use super::*;

fn ssh_tunnel_connector_definition(item_id: Uuid) -> NewAgentConnectorDefinition {
    use vaultmesh_core::{
        AgentCapabilityPolicy, AgentConnectorKind, AgentCredentialKind, AgentCredentialRef,
        AgentOutputPolicy, AgentRiskTier, AgentSshTunnelPolicy, AgentTargetPolicy,
    };

    NewAgentConnectorDefinition {
        display_label: "Example tunnel".into(),
        environment: "test".into(),
        connector_kind: AgentConnectorKind::Ssh,
        credential_refs: vec![AgentCredentialRef {
            kind: AgentCredentialKind::Ssh,
            item_id,
        }],
        target_policy: AgentTargetPolicy::Ssh {
            host: "deploy.example.test".into(),
            port: 22,
            host_key_sha256: format!("SHA256:{}", "a".repeat(43)),
            tunnel_policies: vec![AgentSshTunnelPolicy {
                name: "database".into(),
                local_host: "127.0.0.1".into(),
                local_port: 15_432,
                destination_host: "database.internal".into(),
                destination_port: 5_432,
                max_connections: 2,
                ttl_millis: 60_000,
                risk: AgentRiskTier::R3,
            }],
        },
        capability_policy: AgentCapabilityPolicy {
            allowed_tools: vec!["vaultmesh_ssh_tunnel_open".into()],
            risk_ceiling: AgentRiskTier::R3,
            destructive_enabled: false,
        },
        output_policy: AgentOutputPolicy {
            allowed_fields: vec!["status".into()],
            max_bytes: 4_096,
            max_items: 10,
            disclose_target: false,
        },
        enabled: true,
    }
}

fn unique_path(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("vaultmesh-tauri-{name}-{}.vault", Uuid::new_v4()))
}

fn add_runtime_ssh_account(runtime: &mut DesktopRuntime) -> Uuid {
    let account = runtime
        .execute(
            "ssh.add",
            json!({
                "title": "Agent SSH account", "host": "deploy.example.test", "port": 22,
                "username": "deploy", "password": "ssh-password", "publicKey": null,
                "privateKey": null, "keyPassphrase": null, "notes": null, "folder": null,
                "favorite": false, "masterPasswordReprompt": false, "recordKind": "account"
            }),
        )
        .expect("add SSH account");
    Uuid::parse_str(account["id"].as_str().expect("SSH account id")).expect("uuid")
}

#[test]
fn lifecycle_and_mutation_are_available_without_the_c_abi() {
    let path = unique_path("lifecycle");
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    assert!(!runtime.status().has_vault);
    assert!(
        runtime
            .create("correct horse battery staple".into())
            .expect("create")
            .unlocked
    );
    let item = runtime
        .execute(
            "items.add",
            json!({
                "title": "Example", "username": "alice", "password": "secret",
                "url": "https://example.com", "notes": null
            }),
        )
        .expect("add");
    assert_eq!(item["title"], "Example");
    assert_eq!(
        runtime
            .execute("items.list", json!({}))
            .expect("list")
            .as_array()
            .map(Vec::len),
        Some(1)
    );
    assert!(!runtime.lock().unlocked);
    assert_eq!(
        runtime
            .execute("items.list", json!({}))
            .expect_err("locked")
            .status(),
        VAULTMESH_STATUS_LOCKED
    );
    assert!(
        runtime
            .unlock("correct horse battery staple".into())
            .expect("unlock")
            .unlocked
    );
    std::fs::remove_file(path).expect("cleanup");
}

#[test]
fn agent_item_metadata_is_bounded_and_omits_all_protected_values() {
    let path = unique_path("agent-item-metadata");
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime
        .create("correct horse battery staple".into())
        .expect("create");
    let login = runtime
        .execute(
            "items.add",
            json!({
                "title": "Example", "username": "private-user", "password": "secret-canary",
                "url": "https://example.test/private", "notes": "private-note"
            }),
        )
        .expect("add login");
    let metadata = runtime.agent_items_metadata(None).expect("metadata");
    let serialized = metadata.to_string();
    assert_eq!(metadata["items"][0]["label"], "Example");
    for secret in ["private-user", "secret-canary", "private-note", "/private"] {
        assert!(!serialized.contains(secret));
    }
    let item_id = Uuid::parse_str(login["id"].as_str().unwrap()).unwrap();
    assert_eq!(
        runtime.agent_item_metadata(item_id).expect("detail")["kind"],
        "login"
    );
    let candidates = runtime
        .agent_account_candidates()
        .expect("agent account candidates");
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0]["accountRef"], item_id.to_string());
    let serialized_candidates = serde_json::to_string(&candidates).expect("serialize candidates");
    for secret in ["private-user", "secret-canary", "private-note", "/private"] {
        assert!(!serialized_candidates.contains(secret));
    }
    std::fs::remove_file(path).expect("cleanup");
}

#[test]
fn managed_ssh_host_key_is_atomically_persisted_and_resolved_from_the_vault() {
    let path = unique_path("managed-ssh-host-key");
    let password = "correct horse battery staple";
    let host_key = format!("SHA256:{}", "a".repeat(43));
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime.create(password.into()).expect("create");
    let account = runtime
        .execute(
            "ssh.add",
            json!({
                "title": "Home server",
                "host": "home.example.test",
                "port": 22,
                "username": "deploy",
                "password": "bootstrap-password",
                "publicKey": null,
                "privateKey": null,
                "keyPassphrase": null,
                "notes": null,
                "folder": null,
                "favorite": false,
                "masterPasswordReprompt": false,
                "recordKind": "account"
            }),
        )
        .expect("account");
    let account_id = Uuid::parse_str(account["id"].as_str().expect("account id")).unwrap();
    assert!(
        runtime
            .managed_ssh_host_key(account_id, "home-server", &host_key)
            .expect("lookup")
            .is_none()
    );
    let created = runtime
        .add_managed_ssh_host_key(
            account_id,
            "home-server".into(),
            host_key.clone(),
            Zeroizing::new(
                "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGV4YW1wbGU= managed@test".into(),
            ),
            Zeroizing::new(
                "-----BEGIN OPENSSH PRIVATE KEY-----\nmanaged-private-material\n-----END OPENSSH PRIVATE KEY-----".into(),
            ),
        )
        .expect("persist managed key");
    assert_eq!(
        runtime
            .execute("ssh.list", json!({}))
            .expect("list")
            .as_array()
            .map(Vec::len),
        Some(2)
    );
    let key_id = created.key_item_id;
    runtime.lock();
    runtime.unlock(password.into()).expect("reopen");
    let reopened = runtime
        .managed_ssh_host_key(account_id, "home-server", &host_key)
        .expect("lookup")
        .expect("managed key");
    assert_eq!(reopened.key_item_id, key_id);
    assert!(reopened.public_key.starts_with("ssh-ed25519 "));
    assert!(reopened.private_key.contains("managed-private-material"));
    std::fs::remove_file(path).expect("cleanup");
}

#[test]
fn agent_connector_definition_runtime_uses_the_single_format_three_contract() {
    let path = unique_path("agent-connector-format");
    let password = "correct horse battery staple";
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime.create(password.into()).expect("create");
    let ssh_account_id = add_runtime_ssh_account(&mut runtime);
    let created = runtime
        .add_agent_connector_definition(ssh_tunnel_connector_definition(ssh_account_id), 101)
        .expect("definition");
    assert_eq!(created.display_label, "Example tunnel");
    assert_eq!(runtime.agent_connector_definitions().expect("definitions"), vec![created]);

    runtime.lock();
    runtime.unlock(password.into()).expect("v3 unlock");
    assert_eq!(runtime.agent_connector_definitions().expect("persisted").len(), 1);
    std::fs::remove_file(path).expect("cleanup");
}

#[test]
fn desktop_runtime_rejects_every_non_current_format_without_modifying_the_file() {
    let path = unique_path("unsupported-format");
    let restore_path = unique_path("unsupported-format-restore");
    let password = "correct horse battery staple";
    let current = vaultmesh_core::create(password, &vaultmesh_core::VaultPayload::default())
        .expect("current vault");

    for version in [1, 2, u16::MAX] {
        let mut envelope: vaultmesh_core::VaultEnvelope =
            serde_json::from_slice(&current).expect("envelope");
        envelope.header.format_version = version;
        envelope.header.kdf.memory_kib = u32::MAX;
        let unsupported = serde_json::to_vec(&envelope).expect("unsupported envelope");
        std::fs::write(&path, &unsupported).expect("write unsupported vault");

        let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
        assert_eq!(
            runtime
                .unlock(password.into())
                .expect_err("non-current format")
                .status(),
            VAULTMESH_STATUS_CORE_ERROR
        );
        assert_eq!(
            runtime
                .unlock_with_quick_key(path.clone(), &[0_u8; 32])
                .expect_err("non-current quick unlock")
                .status(),
            VAULTMESH_STATUS_CORE_ERROR
        );
        assert_eq!(
            runtime
                .unlock_for_agent_with_quick_key(path.clone(), &[0_u8; 32])
                .expect_err("non-current agent quick unlock")
                .status(),
            VAULTMESH_STATUS_CORE_ERROR
        );
        assert_eq!(
            runtime
                .unlock_for_browser(password.into())
                .expect_err("non-current browser unlock")
                .status(),
            VAULTMESH_STATUS_CORE_ERROR
        );
        assert_eq!(
            runtime
                .unlock_for_agent(password.into())
                .expect_err("non-current agent unlock")
                .status(),
            VAULTMESH_STATUS_CORE_ERROR
        );

        let mut restore_runtime =
            DesktopRuntime::new(restore_path.clone()).expect("restore runtime");
        restore_runtime
            .create(password.into())
            .expect("restore destination");
        let destination_before = std::fs::read(&restore_path).expect("destination before");
        assert_eq!(
            restore_runtime
                .restore_from(&path, password.into())
                .expect_err("non-current restore")
                .status(),
            VAULTMESH_STATUS_CORE_ERROR
        );
        assert_eq!(
            std::fs::read(&restore_path).expect("destination unchanged"),
            destination_before
        );
        restore_runtime.lock();
        std::fs::remove_file(&restore_path).expect("cleanup restore destination");
        assert_eq!(std::fs::read(&path).expect("unchanged"), unsupported);
    }

    std::fs::remove_file(path).expect("cleanup vault");
}

#[cfg(unix)]
#[test]
fn agent_connector_definition_write_failure_rolls_back_memory_in_format_three() {
    use std::os::unix::fs::PermissionsExt;

    let directory = std::env::temp_dir().join(format!(
        "vaultmesh-agent-connector-rollback-{}",
        Uuid::new_v4()
    ));
    std::fs::create_dir(&directory).expect("directory");
    let path = directory.join("vault.vault");
    let password = "correct horse battery staple";
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime.create(password.into()).expect("create");
    let ssh_account_id = add_runtime_ssh_account(&mut runtime);
    let before = std::fs::read(&path).expect("before");

    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o500))
        .expect("make read only");
    let error = runtime
        .add_agent_connector_definition(ssh_tunnel_connector_definition(ssh_account_id), 100)
        .expect_err("write must fail");
    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))
        .expect("restore permissions");

    assert_eq!(error.status(), VAULTMESH_STATUS_IO_ERROR);
    assert_eq!(std::fs::read(&path).expect("unchanged"), before);
    assert!(runtime.agent_connector_definitions().expect("definitions").is_empty());
    runtime.lock();
    std::fs::remove_file(path).expect("cleanup vault");
    std::fs::remove_dir(directory).expect("cleanup directory");
}

#[test]
fn independent_runtimes_refresh_newer_commits_without_lost_updates() {
    let path = unique_path("multi-session-refresh");
    let password = "correct horse battery staple";
    let mut desktop = DesktopRuntime::new(path.clone()).expect("desktop");
    desktop.create(password.into()).expect("create");
    let mut browser = DesktopRuntime::new(path.clone()).expect("browser");
    browser
        .unlock_for_browser(password.into())
        .expect("browser unlock");

    desktop
        .execute(
            "items.add",
            json!({
                "title": "Desktop", "username": "alice", "password": "secret",
                "url": "https://example.com", "notes": null
            }),
        )
        .expect("desktop add");
    assert_eq!(
        browser.workspace_snapshot().expect("browser refresh")["items"]
            .as_array()
            .map(Vec::len),
        Some(1)
    );
    browser
        .execute(
            "items.add",
            json!({
                "title": "Browser", "username": "bob", "password": "secret",
                "url": "https://example.org", "notes": null
            }),
        )
        .expect("browser add");
    assert_eq!(
        desktop
            .execute("items.list", json!({}))
            .expect("desktop refresh")
            .as_array()
            .map(Vec::len),
        Some(2)
    );

    desktop.lock();
    browser.lock();
    drop(desktop);
    drop(browser);
    std::fs::remove_file(path).expect("cleanup");
}

#[test]
fn browser_login_metadata_batches_large_vaults_without_protected_values() {
    let path = unique_path("browser-login-metadata");
    let password = "correct horse battery staple";
    let mut creator = vaultmesh_core::VaultSession::create(password).expect("creator");
    for index in 0..505 {
        creator
            .add_item(vaultmesh_core::NewLoginItem {
                title: format!("Login {index}"),
                username: format!("user-{index}@example.test"),
                password: "not-a-real-password".into(),
                url: Some("https://example.test/login".into()),
                notes: None,
                folder: None,
                favorite: false,
                totp_secret: None,
                recovery_codes: Vec::new(),
                additional_urls: vec!["https://accounts.example.test".into()],
                autofill_on_page_load: index % 2 == 0,
                master_password_reprompt: index % 3 == 0,
                custom_fields: Vec::new(),
            })
            .expect("add login");
    }
    std::fs::write(&path, creator.save().expect("save")).expect("write vault");
    creator.lock();

    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime
        .unlock_for_browser(password.into())
        .expect("browser unlock");
    let metadata = runtime.browser_login_metadata().expect("browser metadata");
    let entries = metadata.as_array().expect("metadata array");
    assert_eq!(entries.len(), 505);
    assert!(
        entries
            .iter()
            .all(|entry| { entry.get("password").is_none() && entry.get("totpSecret").is_none() })
    );
    assert_eq!(
        entries[0]["additionalUrls"][0],
        "https://accounts.example.test"
    );

    runtime.lock();
    drop(runtime);
    std::fs::remove_file(path).expect("cleanup");
}

#[test]
fn recovery_codes_are_presence_only_and_always_reauthenticated() {
    let path = unique_path("recovery-codes");
    let password = "correct horse battery staple";
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime.create(password.into()).expect("create");
    let item = runtime
        .execute(
            "items.add",
            json!({
                "title": "2FA account", "username": "alice", "password": "secret",
                "url": "https://example.com", "notes": null,
                "recoveryCodes": ["runtime-code-one", "runtime-code-two"]
            }),
        )
        .expect("add");
    let id = item["id"].as_str().expect("item id");
    assert_eq!(item["hasRecoveryCodes"], true);
    let detail = runtime
        .execute("items.detail", json!({ "id": id }))
        .expect("detail");
    assert_eq!(detail["hasRecoveryCodes"], true);
    assert!(!detail.to_string().contains("runtime-code-one"));
    assert_eq!(
        runtime
            .recovery_codes(id, None)
            .expect_err("password required")
            .status(),
        VAULTMESH_STATUS_REAUTH_REQUIRED
    );
    assert_eq!(
        runtime
            .recovery_codes(id, Some("wrong password"))
            .expect_err("wrong password")
            .status(),
        VAULTMESH_STATUS_AUTH_FAILED
    );
    assert_eq!(
        runtime.recovery_codes(id, Some(password)).expect("codes"),
        vec!["runtime-code-one", "runtime-code-two"]
    );
    runtime.lock();
    assert_eq!(
        runtime
            .recovery_codes(id, Some(password))
            .expect_err("locked")
            .status(),
        VAULTMESH_STATUS_LOCKED
    );
    std::fs::remove_file(path).expect("cleanup");
}

#[test]
fn missing_persisted_vault_invalidates_the_unlocked_runtime() {
    let path = unique_path("missing-refresh");
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime
        .create("correct horse battery staple".into())
        .expect("create");
    std::fs::remove_file(path).expect("remove backing vault");
    assert_eq!(
        runtime
            .refresh_from_disk()
            .expect_err("missing vault rejected")
            .status(),
        VAULTMESH_STATUS_IO_ERROR
    );
    assert!(!runtime.status().unlocked);
}

#[test]
fn different_vault_key_invalidates_the_unlocked_runtime() {
    let path = unique_path("replaced-refresh");
    let replacement_path = unique_path("replacement-source");
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime
        .create("correct horse battery staple".into())
        .expect("create");
    let mut replacement = DesktopRuntime::new(replacement_path.clone()).expect("replacement");
    replacement
        .create("different replacement password".into())
        .expect("create replacement");
    replacement.lock();
    drop(replacement);
    let replacement_bytes = Zeroizing::new(read_vault(&replacement_path).expect("replacement"));
    write_vault(&path, replacement_bytes.as_slice()).expect("replace target");

    assert_eq!(
        runtime
            .refresh_from_disk()
            .expect_err("different key rejected")
            .status(),
        VAULTMESH_STATUS_AUTH_FAILED
    );
    assert!(!runtime.status().unlocked);
    drop(runtime);
    std::fs::remove_file(path).expect("cleanup target");
    std::fs::remove_file(replacement_path).expect("cleanup replacement");
}

#[test]
fn rust_runtime_quick_key_round_trip_records_pin_unlock() {
    let path = unique_path("quick-unlock");
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime
        .create("correct horse battery staple".into())
        .expect("create");
    let (material_path, key) = runtime.quick_unlock_material().expect("quick material");
    assert_eq!(material_path, path);
    runtime.lock();
    assert_eq!(
        runtime
            .unlock_with_quick_key(path.clone(), &[0_u8; 32])
            .expect_err("wrong key")
            .status(),
        VAULTMESH_STATUS_AUTH_FAILED
    );
    assert!(!runtime.status().unlocked);
    assert!(
        runtime
            .unlock_with_quick_key(path.clone(), key.as_ref())
            .expect("quick unlock")
            .unlocked
    );
    let history = runtime
        .execute("vault.unlock-history", json!({}))
        .expect("unlock history");
    assert_eq!(history[0]["source"], "desktop-pin");
    std::fs::remove_file(path).expect("cleanup");
}

#[test]
fn rust_runtime_biometric_key_round_trip_keeps_desktop_authority() {
    let path = unique_path("biometric-unlock");
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime
        .create("correct horse battery staple".into())
        .expect("create");
    let (_, key) = runtime.quick_unlock_material().expect("quick material");
    runtime.lock();
    assert!(
        runtime
            .unlock_with_biometric_key(path.clone(), key.as_ref())
            .expect("biometric unlock")
            .unlocked
    );
    let history = runtime
        .execute("vault.unlock-history", json!({}))
        .expect("unlock history");
    assert_eq!(history[0]["source"], "desktop");
    runtime.lock();
    std::fs::remove_file(path).expect("cleanup");
}

#[test]
fn backup_restore_validates_before_replacing_the_current_vault() {
    let path = unique_path("restore-current");
    let backup = unique_path("restore-backup");
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime
        .create("correct horse battery staple".into())
        .expect("create");
    runtime.backup_to(&backup).expect("backup");
    runtime
        .execute(
            "items.add",
            json!({
                "title": "Added later", "username": "alice", "password": "secret",
                "url": null, "notes": null
            }),
        )
        .expect("mutate current");
    assert_eq!(runtime.status().item_count, 1);

    assert_eq!(
        runtime
            .restore_from(&backup, "wrong password".into())
            .expect_err("reject wrong password")
            .status(),
        VAULTMESH_STATUS_AUTH_FAILED
    );
    assert_eq!(runtime.status().item_count, 1);

    runtime
        .restore_from(&backup, "correct horse battery staple".into())
        .expect("restore");
    assert_eq!(runtime.status().item_count, 0);
    std::fs::remove_file(path).expect("cleanup current");
    std::fs::remove_file(backup).expect("cleanup backup");
}

#[test]
fn backup_and_restore_preserve_format_three_agent_connector_definitions() {
    let path = unique_path("agent-connector-restore-current");
    let backup = unique_path("agent-connector-restore-backup");
    let password = "correct horse battery staple";
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime.create(password.into()).expect("create");
    let ssh_account_id = add_runtime_ssh_account(&mut runtime);
    runtime
        .add_agent_connector_definition(ssh_tunnel_connector_definition(ssh_account_id), 100)
        .expect("definition");
    runtime.backup_to(&backup).expect("backup");
    let definition_id = runtime.agent_connector_definitions().expect("definitions")[0].id;
    runtime.delete_agent_connector_definition(definition_id).expect("delete");

    runtime
        .restore_from(&backup, password.into())
        .expect("restore v3");
    assert_eq!(runtime.agent_connector_definitions().expect("definition restored").len(), 1);
    std::fs::remove_file(path).expect("cleanup current");
    std::fs::remove_file(backup).expect("cleanup backup");
}

#[test]
fn service_operations_are_typed_atomic_stale_safe_and_secretless() {
    let path = unique_path("service-hub");
    let backup = unique_path("service-hub-backup");
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime.create("correct horse battery staple".into()).expect("create");
    let login = runtime.execute("items.add", json!({
        "title": "Example admin", "username": "private-user", "password": "private-password",
        "url": "https://www.example.test/login", "notes": "private-note"
    })).expect("login");
    let first_plan = runtime.execute("services.aggregation.preview", json!({})).expect("preview");
    runtime.execute("items.add", json!({
        "title": "Later", "username": "later-user", "password": "later-password",
        "url": "https://later.test", "notes": null
    })).expect("catalog mutation");
    assert_eq!(
        runtime.execute("services.aggregation.apply", json!({ "planId": first_plan["planId"] })).expect_err("stale preview").status(),
        VAULTMESH_STATUS_CONFLICT
    );

    let plan = runtime.execute("services.aggregation.preview", json!({})).expect("fresh preview");
    let applied = runtime.execute("services.aggregation.apply", json!({ "planId": plan["planId"] })).expect("apply");
    assert_eq!(applied["createdServiceCount"], 2);
    let services = runtime.execute("services.list", json!({})).expect("services");
    let example = services.as_array().unwrap().iter().find(|service| service["name"] == "example.test").unwrap();
    let detail = runtime.execute("services.detail", json!({ "id": example["id"] })).expect("detail");
    assert_eq!(detail["relationships"][0]["itemId"], login["id"]);
    let serialized = detail.to_string();
    for protected in ["private-user", "private-password", "private-note", "later-password"] {
        assert!(!serialized.contains(protected));
    }
    let repeated = runtime.execute("services.aggregation.apply", json!({ "planId": plan["planId"] })).expect("idempotent apply");
    assert_eq!(repeated["alreadyApplied"], true);
    runtime.backup_to(&backup).expect("service backup");
    runtime.execute("services.aggregation.rollback", json!({ "batchId": applied["batchId"] })).expect("rollback");
    assert!(runtime.execute("services.list", json!({})).unwrap().as_array().unwrap().is_empty());
    runtime
        .restore_from(&backup, "correct horse battery staple".into())
        .expect("restore services");
    assert_eq!(runtime.execute("services.list", json!({})).unwrap().as_array().unwrap().len(), 2);
    let invalid = runtime.execute("services.link", json!({
        "serviceId": example["id"],
        "relationship": { "itemKind": "card", "itemId": login["id"], "source": "manual" }
    })).expect_err("unknown relationship kind rejected");
    assert_eq!(invalid.status(), VAULTMESH_STATUS_INVALID_ARGUMENT);
    std::fs::remove_file(path).expect("cleanup");
    std::fs::remove_file(backup).expect("cleanup backup");
}

#[test]
fn api_environment_operations_backup_and_agent_projection_are_typed_and_secretless() {
    let path = unique_path("api-environment");
    let backup = unique_path("api-environment-backup");
    let password = "correct horse battery staple";
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime.create(password.into()).expect("create");
    let service = runtime.execute("services.add", json!({
        "name": "Example", "description": null, "tags": [], "sites": ["https://example.test"]
    })).expect("service");
    let token = runtime.execute("secrets.add", json!({
        "title": "Production token", "kind": "access-token", "secret": "runtime-secret-canary",
        "provider": null, "account": null, "environment": null, "scopes": [], "expiresAt": null,
        "website": null, "notes": null, "folder": null, "favorite": false, "masterPasswordReprompt": false
    })).expect("token");
    let environment_input = json!({
        "serviceId": service["id"], "name": "Production", "kind": "production",
        "origin": "https://api.example.test", "basePath": "/v1", "openapiUrl": "https://docs.example.test/openapi.json",
        "auth": { "type": "bearer", "credential": { "itemKind": "secret", "itemId": token["id"], "field": "secret-value", "expectedSecretKind": "access-token" } },
        "fixedHeaders": [{ "name": "X-API-Version", "source": { "type": "literal", "value": "2026-08" } }]
    });
    let mut legacy_input = environment_input.clone();
    legacy_input["agentEnabled"] = json!(false);
    let legacy_error = runtime
        .execute("api-environments.add", legacy_input)
        .expect_err("removed Agent enable field must fail closed at the typed boundary");
    assert_eq!(legacy_error.status(), VAULTMESH_STATUS_INVALID_ARGUMENT);
    let environment = runtime
        .execute("api-environments.add", environment_input.clone())
        .expect("environment");
    assert_eq!(environment["revision"], 1);
    let mut legacy_update = environment_input;
    legacy_update["id"] = environment["id"].clone();
    legacy_update["agentEnabled"] = json!(false);
    let legacy_update_error = runtime
        .execute("api-environments.update", legacy_update)
        .expect_err("removed Agent enable update field must fail closed at the typed boundary");
    assert_eq!(legacy_update_error.status(), VAULTMESH_STATUS_INVALID_ARGUMENT);
    let detail = runtime.execute("api-environments.detail", json!({ "id": environment["id"] })).expect("detail");
    assert!(!detail.to_string().contains("runtime-secret-canary"));
    let projection = runtime.agent_api_environment_candidates().expect("projection");
    assert_eq!(projection.len(), 1);
    let projection = serde_json::to_string(&projection).unwrap();
    assert!(projection.contains("docs.example.test/openapi.json"));
    for forbidden in ["api.example.test", "x-api-version", "bearer", "runtime-secret-canary"] {
        assert!(!projection.contains(forbidden));
    }
    runtime.backup_to(&backup).expect("backup");
    runtime.execute("api-environments.delete", json!({ "id": environment["id"] })).expect("delete");
    assert!(runtime.agent_api_environment_candidates().unwrap().is_empty());
    runtime.restore_from(&backup, password.into()).expect("restore");
    assert_eq!(runtime.agent_api_environment_candidates().unwrap().len(), 1);
    std::fs::remove_file(path).expect("cleanup");
    std::fs::remove_file(backup).expect("cleanup backup");
}

#[cfg(unix)]
#[test]
fn api_environment_write_failure_preserves_file_memory_revision_and_catalog() {
    use std::os::unix::fs::PermissionsExt;

    let directory = std::env::temp_dir().join(format!("vaultmesh-api-environment-rollback-{}", Uuid::new_v4()));
    std::fs::create_dir(&directory).expect("directory");
    let path = directory.join("vault.vault");
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime.create("correct horse battery staple".into()).expect("create");
    let service = runtime.execute("services.add", json!({
        "name": "Example", "description": null, "tags": [], "sites": ["https://example.test"]
    })).unwrap();
    let environment = runtime.execute("api-environments.add", json!({
        "serviceId": service["id"], "name": "Local", "kind": "local", "origin": "http://127.0.0.1:8080",
        "basePath": null, "openapiUrl": null, "auth": { "type": "none" }, "fixedHeaders": []
    })).unwrap();
    let before = std::fs::read(&path).unwrap();
    let before_projection = runtime.agent_api_environment_candidates().unwrap();
    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o500)).unwrap();
    let error = runtime.execute("api-environments.update", json!({
        "id": environment["id"], "serviceId": service["id"], "name": "Local changed", "kind": "local",
        "origin": "http://127.0.0.1:8080", "basePath": null, "openapiUrl": null,
        "auth": { "type": "none" }, "fixedHeaders": []
    })).expect_err("write must fail");
    std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(error.status(), VAULTMESH_STATUS_IO_ERROR);
    assert_eq!(std::fs::read(&path).unwrap(), before);
    assert_eq!(runtime.agent_api_environment_candidates().unwrap(), before_projection);
    assert_eq!(runtime.execute("api-environments.detail", json!({ "id": environment["id"] })).unwrap()["revision"], 1);
    runtime.lock();
    std::fs::remove_file(path).unwrap();
    std::fs::remove_dir(directory).unwrap();
}
