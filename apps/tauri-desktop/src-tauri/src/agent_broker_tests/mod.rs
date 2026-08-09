use super::*;

fn peer() -> PeerIdentity {
    PeerIdentity {
        user_id: "501".into(),
        process_id: 42,
        executable: "/Applications/Codex.app/Contents/MacOS/codex".into(),
        binary_identity: format!("sha256:{}", "b".repeat(64)),
    }
}

fn hello(_tools: &[&str]) -> ClientHello {
    ClientHello {
        client_key: "codex".into(),
    }
}

fn paired_broker(tools: &[&str]) -> (AgentBrokerCore, Uuid, ConnectionSessionSnapshot) {
    let mut broker = AgentBrokerCore::new().unwrap();
    let client = broker.register_client(peer(), hello(tools), 1_000).unwrap();
    broker.approve_pairing(&client.client_id).unwrap();
    let session = broker
        .issue_session(
            &client.client_id,
            tools.iter().map(|tool| (*tool).to_owned()).collect(),
            vec![],
            60_000,
            20,
            1_001,
        )
        .unwrap();
    (broker, Uuid::parse_str(&client.client_id).unwrap(), session)
}

fn request(
    session: &ConnectionSessionSnapshot,
    request_id: Uuid,
    tool: &str,
    parameters: Value,
) -> Vec<u8> {
    let tool_version = if matches!(
        tool,
        "vaultmesh_accounts_list" | "vaultmesh_ssh_exec" | "vaultmesh_http_request"
    ) {
        2
    } else {
        1
    };
    serde_json::to_vec(&json!({
        "protocolVersion": 2,
        "requestId": request_id,
        "sessionId": session.session_id,
        "tool": tool,
        "toolVersion": tool_version,
        "parameters": parameters
    }))
    .unwrap()
}

fn account_request(
    session: &ConnectionSessionSnapshot,
    request_id: Uuid,
    account_ref: &str,
    tool: &str,
    parameters: Value,
) -> Vec<u8> {
    let tool_version = if matches!(
        tool,
        "vaultmesh_accounts_list" | "vaultmesh_ssh_exec" | "vaultmesh_http_request"
    ) {
        2
    } else {
        1
    };
    serde_json::to_vec(&json!({
        "protocolVersion": 2,
        "requestId": request_id,
        "sessionId": session.session_id,
        "accountRef": account_ref,
        "tool": tool,
        "toolVersion": tool_version,
        "parameters": parameters
    }))
    .unwrap()
}

fn connection_request(request_id: Uuid, tool: &str, parameters: Value) -> Vec<u8> {
    let tool_version = if matches!(
        tool,
        "vaultmesh_accounts_list" | "vaultmesh_ssh_exec" | "vaultmesh_http_request"
    ) {
        2
    } else {
        1
    };
    serde_json::to_vec(&json!({
        "protocolVersion": 2,
        "requestId": request_id,
        "tool": tool,
        "toolVersion": tool_version,
        "parameters": parameters
    }))
    .unwrap()
}

fn test_managed_web_definition(id: &str, source_item_ref: &str) -> AgentConnectorDefinition {
    serde_json::from_value(json!({
        "id": id,
        "displayLabel": "Managed Web",
        "environment": "test",
        "connectorKind": "managed-web",
        "credentialRefs": [{ "kind": "login", "itemId": source_item_ref }],
        "targetPolicy": {
            "connector": "managed-web", "origins": ["https://app.example.test"], "persistSession": false,
            "recipes": [
                { "name": "login", "kind": "login", "path": "/login", "usernameSelector": "#user", "passwordSelector": "#pass", "submitSelector": "button", "successSelector": ".ok", "failureSelector": ".error", "risk": "R2" },
                { "name": "status", "kind": "extract", "path": "/status", "selector": "main", "fields": [{ "name": "status", "selector": ".status", "source": "text" }], "risk": "R1" },
                { "name": "restart", "kind": "action", "path": "/status", "selector": "button.restart", "successSelector": ".ok", "inputs": [], "risk": "R3" },
                { "name": "report", "kind": "download", "path": "/download", "selector": "a.download", "risk": "R1" }
            ]
        },
        "capabilityPolicy": {
            "allowedTools": ["vaultmesh_web_session_open", "vaultmesh_web_extract", "vaultmesh_web_act", "vaultmesh_web_download"],
            "riskCeiling": "R3", "destructiveEnabled": false
        },
        "outputPolicy": { "allowedFields": ["status"], "maxBytes": 4096, "maxItems": 10, "discloseTarget": false },
        "enabled": true, "createdAt": 1, "updatedAt": 1
    })).unwrap()
}

fn test_protected_web_definition(id: &str, source_item_ref: &str) -> AgentConnectorDefinition {
    let definition: AgentConnectorDefinition = serde_json::from_value(json!({
        "id": id,
        "displayLabel": "Protected Web",
        "environment": "test",
        "connectorKind": "managed-web",
        "credentialRefs": [{ "kind": "login", "itemId": source_item_ref }],
        "targetPolicy": {
            "connector": "managed-web", "origins": ["https://app.example.test"], "persistSession": false,
            "recipes": [
                { "name": "login", "kind": "login", "path": "/login", "usernameSelector": "#user", "passwordSelector": "#pass", "submitSelector": "button", "successSelector": ".ok", "failureSelector": ".error", "risk": "R2" },
                { "name": "totp", "kind": "totp", "path": "/status", "selector": "#code", "submitSelector": "#submit", "successSelector": ".ok", "risk": "R2" },
                { "name": "recovery", "kind": "recovery-code", "path": "/status", "selector": "#code", "submitSelector": "#submit", "successSelector": ".ok", "risk": "R3" },
                { "name": "register", "kind": "passkey-assertion", "path": "/status", "selector": "#passkey", "risk": "R3" }
            ]
        },
        "capabilityPolicy": {
            "allowedTools": ["vaultmesh_otp_fill", "vaultmesh_recovery_code_consume", "vaultmesh_passkey_request_begin", "vaultmesh_passkey_perform"],
            "riskCeiling": "R3", "destructiveEnabled": true
        },
        "outputPolicy": { "allowedFields": [], "maxBytes": 4096, "maxItems": 10, "discloseTarget": false },
        "enabled": true, "createdAt": 1, "updatedAt": 1
    })).unwrap();
    definition
}

fn test_direct_ssh_policy(
    account_ref: Uuid,
    label: &str,
    host: &str,
) -> crate::agent_broker::AgentDirectSshPolicy {
    test_direct_ssh_policy_for_tool_with(
        &account_ref.to_string(),
        label,
        host,
        "vaultmesh_ssh_exec",
        &json!({ "program": "hostname" }),
    )
}

fn test_direct_ssh_policy_for_tool(
    account_ref: Uuid,
    tool: &str,
    parameters: &Value,
) -> crate::agent_broker::AgentDirectSshPolicy {
    test_direct_ssh_policy_for_tool_with(
        &account_ref.to_string(),
        "Direct SSH",
        "server.example.test",
        tool,
        parameters,
    )
}

fn test_direct_ssh_policy_for_tool_with(
    account_ref: &str,
    label: &str,
    host: &str,
    tool: &str,
    parameters: &Value,
) -> crate::agent_broker::AgentDirectSshPolicy {
    let risk = if matches!(
        tool,
        "vaultmesh_ssh_pty_open" | "vaultmesh_ssh_tunnel_open" | "vaultmesh_ssh_host_setup"
    ) || parameters["program"] == "sudo"
    {
        "R3"
    } else if matches!(
        tool,
        "vaultmesh_ssh_upload"
            | "vaultmesh_ssh_public_key_install"
            | "vaultmesh_local_file_select"
            | "vaultmesh_result_save"
    ) {
        "R2"
    } else {
        "R1"
    };
    let target_digest = if host == "server.example.test" {
        format!("sha256:{}", "a".repeat(64))
    } else {
        format!("sha256:{}", "b".repeat(64))
    };
    crate::agent_broker::AgentDirectSshPolicy {
        account_ref: Uuid::parse_str(account_ref).unwrap(),
        account_label: label.into(),
        environment: "test".into(),
        tool: tool.into(),
        risk: risk.into(),
        action_display: parameters["program"].as_str().unwrap_or(tool).into(),
        host: host.into(),
        port: 22,
        username: "deploy".into(),
        host_key_sha256: "SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
        target_digest,
        approved_display: host.into(),
        max_output_bytes: 4096,
        remote_path_prefixes: vec!["/srv".into()],
        connector_ref: None,
        tunnel: None,
    }
}

fn test_direct_http_policy(item_id: Uuid) -> crate::agent_broker::AgentDirectHttpPolicy {
    let mut policy = test_direct_http_policy_for_operation(item_id, "read");
    policy.operation.name = "direct".into();
    policy.operation.method = "GET".into();
    policy.operation.path = "/v1/status".into();
    policy.operation.request_fields = Vec::new();
    policy.operation.request_mode = vaultmesh_ffi::AgentHttpBodyMode::Empty;
    policy.approved_display = "https://api.example.test/v1/status".into();
    policy
}

fn configure_test_direct_http_account(broker: &mut AgentBrokerCore, account_ref: Uuid) {
    broker.set_account_catalog(Arc::new(move || {
        Ok(AgentAccountCatalogSnapshot {
            connector_definitions: Vec::new(),
            candidates: vec![AgentVaultAccountCandidate {
                account_ref,
                kind: "secret".into(),
                label: "Direct API".into(),
            }],
        })
    }));
    broker.set_direct_http_policy_factory(Arc::new(move |item_id, kind, tool, parameters| {
        assert_eq!(item_id, account_ref);
        assert_eq!(kind, "secret");
        assert_eq!(tool, "vaultmesh_http_request");
        assert_eq!(parameters["method"], "GET");
        assert_eq!(parameters["path"], "/status");
        Ok(test_direct_http_policy(item_id))
    }));
}

fn test_direct_http_policy_for_operation(
    item_id: Uuid,
    operation: &str,
) -> crate::agent_broker::AgentDirectHttpPolicy {
    let risk = if operation == "restart_service" {
        vaultmesh_ffi::AgentRiskTier::R2
    } else {
        vaultmesh_ffi::AgentRiskTier::R1
    };
    crate::agent_broker::AgentDirectHttpPolicy {
        account_ref: item_id,
        account_label: "Test API".into(),
        environment: "test".into(),
        item_kind: "secret".into(),
        credential_kind: vaultmesh_ffi::AgentCredentialKind::Secret,
        origin: "https://api.example.test".into(),
        auth_strategy: vaultmesh_ffi::AgentHttpAuthStrategy::Bearer,
        operation: vaultmesh_ffi::AgentHttpOperationPolicy {
            name: operation.into(),
            method: if operation == "restart_service" {
                "POST".into()
            } else {
                "GET".into()
            },
            path: format!("/v1/{operation}"),
            request_fields: if operation == "restart_service" {
                vec!["service".into()]
            } else {
                Vec::new()
            },
            response_fields: vec!["status".into()],
            request_mode: vaultmesh_ffi::AgentHttpBodyMode::Json,
            response_mode: vaultmesh_ffi::AgentHttpBodyMode::Json,
            risk,
        },
        target_digest: format!("sha256:{}", "b".repeat(64)),
        approved_display: "https://api.example.test".into(),
        allowed_output_fields: vec!["status".into()],
        max_output_bytes: 4096,
        max_output_items: 10,
    }
}

fn test_direct_connector_policy(
    account_ref: Uuid,
    tool: &str,
    parameters: &Value,
) -> crate::agent_broker::AgentDirectConnectorPolicy {
    let operation = parameters
        .get("operation")
        .and_then(Value::as_str)
        .or_else(|| parameters.get("recipe").and_then(Value::as_str))
        .map(str::to_owned);
    let risk = match tool {
        "vaultmesh_web_act"
        | "vaultmesh_recovery_code_consume"
        | "vaultmesh_passkey_request_begin"
        | "vaultmesh_passkey_perform" => "R3",
        "vaultmesh_web_session_open" | "vaultmesh_otp_fill" => "R2",
        _ => "R1",
    };
    crate::agent_broker::AgentDirectConnectorPolicy {
        connector_ref: account_ref,
        account_ref,
        account_label: "Managed Web".into(),
        environment: "test".into(),
        connector_kind: "managed-web".into(),
        tool: tool.into(),
        operation,
        risk: risk.into(),
        action_display: tool.into(),
        approved_display: "https://app.example.test".into(),
        target_digest: format!("sha256:{}", "c".repeat(64)),
    }
}

fn broker_permission_request(
    broker: &mut AgentBrokerCore,
    client_id: Uuid,
    session: &ConnectionSessionSnapshot,
    account_ref: &str,
    parameters: Value,
    now_millis: u64,
) -> Value {
    json!({
        "ok": true,
        "result": broker
            .request_permission(
                client_id,
                Uuid::parse_str(&session.session_id).unwrap(),
                account_ref,
                &parameters,
                now_millis,
            )
            .unwrap()
    })
}

fn seed_test_direct_action(
    broker: &mut AgentBrokerCore,
    client_id: Uuid,
    account_ref: &str,
    tool: &str,
    parameters: &Value,
) {
    let digest = crate::agent_broker::canonical_parameters_digest(parameters).unwrap();
    let key = (client_id, account_ref.to_owned(), tool.to_owned(), digest);
    if tool == "vaultmesh_http_request" {
        let method = parameters["method"].as_str().unwrap();
        let path = parameters["path"].as_str().unwrap();
        let mut policy = test_direct_http_policy(Uuid::parse_str(account_ref).unwrap());
        policy.operation.method = method.to_owned();
        policy.operation.path = format!("/v1{path}");
        policy.operation.risk = crate::agent_http_path_policy::method_risk(method).unwrap();
        broker.active_direct_http_policies.insert(key, policy);
    } else {
        broker.active_direct_ssh_policies.insert(
            key,
            test_direct_ssh_policy_for_tool(
                Uuid::parse_str(account_ref).unwrap(),
                tool,
                parameters,
            ),
        );
    }
}

fn test_agent_connector_definition(id: &str, allowed_tools: &[&str]) -> AgentConnectorDefinition {
    serde_json::from_value(json!({
        "id": id,
        "displayLabel": "Test SSH",
        "environment": "test",
        "connectorKind": "ssh",
        "credentialRefs": [{ "kind": "ssh", "itemId": id }],
        "targetPolicy": {
            "connector": "ssh", "host": "ssh.example.test", "port": 22,
            "hostKeySha256": "SHA256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "tunnelPolicies": [{ "name": "database", "localHost": "127.0.0.1", "localPort": 15432, "destinationHost": "db.internal", "destinationPort": 5432, "maxConnections": 1, "ttlMillis": 60000, "risk": "R3" }]
        },
        "capabilityPolicy": {
            "allowedTools": allowed_tools, "riskCeiling": "R3", "destructiveEnabled": false
        },
        "outputPolicy": {
            "allowedFields": ["status"], "maxBytes": 4096, "maxItems": 10,
            "discloseTarget": false
        },
        "enabled": true,
        "createdAt": 1,
        "updatedAt": 1
    }))
    .unwrap()
}

mod authorization;
mod dispatch;
mod transport;
