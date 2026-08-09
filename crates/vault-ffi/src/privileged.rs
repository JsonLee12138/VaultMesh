use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;
use vaultmesh_core::VaultError;
use zeroize::Zeroizing;

use crate::{
    VAULTMESH_ITEM_KIND_LOGIN, VAULTMESH_ITEM_KIND_PAYMENT_CARD, VAULTMESH_ITEM_KIND_SECRET,
    VAULTMESH_ITEM_KIND_SSH_CREDENTIAL, VAULTMESH_STATUS_CORE_ERROR,
    VAULTMESH_STATUS_INVALID_ARGUMENT, VAULTMESH_STATUS_OK, VaultmeshBuffer, VaultmeshBytes,
    VaultmeshStatus, VaultmeshVault,
    buffer::initialize_out_buffer,
    status::{check_abi, ffi_boundary},
    vault::map_core_error,
};

pub const VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD: u32 = 1;
pub const VAULTMESH_PROTECTED_FIELD_LOGIN_TOTP: u32 = 2;
pub const VAULTMESH_PROTECTED_FIELD_CARD_NUMBER: u32 = 3;
pub const VAULTMESH_PROTECTED_FIELD_CARD_SECURITY_CODE: u32 = 4;
pub const VAULTMESH_PROTECTED_FIELD_CARD_PIN: u32 = 5;
pub const VAULTMESH_PROTECTED_FIELD_SSH_PASSWORD: u32 = 6;
pub const VAULTMESH_PROTECTED_FIELD_SSH_PUBLIC_KEY: u32 = 7;
pub const VAULTMESH_PROTECTED_FIELD_SSH_PRIVATE_KEY: u32 = 8;
pub const VAULTMESH_PROTECTED_FIELD_SSH_KEY_PASSPHRASE: u32 = 9;
pub const VAULTMESH_PROTECTED_FIELD_SECRET_VALUE: u32 = 10;

unsafe fn optional_password<'a>(input: VaultmeshBytes) -> Result<Option<&'a str>, VaultmeshStatus> {
    if input.data.is_null() {
        return if input.len == 0 {
            Ok(None)
        } else {
            Err(VAULTMESH_STATUS_INVALID_ARGUMENT)
        };
    }
    // SAFETY: byte-view validity is part of the exported operation contract.
    unsafe { input.as_utf8() }.map(Some)
}

pub(crate) fn protected_value(
    vault: &VaultmeshVault,
    item_kind: u32,
    protected_field: u32,
    id: Uuid,
    master_password: Option<&str>,
) -> Result<Zeroizing<Vec<u8>>, VaultError> {
    let session = &vault.session;
    let bytes = match (item_kind, protected_field) {
        (VAULTMESH_ITEM_KIND_LOGIN, VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD) => session
            .password_for_access(id, master_password)?
            .as_bytes()
            .to_vec(),
        (VAULTMESH_ITEM_KIND_LOGIN, VAULTMESH_PROTECTED_FIELD_LOGIN_TOTP) => {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_err(|_| VaultError::Crypto)?
                .as_secs();
            let code = Zeroizing::new(session.totp_code_for_access(id, now, master_password)?.code);
            code.as_bytes().to_vec()
        }
        (VAULTMESH_ITEM_KIND_PAYMENT_CARD, VAULTMESH_PROTECTED_FIELD_CARD_NUMBER) => session
            .card_number_for_access(id, master_password)?
            .as_bytes()
            .to_vec(),
        (VAULTMESH_ITEM_KIND_PAYMENT_CARD, VAULTMESH_PROTECTED_FIELD_CARD_SECURITY_CODE) => session
            .card_security_code_for_access(id, master_password)?
            .as_bytes()
            .to_vec(),
        (VAULTMESH_ITEM_KIND_PAYMENT_CARD, VAULTMESH_PROTECTED_FIELD_CARD_PIN) => session
            .card_pin_for_access(id, master_password)?
            .as_bytes()
            .to_vec(),
        (VAULTMESH_ITEM_KIND_SSH_CREDENTIAL, VAULTMESH_PROTECTED_FIELD_SSH_PASSWORD) => session
            .ssh_password_for_access(id, master_password)?
            .as_bytes()
            .to_vec(),
        (VAULTMESH_ITEM_KIND_SSH_CREDENTIAL, VAULTMESH_PROTECTED_FIELD_SSH_PUBLIC_KEY) => {
            session.ssh_public_key_for_access(id)?.as_bytes().to_vec()
        }
        (VAULTMESH_ITEM_KIND_SSH_CREDENTIAL, VAULTMESH_PROTECTED_FIELD_SSH_PRIVATE_KEY) => session
            .ssh_private_key_for_access(id, master_password)?
            .as_bytes()
            .to_vec(),
        (VAULTMESH_ITEM_KIND_SSH_CREDENTIAL, VAULTMESH_PROTECTED_FIELD_SSH_KEY_PASSPHRASE) => {
            session
                .ssh_key_passphrase_for_access(id, master_password)?
                .as_bytes()
                .to_vec()
        }
        (VAULTMESH_ITEM_KIND_SECRET, VAULTMESH_PROTECTED_FIELD_SECRET_VALUE) => session
            .secret_value_for_access(id, master_password)?
            .as_bytes()
            .to_vec(),
        _ => return Err(VaultError::ItemNotFound),
    };
    Ok(Zeroizing::new(bytes))
}

/// Returns one protected value for a user-authorized native copy or reveal
/// operation. The response is never part of the ordinary item DTO.
///
/// # Safety
///
/// `vault` must be a live handle. Borrowed inputs must remain readable for the
/// call. `out_value` must point to a writable empty buffer that is destroyed by
/// the caller on success.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vaultmesh_item_protected_value(
    abi_version: u32,
    vault: *const VaultmeshVault,
    item_kind: u32,
    protected_field: u32,
    item_id: VaultmeshBytes,
    master_password: VaultmeshBytes,
    out_value: *mut VaultmeshBuffer,
) -> VaultmeshStatus {
    ffi_boundary(|| {
        // SAFETY: forwarded from the exported operation contract.
        if let Err(status) = unsafe { initialize_out_buffer(out_value) } {
            return status;
        }
        if let Err(status) = check_abi(abi_version) {
            return status;
        }
        if vault.is_null() {
            return VAULTMESH_STATUS_INVALID_ARGUMENT;
        }
        // SAFETY: byte-view validity is part of the exported operation contract.
        let id = match unsafe { item_id.as_utf8() }
            .ok()
            .and_then(|value| Uuid::parse_str(value).ok())
        {
            Some(id) => id,
            None => return VAULTMESH_STATUS_INVALID_ARGUMENT,
        };
        // SAFETY: byte-view validity is part of the exported operation contract.
        let master_password = match unsafe { optional_password(master_password) } {
            Ok(password) => password,
            Err(status) => return status,
        };
        // SAFETY: the caller contract requires a live opaque handle.
        let vault = unsafe { &*vault };
        let value = match protected_value(vault, item_kind, protected_field, id, master_password) {
            Ok(value) => value,
            Err(VaultError::ItemNotFound)
                if !matches!(
                    (item_kind, protected_field),
                    (
                        VAULTMESH_ITEM_KIND_LOGIN,
                        VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD
                    ) | (
                        VAULTMESH_ITEM_KIND_LOGIN,
                        VAULTMESH_PROTECTED_FIELD_LOGIN_TOTP
                    ) | (
                        VAULTMESH_ITEM_KIND_PAYMENT_CARD,
                        VAULTMESH_PROTECTED_FIELD_CARD_NUMBER
                    ) | (
                        VAULTMESH_ITEM_KIND_PAYMENT_CARD,
                        VAULTMESH_PROTECTED_FIELD_CARD_SECURITY_CODE
                    ) | (
                        VAULTMESH_ITEM_KIND_PAYMENT_CARD,
                        VAULTMESH_PROTECTED_FIELD_CARD_PIN
                    ) | (
                        VAULTMESH_ITEM_KIND_SSH_CREDENTIAL,
                        VAULTMESH_PROTECTED_FIELD_SSH_PASSWORD
                    ) | (
                        VAULTMESH_ITEM_KIND_SSH_CREDENTIAL,
                        VAULTMESH_PROTECTED_FIELD_SSH_PUBLIC_KEY
                    ) | (
                        VAULTMESH_ITEM_KIND_SSH_CREDENTIAL,
                        VAULTMESH_PROTECTED_FIELD_SSH_PRIVATE_KEY
                    ) | (
                        VAULTMESH_ITEM_KIND_SSH_CREDENTIAL,
                        VAULTMESH_PROTECTED_FIELD_SSH_KEY_PASSPHRASE
                    ) | (
                        VAULTMESH_ITEM_KIND_SECRET,
                        VAULTMESH_PROTECTED_FIELD_SECRET_VALUE
                    )
                ) =>
            {
                return VAULTMESH_STATUS_INVALID_ARGUMENT;
            }
            Err(error) => return map_core_error(error),
        };
        if value.is_empty() {
            return VAULTMESH_STATUS_CORE_ERROR;
        }
        // SAFETY: `out_value` was validated as writable empty storage above.
        unsafe { *out_value = VaultmeshBuffer::from_vec(value.as_slice().to_vec()) };
        VAULTMESH_STATUS_OK
    })
}
