use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::Path,
};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::SecuritySettings;

const LEGACY_VAULT_NAME: &str = "VaultMesh.vaultmesh";
const TAURI_VAULT_NAME: &str = "vaultmesh.vault";
const SETTINGS_NAME: &str = "security-settings.json";
const RECEIPT_NAME: &str = "electron-migration-v1.json";
const PENDING_RECEIPT_NAME: &str = "electron-migration-pending-v1.json";
const MAX_VAULT_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SETTINGS_BYTES: u64 = 64 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MigrationOutcome {
    DisabledForPreview,
    ExistingTauriVault,
    NoLegacyVault,
    Migrated { settings_migrated: bool },
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MigrationReceipt {
    version: u8,
    source: String,
    vault_copied: bool,
    settings_copied: bool,
    quick_unlock_reset: bool,
    browser_pairing_reset: bool,
    verified_by_master_password: bool,
}

pub(crate) fn should_migrate_legacy(identifier: &str) -> bool {
    identifier != "com.vaultmesh.tauri.preview"
}

/// Copies the encrypted Electron Vault into the Tauri-owned data directory.
///
/// The Electron source is deliberately retained as rollback evidence. Existing
/// Tauri data is never replaced, and device-bound quick-unlock/browser pairing
/// material is deliberately excluded.
pub(crate) fn migrate_legacy_electron_data(
    app_data: &Path,
    legacy_data: &Path,
    enabled: bool,
) -> io::Result<MigrationOutcome> {
    if !enabled {
        return Ok(MigrationOutcome::DisabledForPreview);
    }

    let destination = app_data.join(TAURI_VAULT_NAME);
    if destination.try_exists()? {
        return Ok(MigrationOutcome::ExistingTauriVault);
    }

    let source = legacy_data.join(LEGACY_VAULT_NAME);
    if !source.try_exists()? {
        return Ok(MigrationOutcome::NoLegacyVault);
    }

    create_private_directory(app_data)?;
    // Publication uses a no-clobber hard link, so concurrent launches cannot
    // replace a destination created after the initial check.
    if destination.try_exists()? {
        return Ok(MigrationOutcome::ExistingTauriVault);
    }

    publish_private_copy(&source, &destination, MAX_VAULT_BYTES)?;

    let settings_migrated = migrate_settings(
        &legacy_data.join(SETTINGS_NAME),
        &app_data.join(SETTINGS_NAME),
    );
    let pending_receipt = serde_json::to_vec(&MigrationReceipt {
        version: 1,
        source: "electron".into(),
        vault_copied: true,
        settings_copied: settings_migrated,
        quick_unlock_reset: true,
        browser_pairing_reset: true,
        verified_by_master_password: false,
    })
    .map_err(io::Error::other)?;
    publish_private_bytes_if_absent(&app_data.join(PENDING_RECEIPT_NAME), &pending_receipt)?;

    Ok(MigrationOutcome::Migrated { settings_migrated })
}

/// Marks a copied Vault as migrated only after the Rust runtime has unlocked
/// it with the user's master password. No Electron file is removed here.
pub(crate) fn finalize_legacy_electron_migration(app_data: &Path) -> io::Result<bool> {
    let pending_path = app_data.join(PENDING_RECEIPT_NAME);
    if !pending_path.try_exists()? {
        return Ok(false);
    }

    let pending_bytes = read_bounded_regular_file(&pending_path, MAX_SETTINGS_BYTES)?;
    let pending: MigrationReceipt = serde_json::from_slice(&pending_bytes)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid migration receipt"))?;
    if pending.version != 1
        || pending.source != "electron"
        || !pending.vault_copied
        || pending.verified_by_master_password
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "invalid pending migration state",
        ));
    }

    let completed = serde_json::to_vec(&MigrationReceipt {
        verified_by_master_password: true,
        ..pending
    })
    .map_err(io::Error::other)?;
    let completed_path = app_data.join(RECEIPT_NAME);
    match publish_private_bytes_if_absent(&completed_path, &completed) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
            let existing = read_bounded_regular_file(&completed_path, MAX_SETTINGS_BYTES)?;
            let existing: MigrationReceipt = serde_json::from_slice(&existing).map_err(|_| {
                io::Error::new(io::ErrorKind::InvalidData, "invalid migration receipt")
            })?;
            if !existing.verified_by_master_password || !existing.vault_copied {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    "invalid completed migration state",
                ));
            }
        }
        Err(error) => return Err(error),
    }
    fs::remove_file(pending_path)?;
    sync_directory(app_data)?;
    Ok(true)
}

fn migrate_settings(source: &Path, destination: &Path) -> bool {
    if destination.try_exists().unwrap_or(true) {
        return false;
    }
    let Ok(bytes) = read_bounded_regular_file(source, MAX_SETTINGS_BYTES) else {
        return false;
    };
    let Ok(settings) = serde_json::from_slice::<SecuritySettings>(&bytes) else {
        return false;
    };
    if !settings.validate() {
        return false;
    }
    let Ok(canonical) = serde_json::to_vec(&settings) else {
        return false;
    };
    publish_private_bytes_if_absent(destination, &canonical).is_ok()
}

fn read_bounded_regular_file(path: &Path, maximum: u64) -> io::Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_file() || metadata.len() == 0 || metadata.len() > maximum {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "legacy file is not an allowed regular file",
        ));
    }
    let file = File::open(path)?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(maximum.saturating_add(1))
        .read_to_end(&mut bytes)?;
    if bytes.is_empty() || bytes.len() as u64 > maximum {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "legacy file exceeds the allowed size",
        ));
    }
    Ok(bytes)
}

fn publish_private_copy(source: &Path, destination: &Path, maximum: u64) -> io::Result<()> {
    let bytes = read_bounded_regular_file(source, maximum)?;
    publish_private_bytes_if_absent(destination, &bytes)
}

fn publish_private_bytes_if_absent(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "migration destination has no parent",
        )
    })?;
    create_private_directory(parent)?;

    let temporary = parent.join(format!(".vaultmesh-migration-{}.tmp", Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let result = (|| {
        let mut file = options.open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::hard_link(&temporary, path)?;
        sync_directory(parent)?;
        Ok(())
    })();
    let cleanup = fs::remove_file(&temporary);
    result.and(cleanup.or_else(|error| {
        if error.kind() == io::ErrorKind::NotFound {
            Ok(())
        } else {
            Err(error)
        }
    }))
}

fn create_private_directory(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> io::Result<()> {
    File::open(path)?.sync_all()
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use vaultmesh_ffi::DesktopRuntime;

    fn directories(name: &str) -> (PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "vaultmesh-electron-migration-{name}-{}",
            Uuid::new_v4()
        ));
        let legacy = root.join("legacy");
        let app_data = root.join("tauri");
        fs::create_dir_all(&legacy).expect("legacy directory");
        (root, legacy, app_data)
    }

    #[test]
    fn preview_identity_never_reads_or_copies_electron_data() {
        let (root, legacy, app_data) = directories("preview");
        fs::write(legacy.join(LEGACY_VAULT_NAME), b"encrypted-vault").expect("fixture");

        assert!(!should_migrate_legacy("com.vaultmesh.tauri.preview"));
        assert_eq!(
            migrate_legacy_electron_data(&app_data, &legacy, false).expect("outcome"),
            MigrationOutcome::DisabledForPreview
        );
        assert!(!app_data.exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn copies_a_real_encrypted_vault_and_keeps_the_legacy_source() {
        let (root, legacy, app_data) = directories("round-trip");
        let legacy_vault = legacy.join(LEGACY_VAULT_NAME);
        let mut electron = DesktopRuntime::new(legacy_vault.clone()).expect("electron runtime");
        electron
            .create("correct horse battery staple".into())
            .expect("legacy vault");
        electron.lock();
        drop(electron);
        fs::write(
            legacy.join(SETTINGS_NAME),
            serde_json::to_vec(&SecuritySettings::default()).expect("settings"),
        )
        .expect("legacy settings");

        assert_eq!(
            migrate_legacy_electron_data(&app_data, &legacy, true).expect("migration"),
            MigrationOutcome::Migrated {
                settings_migrated: true
            }
        );
        assert!(legacy_vault.is_file());
        assert!(app_data.join(PENDING_RECEIPT_NAME).is_file());
        assert!(!app_data.join(RECEIPT_NAME).exists());
        assert!(!app_data.join("desktop-pin-unlock.json").exists());
        assert!(!app_data.join("browser-pairing.json").exists());

        let mut tauri =
            DesktopRuntime::new(app_data.join(TAURI_VAULT_NAME)).expect("tauri runtime");
        assert!(tauri.unlock("wrong password".into()).is_err());
        assert!(app_data.join(PENDING_RECEIPT_NAME).is_file());
        assert!(!app_data.join(RECEIPT_NAME).exists());
        assert!(
            tauri
                .unlock("correct horse battery staple".into())
                .expect("migrated vault unlock")
                .unlocked
        );
        assert!(finalize_legacy_electron_migration(&app_data).expect("finalize"));
        assert!(!app_data.join(PENDING_RECEIPT_NAME).exists());
        let completed: MigrationReceipt = serde_json::from_slice(
            &fs::read(app_data.join(RECEIPT_NAME)).expect("completed receipt"),
        )
        .expect("valid completed receipt");
        assert!(completed.verified_by_master_password);
        tauri.lock();
        drop(tauri);
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn never_overwrites_an_existing_tauri_vault() {
        let (root, legacy, app_data) = directories("no-overwrite");
        fs::create_dir_all(&app_data).expect("app data");
        fs::write(legacy.join(LEGACY_VAULT_NAME), b"legacy").expect("legacy");
        fs::write(app_data.join(TAURI_VAULT_NAME), b"current").expect("current");

        assert_eq!(
            migrate_legacy_electron_data(&app_data, &legacy, true).expect("outcome"),
            MigrationOutcome::ExistingTauriVault
        );
        assert_eq!(
            fs::read(app_data.join(TAURI_VAULT_NAME)).expect("current"),
            b"current"
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn rejects_oversized_legacy_vault_without_publishing_a_destination() {
        let (root, legacy, app_data) = directories("oversized");
        let source = File::create(legacy.join(LEGACY_VAULT_NAME)).expect("source");
        source
            .set_len(MAX_VAULT_BYTES + 1)
            .expect("sparse oversized fixture");

        assert!(migrate_legacy_electron_data(&app_data, &legacy, true).is_err());
        assert!(!app_data.join(TAURI_VAULT_NAME).exists());
        assert!(legacy.join(LEGACY_VAULT_NAME).exists());
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_legacy_vault() {
        use std::os::unix::fs::symlink;

        let (root, legacy, app_data) = directories("symlink");
        let outside = root.join("outside.vault");
        fs::write(&outside, b"outside").expect("outside");
        symlink(&outside, legacy.join(LEGACY_VAULT_NAME)).expect("symlink");

        assert!(migrate_legacy_electron_data(&app_data, &legacy, true).is_err());
        assert!(!app_data.join(TAURI_VAULT_NAME).exists());
        fs::remove_dir_all(root).expect("cleanup");
    }
}
