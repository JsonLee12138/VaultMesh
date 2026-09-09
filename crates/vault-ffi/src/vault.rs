use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock, Weak},
};

use sha2::{Digest, Sha256};
use vaultmesh_core::{VaultError, VaultSession};

use crate::{
    VAULTMESH_STATUS_AUTH_FAILED, VAULTMESH_STATUS_CONFLICT, VAULTMESH_STATUS_CORE_ERROR,
    VAULTMESH_STATUS_INVALID_ARGUMENT, VAULTMESH_STATUS_LOCKED, VAULTMESH_STATUS_NOT_FOUND,
    VAULTMESH_STATUS_REAUTH_REQUIRED, VAULTMESH_STATUS_VALUE_UNAVAILABLE, VaultmeshStatus,
};

pub(crate) struct VaultmeshVault {
    pub(crate) session: VaultSession,
    pub(crate) path: PathBuf,
    pub(crate) persisted_fingerprint: [u8; 32],
}

static MUTATION_LOCKS: OnceLock<Mutex<HashMap<PathBuf, Weak<Mutex<()>>>>> = OnceLock::new();

pub(crate) fn vault_fingerprint(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

pub(crate) fn mutation_lock(path: &Path) -> Arc<Mutex<()>> {
    let lock_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let locks = MUTATION_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(&lock_path).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(Mutex::new(()));
    locks.insert(lock_path, Arc::downgrade(&lock));
    lock
}

pub(crate) fn map_core_error(error: VaultError) -> VaultmeshStatus {
    match error {
        VaultError::UnlockFailed => VAULTMESH_STATUS_AUTH_FAILED,
        VaultError::Locked => VAULTMESH_STATUS_LOCKED,
        VaultError::ItemNotFound
        | VaultError::ServiceNotFound
        | VaultError::ApiEnvironmentNotFound => VAULTMESH_STATUS_NOT_FOUND,
        VaultError::ApiRequestPlanStale | VaultError::ServiceAggregationPlanExpired => {
            VAULTMESH_STATUS_CONFLICT
        }
        VaultError::MasterPasswordRequired => VAULTMESH_STATUS_REAUTH_REQUIRED,
        VaultError::InvalidAgentConnectorDefinition
        | VaultError::InvalidService
        | VaultError::InvalidApiEnvironment
        | VaultError::InvalidApiRequest => VAULTMESH_STATUS_INVALID_ARGUMENT,
        VaultError::TotpUnavailable
        | VaultError::RecoveryCodesUnavailable
        | VaultError::CardSecretUnavailable
        | VaultError::SshSecretUnavailable => VAULTMESH_STATUS_VALUE_UNAVAILABLE,
        _ => VAULTMESH_STATUS_CORE_ERROR,
    }
}
