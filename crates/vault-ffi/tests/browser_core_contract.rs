use std::{fs, path::Path, ptr, slice};

use serde_json::{Value, json};
use vaultmesh_ffi::{
    ABI_VERSION, VAULTMESH_STATUS_INVALID_ARGUMENT, VAULTMESH_STATUS_OK, VaultmeshBuffer,
    VaultmeshBytes, VaultmeshVault, vaultmesh_browser_core_operation, vaultmesh_buffer_destroy,
    vaultmesh_vault_create, vaultmesh_vault_destroy, vaultmesh_vault_unlock,
};

fn bytes(value: &[u8]) -> VaultmeshBytes {
    VaultmeshBytes {
        data: value.as_ptr(),
        len: value.len(),
    }
}

fn path_bytes(path: &Path) -> VaultmeshBytes {
    bytes(path.to_str().expect("UTF-8 test path").as_bytes())
}

fn operation(vault: *mut VaultmeshVault, name: &str, input: Value) -> Result<Value, u32> {
    let encoded = serde_json::to_vec(&input).expect("encode operation input");
    let mut output = VaultmeshBuffer {
        data: ptr::null_mut(),
        len: 0,
    };
    // SAFETY: all views, the live handle, and output storage remain valid.
    let status = unsafe {
        vaultmesh_browser_core_operation(
            ABI_VERSION,
            vault,
            bytes(name.as_bytes()),
            bytes(&encoded),
            &mut output,
        )
    };
    if status != VAULTMESH_STATUS_OK {
        assert!(output.data.is_null() && output.len == 0);
        return Err(status);
    }
    // SAFETY: successful buffers are library-owned and readable until destroy.
    let result = serde_json::from_slice(unsafe { slice::from_raw_parts(output.data, output.len) })
        .expect("decode operation output");
    // SAFETY: output is the live library-owned buffer returned above.
    assert_eq!(
        unsafe { vaultmesh_buffer_destroy(&mut output) },
        VAULTMESH_STATUS_OK
    );
    Ok(result)
}

// REQ-BROWSER-001 / CT-NATIVE-BROWSER-001: representative operations from
// every core-owned route family use camelCase JSON, persist atomically, expose
// custom fields only through the gesture-authorized detail route, and survive
// a close/reopen boundary.
#[test]
fn browser_core_routes_mutate_persist_and_recover() {
    let root = std::env::temp_dir().join(format!(
        "vaultmesh-browser-core-{}-{}",
        std::process::id(),
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).expect("create test root");
    let path = root.join("browser.vaultmesh");
    let password = b"browser core contract password";
    let mut vault = ptr::null_mut();
    assert_eq!(
        // SAFETY: borrowed views and out pointer are valid.
        unsafe {
            vaultmesh_vault_create(ABI_VERSION, path_bytes(&path), bytes(password), &mut vault)
        },
        VAULTMESH_STATUS_OK
    );

    let login = operation(
        vault,
        "items.add",
        json!({
            "title": "Example", "username": "ada@example.test", "password": "login-secret",
            "url": "https://example.test/login", "notes": null,
            "customFields": [{"label": "Tenant", "value": "protected-custom"}]
        }),
    )
    .expect("add login");
    let login_id = login["id"].as_str().expect("login id");
    assert!(login.get("masterPasswordReprompt").is_some());
    let detail = operation(vault, "items.detail", json!({"id": login_id})).expect("login detail");
    assert_eq!(detail["customFields"][0]["value"], "protected-custom");

    operation(
        vault,
        "items.update",
        json!({
            "id": login_id, "title": "Example updated", "username": "ada@example.test",
            "password": null, "url": "https://example.test/login", "notes": null,
            "customFields": [{"label": "Tenant", "value": "protected-custom"}]
        }),
    )
    .expect("update login");
    assert_eq!(
        operation(vault, "items.history.list", json!({"id": login_id}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );

    let card = operation(vault, "cards.add", json!({
        "title": "Work card", "cardholderName": "Ada Lovelace", "cardNumber": "4111111111111111",
        "expirationMonth": 12, "expirationYear": 2035, "billingAddress": null, "notes": null
    })).expect("add card");
    assert_eq!(card["maskedNumber"], "•••• 1111");
    let identity = operation(
        vault,
        "identities.add",
        json!({
            "title": "Ada", "notes": null,
            "emails": [{"label": "Work", "value": "ada@example.test"}],
            "addresses": [{"label": "Home", "addressLine1": "12 Example Street"}]
        }),
    )
    .expect("add identity");
    assert!(identity["id"].is_string());
    let ssh = operation(
        vault,
        "ssh.add",
        json!({
            "title": "Server", "host": "server.example.test", "username": "ada",
            "password": "ssh-secret", "publicKey": null, "privateKey": null,
            "keyPassphrase": null, "notes": null, "recordKind": "account"
        }),
    )
    .expect("add SSH credential");
    assert_eq!(ssh["hasPassword"], true);
    let secret = operation(vault, "secrets.add", json!({
        "title": "Deploy token", "kind": "access-token", "secret": "developer-secret", "notes": null
    })).expect("add developer secret");
    assert_eq!(secret["kind"], "access-token");

    let fill = operation(
        vault,
        "browser.fill.record",
        json!({
            "itemKind": "login", "itemId": login_id, "itemTitle": "Example updated",
            "origin": "https://example.test", "fieldCount": 2
        }),
    )
    .expect("record fill");
    assert_eq!(fill["fieldCount"], 2);
    assert_eq!(
        operation(vault, "browser.fill.history", json!({}))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(operation(vault, "password.health", json!({})).unwrap()["score"].is_u64());

    operation(vault, "items.delete", json!({"id": login_id})).expect("delete login");
    let trash = operation(vault, "items.trash.list", json!({})).expect("list trash");
    let trash_id = trash[0]["trashId"].as_str().expect("trash id");
    operation(vault, "items.trash.restore", json!({"trashId": trash_id})).expect("restore login");

    let before_failure = fs::read(&path).expect("read persisted vault");
    assert_eq!(
        operation(
            vault,
            "items.add",
            json!({
                "title": "   ", "username": "", "password": "secret",
                "url": null, "notes": null
            })
        ),
        Err(VAULTMESH_STATUS_INVALID_ARGUMENT)
    );
    assert_eq!(
        operation(
            vault,
            "browser.fill.record",
            json!({
                "itemKind": "login", "itemId": login_id, "itemTitle": "Example",
                "origin": "file:///tmp/not-an-origin", "fieldCount": 1
            })
        ),
        Err(VAULTMESH_STATUS_INVALID_ARGUMENT)
    );
    assert_eq!(
        operation(vault, "cards.add", json!({"title": "invalid"})),
        Err(VAULTMESH_STATUS_INVALID_ARGUMENT)
    );
    assert_eq!(
        fs::read(&path).expect("read vault after failure"),
        before_failure
    );

    operation(
        vault,
        "vault.change-password",
        json!({
            "currentPassword": String::from_utf8_lossy(password),
            "newPassword": "browser core replacement password"
        }),
    )
    .expect("change password");
    assert_eq!(
        unsafe { vaultmesh_vault_destroy(&mut vault) },
        VAULTMESH_STATUS_OK
    );
    assert_eq!(
        unsafe {
            vaultmesh_vault_unlock(
                ABI_VERSION,
                path_bytes(&path),
                bytes(b"browser core replacement password"),
                &mut vault,
            )
        },
        VAULTMESH_STATUS_OK
    );
    let persisted =
        operation(vault, "items.detail", json!({"id": login_id})).expect("persisted login");
    assert_eq!(persisted["title"], "Example updated");
    assert_eq!(
        unsafe { vaultmesh_vault_destroy(&mut vault) },
        VAULTMESH_STATUS_OK
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn browser_core_operation_fails_closed_on_invalid_boundary_arguments() {
    let mut output = VaultmeshBuffer {
        data: ptr::null_mut(),
        len: 0,
    };
    // SAFETY: null handle is intentionally tested and output remains writable.
    assert_eq!(
        unsafe {
            vaultmesh_browser_core_operation(
                ABI_VERSION,
                ptr::null_mut(),
                bytes(b"items.list"),
                bytes(b"{}"),
                &mut output,
            )
        },
        VAULTMESH_STATUS_INVALID_ARGUMENT
    );
    assert!(output.data.is_null() && output.len == 0);
}
