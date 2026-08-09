use std::{
    fs,
    path::{Path, PathBuf},
    ptr,
    sync::atomic::{AtomicU64, Ordering},
};

use vaultmesh_ffi::{
    ABI_VERSION, VAULTMESH_STATUS_AUTH_FAILED, VAULTMESH_STATUS_INCOMPATIBLE_ABI,
    VAULTMESH_STATUS_INVALID_ARGUMENT, VAULTMESH_STATUS_IO_ERROR, VAULTMESH_STATUS_OK,
    VAULTMESH_STATUS_VAULT_EXISTS, VaultmeshBytes, VaultmeshVault, vaultmesh_vault_create,
    vaultmesh_vault_destroy, vaultmesh_vault_lock, vaultmesh_vault_status, vaultmesh_vault_unlock,
};

static NEXT_CASE_ID: AtomicU64 = AtomicU64::new(1);

struct TempCase {
    root: PathBuf,
}

impl TempCase {
    fn new(label: &str) -> Self {
        let id = NEXT_CASE_ID.fetch_add(1, Ordering::Relaxed);
        let root =
            std::env::temp_dir().join(format!("vaultmesh-ffi-{label}-{}-{id}", std::process::id()));
        fs::create_dir_all(&root).expect("create isolated contract-test directory");
        Self { root }
    }

    fn vault_path(&self) -> PathBuf {
        self.root.join("native-preview.vault")
    }
}

impl Drop for TempCase {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn bytes(value: &[u8]) -> VaultmeshBytes {
    VaultmeshBytes {
        data: value.as_ptr(),
        len: value.len(),
    }
}

fn path_bytes(path: &Path) -> VaultmeshBytes {
    bytes(path.to_str().expect("test path is UTF-8").as_bytes())
}

// CT-NATIVE-VAULT-001: create, status, idempotent lock, wrong-password,
// correct unlock, and idempotent final destroy cross the public C ABI.
#[test]
fn vault_lifecycle_round_trips_through_the_abi() {
    let case = TempCase::new("lifecycle");
    let path = case.vault_path();
    let password = b"correct horse battery staple";
    let mut vault: *mut VaultmeshVault = ptr::null_mut();

    // SAFETY: all borrowed views and the out-pointer remain valid for the call.
    assert_eq!(
        unsafe {
            vaultmesh_vault_create(ABI_VERSION, path_bytes(&path), bytes(password), &mut vault)
        },
        VAULTMESH_STATUS_OK
    );
    assert!(!vault.is_null());
    assert!(path.is_file());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&path)
                .expect("read vault metadata")
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    let mut is_locked = 1_u8;
    // SAFETY: `vault` is live and the status output is writable.
    assert_eq!(
        unsafe { vaultmesh_vault_status(ABI_VERSION, vault, &mut is_locked) },
        VAULTMESH_STATUS_OK
    );
    assert_eq!(is_locked, 0);

    // SAFETY: `vault` remains a live mutable handle.
    assert_eq!(
        unsafe { vaultmesh_vault_lock(ABI_VERSION, vault) },
        VAULTMESH_STATUS_OK
    );
    assert_eq!(
        unsafe { vaultmesh_vault_lock(ABI_VERSION, vault) },
        VAULTMESH_STATUS_OK
    );
    assert_eq!(
        unsafe { vaultmesh_vault_status(ABI_VERSION, vault, &mut is_locked) },
        VAULTMESH_STATUS_OK
    );
    assert_eq!(is_locked, 1);

    // SAFETY: the pointer-to-pointer owns the live handle and becomes null.
    assert_eq!(
        unsafe { vaultmesh_vault_destroy(&mut vault) },
        VAULTMESH_STATUS_OK
    );
    assert!(vault.is_null());
    assert_eq!(
        unsafe { vaultmesh_vault_destroy(&mut vault) },
        VAULTMESH_STATUS_OK
    );

    // Creation is fail-closed once the target exists and cannot replace the
    // original encrypted bytes or publish a replacement handle.
    assert_eq!(
        unsafe {
            vaultmesh_vault_create(
                ABI_VERSION,
                path_bytes(&path),
                bytes(b"replacement password"),
                &mut vault,
            )
        },
        VAULTMESH_STATUS_VAULT_EXISTS
    );
    assert!(vault.is_null());

    // SAFETY: the borrowed inputs and out-pointer remain valid for each call.
    assert_eq!(
        unsafe {
            vaultmesh_vault_unlock(
                ABI_VERSION,
                path_bytes(&path),
                bytes(b"wrong password"),
                &mut vault,
            )
        },
        VAULTMESH_STATUS_AUTH_FAILED
    );
    assert!(vault.is_null());

    assert_eq!(
        unsafe {
            vaultmesh_vault_unlock(ABI_VERSION, path_bytes(&path), bytes(password), &mut vault)
        },
        VAULTMESH_STATUS_OK
    );
    assert!(!vault.is_null());
    assert_eq!(
        unsafe { vaultmesh_vault_destroy(&mut vault) },
        VAULTMESH_STATUS_OK
    );
}

// NFR-REL-001 / CT-NATIVE-VAULT-001: an I/O failure cannot publish a session
// handle, and ABI mismatches fail before creating a file.
#[test]
fn create_failure_keeps_the_out_handle_empty() {
    let case = TempCase::new("failure");
    let blocker = case.root.join("not-a-directory");
    fs::write(&blocker, b"block parent creation").expect("create blocker file");
    let impossible_path = blocker.join("vault.vault");
    let mut vault = ptr::dangling_mut::<VaultmeshVault>();

    // SAFETY: borrowed views and out-pointer are valid; the path is expected to fail.
    assert_eq!(
        unsafe {
            vaultmesh_vault_create(
                ABI_VERSION,
                path_bytes(&impossible_path),
                bytes(b"temporary password"),
                &mut vault,
            )
        },
        VAULTMESH_STATUS_IO_ERROR
    );
    assert!(vault.is_null());

    let mismatch_path = case.root.join("must-not-exist.vault");
    vault = ptr::dangling_mut::<VaultmeshVault>();
    assert_eq!(
        unsafe {
            vaultmesh_vault_create(
                ABI_VERSION + 1,
                path_bytes(&mismatch_path),
                bytes(b"temporary password"),
                &mut vault,
            )
        },
        VAULTMESH_STATUS_INCOMPATIBLE_ABI
    );
    assert!(vault.is_null());
    assert!(!mismatch_path.exists());
}

#[test]
fn invalid_arguments_fail_closed() {
    let mut vault: *mut VaultmeshVault = ptr::null_mut();
    let invalid_utf8 = [0xff_u8];

    // SAFETY: byte storage and the out-pointer are valid; UTF-8 validation rejects the path.
    assert_eq!(
        unsafe {
            vaultmesh_vault_unlock(
                ABI_VERSION,
                bytes(&invalid_utf8),
                bytes(b"password"),
                &mut vault,
            )
        },
        VAULTMESH_STATUS_INVALID_ARGUMENT
    );
    assert!(vault.is_null());

    // SAFETY: null arguments are explicitly validated before dereference.
    assert_eq!(
        unsafe { vaultmesh_vault_status(ABI_VERSION, ptr::null(), ptr::null_mut()) },
        VAULTMESH_STATUS_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { vaultmesh_vault_lock(ABI_VERSION, ptr::null_mut()) },
        VAULTMESH_STATUS_INVALID_ARGUMENT
    );
    assert_eq!(
        unsafe { vaultmesh_vault_destroy(ptr::null_mut()) },
        VAULTMESH_STATUS_INVALID_ARGUMENT
    );
}
