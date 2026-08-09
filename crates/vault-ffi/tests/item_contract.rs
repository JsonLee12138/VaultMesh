use std::{fs, path::Path, ptr, slice};

use uuid::Uuid;
use vaultmesh_core::{
    IdentityValue, LoginCustomField, NewIdentityItem, NewLoginItem, NewPaymentCardItem,
    NewSecretItem, NewSshCredentialItem, PostalAddress, SecretItemKind, VaultSession,
};
use vaultmesh_ffi::{
    ABI_VERSION, VAULTMESH_ITEM_KIND_IDENTITY, VAULTMESH_ITEM_KIND_LOGIN,
    VAULTMESH_ITEM_KIND_PAYMENT_CARD, VAULTMESH_ITEM_KIND_SECRET,
    VAULTMESH_ITEM_KIND_SSH_CREDENTIAL, VAULTMESH_STATUS_INCOMPATIBLE_ABI,
    VAULTMESH_STATUS_INVALID_ARGUMENT, VAULTMESH_STATUS_LOCKED, VAULTMESH_STATUS_NOT_FOUND,
    VAULTMESH_STATUS_OK, VaultmeshBuffer, VaultmeshBytes, VaultmeshVault, vaultmesh_buffer_destroy,
    vaultmesh_item_detail, vaultmesh_items_list, vaultmesh_vault_destroy, vaultmesh_vault_lock,
    vaultmesh_vault_unlock,
};

mod support {
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    static NEXT_CASE_ID: AtomicU64 = AtomicU64::new(1);

    pub struct TempCase {
        pub root: PathBuf,
    }

    impl TempCase {
        pub fn new(label: &str) -> Self {
            let id = NEXT_CASE_ID.fetch_add(1, Ordering::Relaxed);
            let root = std::env::temp_dir().join(format!(
                "vaultmesh-ffi-items-{label}-{}-{id}",
                std::process::id()
            ));
            fs::create_dir_all(&root).expect("create isolated item contract directory");
            Self { root }
        }

        pub fn vault_path(&self) -> PathBuf {
            self.root.join("native-items.vault")
        }
    }

    impl Drop for TempCase {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}

const MASTER_PASSWORD: &str = "native item contract password";
const LOGIN_PASSWORD: &str = "LOGIN-PASSWORD-SENTINEL";
const LOGIN_TOTP: &str = "JBSWY3DPEHPK3PXP";
const LOGIN_CUSTOM_VALUE: &str = "LOGIN-CUSTOM-FIELD-SENTINEL";
const CARD_NUMBER: &str = "4111111111111111";
const CARD_SECURITY_CODE: &str = "987";
const CARD_PIN: &str = "6789";
const SSH_PASSWORD: &str = "SSH-PASSWORD-SENTINEL";
const SSH_PUBLIC_KEY: &str =
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGV4YW1wbGU= native-contract@test";
const SSH_PRIVATE_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----\nSSH-PRIVATE-KEY-SENTINEL\n-----END OPENSSH PRIVATE KEY-----";
const SSH_PASSPHRASE: &str = "SSH-PASSPHRASE-SENTINEL";
const SECRET_VALUE: &str = "DEVELOPER-SECRET-VALUE-SENTINEL";

struct FixtureIds {
    values: Vec<(u32, Uuid)>,
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

fn create_fixture(path: &Path) -> FixtureIds {
    let mut session = VaultSession::create(MASTER_PASSWORD).expect("create fixture session");
    let login = session
        .add_item(NewLoginItem {
            title: "Native login".into(),
            username: "ada@example.test".into(),
            password: LOGIN_PASSWORD.into(),
            url: Some("https://example.test".into()),
            notes: Some("ordinary login note".into()),
            folder: Some("Work".into()),
            favorite: true,
            totp_secret: Some(LOGIN_TOTP.into()),
            recovery_codes: Vec::new(),
            additional_urls: vec!["https://accounts.example.test".into()],
            autofill_on_page_load: true,
            master_password_reprompt: true,
            custom_fields: vec![LoginCustomField {
                label: "Protected custom value".into(),
                value: LOGIN_CUSTOM_VALUE.into(),
            }],
        })
        .expect("add login fixture");
    let card = session
        .add_card(NewPaymentCardItem {
            title: "Native card".into(),
            cardholder_name: "Ada Lovelace".into(),
            card_number: CARD_NUMBER.into(),
            expiration_month: 12,
            expiration_year: 2035,
            security_code: Some(CARD_SECURITY_CODE.into()),
            pin: Some(CARD_PIN.into()),
            issuer: Some("Example Bank".into()),
            network: Some("Visa".into()),
            billing_address: Some("12 Example Street".into()),
            notes: Some("ordinary card note".into()),
            folder: Some("Wallet".into()),
            favorite: true,
            master_password_reprompt: true,
        })
        .expect("add card fixture");
    let identity = session
        .add_identity(NewIdentityItem {
            title: "Native identity".into(),
            first_name: Some("Ada".into()),
            middle_name: None,
            last_name: Some("Lovelace".into()),
            birth_date: Some("1815-12-10".into()),
            emails: vec![IdentityValue {
                id: Uuid::nil(),
                label: "Work".into(),
                value: "ada@example.test".into(),
                preferred: true,
            }],
            phones: Vec::new(),
            addresses: vec![PostalAddress {
                id: Uuid::nil(),
                label: "Home".into(),
                address_line1: "12 Example Street".into(),
                address_line2: None,
                city: Some("London".into()),
                region: None,
                postal_code: Some("N1 9GU".into()),
                country_code: Some("GB".into()),
                country: Some("United Kingdom".into()),
                preferred: true,
            }],
            organization: Some("Analytical Engines".into()),
            department: Some("Mathematics".into()),
            job_title: Some("Programmer".into()),
            website: Some("https://example.test/ada".into()),
            notes: Some("ordinary identity note".into()),
            folder: Some("Personal".into()),
            favorite: true,
        })
        .expect("add identity fixture");
    let ssh = session
        .add_ssh_credential(NewSshCredentialItem {
            title: "Native SSH".into(),
            host: Some("server.example.test".into()),
            port: 22,
            username: "deploy".into(),
            password: Some(SSH_PASSWORD.into()),
            public_key: Some(SSH_PUBLIC_KEY.into()),
            private_key: Some(SSH_PRIVATE_KEY.into()),
            key_passphrase: Some(SSH_PASSPHRASE.into()),
            notes: Some("ordinary SSH note".into()),
            folder: Some("Servers".into()),
            favorite: true,
            master_password_reprompt: true,
        })
        .expect("add SSH fixture");
    let secret = session
        .add_secret(NewSecretItem {
            title: "Native developer secret".into(),
            kind: SecretItemKind::AccessToken,
            provider: Some("Example Cloud".into()),
            account: Some("ada".into()),
            secret: SECRET_VALUE.into(),
            environment: Some("Production".into()),
            scopes: vec!["read".into(), "write".into()],
            expires_at: Some("2035-12-31".into()),
            website: Some("https://example.test/tokens".into()),
            notes: Some("ordinary secret metadata note".into()),
            folder: Some("Work".into()),
            favorite: true,
            master_password_reprompt: true,
        })
        .expect("add secret fixture");

    let encrypted = session.save().expect("encrypt fixture vault");
    session.lock();
    fs::write(path, encrypted).expect("write fixture vault");

    FixtureIds {
        values: vec![
            (VAULTMESH_ITEM_KIND_LOGIN, login.id),
            (VAULTMESH_ITEM_KIND_PAYMENT_CARD, card.id),
            (VAULTMESH_ITEM_KIND_IDENTITY, identity.id),
            (VAULTMESH_ITEM_KIND_SSH_CREDENTIAL, ssh.id),
            (VAULTMESH_ITEM_KIND_SECRET, secret.id),
        ],
    }
}

fn unlock_fixture(path: &Path) -> *mut VaultmeshVault {
    let mut vault = ptr::null_mut();
    // SAFETY: all borrowed inputs and out-pointer storage remain valid for the call.
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
    assert!(!vault.is_null());
    vault
}

fn take_json(buffer: &mut VaultmeshBuffer) -> String {
    assert!(!buffer.data.is_null());
    assert!(buffer.len > 0);
    // SAFETY: the operation returned this unchanged readable allocation.
    let value =
        String::from_utf8(unsafe { slice::from_raw_parts(buffer.data, buffer.len) }.to_vec())
            .expect("response is UTF-8 JSON");
    // SAFETY: `buffer` still owns the unchanged Rust allocation.
    assert_eq!(
        unsafe { vaultmesh_buffer_destroy(buffer) },
        VAULTMESH_STATUS_OK
    );
    assert!(buffer.data.is_null());
    assert_eq!(buffer.len, 0);
    value
}

fn assert_protected_sentinels_absent(json: &str) {
    for sentinel in [
        LOGIN_PASSWORD,
        LOGIN_TOTP,
        LOGIN_CUSTOM_VALUE,
        CARD_NUMBER,
        SSH_PASSWORD,
        SSH_PUBLIC_KEY,
        "SSH-PRIVATE-KEY-SENTINEL",
        SSH_PASSPHRASE,
        SECRET_VALUE,
    ] {
        assert!(
            !json.contains(sentinel),
            "protected sentinel leaked: {sentinel}"
        );
    }
    for short_numeric_sentinel in [CARD_SECURITY_CODE, CARD_PIN] {
        assert!(
            !json.contains(&format!("\"{short_numeric_sentinel}\"")),
            "protected sentinel leaked: {short_numeric_sentinel}"
        );
    }
}

// NFR-PRIV-001 / CT-PRIV-001 / CT-NATIVE-MEMORY-001: every native list and
// detail response crosses the public C ABI without protected values and uses
// the matching Rust-owned buffer destroy path.
#[test]
fn native_item_metadata_redacts_every_protected_kind() {
    let case = support::TempCase::new("redaction");
    let path = case.vault_path();
    let ids = create_fixture(&path);
    let mut vault = unlock_fixture(&path);

    let mut buffer = VaultmeshBuffer::default();
    // SAFETY: the handle is live and the out-buffer is writable and empty.
    assert_eq!(
        unsafe { vaultmesh_items_list(ABI_VERSION, vault, &mut buffer) },
        VAULTMESH_STATUS_OK
    );
    let list_json = take_json(&mut buffer);
    assert_protected_sentinels_absent(&list_json);
    let list: serde_json::Value = serde_json::from_str(&list_json).expect("decode list JSON");
    assert_eq!(list["schemaVersion"], 1);
    assert_eq!(list["items"].as_array().map(Vec::len), Some(5));
    assert!(list_json.contains("•••• 1111"));
    assert!(list["items"].as_array().is_some_and(|items| {
        items
            .iter()
            .any(|item| item["kind"] == "secret" && item["secretKind"] == "access-token")
    }));

    for (kind, id) in ids.values {
        let id = id.to_string();
        assert_eq!(
            unsafe {
                vaultmesh_item_detail(ABI_VERSION, vault, kind, bytes(id.as_bytes()), &mut buffer)
            },
            VAULTMESH_STATUS_OK
        );
        let detail_json = take_json(&mut buffer);
        assert_protected_sentinels_absent(&detail_json);
        let detail: serde_json::Value =
            serde_json::from_str(&detail_json).expect("decode detail JSON");
        assert_eq!(detail["schemaVersion"], 1);
        assert!(detail["item"]["summary"]["id"].is_string());
        if kind == VAULTMESH_ITEM_KIND_IDENTITY {
            let fields = detail["item"]["metadata"]
                .as_array()
                .expect("identity metadata array");
            assert!(fields.iter().any(|field| {
                field["key"] == "email"
                    && field["entryId"].is_string()
                    && field["preferred"] == true
            }));
            assert!(fields.iter().any(|field| {
                field["key"] == "address"
                    && field["address"]["addressLine1"] == "12 Example Street"
                    && field["address"]["countryCode"] == "GB"
            }));
        }
    }

    // SAFETY: destroy consumes the live handle and clears the pointer.
    assert_eq!(
        unsafe { vaultmesh_vault_destroy(&mut vault) },
        VAULTMESH_STATUS_OK
    );
}

// CT-NATIVE-MEMORY-001: locked, stale, invalid, and version-mismatch paths do
// not publish partial buffers; a non-empty caller buffer is rejected intact.
#[test]
fn item_metadata_failures_keep_output_empty_and_fail_closed() {
    let case = support::TempCase::new("failure");
    let path = case.vault_path();
    let ids = create_fixture(&path);
    let mut vault = unlock_fixture(&path);
    let mut buffer = VaultmeshBuffer::default();

    assert_eq!(
        unsafe { vaultmesh_items_list(ABI_VERSION + 1, vault, &mut buffer) },
        VAULTMESH_STATUS_INCOMPATIBLE_ABI
    );
    assert!(buffer.data.is_null() && buffer.len == 0);

    let valid_id = ids.values[0].1.to_string();
    assert_eq!(
        unsafe {
            vaultmesh_item_detail(
                ABI_VERSION,
                vault,
                999,
                bytes(valid_id.as_bytes()),
                &mut buffer,
            )
        },
        VAULTMESH_STATUS_INVALID_ARGUMENT
    );
    assert!(buffer.data.is_null() && buffer.len == 0);

    assert_eq!(
        unsafe {
            vaultmesh_item_detail(
                ABI_VERSION,
                vault,
                VAULTMESH_ITEM_KIND_LOGIN,
                bytes(b"not-a-uuid"),
                &mut buffer,
            )
        },
        VAULTMESH_STATUS_INVALID_ARGUMENT
    );
    assert!(buffer.data.is_null() && buffer.len == 0);

    let missing = Uuid::new_v4().to_string();
    assert_eq!(
        unsafe {
            vaultmesh_item_detail(
                ABI_VERSION,
                vault,
                VAULTMESH_ITEM_KIND_LOGIN,
                bytes(missing.as_bytes()),
                &mut buffer,
            )
        },
        VAULTMESH_STATUS_NOT_FOUND
    );
    assert!(buffer.data.is_null() && buffer.len == 0);

    assert_eq!(
        unsafe { vaultmesh_items_list(ABI_VERSION, vault, &mut buffer) },
        VAULTMESH_STATUS_OK
    );
    let original_data = buffer.data;
    let original_len = buffer.len;
    assert_eq!(
        unsafe { vaultmesh_items_list(ABI_VERSION, vault, &mut buffer) },
        VAULTMESH_STATUS_INVALID_ARGUMENT
    );
    assert_eq!(buffer.data, original_data);
    assert_eq!(buffer.len, original_len);
    let _ = take_json(&mut buffer);

    assert_eq!(
        unsafe { vaultmesh_vault_lock(ABI_VERSION, vault) },
        VAULTMESH_STATUS_OK
    );
    assert_eq!(
        unsafe { vaultmesh_items_list(ABI_VERSION, vault, &mut buffer) },
        VAULTMESH_STATUS_LOCKED
    );
    assert!(buffer.data.is_null() && buffer.len == 0);
    assert_eq!(
        unsafe {
            vaultmesh_item_detail(
                ABI_VERSION,
                vault,
                VAULTMESH_ITEM_KIND_LOGIN,
                bytes(valid_id.as_bytes()),
                &mut buffer,
            )
        },
        VAULTMESH_STATUS_LOCKED
    );
    assert!(buffer.data.is_null() && buffer.len == 0);

    assert_eq!(
        unsafe { vaultmesh_vault_destroy(&mut vault) },
        VAULTMESH_STATUS_OK
    );
}
