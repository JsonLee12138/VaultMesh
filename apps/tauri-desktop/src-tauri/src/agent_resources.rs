use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::{Read, Write},
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use atomic_write_file::OpenOptions as AtomicOpenOptions;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::agent_broker::AgentExecutionScope;

const MAX_RESOURCE_BYTES: usize = 32 * 1024 * 1024;
const MAX_RESOURCES: usize = 32;
const RESOURCE_TTL_MILLIS: u64 = 5 * 60_000;

struct ResourceBinding {
    client_id: Uuid,
    session_id: Uuid,
    account_ref: String,
    cancellation: Arc<AtomicBool>,
    expires_at: u64,
}

impl ResourceBinding {
    fn new(scope: &AgentExecutionScope, account_ref: &str, now_millis: u64) -> Self {
        Self {
            client_id: scope.client_id,
            session_id: scope.session_id,
            account_ref: account_ref.to_owned(),
            cancellation: Arc::clone(&scope.cancellation),
            expires_at: now_millis.saturating_add(RESOURCE_TTL_MILLIS),
        }
    }

    fn permits(&self, scope: &AgentExecutionScope, account_ref: &str, now_millis: u64) -> bool {
        self.client_id == scope.client_id
            && self.session_id == scope.session_id
            && self.account_ref == account_ref
            && self.expires_at > now_millis
            && !self.cancellation.load(Ordering::Acquire)
    }

    fn live(&self, now_millis: u64) -> bool {
        self.expires_at > now_millis && !self.cancellation.load(Ordering::Acquire)
    }
}

struct InputFileResource {
    binding: ResourceBinding,
    purpose: String,
    digest: String,
    bytes: Zeroizing<Vec<u8>>,
}

struct ResultResource {
    binding: ResourceBinding,
    purpose: String,
    suggested_basename: String,
    bytes: Zeroizing<Vec<u8>>,
}

pub(crate) struct AgentInputFile {
    pub digest: String,
    pub bytes: Zeroizing<Vec<u8>>,
}

pub(crate) struct AgentInputFileSelection<'a> {
    pub scope: &'a AgentExecutionScope,
    pub account_ref: &'a str,
    pub purpose: &'a str,
    pub basename: &'a str,
    pub mime: &'a str,
    pub bytes: Zeroizing<Vec<u8>>,
    pub now_millis: u64,
}

pub(crate) struct AgentResultForSave {
    pub result_id: Uuid,
    pub suggested_basename: String,
    pub bytes: Zeroizing<Vec<u8>>,
}

#[derive(Default)]
pub(crate) struct AgentResourceStore {
    input_files: HashMap<Uuid, InputFileResource>,
    results: HashMap<Uuid, ResultResource>,
}

impl AgentResourceStore {
    pub fn add_input_file(
        &mut self,
        selection: AgentInputFileSelection<'_>,
    ) -> Result<Value, &'static str> {
        let AgentInputFileSelection {
            scope,
            account_ref,
            purpose,
            basename,
            mime,
            bytes,
            now_millis,
        } = selection;
        self.prune(now_millis);
        if self.input_files.len().saturating_add(self.results.len()) >= MAX_RESOURCES
            || bytes.is_empty()
            || bytes.len() > MAX_RESOURCE_BYTES
            || !valid_purpose(purpose)
            || !valid_basename(basename)
            || !valid_mime(mime)
        {
            return Err("resource-policy-invalid");
        }
        let file_ref = Uuid::new_v4();
        let size = bytes.len() as u64;
        let digest = format!("sha256:{:x}", Sha256::digest(bytes.as_slice()));
        self.input_files.insert(
            file_ref,
            InputFileResource {
                binding: ResourceBinding::new(scope, account_ref, now_millis),
                purpose: purpose.to_owned(),
                digest: digest.clone(),
                bytes,
            },
        );
        Ok(json!({
            "fileRef": file_ref,
            "basename": basename,
            "size": size,
            "mime": mime,
            "sha256": digest,
            "expiresAt": now_millis.saturating_add(RESOURCE_TTL_MILLIS)
        }))
    }

    pub fn consume_input_file(
        &mut self,
        file_ref: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
        purpose: &str,
        now_millis: u64,
    ) -> Result<AgentInputFile, &'static str> {
        self.prune(now_millis);
        let file_ref = Uuid::parse_str(file_ref).map_err(|_| "unknown-file-handle")?;
        let permitted = self.input_files.get(&file_ref).is_some_and(|resource| {
            resource.purpose == purpose && resource.binding.permits(scope, account_ref, now_millis)
        });
        if !permitted {
            return Err("unknown-file-handle");
        }
        let resource = self
            .input_files
            .remove(&file_ref)
            .ok_or("unknown-file-handle")?;
        Ok(AgentInputFile {
            digest: resource.digest,
            bytes: resource.bytes,
        })
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_result(
        &mut self,
        scope: &AgentExecutionScope,
        account_ref: &str,
        purpose: &str,
        suggested_basename: &str,
        mime: &str,
        bytes: Zeroizing<Vec<u8>>,
        now_millis: u64,
    ) -> Result<Value, &'static str> {
        self.prune(now_millis);
        if self.input_files.len().saturating_add(self.results.len()) >= MAX_RESOURCES
            || bytes.is_empty()
            || bytes.len() > MAX_RESOURCE_BYTES
            || !valid_purpose(purpose)
            || !valid_basename(suggested_basename)
            || !valid_mime(mime)
        {
            return Err("resource-policy-invalid");
        }
        let result_ref = Uuid::new_v4();
        let size = bytes.len() as u64;
        let digest = format!("sha256:{:x}", Sha256::digest(bytes.as_slice()));
        self.results.insert(
            result_ref,
            ResultResource {
                binding: ResourceBinding::new(scope, account_ref, now_millis),
                purpose: purpose.to_owned(),
                suggested_basename: suggested_basename.to_owned(),
                bytes,
            },
        );
        Ok(json!({
            "resultRef": result_ref,
            "size": size,
            "mime": mime,
            "sha256": digest,
            "expiresAt": now_millis.saturating_add(RESOURCE_TTL_MILLIS)
        }))
    }

    pub fn result_for_save(
        &mut self,
        result_ref: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
        now_millis: u64,
    ) -> Result<AgentResultForSave, &'static str> {
        self.prune(now_millis);
        let result_id = Uuid::parse_str(result_ref).map_err(|_| "unknown-result-handle")?;
        let resource = self
            .results
            .get(&result_id)
            .ok_or("unknown-result-handle")?;
        if resource.purpose.is_empty() || !resource.binding.permits(scope, account_ref, now_millis)
        {
            return Err("unknown-result-handle");
        }
        Ok(AgentResultForSave {
            result_id,
            suggested_basename: resource.suggested_basename.clone(),
            bytes: Zeroizing::new(resource.bytes.to_vec()),
        })
    }

    pub fn complete_result_save(&mut self, result_id: Uuid) {
        self.results.remove(&result_id);
    }

    pub fn revoke_client(&mut self, client_id: Uuid) {
        self.input_files
            .retain(|_, resource| resource.binding.client_id != client_id);
        self.results
            .retain(|_, resource| resource.binding.client_id != client_id);
    }

    pub fn revoke_session(&mut self, session_id: Uuid) {
        self.input_files
            .retain(|_, resource| resource.binding.session_id != session_id);
        self.results
            .retain(|_, resource| resource.binding.session_id != session_id);
    }

    pub fn clear(&mut self) {
        self.input_files.clear();
        self.results.clear();
    }

    pub fn prune(&mut self, now_millis: u64) {
        self.input_files
            .retain(|_, resource| resource.binding.live(now_millis));
        self.results
            .retain(|_, resource| resource.binding.live(now_millis));
    }
}

pub(crate) fn load_selected_file(
    path: &Path,
) -> Result<(String, String, Zeroizing<Vec<u8>>), &'static str> {
    let mut file = open_selected_file(path)?;
    let metadata = file.metadata().map_err(|_| "local-file-unavailable")?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_RESOURCE_BYTES as u64 {
        return Err("local-file-policy-denied");
    }
    let basename = path
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| valid_basename(name))
        .unwrap_or("selected-file")
        .to_owned();
    let mime = mime_for_basename(&basename).to_owned();
    let mut bytes = Zeroizing::new(Vec::with_capacity(metadata.len() as usize));
    Read::by_ref(&mut file)
        .take((MAX_RESOURCE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| "local-file-unavailable")?;
    if bytes.is_empty() || bytes.len() > MAX_RESOURCE_BYTES {
        return Err("local-file-policy-denied");
    }
    Ok((basename, mime, bytes))
}

#[cfg(unix)]
fn open_selected_file(path: &Path) -> Result<File, &'static str> {
    use std::os::unix::fs::OpenOptionsExt;

    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|_| "local-file-unavailable")
}

#[cfg(windows)]
fn open_selected_file(path: &Path) -> Result<File, &'static str> {
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
    OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|_| "local-file-unavailable")
}

pub(crate) fn save_result_bytes(path: &Path, bytes: &[u8]) -> Result<(), &'static str> {
    if path.file_name().is_none() || bytes.is_empty() || bytes.len() > MAX_RESOURCE_BYTES {
        return Err("result-save-denied");
    }
    let mut options = AtomicOpenOptions::new();
    #[cfg(unix)]
    {
        use atomic_write_file::unix::OpenOptionsExt as AtomicOpenOptionsExt;
        use std::os::unix::fs::OpenOptionsExt as StandardOpenOptionsExt;

        AtomicOpenOptionsExt::preserve_mode(&mut options, false);
        StandardOpenOptionsExt::mode(&mut options, 0o600);
    }
    let mut file = options.open(path).map_err(|_| "result-save-unavailable")?;
    file.write_all(bytes)
        .and_then(|()| file.commit())
        .map_err(|_| "result-save-unavailable")
}

fn mime_for_basename(basename: &str) -> &'static str {
    let extension = Path::new(basename)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match extension.as_str() {
        "json" => "application/json",
        "txt" | "log" | "md" => "text/plain",
        "csv" => "text/csv",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn valid_purpose(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn valid_basename(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && value != "."
        && value != ".."
        && !value.contains(['/', '\\'])
        && !value.chars().any(char::is_control)
}

fn valid_mime(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.is_ascii()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'+' | b'-' | b'.'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scope(session_id: Uuid) -> AgentExecutionScope {
        AgentExecutionScope {
            client_id: Uuid::from_u128(1),
            session_id,
            cancellation: Arc::new(AtomicBool::new(false)),
            direct_ssh_policy: None,
            direct_http_policy: None,
            direct_connector_policy: None,
        }
    }

    #[test]
    fn file_handles_are_task_account_purpose_expiry_and_one_use_bound() {
        let session = Uuid::from_u128(2);
        let session_scope = scope(session);
        let mut store = AgentResourceStore::default();
        let metadata = store
            .add_input_file(AgentInputFileSelection {
                scope: &session_scope,
                account_ref: "account-a",
                purpose: "ssh-upload",
                basename: "release.bin",
                mime: "application/octet-stream",
                bytes: Zeroizing::new(b"fixture".to_vec()),
                now_millis: 1_000,
            })
            .unwrap();
        let serialized = metadata.to_string();
        assert!(!serialized.contains("/Users/"));
        let file_ref = metadata["fileRef"].as_str().unwrap();
        assert_eq!(
            store
                .consume_input_file(
                    file_ref,
                    &scope(Uuid::from_u128(3)),
                    "account-a",
                    "ssh-upload",
                    1_001,
                )
                .err()
                .unwrap(),
            "unknown-file-handle"
        );
        let file = store
            .consume_input_file(file_ref, &session_scope, "account-a", "ssh-upload", 1_001)
            .unwrap();
        assert_eq!(file.bytes.as_slice(), b"fixture");
        assert_eq!(
            store
                .consume_input_file(file_ref, &session_scope, "account-a", "ssh-upload", 1_002,)
                .err()
                .unwrap(),
            "unknown-file-handle"
        );
    }

    #[test]
    fn cancellation_and_expiry_destroy_broker_owned_resources() {
        let session = Uuid::from_u128(2);
        let session_scope = scope(session);
        let cancellation = Arc::clone(&session_scope.cancellation);
        let mut store = AgentResourceStore::default();
        let result = store
            .add_result(
                &session_scope,
                "account-a",
                "ssh-download",
                "result.bin",
                "application/octet-stream",
                Zeroizing::new(b"fixture".to_vec()),
                1_000,
            )
            .unwrap();
        cancellation.store(true, Ordering::Release);
        assert_eq!(
            store
                .result_for_save(
                    result["resultRef"].as_str().unwrap(),
                    &session_scope,
                    "account-a",
                    1_001,
                )
                .err()
                .unwrap(),
            "unknown-result-handle"
        );
        assert!(store.results.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn selected_file_rejects_symlinks_and_result_save_is_atomic_and_owner_only() {
        use std::{fs, os::unix::fs::PermissionsExt, os::unix::fs::symlink};

        let directory = Path::new("/tmp").join(format!(
            "vaultmesh-agent-resource-{}",
            Uuid::new_v4().simple()
        ));
        fs::create_dir(&directory).unwrap();
        let source = directory.join("input.txt");
        let link = directory.join("input-link.txt");
        let destination = directory.join("saved.txt");
        fs::write(&source, b"resource-fixture").unwrap();
        symlink(&source, &link).unwrap();

        let (basename, mime, bytes) = load_selected_file(&source).unwrap();
        assert_eq!(basename, "input.txt");
        assert_eq!(mime, "text/plain");
        assert_eq!(bytes.as_slice(), b"resource-fixture");
        assert_eq!(
            load_selected_file(&link).err().unwrap(),
            "local-file-unavailable"
        );
        save_result_bytes(&destination, b"saved-fixture").unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"saved-fixture");
        assert_eq!(
            fs::metadata(&destination).unwrap().permissions().mode() & 0o777,
            0o600
        );

        fs::remove_file(&link).unwrap();
        fs::remove_file(&source).unwrap();
        fs::remove_file(&destination).unwrap();
        fs::remove_dir(&directory).unwrap();
    }
}
