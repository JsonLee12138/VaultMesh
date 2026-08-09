#[test]
fn agent_direct_ssh_plan_uses_original_account_and_revalidates_pinned_target() {
    let path = std::env::temp_dir().join(format!(
        "vaultmesh-tauri-agent-direct-ssh-plan-{}.vault",
        uuid::Uuid::new_v4()
    ));
    let password = "correct horse battery staple";
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime.create(password.into()).expect("create");
    let account = runtime
        .execute(
            "ssh.add",
            json!({
                "title": "Agent server", "host": "SERVER.example.test", "port": 2222,
                "username": "deploy", "password": "server-password", "publicKey": null,
                "privateKey": null, "keyPassphrase": null, "notes": null, "folder": null,
                "favorite": false, "masterPasswordReprompt": false, "recordKind": "account"
            }),
        )
        .expect("account");
    let account_ref = uuid::Uuid::parse_str(account["id"].as_str().unwrap()).unwrap();
    let mut policy = agent_broker::AgentDirectSshPolicy {
        account_ref,
        account_label: "Agent server".to_owned(),
        environment: "default".to_owned(),
        tool: "vaultmesh_ssh_exec".to_owned(),
        risk: "R1".to_owned(),
        action_display: "hostname".to_owned(),
        host: "server.example.test".to_owned(),
        port: 2222,
        username: "deploy".to_owned(),
        host_key_sha256: "SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_owned(),
        target_digest: format!("sha256:{}", "b".repeat(64)),
        approved_display: "deploy@server.example.test:2222".to_owned(),
        max_output_bytes: 4096,
        remote_path_prefixes: Vec::new(),
        connector_ref: None,
        tunnel: None,
    };
    let request = collect_direct_agent_ssh_exec_request(
        &mut runtime,
        &policy,
        &json!({ "program": "hostname", "arguments": [] }),
    )
    .expect("direct request");
    assert_eq!(request.target.host, "server.example.test");
    assert_eq!(request.target.port, 2222);
    assert_eq!(request.target.username, "deploy");
    assert_eq!(request.command, "hostname");
    assert!(matches!(
        request.authentication,
        AuthenticationMaterial::StoredPassword(ref value) if value.as_str() == "server-password"
    ));

    policy.host = "changed.example.test".to_owned();
    assert!(
        collect_direct_agent_ssh_exec_request(
            &mut runtime,
            &policy,
            &json!({ "program": "hostname", "arguments": [] }),
        )
        .is_err()
    );
    runtime.lock();
    std::fs::remove_file(path).expect("cleanup");
}

#[test]
fn agent_direct_ssh_collectors_cover_transfer_key_pty_and_fixed_tunnel() {
    let path = std::env::temp_dir().join(format!(
        "vaultmesh-tauri-agent-direct-ssh-tools-{}.vault",
        uuid::Uuid::new_v4()
    ));
    let password = "correct horse battery staple";
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime.create(password.into()).expect("create");
    let account = runtime
        .execute(
            "ssh.add",
            json!({
                "title": "Agent server", "host": "server.example.test", "port": 2222,
                "username": "deploy", "password": "server-password", "publicKey": null,
                "privateKey": null, "keyPassphrase": null, "notes": null, "folder": null,
                "favorite": false, "masterPasswordReprompt": false, "recordKind": "account"
            }),
        )
        .expect("account");
    let key = runtime
        .execute(
            "ssh.add",
            json!({
                "title": "Deployment key", "host": null, "port": 22, "username": "",
                "password": null,
                "publicKey": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGV4YW1wbGU= deploy@test",
                "privateKey": null, "keyPassphrase": null, "notes": null, "folder": null,
                "favorite": false, "masterPasswordReprompt": false, "recordKind": "key"
            }),
        )
        .expect("key");
    let account_ref = uuid::Uuid::parse_str(account["id"].as_str().unwrap()).unwrap();
    let host_key = "SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    let definition: NewAgentConnectorDefinition = serde_json::from_value(json!({
        "displayLabel": "Fixed tunnel", "environment": "test", "connectorKind": "ssh",
        "credentialRefs": [{ "kind": "ssh", "itemId": account_ref }],
        "targetPolicy": {
            "connector": "ssh", "host": "server.example.test", "port": 2222,
            "hostKeySha256": host_key,
            "tunnelPolicies": [{
                "name": "database", "localHost": "127.0.0.1", "localPort": 15432,
                "destinationHost": "db.internal", "destinationPort": 5432,
                "maxConnections": 2, "ttlMillis": 60000, "risk": "R3"
            }]
        },
        "capabilityPolicy": {
            "allowedTools": ["vaultmesh_ssh_tunnel_open"],
            "riskCeiling": "R3", "destructiveEnabled": false
        },
        "outputPolicy": {
            "allowedFields": ["status"], "maxBytes": 4096, "maxItems": 10,
            "discloseTarget": false
        },
        "enabled": true
    }))
    .expect("definition input");
    let definition = runtime
        .add_agent_connector_definition(definition, 100)
        .expect("definition");
    let base_policy = agent_broker::AgentDirectSshPolicy {
        account_ref,
        account_label: "Agent server".to_owned(),
        environment: "default".to_owned(),
        tool: "vaultmesh_ssh_upload".to_owned(),
        risk: "R2".to_owned(),
        action_display: "上传到 /srv/upload.bin".to_owned(),
        host: "server.example.test".to_owned(),
        port: 2222,
        username: "deploy".to_owned(),
        host_key_sha256: host_key.to_owned(),
        target_digest: format!("sha256:{}", "b".repeat(64)),
        approved_display: "deploy@server.example.test:2222".to_owned(),
        max_output_bytes: 4096,
        remote_path_prefixes: vec!["/srv".to_owned()],
        connector_ref: None,
        tunnel: None,
    };

    let upload = collect_direct_agent_ssh_transfer_request(
        &mut runtime,
        &base_policy,
        &json!({ "fileRef": uuid::Uuid::new_v4(), "remotePath": "/srv/upload.bin" }),
    )
    .expect("upload request");
    assert_eq!(upload.target.endpoint(), "deploy@server.example.test:2222");
    assert_eq!(upload.remote_path, "/srv/upload.bin");
    assert_eq!(upload.remote_path_prefixes, vec!["/srv"]);
    assert!(matches!(
        upload.authentication,
        AuthenticationMaterial::StoredPassword(ref value) if value.as_str() == "server-password"
    ));

    let mut pty_policy = base_policy.clone();
    pty_policy.tool = "vaultmesh_ssh_pty_open".to_owned();
    pty_policy.risk = "R3".to_owned();
    let pty = collect_direct_agent_ssh_pty_request(&mut runtime, &pty_policy)
        .expect("PTY request");
    assert_eq!(pty.max_output_bytes, 4096);

    let mut key_policy = base_policy.clone();
    key_policy.tool = "vaultmesh_ssh_public_key_install".to_owned();
    let install = collect_direct_agent_ssh_public_key_install_request(
        &mut runtime,
        &key_policy,
        &json!({ "publicKeyRef": key["id"] }),
    )
    .expect("public key install request");
    assert!(install.public_key.starts_with("ssh-ed25519 "));
    assert!(matches!(
        install.authentication,
        AuthenticationMaterial::StoredPassword(ref value) if value.as_str() == "server-password"
    ));

    let ssh_root = std::env::temp_dir().join(format!(
        "vaultmesh-agent-host-setup-{}",
        uuid::Uuid::new_v4()
    ));
    let ssh_directory = ssh_root.join(".ssh");
    std::fs::create_dir_all(&ssh_directory).expect("ssh directory");
    let mut setup_policy = base_policy.clone();
    setup_policy.tool = "vaultmesh_ssh_host_setup".to_owned();
    setup_policy.risk = "R3".to_owned();
    let setup = collect_direct_agent_ssh_host_setup_request(
        &mut runtime,
        &ssh_directory,
        &setup_policy,
        &json!({ "alias": "home-server" }),
    )
    .expect("host setup request");
    assert_eq!(setup.commit.alias, "home-server");
    assert!(!setup.commit.config_ready);
    assert!(!setup.existing_binding);
    assert!(setup.public_key.starts_with("ssh-ed25519 "));
    assert_eq!(
        runtime
            .execute("ssh.list", json!({}))
            .expect("managed key is visible")
            .as_array()
            .map(Vec::len),
        Some(3)
    );
    assert!(!ssh_directory
        .join("vaultmesh/hosts/home-server/manifest.json")
        .exists());
    assert!(matches!(
        setup.bootstrap_authentication,
        Some(AuthenticationMaterial::StoredPassword(ref value)) if value.as_str() == "server-password"
    ));
    let managed_key_id = setup.key_item_id;
    drop(setup);
    let repeated = collect_direct_agent_ssh_host_setup_request(
        &mut runtime,
        &ssh_directory,
        &setup_policy,
        &json!({ "alias": "home-server" }),
    )
    .expect("repeat host setup request");
    assert!(repeated.existing_binding);
    assert_eq!(repeated.key_item_id, managed_key_id);
    assert_eq!(
        runtime
            .execute("ssh.list", json!({}))
            .expect("managed key remains singular")
            .as_array()
            .map(Vec::len),
        Some(3)
    );

    let tunnel: vaultmesh_ffi::AgentSshTunnelPolicy = serde_json::from_value(json!({
        "name": "database", "localHost": "127.0.0.1", "localPort": 15432,
        "destinationHost": "db.internal", "destinationPort": 5432,
        "maxConnections": 2, "ttlMillis": 60000, "risk": "R3"
    }))
    .unwrap();
    let mut tunnel_policy = base_policy;
    tunnel_policy.tool = "vaultmesh_ssh_tunnel_open".to_owned();
    tunnel_policy.risk = "R3".to_owned();
    tunnel_policy.connector_ref = Some(definition.id);
    tunnel_policy.tunnel = Some(tunnel);
    let tunnel = collect_direct_agent_ssh_tunnel_request(
        &mut runtime,
        &tunnel_policy,
        &json!({ "endpoint": "database" }),
    )
    .expect("tunnel request");
    assert_eq!(tunnel.local_host, "127.0.0.1");
    assert_eq!(tunnel.local_port, 15432);
    assert_eq!(tunnel.destination_host, "db.internal");
    assert_eq!(tunnel.destination_port, 5432);

    runtime.lock();
    std::fs::remove_file(path).expect("cleanup");
    std::fs::remove_dir_all(ssh_root).expect("SSH setup cleanup");
}

#[test]
fn ct_agent_http_path_001_direct_secret_uses_method_path_and_revalidates_target() {
    let path = std::env::temp_dir().join(format!(
        "vaultmesh-tauri-agent-direct-http-plan-{}.vault",
        uuid::Uuid::new_v4()
    ));
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime
        .create("correct horse battery staple".into())
        .expect("create");
    let credential = runtime
        .execute(
            "secrets.add",
            json!({
                "title": "Agent API token", "kind": "access-token",
                "secret": "http-token-canary", "website": "http://127.0.0.1:8080/v1",
                "notes": null
            }),
        )
        .expect("credential");
    let account_ref = uuid::Uuid::parse_str(credential["id"].as_str().unwrap()).unwrap();
    let mut policy = agent_direct_policy::generate_direct_http_policy(
        &mut runtime,
        account_ref,
        "secret",
        "vaultmesh_http_request",
        &json!({ "method": "GET", "path": "/status", "responseMode": "json" }),
    )
    .expect("connector definition");
    let request = collect_direct_agent_http_request(
        &mut runtime,
        &policy,
        &json!({ "method": "GET", "path": "/status", "responseMode": "json" }),
    )
    .expect("direct HTTP request");
    assert_eq!(request.origin, "http://127.0.0.1:8080");
    assert_eq!(request.operation.method, "GET");
    assert_eq!(request.operation.path, "/v1/status");
    assert!(matches!(
        request.authentication,
        agent_http::AgentHttpAuthentication::Bearer(ref token)
            if token.as_str() == "http-token-canary"
    ));

    policy.origin = "https://changed.example.test".to_owned();
    assert!(
        collect_direct_agent_http_request(
            &mut runtime,
            &policy,
            &json!({ "method": "GET", "path": "/status", "responseMode": "json" }),
        )
        .is_err()
    );
    runtime.lock();
    std::fs::remove_file(path).expect("cleanup");
}

#[test]
fn agent_direct_managed_web_policy_pins_recipe_and_revalidates_before_secret_use() {
    let path = std::env::temp_dir().join(format!(
        "vaultmesh-tauri-agent-direct-web-plan-{}.vault",
        uuid::Uuid::new_v4()
    ));
    let password = "correct horse battery staple";
    let mut runtime = DesktopRuntime::new(path.clone()).expect("runtime");
    runtime.create(password.into()).expect("create");
    let login = runtime
        .execute(
            "items.add",
            json!({
                "title": "Portal login", "username": "operator",
                "password": "web-runtime-canary", "url": "https://portal.example.test/login",
                "notes": null
            }),
        )
        .expect("login");
    let definition: NewAgentConnectorDefinition = serde_json::from_value(json!({
        "displayLabel": "Managed portal", "environment": "test",
        "connectorKind": "managed-web",
        "credentialRefs": [{ "kind": "login", "itemId": login["id"] }],
        "targetPolicy": {
            "connector": "managed-web", "origins": ["https://portal.example.test"],
            "recipes": [
                {
                    "name": "login", "kind": "login", "path": "/login",
                    "usernameSelector": "#username", "passwordSelector": "#password",
                    "submitSelector": "#submit", "successSelector": "#dashboard",
                    "failureSelector": ".error", "risk": "R2"
                },
                {
                    "name": "status", "kind": "extract", "path": "/dashboard",
                    "fields": [{ "name": "state", "selector": "#state", "source": "text" }],
                    "risk": "R1"
                },
                {
                    "name": "totp", "kind": "totp", "path": "/mfa",
                    "selector": "#totp", "submitSelector": "#submit-totp",
                    "successSelector": "#dashboard", "risk": "R2"
                },
                {
                    "name": "recovery", "kind": "recovery-code", "path": "/recovery",
                    "selector": "#recovery", "submitSelector": "#submit-recovery",
                    "successSelector": "#dashboard", "risk": "R3"
                },
                {
                    "name": "register", "kind": "passkey-registration", "path": "/security",
                    "selector": "#register-passkey", "risk": "R3"
                }
            ],
            "persistSession": false
        },
        "capabilityPolicy": {
            "allowedTools": [
                "vaultmesh_web_session_open", "vaultmesh_web_extract",
                "vaultmesh_otp_fill", "vaultmesh_recovery_code_consume",
                "vaultmesh_passkey_request_begin", "vaultmesh_passkey_perform"
            ],
            "riskCeiling": "R3", "destructiveEnabled": false
        },
        "outputPolicy": {
            "allowedFields": ["state"], "maxBytes": 4096, "maxItems": 10,
            "discloseTarget": false
        },
        "enabled": true
    }))
    .expect("definition input");
    let definition = runtime
        .add_agent_connector_definition(definition, 100)
        .expect("definition");
    let open_parameters = json!({});
    let open_policy = agent_direct_policy::generate_direct_connector_policy(
        &mut runtime,
        definition.id,
        "vaultmesh_web_session_open",
        &open_parameters,
    )
    .expect("open policy");
    assert_eq!(open_policy.connector_kind, "managed-web");
    assert_eq!(open_policy.risk, "R2");
    let plan = collect_direct_agent_managed_web_open_plan(
        &mut runtime,
        &open_policy,
        &open_parameters,
        std::env::temp_dir(),
    )
    .expect("open plan");
    assert_eq!(plan.definition_id, definition.id.to_string());
    assert_eq!(plan.origins, vec!["https://portal.example.test"]);
    assert_eq!(plan.username.as_str(), "operator");
    assert_eq!(plan.password.as_str(), "web-runtime-canary");

    let extract = agent_direct_policy::generate_direct_connector_policy(
        &mut runtime,
        definition.id,
        "vaultmesh_web_extract",
        &json!({ "sessionRef": "web_bound", "recipe": "status" }),
    )
    .expect("extract policy");
    assert_eq!(extract.operation.as_deref(), Some("status"));
    assert_eq!(extract.risk, "R1");
    assert!(
        agent_direct_policy::generate_direct_connector_policy(
            &mut runtime,
            definition.id,
            "vaultmesh_web_extract",
            &json!({ "sessionRef": "web_bound", "recipe": "unconfigured" }),
        )
        .is_err()
    );

    let otp_parameters = json!({ "targetRef": format!("webt_{}", "a".repeat(32)) });
    let otp = agent_direct_policy::generate_direct_connector_policy(
        &mut runtime,
        definition.id,
        "vaultmesh_otp_fill",
        &otp_parameters,
    )
    .expect("OTP policy");
    assert_eq!(otp.risk, "R2");
    let recovery = agent_direct_policy::generate_direct_connector_policy(
        &mut runtime,
        definition.id,
        "vaultmesh_recovery_code_consume",
        &json!({ "targetRef": format!("webt_{}", "b".repeat(32)) }),
    )
    .expect("recovery policy");
    assert_eq!(recovery.risk, "R3");
    let passkey_begin = agent_direct_policy::generate_direct_connector_policy(
        &mut runtime,
        definition.id,
        "vaultmesh_passkey_request_begin",
        &json!({ "sessionRef": "web_bound", "recipe": "register" }),
    )
    .expect("Passkey begin policy");
    assert_eq!(passkey_begin.operation.as_deref(), Some("register"));
    let passkey_perform = agent_direct_policy::generate_direct_connector_policy(
        &mut runtime,
        definition.id,
        "vaultmesh_passkey_perform",
        &json!({ "requestRef": format!("webauthn_{}", "c".repeat(32)) }),
    )
    .expect("Passkey perform policy");
    assert_eq!(passkey_perform.risk, "R3");
    assert!(
        agent_direct_policy::generate_direct_connector_policy(
            &mut runtime,
            definition.id,
            "vaultmesh_otp_fill",
            &json!({ "targetRef": "webt_agent_selected" }),
        )
        .is_err()
    );
    let mut drifted_otp = otp;
    drifted_otp.target_digest = format!("sha256:{}", "0".repeat(64));
    assert!(
        validate_direct_agent_connector_policy(&mut runtime, &drifted_otp, &otp_parameters)
            .is_err()
    );

    runtime.lock();
    std::fs::remove_file(path).expect("cleanup");
}
