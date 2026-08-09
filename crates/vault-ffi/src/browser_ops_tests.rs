use super::*;
use crate::DesktopRuntime;
use std::fs;

#[test]
fn key_conversion_is_recursive_and_bidirectional() {
    let value = json!({ "itemId": "id", "nestedValues": [{ "savedAt": 1 }] });
    let snake = Value::Object(convert_keys(value.as_object().unwrap().clone(), snake_key));
    assert_eq!(snake["item_id"], "id");
    assert_eq!(snake["nested_values"][0]["saved_at"], 1);
    assert_eq!(camel_value(snake), value);
}

#[test]
fn constant_time_compare_rejects_different_lengths_and_values() {
    assert!(constant_time_equal(b"secret", b"secret"));
    assert!(!constant_time_equal(b"secret", b"secrex"));
    assert!(!constant_time_equal(b"secret", b"secret-long"));
}

#[test]
fn stale_low_level_handle_cannot_overwrite_a_newer_atomic_commit() {
    let path = std::env::temp_dir().join(format!("vaultmesh-cas-{}.vault", Uuid::new_v4()));
    let password = "correct horse battery staple";
    let mut creator = DesktopRuntime::new(path.clone()).expect("creator");
    creator.create(password.into()).expect("create");
    creator.lock();
    drop(creator);

    let encrypted = Zeroizing::new(read_vault(&path).expect("vault bytes"));
    let fingerprint = vault_fingerprint(encrypted.as_slice());
    let mut first = VaultmeshVault {
        session: VaultSession::unlock(password, encrypted.as_slice()).expect("first unlock"),
        path: path.clone(),
        persisted_fingerprint: fingerprint,
    };
    let mut stale = VaultmeshVault {
        session: VaultSession::unlock(password, encrypted.as_slice()).expect("stale unlock"),
        path: path.clone(),
        persisted_fingerprint: fingerprint,
    };
    execute_core_operation(
        &mut first,
        "items.add",
        json!({
            "title": "First", "username": "alice", "password": "secret",
            "url": "https://example.com", "notes": null
        }),
    )
    .expect("first commit");
    assert_eq!(
        execute_core_operation(
            &mut stale,
            "items.add",
            json!({
                "title": "Stale", "username": "bob", "password": "secret",
                "url": "https://example.org", "notes": null
            }),
        )
        .expect_err("stale commit rejected"),
        VAULTMESH_STATUS_CONFLICT
    );

    let mut verifier = DesktopRuntime::new(path.clone()).expect("verifier");
    verifier.unlock(password.into()).expect("verify unlock");
    assert_eq!(
        verifier
            .execute("items.list", json!({}))
            .expect("verify list")
            .as_array()
            .map(Vec::len),
        Some(1)
    );
    verifier.lock();
    drop(verifier);
    fs::remove_file(path).expect("cleanup");
}

#[test]
fn email_internal_operations_commit_secret_without_exposing_it_in_list() {
    let path = std::env::temp_dir().join(format!("vaultmesh-email-{}.vault", Uuid::new_v4()));
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime
        .create("correct horse battery staple".into())
        .expect("create");
    let account = runtime
        .execute(
            "_native.email.add",
            json!({
                "label": "Mail", "address": "ada@example.test",
                "provider": "custom-imap", "authKind": "app-password",
                "credential": "provider-secret", "imapHost": "imap.example.test",
                "imapPort": 993, "useTls": true, "enabled": true,
            }),
        )
        .expect("add");
    let listed = runtime
        .execute("_native.email.accounts", json!({}))
        .expect("list");
    assert_eq!(listed[0]["hasCredential"], true);
    assert!(!listed.to_string().contains("provider-secret"));
    let detail = runtime
        .execute("_native.email.account", json!({ "id": account["id"] }))
        .expect("privileged detail");
    assert_eq!(detail["credential"], "provider-secret");
    runtime.lock();
    drop(runtime);
    fs::remove_file(path).expect("cleanup");
}
