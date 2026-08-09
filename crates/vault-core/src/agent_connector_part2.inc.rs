pub fn validate_agent_connector_definition(input: &NewAgentConnectorDefinition) -> Result<(), VaultError> {
    if !valid_label(&input.display_label)
        || !valid_label(&input.environment)
        || input.credential_refs.is_empty()
        || input.credential_refs.len() > MAX_CREDENTIAL_REFS
        || input.output_policy.max_bytes == 0
        || input.output_policy.max_bytes > MAX_OUTPUT_BYTES
        || input.output_policy.max_items == 0
        || input.output_policy.max_items > 10_000
        || !valid_unique_names(&input.capability_policy.allowed_tools, "vaultmesh_")
        || !valid_unique_names(&input.output_policy.allowed_fields, "")
        || (input.capability_policy.risk_ceiling == AgentRiskTier::R4)
            != input.capability_policy.destructive_enabled
    {
        return Err(VaultError::InvalidAgentConnectorDefinition);
    }
    let mut credential_ids = HashSet::new();
    if input
        .credential_refs
        .iter()
        .any(|reference| !credential_ids.insert(reference.item_id))
    {
        return Err(VaultError::InvalidAgentConnectorDefinition);
    }
    let connector_matches = matches!(
        (input.connector_kind, &input.target_policy),
        (AgentConnectorKind::Ssh, AgentTargetPolicy::Ssh { .. })
            | (
                AgentConnectorKind::ManagedWeb,
                AgentTargetPolicy::ManagedWeb { .. }
            )
    );
    let credential_kinds_match = input.credential_refs.iter().all(|reference| {
        matches!(
            (input.connector_kind, reference.kind),
            (AgentConnectorKind::Ssh, AgentCredentialKind::Ssh)
                | (
                    AgentConnectorKind::ManagedWeb,
                    AgentCredentialKind::Login
                        | AgentCredentialKind::Email
                        | AgentCredentialKind::Passkey
                )
        )
    });
    let connector_capabilities_match = match input.connector_kind {
        AgentConnectorKind::Ssh => {
            input.credential_refs.len() == 1
                && input.capability_policy.allowed_tools
                    == ["vaultmesh_ssh_tunnel_open".to_owned()]
        }
        AgentConnectorKind::ManagedWeb => input.capability_policy.allowed_tools.iter().all(|tool| {
            matches!(
                tool.as_str(),
                "vaultmesh_web_session_open"
                    | "vaultmesh_web_navigate"
                    | "vaultmesh_web_extract"
                    | "vaultmesh_web_act"
                    | "vaultmesh_web_download"
                    | "vaultmesh_otp_fill"
                    | "vaultmesh_recovery_code_consume"
                    | "vaultmesh_passkey_request_begin"
                    | "vaultmesh_passkey_perform"
            )
        }),
    };
    let managed_web_auth_matches = match &input.target_policy {
        AgentTargetPolicy::ManagedWeb { recipes, .. } => {
            let login_count = input
                .credential_refs
                .iter()
                .filter(|credential| credential.kind == AgentCredentialKind::Login)
                .count();
            let email_count = input
                .credential_refs
                .iter()
                .filter(|credential| credential.kind == AgentCredentialKind::Email)
                .count();
            let passkey_count = input
                .credential_refs
                .iter()
                .filter(|credential| credential.kind == AgentCredentialKind::Passkey)
                .count();
            let has_passkey_registration = recipes
                .iter()
                .any(|recipe| recipe.kind == AgentWebRecipeKind::PasskeyRegistration);
            let has_passkey_assertion = recipes
                .iter()
                .any(|recipe| recipe.kind == AgentWebRecipeKind::PasskeyAssertion);
            login_count == 1
                && email_count <= 1
                && passkey_count <= 1
                && (!recipes
                    .iter()
                    .any(|recipe| recipe.kind == AgentWebRecipeKind::EmailOtp)
                    || email_count == 1)
                && input
                    .capability_policy
                    .allowed_tools
                    .iter()
                    .any(|tool| tool == "vaultmesh_otp_fill")
                    == recipes.iter().any(|recipe| {
                        matches!(
                            recipe.kind,
                            AgentWebRecipeKind::Totp | AgentWebRecipeKind::EmailOtp
                        )
                    })
                && input
                    .capability_policy
                    .allowed_tools
                    .iter()
                    .any(|tool| tool == "vaultmesh_recovery_code_consume")
                    == recipes
                        .iter()
                        .any(|recipe| recipe.kind == AgentWebRecipeKind::RecoveryCode)
                && input
                    .capability_policy
                    .allowed_tools
                    .iter()
                    .any(|tool| tool == "vaultmesh_passkey_request_begin")
                    == recipes.iter().any(|recipe| {
                        matches!(
                            recipe.kind,
                            AgentWebRecipeKind::PasskeyRegistration
                                | AgentWebRecipeKind::PasskeyAssertion
                        )
                    })
                && input
                    .capability_policy
                    .allowed_tools
                    .iter()
                    .any(|tool| tool == "vaultmesh_passkey_perform")
                    == recipes.iter().any(|recipe| {
                        matches!(
                            recipe.kind,
                            AgentWebRecipeKind::PasskeyRegistration
                                | AgentWebRecipeKind::PasskeyAssertion
                        )
                    })
                && !(has_passkey_registration && has_passkey_assertion)
                && (!has_passkey_registration || passkey_count == 0)
                && (!has_passkey_assertion || passkey_count == 1)
        }
        _ => true,
    };
    if !connector_matches
        || !credential_kinds_match
        || !connector_capabilities_match
        || !managed_web_auth_matches
        || !validate_target(&input.target_policy)
        || !target_risks_fit_capability(&input.target_policy, &input.capability_policy)
    {
        return Err(VaultError::InvalidAgentConnectorDefinition);
    }
    Ok(())
}

fn validate_target(target: &AgentTargetPolicy) -> bool {
    match target {
        AgentTargetPolicy::Ssh {
            host,
            port,
            host_key_sha256,
            tunnel_policies,
        } => {
            valid_host(host)
                && *port > 0
                && valid_ssh_fingerprint(host_key_sha256)
                && !tunnel_policies.is_empty()
                && valid_ssh_tunnels(tunnel_policies)
        }
        AgentTargetPolicy::ManagedWeb {
            origins,
            recipes,
            persist_session,
        } => {
            !origins.is_empty()
                && origins.len() <= 8
                && origins.iter().all(|origin| valid_https_origin(origin))
                && !persist_session
                && valid_web_recipes(recipes)
        }
    }
}

fn valid_http_path(path: &str) -> bool {
    path.starts_with('/')
        && path.len() <= MAX_TARGET_CHARS
        && path.is_ascii()
        && !path.contains("..")
        && !path.contains("//")
        && !path.contains(['\\', '?', '#', '%'])
        && !path.chars().any(char::is_control)
}

fn target_risks_fit_capability(
    target: &AgentTargetPolicy,
    capability: &AgentCapabilityPolicy,
) -> bool {
    match target {
        AgentTargetPolicy::ManagedWeb { recipes, .. } => recipes.iter().all(|operation| {
            operation.risk <= capability.risk_ceiling
                && (operation.risk != AgentRiskTier::R4 || capability.destructive_enabled)
        }),
        AgentTargetPolicy::Ssh {
            tunnel_policies,
            ..
        } => tunnel_policies.iter().map(|operation| operation.risk).all(|risk| {
                risk <= capability.risk_ceiling
                    && (risk != AgentRiskTier::R4 || capability.destructive_enabled)
            }),
    }
}

fn valid_ssh_tunnels(tunnels: &[AgentSshTunnelPolicy]) -> bool {
    if tunnels.len() > 16 {
        return false;
    }
    let mut names = HashSet::new();
    tunnels.iter().all(|tunnel| {
        valid_policy_name(&tunnel.name)
            && names.insert(tunnel.name.as_str())
            && matches!(tunnel.local_host.as_str(), "127.0.0.1" | "::1")
            && tunnel.local_port > 0
            && valid_host(&tunnel.destination_host)
            && tunnel.destination_port > 0
            && (1..=8).contains(&tunnel.max_connections)
            && (1_000..=300_000).contains(&tunnel.ttl_millis)
            && tunnel.risk >= AgentRiskTier::R3
    })
}

fn valid_web_recipes(recipes: &[AgentWebRecipePolicy]) -> bool {
    if recipes.is_empty() || recipes.len() > MAX_POLICY_ENTRIES {
        return false;
    }
    let mut names = HashSet::new();
    let login_count = recipes
        .iter()
        .filter(|recipe| recipe.kind == AgentWebRecipeKind::Login)
        .count();
    login_count == 1
        && recipes.iter().all(|recipe| {
            valid_policy_name(&recipe.name)
                && names.insert(recipe.name.as_str())
                && valid_http_path(&recipe.path)
                && valid_web_recipe_shape(recipe)
        })
}

fn valid_web_recipe_shape(recipe: &AgentWebRecipePolicy) -> bool {
    let selector = |value: &Option<String>| value.as_deref().is_some_and(valid_web_selector);
    let no_login_selectors = recipe.username_selector.is_none()
        && recipe.password_selector.is_none()
        && recipe.submit_selector.is_none()
        && recipe.success_selector.is_none()
        && recipe.failure_selector.is_none();
    let no_credential_selectors = recipe.username_selector.is_none()
        && recipe.password_selector.is_none()
        && recipe.submit_selector.is_none();
    let no_login_identity_selectors =
        recipe.username_selector.is_none() && recipe.password_selector.is_none();
    let fields_valid = recipe.fields.len() <= 32
        && unique_named(recipe.fields.iter().map(|field| field.name.as_str()))
        && recipe
            .fields
            .iter()
            .all(|field| valid_policy_name(&field.name) && valid_web_selector(&field.selector));
    let inputs_valid = recipe.inputs.len() <= 16
        && unique_named(recipe.inputs.iter().map(|input| input.name.as_str()))
        && recipe.inputs.iter().all(|input| {
            valid_policy_name(&input.name)
                && valid_web_selector(&input.selector)
                && (1..=4096).contains(&input.max_length)
        });
    fields_valid
        && inputs_valid
        && match recipe.kind {
            AgentWebRecipeKind::Login => {
                selector(&recipe.username_selector)
                    && selector(&recipe.password_selector)
                    && selector(&recipe.submit_selector)
                    && selector(&recipe.success_selector)
                    && recipe
                        .failure_selector
                        .as_deref()
                        .is_none_or(valid_web_selector)
                    && recipe.selector.is_none()
                    && recipe.fields.is_empty()
                    && recipe.inputs.is_empty()
                    && recipe.risk == AgentRiskTier::R2
            }
            AgentWebRecipeKind::Navigate => {
                no_login_selectors
                    && recipe.selector.is_none()
                    && recipe.fields.is_empty()
                    && recipe.inputs.is_empty()
            }
            AgentWebRecipeKind::Extract => {
                no_login_selectors
                    && recipe.selector.is_none()
                    && !recipe.fields.is_empty()
                    && recipe.inputs.is_empty()
            }
            AgentWebRecipeKind::Action => {
                no_credential_selectors
                    && selector(&recipe.selector)
                    && selector(&recipe.success_selector)
                    && recipe
                        .failure_selector
                        .as_deref()
                        .is_none_or(valid_web_selector)
                    && recipe.fields.is_empty()
            }
            AgentWebRecipeKind::Download => {
                no_login_selectors
                    && selector(&recipe.selector)
                    && recipe.fields.is_empty()
                    && recipe.inputs.is_empty()
            }
            AgentWebRecipeKind::Totp | AgentWebRecipeKind::EmailOtp => {
                no_login_identity_selectors
                    && selector(&recipe.selector)
                    && selector(&recipe.submit_selector)
                    && selector(&recipe.success_selector)
                    && recipe
                        .failure_selector
                        .as_deref()
                        .is_none_or(valid_web_selector)
                    && recipe.fields.is_empty()
                    && recipe.inputs.is_empty()
                    && recipe.risk >= AgentRiskTier::R2
            }
            AgentWebRecipeKind::RecoveryCode => {
                no_login_identity_selectors
                    && selector(&recipe.selector)
                    && selector(&recipe.submit_selector)
                    && selector(&recipe.success_selector)
                    && recipe
                        .failure_selector
                        .as_deref()
                        .is_none_or(valid_web_selector)
                    && recipe.fields.is_empty()
                    && recipe.inputs.is_empty()
                    && recipe.risk == AgentRiskTier::R3
            }
            AgentWebRecipeKind::PasskeyRegistration | AgentWebRecipeKind::PasskeyAssertion => {
                no_login_selectors
                    && selector(&recipe.selector)
                    && recipe.fields.is_empty()
                    && recipe.inputs.is_empty()
                    && recipe.risk == AgentRiskTier::R3
            }
        }
}

fn unique_named<'a>(values: impl Iterator<Item = &'a str>) -> bool {
    let mut names = HashSet::new();
    values.into_iter().all(|value| names.insert(value))
}

fn valid_web_selector(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value.is_ascii()
        && !value.chars().any(char::is_control)
}

fn valid_policy_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
}

fn valid_label(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed == value
        && value.chars().count() <= MAX_LABEL_CHARS
        && !value.chars().any(char::is_control)
}

fn valid_host(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 253
        && value == value.to_ascii_lowercase()
        && !value.contains(['/', '\\', '@'])
        && !value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
}

fn valid_https_origin(value: &str) -> bool {
    let Some(authority) = value.strip_prefix("https://") else {
        return false;
    };
    !authority.is_empty()
        && !authority.contains(['/', '?', '#', '@'])
        && !authority
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
}

fn valid_ssh_fingerprint(value: &str) -> bool {
    value.strip_prefix("SHA256:").is_some_and(|digest| {
        digest.len() == 43
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/'))
    })
}

fn valid_unique_names(values: &[String], prefix: &str) -> bool {
    if values.is_empty() || values.len() > MAX_POLICY_ENTRIES {
        return false;
    }
    let mut unique = HashSet::new();
    values.iter().all(|value| {
        value.starts_with(prefix)
            && value.len() <= 128
            && value
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
            && !matches!(
                value.as_str(),
                "vaultmesh_get_password"
                    | "vaultmesh_get_private_key"
                    | "vaultmesh_get_cookie"
                    | "vaultmesh_get_otp"
                    | "vaultmesh_export_secret"
                    | "vaultmesh_dump_vault"
            )
            && unique.insert(value)
    })
}

fn zeroize_target_policy(target: &mut AgentTargetPolicy) {
    match target {
        AgentTargetPolicy::Ssh {
            host,
            host_key_sha256,
            tunnel_policies,
            ..
        } => {
            host.zeroize();
            host_key_sha256.zeroize();
            for tunnel in tunnel_policies.iter_mut() {
                tunnel.name.zeroize();
                tunnel.local_host.zeroize();
                tunnel.destination_host.zeroize();
            }
            tunnel_policies.clear();
        }
        AgentTargetPolicy::ManagedWeb {
            origins, recipes, ..
        } => {
            origins.iter_mut().for_each(Zeroize::zeroize);
            origins.clear();
            for recipe in recipes.iter_mut() {
                recipe.name.zeroize();
                recipe.path.zeroize();
                recipe.username_selector.zeroize();
                recipe.password_selector.zeroize();
                recipe.submit_selector.zeroize();
                recipe.success_selector.zeroize();
                recipe.failure_selector.zeroize();
                recipe.selector.zeroize();
                for field in &mut recipe.fields {
                    field.name.zeroize();
                    field.selector.zeroize();
                }
                recipe.fields.clear();
                for input in &mut recipe.inputs {
                    input.name.zeroize();
                    input.selector.zeroize();
                }
                recipe.inputs.clear();
            }
            recipes.clear();
        }
    }
}

#[cfg(test)]
#[path = "agent_connector_tests.rs"]
mod tests;
