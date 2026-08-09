use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use vaultmesh_ffi::{DesktopRuntime, DesktopRuntimeError};
use zeroize::Zeroize;

use crate::{desktop_runtime::write_private_file, unix_millis};

const DEFAULT_IDLE_TIMEOUT_MILLIS: u64 = 15 * 60_000;
const DEFAULT_MAX_UNLOCK_DURATION_MILLIS: u64 = 8 * 60 * 60_000;
const ALLOWED_IDLE_TIMEOUTS_MILLIS: [u64; 4] = [5 * 60_000, 15 * 60_000, 30 * 60_000, 60 * 60_000];
const ALLOWED_MAX_UNLOCK_DURATIONS_MILLIS: [u64; 3] =
    [60 * 60_000, 4 * 60 * 60_000, 8 * 60 * 60_000];

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentAccessSettings {
    pub idle_timeout_ms: u64,
    pub max_unlock_duration_ms: Option<u64>,
    #[serde(default)]
    pub unlock_scope: AgentUnlockScope,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentUnlockScope {
    #[default]
    Connection,
    Client,
}

impl Default for AgentAccessSettings {
    fn default() -> Self {
        Self {
            idle_timeout_ms: DEFAULT_IDLE_TIMEOUT_MILLIS,
            max_unlock_duration_ms: Some(DEFAULT_MAX_UNLOCK_DURATION_MILLIS),
            unlock_scope: AgentUnlockScope::Connection,
        }
    }
}

impl AgentAccessSettings {
    fn validate(self) -> bool {
        ALLOWED_IDLE_TIMEOUTS_MILLIS.contains(&self.idle_timeout_ms)
            && self
                .max_unlock_duration_ms
                .is_none_or(|duration| ALLOWED_MAX_UNLOCK_DURATIONS_MILLIS.contains(&duration))
    }
}

#[derive(Clone, Copy, Debug)]
struct AgentUnlockLease {
    unlocked_at: u64,
    last_activity_at: u64,
    active_operations: u32,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
enum AgentUnlockLeaseOwner {
    Connection(Uuid),
    Client(String),
}

#[derive(Clone)]
pub struct AgentVaultAccess {
    runtime: Arc<Mutex<DesktopRuntime>>,
    leases: Arc<Mutex<HashMap<AgentUnlockLeaseOwner, AgentUnlockLease>>>,
    client_identities: Arc<Mutex<HashMap<Uuid, String>>>,
    settings: Arc<Mutex<AgentAccessSettings>>,
    settings_path: PathBuf,
    operation: Arc<Mutex<()>>,
}

pub struct AgentLeaseActivity {
    access: AgentVaultAccess,
    client_id: Uuid,
}

impl Drop for AgentLeaseActivity {
    fn drop(&mut self) {
        self.access.finish_activity(self.client_id, unix_millis());
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVaultAccessStatus {
    pub has_vault: bool,
    pub runtime_unlocked: bool,
    pub client_unlocked: bool,
    pub active_lease_count: usize,
    pub settings: AgentAccessSettings,
}

impl AgentVaultAccess {
    pub fn new(vault_path: PathBuf, settings_path: PathBuf) -> Result<Self, DesktopRuntimeError> {
        let settings = load_settings(&settings_path);
        Ok(Self {
            runtime: Arc::new(Mutex::new(DesktopRuntime::new(vault_path)?)),
            leases: Arc::new(Mutex::new(HashMap::new())),
            client_identities: Arc::new(Mutex::new(HashMap::new())),
            settings: Arc::new(Mutex::new(settings)),
            settings_path,
            operation: Arc::new(Mutex::new(())),
        })
    }

    pub fn runtime(&self) -> Arc<Mutex<DesktopRuntime>> {
        Arc::clone(&self.runtime)
    }

    pub fn register_client(&self, client_id: Uuid, pairing_identity: String) {
        let Ok(_operation) = self.operation.lock() else {
            return;
        };
        if let Ok(mut identities) = self.client_identities.lock() {
            identities.insert(client_id, pairing_identity);
        }
    }

    pub fn shares_unlock(&self, left: Uuid, right: Uuid) -> bool {
        if left == right {
            return true;
        }
        let Ok(_operation) = self.operation.lock() else {
            return false;
        };
        if !self
            .settings
            .lock()
            .is_ok_and(|settings| settings.unlock_scope == AgentUnlockScope::Client)
        {
            return false;
        }
        self.client_identities.lock().is_ok_and(|identities| {
            identities
                .get(&left)
                .zip(identities.get(&right))
                .is_some_and(|(left, right)| left == right)
        })
    }

    pub fn disconnect_client(&self, client_id: Uuid) -> bool {
        let Ok(_operation) = self.operation.lock() else {
            return false;
        };
        let Ok(settings) = self.settings.lock().map(|settings| *settings) else {
            return false;
        };
        let Ok(mut identities) = self.client_identities.lock() else {
            return false;
        };
        let identity = identities.remove(&client_id);
        let owner = match settings.unlock_scope {
            AgentUnlockScope::Connection => AgentUnlockLeaseOwner::Connection(client_id),
            AgentUnlockScope::Client => {
                let Some(identity) = identity else {
                    return false;
                };
                if identities.values().any(|candidate| candidate == &identity) {
                    return false;
                }
                AgentUnlockLeaseOwner::Client(identity)
            }
        };
        drop(identities);
        self.remove_lease_and_lock_runtime_if_last(&owner)
    }

    pub fn is_unlocked(&self, client_id: Uuid) -> bool {
        self.is_unlocked_at(client_id, unix_millis())
    }

    fn is_unlocked_at(&self, client_id: Uuid, now_millis: u64) -> bool {
        let Ok(_operation) = self.operation.lock() else {
            return false;
        };
        let Ok(settings) = self.settings.lock().map(|settings| *settings) else {
            return false;
        };
        let Ok(identities) = self.client_identities.lock() else {
            return false;
        };
        let Some(owner) = lease_owner(client_id, settings, &identities) else {
            return false;
        };
        drop(identities);
        let Ok(mut leases) = self.leases.lock() else {
            return false;
        };
        let Some(lease) = leases.get_mut(&owner) else {
            return false;
        };
        if lease_expired(*lease, settings, now_millis) {
            return false;
        }
        if !self
            .runtime
            .lock()
            .is_ok_and(|runtime| runtime.status().unlocked)
        {
            return false;
        }
        lease.last_activity_at = now_millis;
        true
    }

    pub fn begin_activity(&self, client_id: Uuid) -> Option<AgentLeaseActivity> {
        let now_millis = unix_millis();
        let _operation = self.operation.lock().ok()?;
        let settings = *self.settings.lock().ok()?;
        let identities = self.client_identities.lock().ok()?;
        let owner = lease_owner(client_id, settings, &identities)?;
        drop(identities);
        let mut leases = self.leases.lock().ok()?;
        let lease = leases.get_mut(&owner)?;
        if lease_expired(*lease, settings, now_millis)
            || !self
                .runtime
                .lock()
                .is_ok_and(|runtime| runtime.status().unlocked)
        {
            return None;
        }
        lease.last_activity_at = now_millis;
        lease.active_operations = lease.active_operations.saturating_add(1);
        Some(AgentLeaseActivity {
            access: self.clone(),
            client_id,
        })
    }

    pub fn status(
        &self,
        client_id: Option<Uuid>,
        selected_vault_path: &std::path::Path,
    ) -> Result<AgentVaultAccessStatus, String> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| "Agent 解锁状态暂时不可用。".to_owned())?;
        let runtime_status = self
            .runtime
            .lock()
            .map_err(|_| "Agent 保险库暂时不可用。".to_owned())?
            .status();
        let selected_runtime = runtime_status.unlocked
            && self
                .runtime
                .lock()
                .map_err(|_| "Agent 保险库暂时不可用。".to_owned())?
                .current_path()
                == selected_vault_path;
        let settings = *self
            .settings
            .lock()
            .map_err(|_| "Agent 自动锁定设置暂时不可用。".to_owned())?;
        let identities = self
            .client_identities
            .lock()
            .map_err(|_| "Agent 客户端身份暂时不可用。".to_owned())?;
        let client_owner =
            client_id.and_then(|client_id| lease_owner(client_id, settings, &identities));
        let leases = self
            .leases
            .lock()
            .map_err(|_| "Agent 解锁状态暂时不可用。".to_owned())?;
        Ok(AgentVaultAccessStatus {
            has_vault: selected_vault_path.is_file(),
            runtime_unlocked: selected_runtime,
            client_unlocked: selected_runtime
                && client_owner.is_some_and(|owner| leases.contains_key(&owner)),
            active_lease_count: leases.len(),
            settings,
        })
    }

    pub fn unlock_with_password(
        &self,
        client_id: Uuid,
        selected_vault_path: PathBuf,
        mut password: String,
    ) -> Result<(), String> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| "Agent 解锁状态暂时不可用。".to_owned())?;
        let settings = *self
            .settings
            .lock()
            .map_err(|_| "Agent 自动锁定设置暂时不可用。".to_owned())?;
        let identities = self
            .client_identities
            .lock()
            .map_err(|_| "Agent 客户端身份暂时不可用。".to_owned())?;
        let owner = lease_owner(client_id, settings, &identities)
            .ok_or_else(|| "Agent 客户端身份不可用，请重新连接。".to_owned())?;
        drop(identities);
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "Agent 保险库暂时不可用。".to_owned())?;
        if runtime.status().unlocked && runtime.current_path() == selected_vault_path {
            let result = runtime
                .verify_master_password(&password)
                .map_err(|error| error.public_message());
            password.zeroize();
            result?;
        } else if runtime.status().unlocked {
            password.zeroize();
            return Err("其他 Vault 仍有活动的 MCP 解锁租约，请先锁定全部 MCP 连接。".to_owned());
        } else {
            runtime
                .unlock_for_agent_from(selected_vault_path, password)
                .map_err(|error| error.public_message())?;
        }
        drop(runtime);
        let now_millis = unix_millis();
        self.leases
            .lock()
            .map_err(|_| "Agent 解锁状态暂时不可用。".to_owned())?
            .insert(
                owner,
                AgentUnlockLease {
                    unlocked_at: now_millis,
                    last_activity_at: now_millis,
                    active_operations: 0,
                },
            );
        Ok(())
    }

    pub fn unlock_with_quick_key(
        &self,
        client_id: Uuid,
        path: PathBuf,
        vault_key: &[u8],
    ) -> Result<(), String> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| "Agent 解锁状态暂时不可用。".to_owned())?;
        let settings = *self
            .settings
            .lock()
            .map_err(|_| "Agent 自动锁定设置暂时不可用。".to_owned())?;
        let identities = self
            .client_identities
            .lock()
            .map_err(|_| "Agent 客户端身份暂时不可用。".to_owned())?;
        let owner = lease_owner(client_id, settings, &identities)
            .ok_or_else(|| "Agent 客户端身份不可用，请重新连接。".to_owned())?;
        drop(identities);
        let mut runtime = self
            .runtime
            .lock()
            .map_err(|_| "Agent 保险库暂时不可用。".to_owned())?;
        if runtime.status().unlocked && runtime.current_path() != path {
            return Err("其他 Vault 仍有活动的 MCP 解锁租约，请先锁定全部 MCP 连接。".to_owned());
        }
        if !runtime.status().unlocked {
            runtime
                .unlock_for_agent_with_quick_key(path, vault_key)
                .map_err(|error| error.public_message())?;
        }
        drop(runtime);
        let now_millis = unix_millis();
        self.leases
            .lock()
            .map_err(|_| "Agent 解锁状态暂时不可用。".to_owned())?
            .insert(
                owner,
                AgentUnlockLease {
                    unlocked_at: now_millis,
                    last_activity_at: now_millis,
                    active_operations: 0,
                },
            );
        Ok(())
    }

    pub fn lock_client(&self, client_id: Uuid) -> Vec<Uuid> {
        let Ok(_operation) = self.operation.lock() else {
            return Vec::new();
        };
        let Ok(settings) = self.settings.lock().map(|settings| *settings) else {
            return Vec::new();
        };
        let Ok(identities) = self.client_identities.lock() else {
            return Vec::new();
        };
        let (owner, affected) = match settings.unlock_scope {
            AgentUnlockScope::Connection => (
                AgentUnlockLeaseOwner::Connection(client_id),
                vec![client_id],
            ),
            AgentUnlockScope::Client => {
                let Some(identity) = identities.get(&client_id).cloned() else {
                    return vec![client_id];
                };
                let affected = identities
                    .iter()
                    .filter_map(|(candidate_id, candidate)| {
                        (candidate == &identity).then_some(*candidate_id)
                    })
                    .collect();
                (AgentUnlockLeaseOwner::Client(identity), affected)
            }
        };
        drop(identities);
        self.remove_lease_and_lock_runtime_if_last(&owner);
        affected
    }

    pub fn lock_all(&self) {
        let Ok(_operation) = self.operation.lock() else {
            return;
        };
        if let Ok(mut leases) = self.leases.lock() {
            leases.clear();
        }
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.lock();
        }
    }

    fn remove_lease_and_lock_runtime_if_last(&self, owner: &AgentUnlockLeaseOwner) -> bool {
        let should_lock_runtime = self.leases.lock().is_ok_and(|mut leases| {
            let removed = leases.remove(owner).is_some();
            removed && leases.is_empty()
        });
        if should_lock_runtime && let Ok(mut runtime) = self.runtime.lock() {
            runtime.lock();
        }
        should_lock_runtime
    }

    pub fn update_settings(
        &self,
        settings: AgentAccessSettings,
        now_millis: u64,
    ) -> Result<Vec<Uuid>, String> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| "Agent 解锁状态暂时不可用。".to_owned())?;
        self.update_settings_locked(settings, now_millis)
    }

    pub fn update_unlock_scope(
        &self,
        unlock_scope: AgentUnlockScope,
        now_millis: u64,
    ) -> Result<(AgentAccessSettings, Vec<Uuid>), String> {
        let _operation = self
            .operation
            .lock()
            .map_err(|_| "Agent 解锁状态暂时不可用。".to_owned())?;
        let mut settings = *self
            .settings
            .lock()
            .map_err(|_| "Agent 自动锁定设置暂时不可用。".to_owned())?;
        settings.unlock_scope = unlock_scope;
        let affected = self.update_settings_locked(settings, now_millis)?;
        Ok((settings, affected))
    }

    fn update_settings_locked(
        &self,
        settings: AgentAccessSettings,
        now_millis: u64,
    ) -> Result<Vec<Uuid>, String> {
        if !settings.validate() {
            return Err("Agent 自动锁定设置超出允许范围。".to_owned());
        }
        let encoded = serde_json::to_vec(&settings)
            .map_err(|_| "无法保存 Agent 自动锁定设置。".to_owned())?;
        write_private_file(
            &self.settings_path,
            &encoded,
            "无法保存 Agent 自动锁定设置。",
        )?;
        let previous = {
            let mut current = self
                .settings
                .lock()
                .map_err(|_| "Agent 自动锁定设置暂时不可用。".to_owned())?;
            let previous = *current;
            *current = settings;
            previous
        };
        if previous.unlock_scope != settings.unlock_scope {
            let affected = self
                .client_identities
                .lock()
                .map_err(|_| "Agent 客户端身份暂时不可用。".to_owned())?
                .keys()
                .copied()
                .collect::<Vec<_>>();
            if let Ok(mut leases) = self.leases.lock() {
                leases.clear();
            }
            if !affected.is_empty()
                && let Ok(mut runtime) = self.runtime.lock()
            {
                runtime.lock();
            }
            return Ok(affected);
        }
        Ok(self.prune_expired_locked(now_millis, settings))
    }

    pub fn prune_expired(&self, now_millis: u64) -> Vec<Uuid> {
        let Ok(_operation) = self.operation.lock() else {
            return Vec::new();
        };
        let Ok(settings) = self.settings.lock().map(|settings| *settings) else {
            return Vec::new();
        };
        self.prune_expired_locked(now_millis, settings)
    }

    fn prune_expired_locked(&self, now_millis: u64, settings: AgentAccessSettings) -> Vec<Uuid> {
        let Ok(mut leases) = self.leases.lock() else {
            return Vec::new();
        };
        let expired_owners = leases
            .iter()
            .filter_map(|(owner, lease)| {
                lease_expired(*lease, settings, now_millis).then_some(owner.clone())
            })
            .collect::<Vec<_>>();
        for owner in &expired_owners {
            leases.remove(owner);
        }
        let should_lock_runtime = !expired_owners.is_empty() && leases.is_empty();
        drop(leases);
        if should_lock_runtime && let Ok(mut runtime) = self.runtime.lock() {
            runtime.lock();
        }
        let Ok(identities) = self.client_identities.lock() else {
            return Vec::new();
        };
        let mut expired_clients = HashSet::new();
        for owner in expired_owners {
            match owner {
                AgentUnlockLeaseOwner::Connection(client_id) => {
                    expired_clients.insert(client_id);
                }
                AgentUnlockLeaseOwner::Client(identity) => {
                    expired_clients.extend(identities.iter().filter_map(
                        |(client_id, candidate)| (candidate == &identity).then_some(*client_id),
                    ));
                }
            }
        }
        expired_clients.into_iter().collect()
    }

    fn finish_activity(&self, client_id: Uuid, now_millis: u64) {
        let Ok(_operation) = self.operation.lock() else {
            return;
        };
        let Ok(settings) = self.settings.lock().map(|settings| *settings) else {
            return;
        };
        let Ok(identities) = self.client_identities.lock() else {
            return;
        };
        let Some(owner) = lease_owner(client_id, settings, &identities) else {
            return;
        };
        drop(identities);
        if let Ok(mut leases) = self.leases.lock()
            && let Some(lease) = leases.get_mut(&owner)
        {
            lease.active_operations = lease.active_operations.saturating_sub(1);
            lease.last_activity_at = now_millis;
        }
    }
}

fn lease_owner(
    client_id: Uuid,
    settings: AgentAccessSettings,
    identities: &HashMap<Uuid, String>,
) -> Option<AgentUnlockLeaseOwner> {
    match settings.unlock_scope {
        AgentUnlockScope::Connection => Some(AgentUnlockLeaseOwner::Connection(client_id)),
        AgentUnlockScope::Client => identities
            .get(&client_id)
            .cloned()
            .map(AgentUnlockLeaseOwner::Client),
    }
}

fn lease_expired(lease: AgentUnlockLease, settings: AgentAccessSettings, now_millis: u64) -> bool {
    let absolute_expired = settings
        .max_unlock_duration_ms
        .is_some_and(|duration| now_millis.saturating_sub(lease.unlocked_at) >= duration);
    let idle_expired = lease.active_operations == 0
        && now_millis.saturating_sub(lease.last_activity_at) >= settings.idle_timeout_ms;
    absolute_expired || idle_expired
}

fn load_settings(path: &std::path::Path) -> AgentAccessSettings {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<AgentAccessSettings>(&bytes).ok())
        .filter(|settings| settings.validate())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PASSWORD: &str = "correct horse battery staple";

    #[test]
    fn ct_agent_unlock_runtime_and_leases_are_independent_from_desktop() {
        let root = std::env::temp_dir().join(format!("vaultmesh-agent-access-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("vaultmesh.vault");
        let mut desktop = DesktopRuntime::new(path.clone()).unwrap();
        desktop.create(PASSWORD.into()).unwrap();
        desktop.lock();
        let access =
            AgentVaultAccess::new(path.clone(), root.join("agent-access-settings.json")).unwrap();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();

        desktop.unlock(PASSWORD.into()).unwrap();
        assert!(!access.is_unlocked(first));
        access
            .unlock_with_password(first, path.clone(), PASSWORD.into())
            .unwrap();
        assert!(access.is_unlocked(first));
        assert!(!access.is_unlocked(second));
        desktop.lock();
        assert!(access.is_unlocked(first));

        access
            .unlock_with_password(second, path.clone(), PASSWORD.into())
            .unwrap();
        access.lock_client(first);
        assert!(!access.is_unlocked(first));
        assert!(access.is_unlocked(second));
        access.lock_client(second);
        assert!(!access.status(None, &path).unwrap().runtime_unlocked);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ct_agent_unlock_uses_the_desktop_selected_vault_without_borrowing_its_session() {
        let root =
            std::env::temp_dir().join(format!("vaultmesh-agent-selected-vault-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let default_path = root.join("missing-default.vault");
        let selected_path = root.join("selected.vault");
        let mut desktop = DesktopRuntime::new(selected_path.clone()).unwrap();
        desktop.create(PASSWORD.into()).unwrap();
        desktop.lock();
        let access =
            AgentVaultAccess::new(default_path, root.join("agent-access-settings.json")).unwrap();
        let client_id = Uuid::new_v4();

        assert!(
            access
                .status(Some(client_id), &selected_path)
                .unwrap()
                .has_vault
        );
        access
            .unlock_with_password(client_id, selected_path.clone(), PASSWORD.into())
            .unwrap();
        assert!(access.is_unlocked(client_id));
        assert!(!desktop.status().unlocked);
        assert_eq!(
            access.runtime().lock().unwrap().current_path(),
            selected_path
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ct_agent_unlock_idle_and_absolute_timeouts_are_independent_and_persisted() {
        let root =
            std::env::temp_dir().join(format!("vaultmesh-agent-access-policy-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("vaultmesh.vault");
        let settings_path = root.join("agent-access-settings.json");
        let mut desktop = DesktopRuntime::new(path.clone()).unwrap();
        desktop.create(PASSWORD.into()).unwrap();
        desktop.lock();
        let access = AgentVaultAccess::new(path.clone(), settings_path.clone()).unwrap();
        assert!(
            access
                .update_settings(
                    AgentAccessSettings {
                        idle_timeout_ms: 10 * 60_000,
                        max_unlock_duration_ms: Some(8 * 60 * 60_000),
                        unlock_scope: AgentUnlockScope::Connection,
                    },
                    unix_millis(),
                )
                .is_err()
        );
        let settings = AgentAccessSettings {
            idle_timeout_ms: 5 * 60_000,
            max_unlock_duration_ms: Some(8 * 60 * 60_000),
            unlock_scope: AgentUnlockScope::Connection,
        };
        access.update_settings(settings, unix_millis()).unwrap();
        let idle_client = Uuid::new_v4();
        access
            .unlock_with_password(idle_client, path.clone(), PASSWORD.into())
            .unwrap();
        let started_at = unix_millis();
        let activity = access.begin_activity(idle_client).unwrap();
        assert!(
            access
                .prune_expired(started_at.saturating_add(6 * 60_000))
                .is_empty()
        );
        drop(activity);
        assert_eq!(
            access.prune_expired(started_at.saturating_add(6 * 60_000)),
            vec![idle_client]
        );

        let absolute_client = Uuid::new_v4();
        access
            .unlock_with_password(absolute_client, path.clone(), PASSWORD.into())
            .unwrap();
        let absolute_started_at = unix_millis();
        let _activity = access.begin_activity(absolute_client).unwrap();
        assert_eq!(
            access.prune_expired(absolute_started_at.saturating_add(9 * 60 * 60_000)),
            vec![absolute_client]
        );
        assert!(!access.runtime().lock().unwrap().status().unlocked);

        drop(access);
        let restored = AgentVaultAccess::new(path, settings_path).unwrap();
        assert_eq!(*restored.settings.lock().unwrap(), settings);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ct_agent_unlock_until_shutdown_disables_only_the_absolute_deadline() {
        let root = std::env::temp_dir().join(format!(
            "vaultmesh-agent-access-until-shutdown-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("vaultmesh.vault");
        let settings_path = root.join("agent-access-settings.json");
        let mut desktop = DesktopRuntime::new(path.clone()).unwrap();
        desktop.create(PASSWORD.into()).unwrap();
        desktop.lock();
        let access = AgentVaultAccess::new(path.clone(), settings_path.clone()).unwrap();
        let settings = AgentAccessSettings {
            idle_timeout_ms: 5 * 60_000,
            max_unlock_duration_ms: None,
            unlock_scope: AgentUnlockScope::Connection,
        };
        access.update_settings(settings, unix_millis()).unwrap();
        let client_id = Uuid::new_v4();
        access
            .unlock_with_password(client_id, path.clone(), PASSWORD.into())
            .unwrap();
        let started_at = unix_millis();
        let activity = access.begin_activity(client_id).unwrap();

        assert!(
            access
                .prune_expired(started_at.saturating_add(30 * 24 * 60 * 60_000))
                .is_empty()
        );
        drop(activity);
        assert_eq!(
            access.prune_expired(started_at.saturating_add(30 * 24 * 60 * 60_000)),
            vec![client_id]
        );

        drop(access);
        let restored = AgentVaultAccess::new(path, settings_path).unwrap();
        assert_eq!(*restored.settings.lock().unwrap(), settings);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ct_agent_unlock_scope_shares_by_client_and_locks_on_the_last_disconnect() {
        let root = std::env::temp_dir().join(format!(
            "vaultmesh-agent-access-client-scope-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("vaultmesh.vault");
        let settings_path = root.join("agent-access-settings.json");
        let mut desktop = DesktopRuntime::new(path.clone()).unwrap();
        desktop.create(PASSWORD.into()).unwrap();
        desktop.lock();
        let access = AgentVaultAccess::new(path.clone(), settings_path).unwrap();
        let first = Uuid::new_v4();
        let second = Uuid::new_v4();
        let other = Uuid::new_v4();
        access.register_client(first, "paired-client-a".into());
        access.register_client(second, "paired-client-a".into());
        access.register_client(other, "paired-client-b".into());
        let client_settings = AgentAccessSettings {
            idle_timeout_ms: 15 * 60_000,
            max_unlock_duration_ms: Some(8 * 60 * 60_000),
            unlock_scope: AgentUnlockScope::Client,
        };
        access
            .update_settings(client_settings, unix_millis())
            .unwrap();
        assert!(access.shares_unlock(first, second));
        assert!(!access.shares_unlock(first, other));

        access
            .unlock_with_password(first, path.clone(), PASSWORD.into())
            .unwrap();
        assert!(access.is_unlocked(first));
        assert!(access.is_unlocked(second));
        assert!(!access.is_unlocked(other));
        let mut locked = access.lock_client(first);
        locked.sort();
        let mut same_identity = vec![first, second];
        same_identity.sort();
        assert_eq!(locked, same_identity);
        assert!(!access.runtime().lock().unwrap().status().unlocked);
        access
            .unlock_with_password(first, path.clone(), PASSWORD.into())
            .unwrap();
        assert!(!access.disconnect_client(first));
        assert!(access.is_unlocked(second));
        assert!(access.disconnect_client(second));
        assert!(!access.runtime().lock().unwrap().status().unlocked);

        access.register_client(first, "paired-client-a".into());
        access.register_client(second, "paired-client-a".into());
        access
            .unlock_with_password(first, path.clone(), PASSWORD.into())
            .unwrap();
        let (connection_settings, mut affected) = access
            .update_unlock_scope(AgentUnlockScope::Connection, unix_millis())
            .unwrap();
        assert_eq!(
            connection_settings,
            AgentAccessSettings {
                unlock_scope: AgentUnlockScope::Connection,
                ..client_settings
            },
            "changing only the scope must preserve the idle and maximum duration settings"
        );
        assert!(!access.shares_unlock(first, second));
        affected.sort();
        let mut expected = vec![first, second, other];
        expected.sort();
        assert_eq!(affected, expected);
        assert!(!access.is_unlocked(first));
        assert!(!access.is_unlocked(second));
        access
            .unlock_with_password(first, path, PASSWORD.into())
            .unwrap();
        assert!(access.is_unlocked(first));
        assert!(!access.is_unlocked(second));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ct_agent_access_settings_without_unlock_scope_default_to_connection() {
        let root = std::env::temp_dir().join(format!(
            "vaultmesh-agent-access-settings-upgrade-{}",
            Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let settings_path = root.join("agent-access-settings.json");
        std::fs::write(
            &settings_path,
            br#"{"idleTimeoutMs":1800000,"maxUnlockDurationMs":null}"#,
        )
        .unwrap();

        assert_eq!(
            load_settings(&settings_path),
            AgentAccessSettings {
                idle_timeout_ms: 30 * 60_000,
                max_unlock_duration_ms: None,
                unlock_scope: AgentUnlockScope::Connection,
            }
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
