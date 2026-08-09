use super::*;

fn ssh_tunnel_definition() -> NewAgentConnectorDefinition {
    NewAgentConnectorDefinition {
        display_label: "Production database tunnel".into(),
        environment: "production".into(),
        connector_kind: AgentConnectorKind::Ssh,
        credential_refs: vec![AgentCredentialRef {
            kind: AgentCredentialKind::Ssh,
            item_id: Uuid::new_v4(),
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
            allowed_fields: vec!["endpoint".into()],
            max_bytes: 4_096,
            max_items: 8,
            disclose_target: false,
        },
        enabled: true,
    }
}

fn managed_web_definition() -> NewAgentConnectorDefinition {
    let mut definition = ssh_tunnel_definition();
    definition.display_label = "Managed portal recipe".into();
    definition.connector_kind = AgentConnectorKind::ManagedWeb;
    definition.credential_refs[0].kind = AgentCredentialKind::Login;
    definition.target_policy = AgentTargetPolicy::ManagedWeb {
        origins: vec!["https://portal.example.test".into()],
        recipes: vec![
            AgentWebRecipePolicy {
                name: "login".into(),
                kind: AgentWebRecipeKind::Login,
                path: "/login".into(),
                username_selector: Some("#username".into()),
                password_selector: Some("#password".into()),
                submit_selector: Some("button[type=submit]".into()),
                success_selector: Some("#dashboard".into()),
                failure_selector: Some(".login-error".into()),
                selector: None,
                fields: Vec::new(),
                inputs: Vec::new(),
                risk: AgentRiskTier::R2,
            },
            AgentWebRecipePolicy {
                name: "status".into(),
                kind: AgentWebRecipeKind::Extract,
                path: "/dashboard".into(),
                username_selector: None,
                password_selector: None,
                submit_selector: None,
                success_selector: None,
                failure_selector: None,
                selector: None,
                fields: vec![AgentWebFieldPolicy {
                    name: "state".into(),
                    selector: "#state".into(),
                    source: AgentWebFieldSource::Text,
                }],
                inputs: Vec::new(),
                risk: AgentRiskTier::R1,
            },
        ],
        persist_session: false,
    };
    definition.capability_policy.allowed_tools = vec![
        "vaultmesh_web_session_open".into(),
        "vaultmesh_web_extract".into(),
    ];
    definition.capability_policy.risk_ceiling = AgentRiskTier::R2;
    definition.output_policy.allowed_fields = vec!["state".into()];
    definition
}

#[test]
fn ct_agent_removed_format2_shapes_are_rejected_on_read() {
    let legacy_http = serde_json::from_value::<NewAgentConnectorDefinition>(serde_json::json!({
        "displayLabel": "Legacy HTTP record",
        "environment": "test",
        "connectorKind": "http",
        "credentialRefs": [{
            "kind": "secret",
            "itemId": "00000000-0000-4000-8000-000000000096"
        }],
        "targetPolicy": {
            "connector": "http",
            "origin": "https://api.example.test",
            "authStrategy": "bearer",
            "operations": []
        },
        "capabilityPolicy": {
            "allowedTools": ["vaultmesh_http_request"],
            "riskCeiling": "R1",
            "destructiveEnabled": false
        },
        "outputPolicy": {
            "allowedFields": ["status"],
            "maxBytes": 4096,
            "maxItems": 10,
            "discloseTarget": false
        },
        "permissionRules": [],
        "enabled": true
    }));
    assert!(legacy_http.is_err());
}

#[test]
fn ct_agent_internal_definition_accepts_only_fixed_ssh_tunnels() {
    let definition = ssh_tunnel_definition();
    assert_eq!(validate_agent_connector_definition(&definition), Ok(()));

    let mut missing_tunnel = definition.clone();
    let AgentTargetPolicy::Ssh { tunnel_policies, .. } = &mut missing_tunnel.target_policy else {
        unreachable!();
    };
    tunnel_policies.clear();
    assert_eq!(
        validate_agent_connector_definition(&missing_tunnel),
        Err(VaultError::InvalidAgentConnectorDefinition)
    );
}

#[test]
fn ct_agent_ssh_tunnel_is_loopback_pinned_bounded_and_privileged() {
    let mut definition = ssh_tunnel_definition();
    let AgentTargetPolicy::Ssh {
        host_key_sha256,
        tunnel_policies,
        ..
    } = &mut definition.target_policy else {
        unreachable!();
    };
    *host_key_sha256 = "accept-any".into();
    tunnel_policies[0].local_host = "0.0.0.0".into();
    assert_eq!(
        validate_agent_connector_definition(&definition),
        Err(VaultError::InvalidAgentConnectorDefinition)
    );
}

#[test]
fn ct_agent_internal_definition_rejects_secret_tools_and_unbounded_output() {
    let mut definition = ssh_tunnel_definition();
    definition.capability_policy.allowed_tools = vec!["vaultmesh_get_private_key".into()];
    assert_eq!(
        validate_agent_connector_definition(&definition),
        Err(VaultError::InvalidAgentConnectorDefinition)
    );

    let mut definition = ssh_tunnel_definition();
    definition.output_policy.max_bytes = MAX_OUTPUT_BYTES + 1;
    assert_eq!(
        validate_agent_connector_definition(&definition),
        Err(VaultError::InvalidAgentConnectorDefinition)
    );
}

#[test]
fn ct_agent_managed_web_recipe_is_origin_bound_and_nonpersistent() {
    let mut definition = managed_web_definition();
    assert_eq!(validate_agent_connector_definition(&definition), Ok(()));

    let AgentTargetPolicy::ManagedWeb {
        persist_session, ..
    } = &mut definition.target_policy else {
        unreachable!();
    };
    *persist_session = true;
    assert_eq!(
        validate_agent_connector_definition(&definition),
        Err(VaultError::InvalidAgentConnectorDefinition)
    );
}
