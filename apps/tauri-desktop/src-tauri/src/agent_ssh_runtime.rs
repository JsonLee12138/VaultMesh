use super::*;

pub(super) struct AgentSshHostSetupRequest {
    pub(super) commit: crate::ssh_host_setup::SshHostSetupCommit,
    pub(super) key_item_id: uuid::Uuid,
    pub(super) existing_binding: bool,
    pub(super) target: SshTarget,
    pub(super) expected_host_key_fingerprint: String,
    pub(super) public_key: Zeroizing<String>,
    pub(super) verification_key: PrivateKeyMaterial,
    pub(super) bootstrap_authentication: Option<AuthenticationMaterial>,
}

pub(super) fn collect_direct_agent_ssh_exec_request(
    runtime: &mut DesktopRuntime,
    policy: &crate::agent_broker::AgentDirectSshPolicy,
    parameters: &Value,
) -> Result<AgentSshExecRequest, DesktopRuntimeError> {
    if policy.tool != "vaultmesh_ssh_exec" {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    let program = parameters
        .get("program")
        .and_then(Value::as_str)
        .ok_or_else(|| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    let arguments = parameters
        .get("arguments")
        .and_then(Value::as_array)
        .map(|arguments| {
            arguments
                .iter()
                .map(|argument| {
                    argument
                        .as_str()
                        .map(str::to_owned)
                        .ok_or_else(|| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))
                })
                .collect::<Result<Vec<_>, _>>()
        })
        .transpose()?
        .unwrap_or_default();
    let command = crate::agent_ssh_command_policy::validate_and_serialize(program, &arguments)
        .map_err(|_| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    let account = direct_ssh_account(runtime, policy)?;
    let authentication = direct_ssh_authentication(runtime, &account)?;
    Ok(AgentSshExecRequest {
        target: SshTarget {
            host: policy.host.clone(),
            port: policy.port,
            username: policy.username.clone(),
        },
        expected_host_key_fingerprint: policy.host_key_sha256.clone(),
        command,
        authentication,
        allowed_fields: vec![
            "exit_status".to_owned(),
            "stdout".to_owned(),
            "stderr".to_owned(),
        ],
        max_output_bytes: policy.max_output_bytes,
    })
}

pub(super) fn collect_direct_agent_ssh_transfer_request(
    runtime: &mut DesktopRuntime,
    policy: &crate::agent_broker::AgentDirectSshPolicy,
    parameters: &Value,
) -> Result<AgentSshTransferRequest, DesktopRuntimeError> {
    if !matches!(
        policy.tool.as_str(),
        "vaultmesh_ssh_upload" | "vaultmesh_ssh_download"
    ) {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    let remote_path = parameters
        .get("remotePath")
        .and_then(Value::as_str)
        .ok_or_else(|| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    let account = direct_ssh_account(runtime, policy)?;
    let authentication = direct_ssh_authentication(runtime, &account)?;
    Ok(AgentSshTransferRequest {
        target: direct_ssh_target(policy),
        expected_host_key_fingerprint: policy.host_key_sha256.clone(),
        remote_path: remote_path.to_owned(),
        remote_path_prefixes: policy.remote_path_prefixes.clone(),
        authentication,
    })
}

pub(super) fn collect_direct_agent_ssh_pty_request(
    runtime: &mut DesktopRuntime,
    policy: &crate::agent_broker::AgentDirectSshPolicy,
) -> Result<AgentSshPtyRequest, DesktopRuntimeError> {
    if policy.tool != "vaultmesh_ssh_pty_open" {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    let account = direct_ssh_account(runtime, policy)?;
    let authentication = direct_ssh_authentication(runtime, &account)?;
    Ok(AgentSshPtyRequest {
        target: direct_ssh_target(policy),
        expected_host_key_fingerprint: policy.host_key_sha256.clone(),
        authentication,
        max_output_bytes: policy.max_output_bytes,
    })
}

pub(super) fn collect_direct_agent_ssh_tunnel_request(
    runtime: &mut DesktopRuntime,
    policy: &crate::agent_broker::AgentDirectSshPolicy,
    parameters: &Value,
) -> Result<AgentSshTunnelRequest, DesktopRuntimeError> {
    if policy.tool != "vaultmesh_ssh_tunnel_open" {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    let tunnel = policy
        .tunnel
        .as_ref()
        .filter(|tunnel| {
            parameters.get("endpoint").and_then(Value::as_str) == Some(tunnel.name.as_str())
        })
        .ok_or_else(|| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    let connector_ref = policy
        .connector_ref
        .ok_or_else(|| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    let connector = runtime.agent_connector_definition(connector_ref)?;
    let connector_matches = connector.enabled
        && connector.connector_kind == AgentConnectorKind::Ssh
        && connector.credential_refs.first().is_some_and(|credential| {
            credential.kind == AgentCredentialKind::Ssh && credential.item_id == policy.account_ref
        })
        && match &connector.target_policy {
            AgentTargetPolicy::Ssh {
                host,
                port,
                host_key_sha256,
                tunnel_policies,
                ..
            } => {
                host.trim().eq_ignore_ascii_case(&policy.host)
                    && *port == policy.port
                    && host_key_sha256 == &policy.host_key_sha256
                    && tunnel_policies.iter().any(|current| current == tunnel)
            }
            _ => false,
        };
    if !connector_matches {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    let account = direct_ssh_account(runtime, policy)?;
    let authentication = direct_ssh_authentication(runtime, &account)?;
    Ok(AgentSshTunnelRequest {
        target: direct_ssh_target(policy),
        expected_host_key_fingerprint: policy.host_key_sha256.clone(),
        authentication,
        local_host: tunnel.local_host.clone(),
        local_port: tunnel.local_port,
        destination_host: tunnel.destination_host.clone(),
        destination_port: tunnel.destination_port,
        max_connections: tunnel.max_connections,
        ttl_millis: tunnel.ttl_millis,
    })
}

pub(super) fn collect_direct_agent_ssh_public_key_install_request(
    runtime: &mut DesktopRuntime,
    policy: &crate::agent_broker::AgentDirectSshPolicy,
    parameters: &Value,
) -> Result<PublicKeyInstallRequest, DesktopRuntimeError> {
    if policy.tool != "vaultmesh_ssh_public_key_install" {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    let public_key_ref = parameters
        .get("publicKeyRef")
        .and_then(Value::as_str)
        .and_then(|value| uuid::Uuid::parse_str(value).ok())
        .ok_or_else(|| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    let key = runtime_ssh_detail(runtime, &public_key_ref.to_string())?;
    if key.record_kind != "key" || !key.has_public_key || key.master_password_reprompt {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    let account = direct_ssh_account(runtime, policy)?;
    let public_key = runtime.protected_value(
        VAULTMESH_ITEM_KIND_SSH_CREDENTIAL,
        VAULTMESH_PROTECTED_FIELD_SSH_PUBLIC_KEY,
        &key.id,
        None,
    )?;
    let verification_key = key
        .has_private_key
        .then(|| runtime_private_key(runtime, &key, None))
        .transpose()?;
    let authentication = direct_ssh_authentication(runtime, &account)?;
    Ok(PublicKeyInstallRequest {
        target: direct_ssh_target(policy),
        expected_host_key_fingerprint: policy.host_key_sha256.clone(),
        public_key,
        authentication,
        verification_key,
    })
}

pub(super) fn collect_direct_agent_ssh_host_setup_request(
    runtime: &mut DesktopRuntime,
    ssh_directory: &std::path::Path,
    policy: &crate::agent_broker::AgentDirectSshPolicy,
    parameters: &Value,
) -> Result<AgentSshHostSetupRequest, DesktopRuntimeError> {
    if policy.tool != "vaultmesh_ssh_host_setup" {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    let alias = parameters
        .get("alias")
        .and_then(Value::as_str)
        .filter(|alias| crate::ssh_host_setup::validate_ssh_host_alias(alias).is_ok())
        .ok_or_else(|| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    let account = direct_ssh_account(runtime, policy)?;
    let target = direct_ssh_target(policy);
    let (managed_key, existing_binding) =
        match runtime.managed_ssh_host_key(policy.account_ref, alias, &policy.host_key_sha256)? {
            Some(key) => (key, true),
            None => {
                let legacy = crate::ssh_host_setup::read_legacy_ssh_host_identity(
                    ssh_directory,
                    &policy.account_ref.to_string(),
                    alias,
                    &target,
                    &policy.host_key_sha256,
                )
                .map_err(|_| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
                let (generated, imported_legacy) = match legacy {
                    Some(identity) => (identity, true),
                    None => {
                        crate::ssh_host_setup::preflight_new_ssh_host_identity(
                            ssh_directory,
                            alias,
                            &target,
                        )
                        .map_err(|_| {
                            DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT)
                        })?;
                        (
                            crate::ssh_host_setup::generate_ssh_host_identity(alias).map_err(
                                |_| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT),
                            )?,
                            false,
                        )
                    }
                };
                (
                    runtime.add_managed_ssh_host_key(
                        policy.account_ref,
                        alias.to_owned(),
                        policy.host_key_sha256.clone(),
                        generated.public_key,
                        generated.private_key,
                    )?,
                    imported_legacy,
                )
            }
        };
    let prepared = crate::ssh_host_setup::prepare_ssh_host_identity(
        ssh_directory,
        alias,
        &target,
        &managed_key.public_key,
        &managed_key.private_key,
    )
    .map_err(|_| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    let (commit, public_key, verification_key) = prepared.into_parts();
    let bootstrap_authentication = match direct_ssh_authentication(runtime, &account) {
        Ok(authentication) => Some(authentication),
        Err(_) if existing_binding => None,
        Err(error) => return Err(error),
    };
    Ok(AgentSshHostSetupRequest {
        commit,
        key_item_id: managed_key.key_item_id,
        existing_binding,
        target,
        expected_host_key_fingerprint: policy.host_key_sha256.clone(),
        public_key,
        verification_key,
        bootstrap_authentication,
    })
}

fn direct_ssh_account(
    runtime: &mut DesktopRuntime,
    policy: &crate::agent_broker::AgentDirectSshPolicy,
) -> Result<SshRuntimeDetail, DesktopRuntimeError> {
    let account = runtime_ssh_detail(runtime, &policy.account_ref.to_string())?;
    let current_target = ssh_target(&account)
        .map_err(|_| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    if account.master_password_reprompt
        || current_target.host.trim().to_ascii_lowercase() != policy.host
        || current_target.port != policy.port
        || current_target.username.trim() != policy.username
    {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    Ok(account)
}

fn direct_ssh_authentication(
    runtime: &mut DesktopRuntime,
    account: &SshRuntimeDetail,
) -> Result<AuthenticationMaterial, DesktopRuntimeError> {
    if account.has_private_key {
        Ok(AuthenticationMaterial::AuthenticationKey(
            runtime_private_key(runtime, account, None)?,
        ))
    } else if account.has_password {
        Ok(AuthenticationMaterial::StoredPassword(
            runtime.protected_value(
                VAULTMESH_ITEM_KIND_SSH_CREDENTIAL,
                VAULTMESH_PROTECTED_FIELD_SSH_PASSWORD,
                &account.id,
                None,
            )?,
        ))
    } else {
        Ok(AuthenticationMaterial::SshAgent)
    }
}

fn direct_ssh_target(policy: &crate::agent_broker::AgentDirectSshPolicy) -> SshTarget {
    SshTarget {
        host: policy.host.clone(),
        port: policy.port,
        username: policy.username.clone(),
    }
}

pub(super) fn collect_ssh_external_launch_material(
    runtime: &mut DesktopRuntime,
    account_id: &str,
    client_id: ssh_external::ExternalClientId,
    copy_password: bool,
    permits_transient_secret: bool,
) -> Result<SshExternalLaunchMaterial, DesktopRuntimeError> {
    let detail = runtime_ssh_detail(runtime, account_id)?;
    let target = ssh_target(&detail).map_err(|_| VAULTMESH_STATUS_INVALID_ARGUMENT)?;
    let target = ssh_external::LaunchTarget::new(&target.host, target.port, &target.username)
        .map_err(|_| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    let can_use_vault_key = client_id == ssh_external::ExternalClientId::SystemTerminal
        && detail.has_private_key
        && !detail.master_password_reprompt
        && permits_transient_secret;
    let private_key = can_use_vault_key
        .then(|| {
            runtime.protected_value(
                VAULTMESH_ITEM_KIND_SSH_CREDENTIAL,
                VAULTMESH_PROTECTED_FIELD_SSH_PRIVATE_KEY,
                &detail.id,
                None,
            )
        })
        .transpose()?;
    let should_copy_password = client_id != ssh_external::ExternalClientId::CopyCommand
        && !can_use_vault_key
        && copy_password
        && detail.has_password;
    let password_copy_skipped =
        should_copy_password && (detail.master_password_reprompt || !permits_transient_secret);
    let password = (should_copy_password && !password_copy_skipped)
        .then(|| {
            runtime.protected_value(
                VAULTMESH_ITEM_KIND_SSH_CREDENTIAL,
                VAULTMESH_PROTECTED_FIELD_SSH_PASSWORD,
                &detail.id,
                None,
            )
        })
        .transpose()?;
    let authentication = if can_use_vault_key {
        "key"
    } else if detail.has_password {
        "password"
    } else {
        "sshAgent"
    };
    Ok(SshExternalLaunchMaterial {
        target,
        private_key,
        password,
        password_copy_skipped,
        authentication,
    })
}
