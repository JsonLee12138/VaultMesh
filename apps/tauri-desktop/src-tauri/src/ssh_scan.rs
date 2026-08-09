use std::{collections::HashMap, path::Path};

use base64::{
    Engine as _,
    engine::general_purpose::{STANDARD, STANDARD_NO_PAD},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use vaultmesh_ffi::DesktopRuntime;
use zeroize::Zeroizing;

const MAX_DIRECTORY_ENTRIES: usize = 500;
const MAX_CANDIDATES: usize = 200;
const MAX_KEY_FILE_BYTES: u64 = 1024 * 1024;
const SESSION_LIFETIME_MILLIS: u64 = 10 * 60 * 1_000;

struct Candidate {
    entry_id: Uuid,
    name: String,
    public_key: Option<Zeroizing<String>>,
    private_key: Option<Zeroizing<String>>,
    algorithm: Option<String>,
    fingerprint: Option<String>,
}

struct PendingScan {
    expires_at: u64,
    candidates: Vec<Candidate>,
}

struct ManualPublicKey {
    contents: Zeroizing<String>,
    algorithm: String,
    fingerprint: String,
}

#[derive(Default)]
pub struct SshScanService {
    pending: HashMap<Uuid, PendingScan>,
}

impl SshScanService {
    pub fn scan(
        &mut self,
        directory: &Path,
        runtime: &mut DesktopRuntime,
        now_millis: u64,
    ) -> Result<Value, String> {
        self.prune(now_millis);
        let (discovered, scanned_count, mut skipped_count) = discover(directory)?;
        let mut candidates = Vec::new();
        for candidate in discovered {
            let duplicate = runtime
                .execute(
                    "_native.ssh.has-key",
                    json!({
                        "publicKey": candidate.public_key.as_ref().map(|value| value.as_str()),
                        "privateKey": candidate.private_key.as_ref().map(|value| value.as_str()),
                    }),
                )
                .map_err(|error| error.public_message().to_owned())?["duplicate"]
                .as_bool()
                .unwrap_or(false);
            if duplicate {
                skipped_count += 1;
            } else if candidates.len() < MAX_CANDIDATES {
                candidates.push(candidate);
            } else {
                skipped_count += 1;
            }
        }
        let session_id = Uuid::new_v4();
        let items = candidates
            .iter()
            .map(|candidate| {
                json!({
                    "entryId": candidate.entry_id,
                    "name": candidate.name,
                    "kind": if candidate.public_key.is_some() && candidate.private_key.is_some() {
                        "keyPair"
                    } else if candidate.private_key.is_some() {
                        "privateKey"
                    } else {
                        "publicKey"
                    },
                    "algorithm": candidate.algorithm,
                    "fingerprint": candidate.fingerprint,
                    "duplicate": false,
                })
            })
            .collect::<Vec<_>>();
        self.pending.insert(
            session_id,
            PendingScan {
                expires_at: now_millis.saturating_add(SESSION_LIFETIME_MILLIS),
                candidates,
            },
        );
        Ok(json!({
            "sessionId": session_id,
            "scannedCount": scanned_count,
            "skippedCount": skipped_count,
            "items": items,
        }))
    }

    pub fn commit(
        &mut self,
        session_id: &str,
        entry_ids: &[Value],
        public_key_overrides: Option<&serde_json::Map<String, Value>>,
        runtime: &mut DesktopRuntime,
        now_millis: u64,
    ) -> Result<Value, String> {
        self.prune(now_millis);
        if entry_ids.is_empty() || entry_ids.len() > MAX_CANDIDATES {
            return Err("请求参数无效。".to_owned());
        }
        let session_id = Uuid::parse_str(session_id).map_err(|_| "请求参数无效。")?;
        let selected = entry_ids
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .and_then(|value| Uuid::parse_str(value).ok())
                    .ok_or("请求参数无效。")
            })
            .collect::<Result<std::collections::HashSet<_>, _>>()?;
        let pending = self
            .pending
            .get(&session_id)
            .ok_or("密钥扫描结果已失效，请重新扫描。")?;
        let selected_count = pending
            .candidates
            .iter()
            .filter(|candidate| selected.contains(&candidate.entry_id))
            .count();
        if selected_count != selected.len() {
            return Err("选择的密钥不存在或已失效。".to_owned());
        }
        let mut manual_public_keys =
            validate_public_key_overrides(public_key_overrides, &selected, &pending.candidates)?;
        let pending = self
            .pending
            .remove(&session_id)
            .ok_or("密钥扫描结果已失效，请重新扫描。")?;
        let mut candidates = pending
            .candidates
            .into_iter()
            .filter(|candidate| selected.contains(&candidate.entry_id))
            .collect::<Vec<_>>();
        for candidate in &mut candidates {
            if let Some(public_key) = manual_public_keys.remove(&candidate.entry_id) {
                candidate.public_key = Some(public_key.contents);
                candidate.algorithm = Some(public_key.algorithm);
                candidate.fingerprint = Some(public_key.fingerprint);
            }
        }
        let items = candidates
            .iter()
            .map(|candidate| {
                json!({
                    "title": candidate.name,
                    "host": null,
                    "port": 22,
                    "username": "",
                    "password": null,
                    "publicKey": candidate.public_key.as_ref().map(|value| value.as_str()),
                    "privateKey": candidate.private_key.as_ref().map(|value| value.as_str()),
                    "keyPassphrase": null,
                    "notes": null,
                    "folder": "本地 SSH 密钥",
                    "favorite": false,
                    "masterPasswordReprompt": true,
                    "recordKind": "key",
                })
            })
            .collect::<Vec<_>>();
        runtime
            .execute("_native.ssh.import", json!({ "items": items }))
            .map_err(|error| error.public_message().to_owned())
    }

    pub fn cancel(&mut self, session_id: &str, now_millis: u64) -> Result<(), String> {
        self.prune(now_millis);
        let session_id = Uuid::parse_str(session_id).map_err(|_| "请求参数无效。")?;
        self.pending.remove(&session_id);
        Ok(())
    }

    pub fn clear(&mut self) {
        self.pending.clear();
    }

    fn prune(&mut self, now_millis: u64) {
        self.pending
            .retain(|_, pending| pending.expires_at > now_millis);
    }
}

fn validate_public_key_overrides(
    values: Option<&serde_json::Map<String, Value>>,
    selected: &std::collections::HashSet<Uuid>,
    candidates: &[Candidate],
) -> Result<HashMap<Uuid, ManualPublicKey>, String> {
    let Some(values) = values else {
        return Ok(HashMap::new());
    };
    if values.len() > MAX_CANDIDATES {
        return Err("请求参数无效。".to_owned());
    }
    let mut overrides = HashMap::new();
    for (entry_id, value) in values {
        let entry_id = Uuid::parse_str(entry_id).map_err(|_| "请求参数无效。")?;
        if !selected.contains(&entry_id) {
            return Err("手动公钥只能提交给本次选择的 SSH 私钥。".to_owned());
        }
        let candidate = candidates
            .iter()
            .find(|candidate| candidate.entry_id == entry_id)
            .ok_or("选择的密钥不存在或已失效。")?;
        if candidate.private_key.is_none() || candidate.public_key.is_some() {
            return Err("只有仅含私钥的候选可以手动补充公钥。".to_owned());
        }
        let public_key = value
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.len() <= MAX_KEY_FILE_BYTES as usize)
            .ok_or("请求参数无效。")?;
        let (algorithm, fingerprint) =
            parse_public_key(public_key).ok_or("公钥格式无效，请粘贴单行 OpenSSH 公钥。")?;
        overrides.insert(
            entry_id,
            ManualPublicKey {
                contents: Zeroizing::new(public_key.to_owned()),
                algorithm,
                fingerprint,
            },
        );
    }
    Ok(overrides)
}

fn discover(directory: &Path) -> Result<(Vec<Candidate>, usize, usize), String> {
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Vec::new(), 0, 0));
        }
        Err(_) => return Err("无法读取本地 SSH 密钥目录。".to_owned()),
    };
    let mut paths = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .collect::<Vec<_>>();
    paths.sort();
    let scanned_count = paths.len().min(MAX_DIRECTORY_ENTRIES);
    let mut skipped_count = paths.len().saturating_sub(MAX_DIRECTORY_ENTRIES);
    let mut files = HashMap::<String, Zeroizing<String>>::new();
    for path in paths.into_iter().take(MAX_DIRECTORY_ENTRIES) {
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            skipped_count += 1;
            continue;
        };
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            skipped_count += 1;
            continue;
        };
        if !metadata.is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() == 0
            || metadata.len() > MAX_KEY_FILE_BYTES
            || matches!(
                name,
                "config" | "known_hosts" | "known_hosts.old" | "authorized_keys"
            )
            || name.ends_with("-cert.pub")
        {
            skipped_count += 1;
            continue;
        }
        let Ok(contents) = std::fs::read_to_string(&path) else {
            skipped_count += 1;
            continue;
        };
        if parse_public_key(&contents).is_none() && !is_private_key(&contents) {
            skipped_count += 1;
            continue;
        }
        files.insert(name.to_owned(), Zeroizing::new(contents.trim().to_owned()));
    }

    let mut consumed = std::collections::HashSet::new();
    let mut names = files.keys().cloned().collect::<Vec<_>>();
    names.sort();
    let mut candidates = Vec::new();
    for name in names {
        if consumed.contains(&name) || candidates.len() >= MAX_CANDIDATES {
            continue;
        }
        let Some(contents) = files.remove(&name) else {
            continue;
        };
        if is_private_key(contents.as_str()) {
            let public_name = format!("{name}.pub");
            let public_key = files.remove(&public_name);
            if public_key.is_some() {
                consumed.insert(public_name);
            }
            let metadata = public_key
                .as_ref()
                .and_then(|value| parse_public_key(value.as_str()));
            candidates.push(Candidate {
                entry_id: Uuid::new_v4(),
                name: name.clone(),
                public_key,
                private_key: Some(contents),
                algorithm: metadata.as_ref().map(|value| value.0.clone()).or_else(|| {
                    Some(
                        if name.contains("rsa") {
                            "RSA"
                        } else {
                            "OpenSSH"
                        }
                        .to_owned(),
                    )
                }),
                fingerprint: metadata.map(|value| value.1),
            });
        } else if let Some((algorithm, fingerprint)) = parse_public_key(contents.as_str()) {
            candidates.push(Candidate {
                entry_id: Uuid::new_v4(),
                name: name.trim_end_matches(".pub").to_owned(),
                public_key: Some(contents),
                private_key: None,
                algorithm: Some(algorithm),
                fingerprint: Some(fingerprint),
            });
        }
        consumed.insert(name);
    }
    skipped_count += files.len();
    Ok((candidates, scanned_count, skipped_count))
}

fn parse_public_key(contents: &str) -> Option<(String, String)> {
    let mut lines = contents.trim().lines();
    let line = lines.next()?;
    if lines.next().is_some() {
        return None;
    }
    let mut parts = line.split_whitespace();
    let algorithm = parts.next()?;
    let encoded = parts.next()?;
    if !(algorithm.starts_with("ssh-")
        || algorithm.starts_with("ecdsa-sha2-")
        || algorithm.starts_with("sk-"))
    {
        return None;
    }
    let blob = STANDARD
        .decode(encoded)
        .or_else(|_| STANDARD_NO_PAD.decode(encoded))
        .ok()?;
    if blob.is_empty() {
        return None;
    }
    let digest = STANDARD.encode(Sha256::digest(&blob));
    Some((
        algorithm.to_owned(),
        format!("SHA256:{}", digest.trim_end_matches('=')),
    ))
}

fn is_private_key(contents: &str) -> bool {
    let trimmed = contents.trim();
    [
        "OPENSSH PRIVATE KEY",
        "RSA PRIVATE KEY",
        "EC PRIVATE KEY",
        "DSA PRIVATE KEY",
        "PRIVATE KEY",
        "ENCRYPTED PRIVATE KEY",
    ]
    .iter()
    .any(|label| {
        trimmed.starts_with(&format!("-----BEGIN {label}-----"))
            && trimmed.contains(&format!("-----END {label}-----"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scanner_rejects_symlinks_and_never_returns_key_material_in_preview() {
        let root = std::env::temp_dir().join(format!("vaultmesh-ssh-scan-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("root");
        let public =
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJmJXW7XQzG7AnHjJIeBMZJjUjXoAnrYMRZiLHB4pJg test";
        std::fs::write(root.join("id_test.pub"), public).expect("public key");
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("id_test.pub"), root.join("linked.pub"))
            .expect("symlink");
        let (candidates, scanned, skipped) = discover(&root).expect("discover");
        assert_eq!(candidates.len(), 1);
        assert_eq!(scanned, 2);
        assert_eq!(skipped, 1);
        let preview = json!({
            "name": candidates[0].name,
            "algorithm": candidates[0].algorithm,
            "fingerprint": candidates[0].fingerprint,
        });
        let encoded = serde_json::to_string(&preview).expect("preview");
        assert!(!encoded.contains("AAAAC3"));
        std::fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn private_key_candidates_accept_an_optional_manual_public_key_on_commit() {
        let root =
            std::env::temp_dir().join(format!("vaultmesh-ssh-manual-public-{}", Uuid::new_v4()));
        let ssh_directory = root.join(".ssh");
        std::fs::create_dir_all(&ssh_directory).expect("ssh directory");
        let paired_private = "-----BEGIN OPENSSH PRIVATE KEY-----\npaired-private-material\n-----END OPENSSH PRIVATE KEY-----";
        let private_only = "-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-only-material\n-----END OPENSSH PRIVATE KEY-----";
        std::fs::write(ssh_directory.join("id_paired"), paired_private).expect("paired private");
        std::fs::write(ssh_directory.join("id_private_only"), private_only).expect("private only");

        let vault_path = root.join("scan.vault");
        let mut runtime = DesktopRuntime::new(vault_path).expect("runtime");
        runtime
            .create("correct horse battery staple".into())
            .expect("create vault");
        let mut service = SshScanService::default();
        let preview = service
            .scan(&ssh_directory, &mut runtime, 100)
            .expect("scan");
        let items = preview["items"].as_array().expect("items");
        assert_eq!(items.len(), 2);
        assert!(items.iter().all(|item| item["kind"] == "privateKey"));
        let entry_ids = items
            .iter()
            .map(|item| item["entryId"].clone())
            .collect::<Vec<_>>();
        let paired_id = items
            .iter()
            .find(|item| item["name"] == "id_paired")
            .and_then(|item| item["entryId"].as_str())
            .expect("paired id");
        let manual_public = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGV4YW1wbGU= manual@test";
        let invalid_overrides = serde_json::Map::from_iter([(
            paired_id.to_owned(),
            Value::String("not-an-openssh-public-key".to_owned()),
        )]);
        let error = service
            .commit(
                preview["sessionId"].as_str().expect("session id"),
                &entry_ids,
                Some(&invalid_overrides),
                &mut runtime,
                101,
            )
            .expect_err("invalid public key");
        assert!(error.contains("公钥格式无效"));

        let overrides = serde_json::Map::from_iter([(
            paired_id.to_owned(),
            Value::String(manual_public.to_owned()),
        )]);

        let result = service
            .commit(
                preview["sessionId"].as_str().expect("session id"),
                &entry_ids,
                Some(&overrides),
                &mut runtime,
                102,
            )
            .expect("commit");

        assert_eq!(result["importedCount"], 2);
        assert!(
            result["items"]
                .as_array()
                .expect("imported items")
                .iter()
                .all(|item| item["recordKind"] == "key")
        );
        assert_eq!(runtime.status().item_count, 2);
        assert_eq!(
            runtime
                .execute(
                    "_native.ssh.has-key",
                    json!({ "publicKey": manual_public, "privateKey": null }),
                )
                .expect("manual public duplicate")["duplicate"],
            true
        );
        assert_eq!(
            runtime
                .execute(
                    "_native.ssh.has-key",
                    json!({ "publicKey": null, "privateKey": private_only }),
                )
                .expect("private-only duplicate")["duplicate"],
            true
        );
        runtime.lock();
        std::fs::remove_dir_all(root).expect("cleanup");
    }
}
