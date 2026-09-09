use std::time::{SystemTime, UNIX_EPOCH};

use uuid::Uuid;
use vaultmesh_core::VaultError;
use zeroize::Zeroizing;

use crate::{
    VAULTMESH_ITEM_KIND_LOGIN, VAULTMESH_ITEM_KIND_PAYMENT_CARD, VAULTMESH_ITEM_KIND_SECRET,
    VAULTMESH_ITEM_KIND_SSH_CREDENTIAL, VaultmeshVault,
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
