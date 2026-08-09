use std::{fs, path::Path, ptr, slice};

use uuid::Uuid;
use vaultmesh_core::{
    NewLoginItem, NewPaymentCardItem, NewSecretItem, NewSshCredentialItem, SecretItemKind,
    VaultSession,
};
use vaultmesh_ffi::{
    ABI_VERSION, VAULTMESH_ITEM_KIND_LOGIN, VAULTMESH_ITEM_KIND_PAYMENT_CARD,
    VAULTMESH_ITEM_KIND_SECRET, VAULTMESH_ITEM_KIND_SSH_CREDENTIAL,
    VAULTMESH_PROTECTED_FIELD_CARD_NUMBER, VAULTMESH_PROTECTED_FIELD_CARD_PIN,
    VAULTMESH_PROTECTED_FIELD_CARD_SECURITY_CODE, VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD,
    VAULTMESH_PROTECTED_FIELD_LOGIN_TOTP, VAULTMESH_PROTECTED_FIELD_SECRET_VALUE,
    VAULTMESH_PROTECTED_FIELD_SSH_KEY_PASSPHRASE, VAULTMESH_PROTECTED_FIELD_SSH_PASSWORD,
    VAULTMESH_PROTECTED_FIELD_SSH_PRIVATE_KEY, VAULTMESH_PROTECTED_FIELD_SSH_PUBLIC_KEY,
    VAULTMESH_STATUS_AUTH_FAILED, VAULTMESH_STATUS_INCOMPATIBLE_ABI,
    VAULTMESH_STATUS_INVALID_ARGUMENT, VAULTMESH_STATUS_LOCKED, VAULTMESH_STATUS_NOT_FOUND,
    VAULTMESH_STATUS_OK, VAULTMESH_STATUS_REAUTH_REQUIRED, VAULTMESH_STATUS_VALUE_UNAVAILABLE,
    VaultmeshBuffer, VaultmeshBytes, VaultmeshVault, vaultmesh_buffer_destroy,
    vaultmesh_item_protected_value, vaultmesh_vault_destroy, vaultmesh_vault_lock,
    vaultmesh_vault_quick_unlock_key, vaultmesh_vault_unlock, vaultmesh_vault_unlock_with_key,
};
use zeroize::Zeroizing;

const MASTER_PASSWORD: &str = "native privileged contract password";
const LOGIN_PASSWORD: &str = "native-login-secret";
const CARD_NUMBER: &str = "4111111111111111";
const CARD_SECURITY_CODE: &str = "753";
const CARD_PIN: &str = "2468";
const SSH_PASSWORD: &str = "native-ssh-password";
const SSH_PUBLIC_KEY: &str = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGV4YW1wbGU= privileged@test";
const SSH_PRIVATE_KEY: &str =
    "-----BEGIN OPENSSH PRIVATE KEY-----\nNATIVE-PRIVATE-KEY\n-----END OPENSSH PRIVATE KEY-----";
const SSH_PASSPHRASE: &str = "native-ssh-passphrase";
const SECRET_VALUE: &str = "native-developer-secret";

struct TempCase {
    root: std::path::PathBuf,
}

impl TempCase {
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "vaultmesh-ffi-privileged-{label}-{}-{}",
            std::process::id(),
            Uuid::new_v4()
        ));
        fs::create_dir_all(&root).expect("create isolated privileged contract directory");
        Self { root }
    }

    fn vault_path(&self) -> std::path::PathBuf {
        self.root.join("native-privileged.vault")
    }
}

impl Drop for TempCase {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

struct FixtureIds {
    login: Uuid,
    card: Uuid,
    card_without_pin: Uuid,
    ssh: Uuid,
    secret: Uuid,
}

fn bytes(value: &[u8]) -> VaultmeshBytes {
    VaultmeshBytes {
        data: value.as_ptr(),
        len: value.len(),
    }
}

fn no_bytes() -> VaultmeshBytes {
    VaultmeshBytes {
        data: ptr::null(),
        len: 0,
    }
}

fn path_bytes(path: &Path) -> VaultmeshBytes {
    bytes(path.to_str().expect("test path is UTF-8").as_bytes())
}

fn create_fixture(path: &Path) -> FixtureIds {
    let mut session = VaultSession::create(MASTER_PASSWORD).expect("create fixture session");
    let login = session
        .add_item(NewLoginItem {
            title: "Privileged login".into(),
            username: "test@example.invalid".into(),
            password: LOGIN_PASSWORD.into(),
            url: Some("https://example.invalid".into()),
            notes: None,
            folder: None,
            favorite: false,
            totp_secret: Some("JBSWY3DPEHPK3PXP".into()),
            recovery_codes: Vec::new(),
            additional_urls: Vec::new(),
            autofill_on_page_load: false,
            master_password_reprompt: true,
            custom_fields: Vec::new(),
        })
        .expect("add login");
    let card = session
        .add_card(NewPaymentCardItem {
            title: "Privileged card".into(),
            cardholder_name: "Test User".into(),
            card_number: CARD_NUMBER.into(),
            expiration_month: 12,
            expiration_year: 2035,
            security_code: Some(CARD_SECURITY_CODE.into()),
            pin: Some(CARD_PIN.into()),
            issuer: None,
            network: None,
            billing_address: None,
            notes: None,
            folder: None,
            favorite: false,
            master_password_reprompt: true,
        })
        .expect("add card");
    let ssh = session
        .add_ssh_credential(NewSshCredentialItem {
            title: "Privileged SSH".into(),
            host: Some("example.invalid".into()),
            port: 22,
            username: "test".into(),
            password: Some(SSH_PASSWORD.into()),
            public_key: Some(SSH_PUBLIC_KEY.into()),
            private_key: Some(SSH_PRIVATE_KEY.into()),
            key_passphrase: Some(SSH_PASSPHRASE.into()),
            notes: None,
            folder: None,
            favorite: false,
            master_password_reprompt: true,
        })
        .expect("add SSH");
    let card_without_pin = session
        .add_card(NewPaymentCardItem {
            title: "Card without optional values".into(),
            cardholder_name: "Test User".into(),
            card_number: "5555555555554444".into(),
            expiration_month: 11,
            expiration_year: 2034,
            security_code: None,
            pin: None,
            issuer: None,
            network: None,
            billing_address: None,
            notes: None,
            folder: None,
            favorite: false,
            master_password_reprompt: false,
        })
        .expect("add card without optional values");
    let secret = session
        .add_secret(NewSecretItem {
            title: "Privileged secret".into(),
            kind: SecretItemKind::AccessToken,
            provider: None,
            account: None,
            secret: SECRET_VALUE.into(),
            environment: None,
            scopes: Vec::new(),
            expires_at: None,
            website: None,
            notes: None,
            folder: None,
            favorite: false,
            master_password_reprompt: true,
        })
        .expect("add secret");

    fs::write(path, session.save().expect("encrypt fixture")).expect("write fixture");
    session.lock();
    FixtureIds {
        login: login.id,
        card: card.id,
        card_without_pin: card_without_pin.id,
        ssh: ssh.id,
        secret: secret.id,
    }
}

fn unlock(path: &Path) -> *mut VaultmeshVault {
    let mut vault = ptr::null_mut();
    assert_eq!(
        unsafe {
            vaultmesh_vault_unlock(
                ABI_VERSION,
                path_bytes(path),
                bytes(MASTER_PASSWORD.as_bytes()),
                &mut vault,
            )
        },
        VAULTMESH_STATUS_OK
    );
    vault
}

fn take_buffer(buffer: &mut VaultmeshBuffer) -> Zeroizing<Vec<u8>> {
    assert!(!buffer.data.is_null() && buffer.len > 0);
    // SAFETY: the buffer is an unchanged live allocation returned by the FFI.
    let value = Zeroizing::new(unsafe { slice::from_raw_parts(buffer.data, buffer.len) }.to_vec());
    assert_eq!(
        unsafe { vaultmesh_buffer_destroy(buffer) },
        VAULTMESH_STATUS_OK
    );
    assert!(buffer.data.is_null() && buffer.len == 0);
    value
}

fn read_value(
    vault: *const VaultmeshVault,
    item_kind: u32,
    field: u32,
    id: Uuid,
    password: Option<&str>,
) -> Result<Zeroizing<Vec<u8>>, u32> {
    let id = id.to_string();
    let password_bytes = password.map_or_else(no_bytes, |value| bytes(value.as_bytes()));
    let mut output = VaultmeshBuffer::default();
    let status = unsafe {
        vaultmesh_item_protected_value(
            ABI_VERSION,
            vault,
            item_kind,
            field,
            bytes(id.as_bytes()),
            password_bytes,
            &mut output,
        )
    };
    if status == VAULTMESH_STATUS_OK {
        Ok(take_buffer(&mut output))
    } else {
        assert!(output.data.is_null() && output.len == 0);
        Err(status)
    }
}

// REQ-SEC-002 / CT-NATIVE-PRIVILEGED-001: every supported protected field is
// available only through the privileged buffer operation, with core re-prompt.
#[test]
fn privileged_values_require_reprompt_and_use_destroyable_buffers() {
    let case = TempCase::new("values");
    let path = case.vault_path();
    let ids = create_fixture(&path);
    let mut vault = unlock(&path);

    for (kind, field, id, expected) in [
        (
            VAULTMESH_ITEM_KIND_LOGIN,
            VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD,
            ids.login,
            LOGIN_PASSWORD,
        ),
        (
            VAULTMESH_ITEM_KIND_PAYMENT_CARD,
            VAULTMESH_PROTECTED_FIELD_CARD_NUMBER,
            ids.card,
            CARD_NUMBER,
        ),
        (
            VAULTMESH_ITEM_KIND_PAYMENT_CARD,
            VAULTMESH_PROTECTED_FIELD_CARD_SECURITY_CODE,
            ids.card,
            CARD_SECURITY_CODE,
        ),
        (
            VAULTMESH_ITEM_KIND_PAYMENT_CARD,
            VAULTMESH_PROTECTED_FIELD_CARD_PIN,
            ids.card,
            CARD_PIN,
        ),
        (
            VAULTMESH_ITEM_KIND_SSH_CREDENTIAL,
            VAULTMESH_PROTECTED_FIELD_SSH_PASSWORD,
            ids.ssh,
            SSH_PASSWORD,
        ),
        (
            VAULTMESH_ITEM_KIND_SSH_CREDENTIAL,
            VAULTMESH_PROTECTED_FIELD_SSH_PRIVATE_KEY,
            ids.ssh,
            SSH_PRIVATE_KEY,
        ),
        (
            VAULTMESH_ITEM_KIND_SSH_CREDENTIAL,
            VAULTMESH_PROTECTED_FIELD_SSH_KEY_PASSPHRASE,
            ids.ssh,
            SSH_PASSPHRASE,
        ),
        (
            VAULTMESH_ITEM_KIND_SECRET,
            VAULTMESH_PROTECTED_FIELD_SECRET_VALUE,
            ids.secret,
            SECRET_VALUE,
        ),
    ] {
        assert_eq!(
            read_value(vault, kind, field, id, None).unwrap_err(),
            VAULTMESH_STATUS_REAUTH_REQUIRED
        );
        assert_eq!(
            read_value(vault, kind, field, id, Some("wrong")).unwrap_err(),
            VAULTMESH_STATUS_AUTH_FAILED
        );
        assert_eq!(
            read_value(vault, kind, field, id, Some(MASTER_PASSWORD))
                .expect("read protected value")
                .as_slice(),
            expected.as_bytes()
        );
    }

    assert_eq!(
        read_value(
            vault,
            VAULTMESH_ITEM_KIND_SSH_CREDENTIAL,
            VAULTMESH_PROTECTED_FIELD_SSH_PUBLIC_KEY,
            ids.ssh,
            None,
        )
        .expect("read public key")
        .as_slice(),
        SSH_PUBLIC_KEY.as_bytes()
    );
    let totp = read_value(
        vault,
        VAULTMESH_ITEM_KIND_LOGIN,
        VAULTMESH_PROTECTED_FIELD_LOGIN_TOTP,
        ids.login,
        Some(MASTER_PASSWORD),
    )
    .expect("read TOTP code");
    assert_eq!(totp.len(), 6);
    assert!(totp.iter().all(u8::is_ascii_digit));

    assert_eq!(
        read_value(
            vault,
            VAULTMESH_ITEM_KIND_LOGIN,
            VAULTMESH_PROTECTED_FIELD_CARD_NUMBER,
            ids.login,
            Some(MASTER_PASSWORD),
        )
        .unwrap_err(),
        VAULTMESH_STATUS_INVALID_ARGUMENT
    );
    assert_eq!(
        read_value(
            vault,
            VAULTMESH_ITEM_KIND_PAYMENT_CARD,
            VAULTMESH_PROTECTED_FIELD_CARD_PIN,
            ids.card_without_pin,
            None,
        )
        .unwrap_err(),
        VAULTMESH_STATUS_VALUE_UNAVAILABLE
    );
    assert_eq!(
        read_value(
            vault,
            VAULTMESH_ITEM_KIND_LOGIN,
            VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD,
            Uuid::new_v4(),
            Some(MASTER_PASSWORD),
        )
        .unwrap_err(),
        VAULTMESH_STATUS_NOT_FOUND
    );

    let mut failure_output = VaultmeshBuffer::default();
    let login_id = ids.login.to_string();
    assert_eq!(
        unsafe {
            vaultmesh_item_protected_value(
                ABI_VERSION + 1,
                vault,
                VAULTMESH_ITEM_KIND_LOGIN,
                VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD,
                bytes(login_id.as_bytes()),
                bytes(MASTER_PASSWORD.as_bytes()),
                &mut failure_output,
            )
        },
        VAULTMESH_STATUS_INCOMPATIBLE_ABI
    );
    assert!(failure_output.data.is_null() && failure_output.len == 0);

    assert_eq!(
        unsafe {
            vaultmesh_item_protected_value(
                ABI_VERSION,
                vault,
                VAULTMESH_ITEM_KIND_LOGIN,
                VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD,
                bytes(b"not-a-uuid"),
                no_bytes(),
                &mut failure_output,
            )
        },
        VAULTMESH_STATUS_INVALID_ARGUMENT
    );
    assert!(failure_output.data.is_null() && failure_output.len == 0);

    let mut unknown_storage = [7_u8; 1];
    let mut nonempty_output = VaultmeshBuffer {
        data: unknown_storage.as_mut_ptr(),
        len: unknown_storage.len(),
    };
    assert_eq!(
        unsafe {
            vaultmesh_item_protected_value(
                ABI_VERSION,
                vault,
                VAULTMESH_ITEM_KIND_LOGIN,
                VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD,
                bytes(login_id.as_bytes()),
                bytes(MASTER_PASSWORD.as_bytes()),
                &mut nonempty_output,
            )
        },
        VAULTMESH_STATUS_INVALID_ARGUMENT
    );
    assert_eq!(nonempty_output.data, unknown_storage.as_mut_ptr());
    assert_eq!(nonempty_output.len, unknown_storage.len());
    assert_eq!(unknown_storage, [7]);

    assert_eq!(
        unsafe { vaultmesh_vault_lock(ABI_VERSION, vault) },
        VAULTMESH_STATUS_OK
    );
    assert_eq!(
        read_value(
            vault,
            VAULTMESH_ITEM_KIND_LOGIN,
            VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD,
            ids.login,
            Some(MASTER_PASSWORD),
        )
        .unwrap_err(),
        VAULTMESH_STATUS_LOCKED
    );
    assert_eq!(
        unsafe { vaultmesh_vault_destroy(&mut vault) },
        VAULTMESH_STATUS_OK
    );
}

// REQ-SEC-002 / CT-NATIVE-QUICK-UNLOCK-001: only the random 32-byte Vault Key
// crosses the ABI; invalid keys and locked export fail without a partial handle.
#[test]
fn quick_unlock_key_round_trip_and_failures_are_closed() {
    let case = TempCase::new("quick-unlock");
    let path = case.vault_path();
    create_fixture(&path);
    let mut vault = unlock(&path);
    let mut key_buffer = VaultmeshBuffer::default();

    assert_eq!(
        unsafe { vaultmesh_vault_quick_unlock_key(ABI_VERSION, vault, &mut key_buffer) },
        VAULTMESH_STATUS_OK
    );
    let key = take_buffer(&mut key_buffer);
    assert_eq!(key.len(), 32);
    assert!(!String::from_utf8_lossy(&key).contains(MASTER_PASSWORD));

    assert_eq!(
        unsafe { vaultmesh_vault_destroy(&mut vault) },
        VAULTMESH_STATUS_OK
    );
    let mut quick_vault = ptr::null_mut();
    assert_eq!(
        unsafe {
            vaultmesh_vault_unlock_with_key(
                ABI_VERSION,
                path_bytes(&path),
                bytes(&key),
                &mut quick_vault,
            )
        },
        VAULTMESH_STATUS_OK
    );
    assert!(!quick_vault.is_null());
    assert_eq!(
        unsafe { vaultmesh_vault_lock(ABI_VERSION, quick_vault) },
        VAULTMESH_STATUS_OK
    );
    assert_eq!(
        unsafe { vaultmesh_vault_quick_unlock_key(ABI_VERSION, quick_vault, &mut key_buffer) },
        VAULTMESH_STATUS_LOCKED
    );
    assert!(key_buffer.data.is_null() && key_buffer.len == 0);
    assert_eq!(
        unsafe { vaultmesh_vault_destroy(&mut quick_vault) },
        VAULTMESH_STATUS_OK
    );

    let mut failure_handle = ptr::null_mut();
    assert_eq!(
        unsafe {
            vaultmesh_vault_unlock_with_key(
                ABI_VERSION,
                path_bytes(&path),
                bytes(&[0_u8; 32]),
                &mut failure_handle,
            )
        },
        VAULTMESH_STATUS_AUTH_FAILED
    );
    assert!(failure_handle.is_null());
    assert_eq!(
        unsafe {
            vaultmesh_vault_unlock_with_key(
                ABI_VERSION,
                path_bytes(&path),
                bytes(&[0_u8; 31]),
                &mut failure_handle,
            )
        },
        VAULTMESH_STATUS_AUTH_FAILED
    );
    assert!(failure_handle.is_null());

    assert_eq!(
        unsafe { vaultmesh_vault_quick_unlock_key(ABI_VERSION + 1, vault, &mut key_buffer) },
        VAULTMESH_STATUS_INCOMPATIBLE_ABI
    );
    assert!(key_buffer.data.is_null() && key_buffer.len == 0);
}
