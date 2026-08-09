use std::ptr;

use vaultmesh_ffi::{
    ABI_VERSION, VAULTMESH_ITEM_KIND_IDENTITY, VAULTMESH_ITEM_KIND_LOGIN,
    VAULTMESH_ITEM_KIND_PAYMENT_CARD, VAULTMESH_ITEM_KIND_SECRET,
    VAULTMESH_ITEM_KIND_SSH_CREDENTIAL, VAULTMESH_ITEM_METADATA_SCHEMA_VERSION,
    VAULTMESH_PROTECTED_FIELD_CARD_NUMBER, VAULTMESH_PROTECTED_FIELD_CARD_PIN,
    VAULTMESH_PROTECTED_FIELD_CARD_SECURITY_CODE, VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD,
    VAULTMESH_PROTECTED_FIELD_LOGIN_TOTP, VAULTMESH_PROTECTED_FIELD_SECRET_VALUE,
    VAULTMESH_PROTECTED_FIELD_SSH_KEY_PASSPHRASE, VAULTMESH_PROTECTED_FIELD_SSH_PASSWORD,
    VAULTMESH_PROTECTED_FIELD_SSH_PRIVATE_KEY, VAULTMESH_PROTECTED_FIELD_SSH_PUBLIC_KEY,
    VAULTMESH_STATUS_AUTH_FAILED, VAULTMESH_STATUS_CONFLICT, VAULTMESH_STATUS_CORE_ERROR,
    VAULTMESH_STATUS_INCOMPATIBLE_ABI, VAULTMESH_STATUS_INVALID_ARGUMENT,
    VAULTMESH_STATUS_IO_ERROR, VAULTMESH_STATUS_LOCKED, VAULTMESH_STATUS_NOT_FOUND,
    VAULTMESH_STATUS_OK, VAULTMESH_STATUS_PANIC, VAULTMESH_STATUS_REAUTH_REQUIRED,
    VAULTMESH_STATUS_VALUE_UNAVAILABLE, VAULTMESH_STATUS_VAULT_EXISTS, VaultmeshBuffer,
    vaultmesh_abi_check, vaultmesh_abi_version,
};

// CT-NATIVE-ABI-001: exported ABI behavior and checked-in C header agree.
#[test]
fn c_header_and_rust_contract_are_in_sync() {
    assert_eq!(vaultmesh_abi_version(), ABI_VERSION);
    assert_eq!(vaultmesh_abi_check(ABI_VERSION), VAULTMESH_STATUS_OK);
    assert_eq!(
        vaultmesh_abi_check(ABI_VERSION + 1),
        VAULTMESH_STATUS_INCOMPATIBLE_ABI
    );

    let header = include_str!("../include/vaultmesh.h");
    for declaration in [
        format!("#define VAULTMESH_ABI_VERSION {ABI_VERSION}U"),
        format!("#define VAULTMESH_STATUS_OK {VAULTMESH_STATUS_OK}U"),
        format!("#define VAULTMESH_STATUS_INVALID_ARGUMENT {VAULTMESH_STATUS_INVALID_ARGUMENT}U"),
        format!("#define VAULTMESH_STATUS_INCOMPATIBLE_ABI {VAULTMESH_STATUS_INCOMPATIBLE_ABI}U"),
        format!("#define VAULTMESH_STATUS_CORE_ERROR {VAULTMESH_STATUS_CORE_ERROR}U"),
        format!("#define VAULTMESH_STATUS_LOCKED {VAULTMESH_STATUS_LOCKED}U"),
        format!("#define VAULTMESH_STATUS_IO_ERROR {VAULTMESH_STATUS_IO_ERROR}U"),
        format!("#define VAULTMESH_STATUS_AUTH_FAILED {VAULTMESH_STATUS_AUTH_FAILED}U"),
        format!("#define VAULTMESH_STATUS_VAULT_EXISTS {VAULTMESH_STATUS_VAULT_EXISTS}U"),
        format!("#define VAULTMESH_STATUS_NOT_FOUND {VAULTMESH_STATUS_NOT_FOUND}U"),
        format!("#define VAULTMESH_STATUS_REAUTH_REQUIRED {VAULTMESH_STATUS_REAUTH_REQUIRED}U"),
        format!("#define VAULTMESH_STATUS_VALUE_UNAVAILABLE {VAULTMESH_STATUS_VALUE_UNAVAILABLE}U"),
        format!("#define VAULTMESH_STATUS_CONFLICT {VAULTMESH_STATUS_CONFLICT}U"),
        format!("#define VAULTMESH_STATUS_PANIC {VAULTMESH_STATUS_PANIC}U"),
        format!(
            "#define VAULTMESH_ITEM_METADATA_SCHEMA_VERSION {VAULTMESH_ITEM_METADATA_SCHEMA_VERSION}U"
        ),
        format!("#define VAULTMESH_ITEM_KIND_LOGIN {VAULTMESH_ITEM_KIND_LOGIN}U"),
        format!("#define VAULTMESH_ITEM_KIND_PAYMENT_CARD {VAULTMESH_ITEM_KIND_PAYMENT_CARD}U"),
        format!("#define VAULTMESH_ITEM_KIND_IDENTITY {VAULTMESH_ITEM_KIND_IDENTITY}U"),
        format!("#define VAULTMESH_ITEM_KIND_SSH_CREDENTIAL {VAULTMESH_ITEM_KIND_SSH_CREDENTIAL}U"),
        format!("#define VAULTMESH_ITEM_KIND_SECRET {VAULTMESH_ITEM_KIND_SECRET}U"),
        format!(
            "#define VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD {VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD}U"
        ),
        format!(
            "#define VAULTMESH_PROTECTED_FIELD_LOGIN_TOTP {VAULTMESH_PROTECTED_FIELD_LOGIN_TOTP}U"
        ),
        format!(
            "#define VAULTMESH_PROTECTED_FIELD_CARD_NUMBER {VAULTMESH_PROTECTED_FIELD_CARD_NUMBER}U"
        ),
        format!(
            "#define VAULTMESH_PROTECTED_FIELD_CARD_SECURITY_CODE {VAULTMESH_PROTECTED_FIELD_CARD_SECURITY_CODE}U"
        ),
        format!("#define VAULTMESH_PROTECTED_FIELD_CARD_PIN {VAULTMESH_PROTECTED_FIELD_CARD_PIN}U"),
        format!(
            "#define VAULTMESH_PROTECTED_FIELD_SSH_PASSWORD {VAULTMESH_PROTECTED_FIELD_SSH_PASSWORD}U"
        ),
        format!(
            "#define VAULTMESH_PROTECTED_FIELD_SSH_PUBLIC_KEY {VAULTMESH_PROTECTED_FIELD_SSH_PUBLIC_KEY}U"
        ),
        format!(
            "#define VAULTMESH_PROTECTED_FIELD_SSH_PRIVATE_KEY {VAULTMESH_PROTECTED_FIELD_SSH_PRIVATE_KEY}U"
        ),
        format!(
            "#define VAULTMESH_PROTECTED_FIELD_SSH_KEY_PASSPHRASE {VAULTMESH_PROTECTED_FIELD_SSH_KEY_PASSPHRASE}U"
        ),
        format!(
            "#define VAULTMESH_PROTECTED_FIELD_SECRET_VALUE {VAULTMESH_PROTECTED_FIELD_SECRET_VALUE}U"
        ),
    ] {
        assert!(
            header.contains(&declaration),
            "missing header declaration: {declaration}"
        );
    }

    for operation in [
        "vaultmesh_vault_create",
        "vaultmesh_vault_unlock",
        "vaultmesh_vault_unlock_with_key",
        "vaultmesh_vault_status",
        "vaultmesh_vault_lock",
        "vaultmesh_vault_quick_unlock_key",
        "vaultmesh_items_list",
        "vaultmesh_item_detail",
        "vaultmesh_item_protected_value",
        "vaultmesh_vault_destroy",
    ] {
        assert!(
            header.contains(operation),
            "missing header operation: {operation}"
        );
    }
}

// CT-NATIVE-MEMORY-001: the C-visible empty state has a repeatable cleanup path.
#[test]
fn empty_buffer_cleanup_is_repeatable() {
    let mut buffer = VaultmeshBuffer {
        data: ptr::null_mut(),
        len: 0,
    };

    // SAFETY: `buffer` is valid writable storage in the documented empty state.
    assert_eq!(
        unsafe { vaultmesh_ffi::vaultmesh_buffer_destroy(&mut buffer) },
        VAULTMESH_STATUS_OK
    );
}
