use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    ptr,
    sync::{Arc, Mutex, OnceLock, Weak},
};

use sha2::{Digest, Sha256};
use vaultmesh_core::{VaultError, VaultSession};
use zeroize::Zeroizing;

use crate::{
    VAULTMESH_STATUS_AUTH_FAILED, VAULTMESH_STATUS_CONFLICT, VAULTMESH_STATUS_CORE_ERROR,
    VAULTMESH_STATUS_INVALID_ARGUMENT, VAULTMESH_STATUS_IO_ERROR, VAULTMESH_STATUS_LOCKED,
    VAULTMESH_STATUS_NOT_FOUND, VAULTMESH_STATUS_OK, VAULTMESH_STATUS_REAUTH_REQUIRED,
    VAULTMESH_STATUS_VALUE_UNAVAILABLE, VAULTMESH_STATUS_VAULT_EXISTS, VaultmeshBuffer,
    VaultmeshBytes, VaultmeshStatus,
    buffer::initialize_out_buffer,
    status::{check_abi, ffi_boundary},
    storage::{read_vault, validate_path, write_vault},
};

/// Opaque native vault handle. Foreign callers must never dereference it.
pub struct VaultmeshVault {
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
        VaultError::ApiRequestPlanStale => VAULTMESH_STATUS_CONFLICT,
        VaultError::MasterPasswordRequired => VAULTMESH_STATUS_REAUTH_REQUIRED,
        VaultError::InvalidAgentConnectorDefinition
        | VaultError::InvalidService
        | VaultError::InvalidApiEnvironment
        | VaultError::InvalidApiRequest => VAULTMESH_STATUS_INVALID_ARGUMENT,
        VaultError::ServiceAggregationPlanExpired => VAULTMESH_STATUS_CONFLICT,
        VaultError::TotpUnavailable
        | VaultError::RecoveryCodesUnavailable
        | VaultError::CardSecretUnavailable
        | VaultError::SshSecretUnavailable => VAULTMESH_STATUS_VALUE_UNAVAILABLE,
        _ => VAULTMESH_STATUS_CORE_ERROR,
    }
}

/// Opens an encrypted vault with a short-lived random Vault Key released by a
/// platform user-presence check.
///
/// # Safety
///
/// All byte views must remain readable for the call. `out_vault` must point to
/// writable storage and is always initialized to null before other work.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vaultmesh_vault_unlock_with_key(
    abi_version: u32,
    path: VaultmeshBytes,
    vault_key: VaultmeshBytes,
    out_vault: *mut *mut VaultmeshVault,
) -> VaultmeshStatus {
    ffi_boundary(|| {
        // SAFETY: forwarded from the exported operation contract.
        if let Err(status) = unsafe { initialize_out_handle(out_vault) } {
            return status;
        }
        if let Err(status) = check_abi(abi_version) {
            return status;
        }

        // SAFETY: byte-view validity is part of the exported operation contract.
        let path = match unsafe { path.as_utf8() }
            .and_then(|value| validate_path(value).map_err(|_| VAULTMESH_STATUS_INVALID_ARGUMENT))
        {
            Ok(path) => path,
            Err(status) => return status,
        };
        // SAFETY: byte-view validity is part of the exported operation contract.
        let vault_key = match unsafe { vault_key.as_slice() } {
            Ok(key) => key,
            Err(status) => return status,
        };
        let encrypted = match read_vault(&path) {
            Ok(bytes) => Zeroizing::new(bytes),
            Err(()) => return VAULTMESH_STATUS_IO_ERROR,
        };
        let session = match VaultSession::unlock_with_vault_key(vault_key, encrypted.as_slice()) {
            Ok(session) => session,
            Err(VaultError::UnlockFailed) => return VAULTMESH_STATUS_AUTH_FAILED,
            Err(error) => return map_core_error(error),
        };

        let handle = Box::new(VaultmeshVault {
            session,
            path,
            persisted_fingerprint: vault_fingerprint(encrypted.as_slice()),
        });
        // SAFETY: `out_vault` was validated and initialized above.
        unsafe { *out_vault = Box::into_raw(handle) };
        VAULTMESH_STATUS_OK
    })
}

/// Exports a short-lived copy of the random Vault Key for storage by a
/// platform credential service. The returned secret buffer must be destroyed.
///
/// # Safety
///
/// `vault` must be a live handle. `out_key` must point to a writable empty
/// buffer that the caller later passes to `vaultmesh_buffer_destroy`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vaultmesh_vault_quick_unlock_key(
    abi_version: u32,
    vault: *const VaultmeshVault,
    out_key: *mut VaultmeshBuffer,
) -> VaultmeshStatus {
    ffi_boundary(|| {
        // SAFETY: forwarded from the exported operation contract.
        if let Err(status) = unsafe { initialize_out_buffer(out_key) } {
            return status;
        }
        if let Err(status) = check_abi(abi_version) {
            return status;
        }
        if vault.is_null() {
            return VAULTMESH_STATUS_INVALID_ARGUMENT;
        }
        // SAFETY: the caller contract requires a live opaque handle.
        let vault = unsafe { &*vault };
        let key = match vault.session.quick_unlock_key() {
            Ok(key) => key,
            Err(error) => return map_core_error(error),
        };
        // SAFETY: `out_key` was validated as writable empty storage above.
        unsafe { *out_key = VaultmeshBuffer::from_vec(key.as_slice().to_vec()) };
        VAULTMESH_STATUS_OK
    })
}

unsafe fn initialize_out_handle(
    out_vault: *mut *mut VaultmeshVault,
) -> Result<(), VaultmeshStatus> {
    if out_vault.is_null() {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT);
    }
    // SAFETY: the operation contract requires writable out-pointer storage.
    unsafe { *out_vault = ptr::null_mut() };
    Ok(())
}

/// Creates and atomically persists a new encrypted vault before publishing an
/// unlocked opaque handle.
///
/// # Safety
///
/// All byte views must remain readable for the call. `out_vault` must point to
/// writable storage and is always initialized to null before other work.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vaultmesh_vault_create(
    abi_version: u32,
    path: VaultmeshBytes,
    master_password: VaultmeshBytes,
    out_vault: *mut *mut VaultmeshVault,
) -> VaultmeshStatus {
    ffi_boundary(|| {
        // SAFETY: forwarded from the exported operation contract.
        if let Err(status) = unsafe { initialize_out_handle(out_vault) } {
            return status;
        }
        if let Err(status) = check_abi(abi_version) {
            return status;
        }

        // SAFETY: byte-view validity is part of the exported operation contract.
        let path = match unsafe { path.as_utf8() }
            .and_then(|value| validate_path(value).map_err(|_| VAULTMESH_STATUS_INVALID_ARGUMENT))
        {
            Ok(path) => path,
            Err(status) => return status,
        };
        // SAFETY: byte-view validity is part of the exported operation contract.
        let master_password = match unsafe { master_password.as_utf8() } {
            Ok(password) => password,
            Err(status) => return status,
        };

        match path.try_exists() {
            Ok(true) => return VAULTMESH_STATUS_VAULT_EXISTS,
            Ok(false) => {}
            Err(_) => return VAULTMESH_STATUS_IO_ERROR,
        }

        let session = match VaultSession::create(master_password) {
            Ok(session) => session,
            Err(error) => return map_core_error(error),
        };
        let encrypted = match session.save() {
            Ok(bytes) => Zeroizing::new(bytes),
            Err(error) => return map_core_error(error),
        };
        if write_vault(&path, encrypted.as_slice()).is_err() {
            return VAULTMESH_STATUS_IO_ERROR;
        }

        let handle = Box::new(VaultmeshVault {
            session,
            path,
            persisted_fingerprint: vault_fingerprint(encrypted.as_slice()),
        });
        // SAFETY: `out_vault` was validated and initialized above.
        unsafe { *out_vault = Box::into_raw(handle) };
        VAULTMESH_STATUS_OK
    })
}

/// Opens an encrypted vault with the supplied password.
///
/// # Safety
///
/// All byte views must remain readable for the call. `out_vault` must point to
/// writable storage and is always initialized to null before other work.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vaultmesh_vault_unlock(
    abi_version: u32,
    path: VaultmeshBytes,
    master_password: VaultmeshBytes,
    out_vault: *mut *mut VaultmeshVault,
) -> VaultmeshStatus {
    ffi_boundary(|| {
        // SAFETY: forwarded from the exported operation contract.
        if let Err(status) = unsafe { initialize_out_handle(out_vault) } {
            return status;
        }
        if let Err(status) = check_abi(abi_version) {
            return status;
        }

        // SAFETY: byte-view validity is part of the exported operation contract.
        let path = match unsafe { path.as_utf8() }
            .and_then(|value| validate_path(value).map_err(|_| VAULTMESH_STATUS_INVALID_ARGUMENT))
        {
            Ok(path) => path,
            Err(status) => return status,
        };
        // SAFETY: byte-view validity is part of the exported operation contract.
        let master_password = match unsafe { master_password.as_utf8() } {
            Ok(password) => password,
            Err(status) => return status,
        };
        let encrypted = match read_vault(&path) {
            Ok(bytes) => Zeroizing::new(bytes),
            Err(()) => return VAULTMESH_STATUS_IO_ERROR,
        };
        let session = match VaultSession::unlock(master_password, encrypted.as_slice()) {
            Ok(session) => session,
            Err(error) => return map_core_error(error),
        };

        let handle = Box::new(VaultmeshVault {
            session,
            path,
            persisted_fingerprint: vault_fingerprint(encrypted.as_slice()),
        });
        // SAFETY: `out_vault` was validated and initialized above.
        unsafe { *out_vault = Box::into_raw(handle) };
        VAULTMESH_STATUS_OK
    })
}

/// Returns `1` for locked and `0` for unlocked.
///
/// # Safety
///
/// `vault` must be a live handle from this library and `out_is_locked` must
/// point to writable byte storage.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vaultmesh_vault_status(
    abi_version: u32,
    vault: *const VaultmeshVault,
    out_is_locked: *mut u8,
) -> VaultmeshStatus {
    ffi_boundary(|| {
        if out_is_locked.is_null() {
            return VAULTMESH_STATUS_INVALID_ARGUMENT;
        }
        // Default to the safe locked state on every failure path.
        unsafe { *out_is_locked = 1 };
        if let Err(status) = check_abi(abi_version) {
            return status;
        }
        if vault.is_null() {
            return VAULTMESH_STATUS_INVALID_ARGUMENT;
        }

        // SAFETY: the caller contract requires a live opaque handle.
        let vault = unsafe { &*vault };
        unsafe { *out_is_locked = u8::from(vault.session.is_locked()) };
        VAULTMESH_STATUS_OK
    })
}

/// Locks a live handle. Repeated calls remain successful.
///
/// # Safety
///
/// `vault` must be a live mutable handle returned by this library.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vaultmesh_vault_lock(
    abi_version: u32,
    vault: *mut VaultmeshVault,
) -> VaultmeshStatus {
    ffi_boundary(|| {
        if let Err(status) = check_abi(abi_version) {
            return status;
        }
        if vault.is_null() {
            return VAULTMESH_STATUS_INVALID_ARGUMENT;
        }

        // SAFETY: the caller contract requires a live mutable opaque handle.
        unsafe { &mut *vault }.session.lock();
        VAULTMESH_STATUS_OK
    })
}

/// Locks and destroys an opaque handle, replacing the caller's pointer with
/// null so teardown can be repeated safely.
///
/// # Safety
///
/// `vault` must be null or point to writable handle-pointer storage. A
/// non-null inner handle must be live and owned by this library.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vaultmesh_vault_destroy(
    vault: *mut *mut VaultmeshVault,
) -> VaultmeshStatus {
    ffi_boundary(|| {
        if vault.is_null() {
            return VAULTMESH_STATUS_INVALID_ARGUMENT;
        }
        // SAFETY: the caller contract requires writable pointer storage.
        let handle = unsafe { *vault };
        if handle.is_null() {
            return VAULTMESH_STATUS_OK;
        }
        // Empty the foreign pointer before any destructor runs.
        unsafe { *vault = ptr::null_mut() };

        // SAFETY: the inner pointer must be a live allocation from this library.
        let mut owned = unsafe { Box::from_raw(handle) };
        owned.session.lock();
        drop(owned);
        VAULTMESH_STATUS_OK
    })
}
