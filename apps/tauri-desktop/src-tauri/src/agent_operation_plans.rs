use super::*;

pub(super) fn validate_direct_agent_connector_policy(
    runtime: &mut DesktopRuntime,
    policy: &crate::agent_broker::AgentDirectConnectorPolicy,
    parameters: &Value,
) -> Result<(), DesktopRuntimeError> {
    let current = crate::agent_direct_policy::generate_direct_connector_policy(
        runtime,
        policy.connector_ref,
        &policy.tool,
        parameters,
    )
    .map_err(|_| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    if &current != policy {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    Ok(())
}

pub(super) fn collect_agent_managed_web_open_plan(
    runtime: &mut DesktopRuntime,
    account_ref: &str,
    runtime_root: PathBuf,
) -> Result<AgentManagedWebOpenPlan, DesktopRuntimeError> {
    let definition_id = uuid::Uuid::parse_str(account_ref)
        .map_err(|_| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    let definition = runtime.agent_connector_definition(definition_id)?;
    let (origins, recipes, persist_session) = match &definition.target_policy {
        AgentTargetPolicy::ManagedWeb {
            origins,
            recipes,
            persist_session,
        } => (origins.clone(), recipes.clone(), *persist_session),
        _ => return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into()),
    };
    if persist_session {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    let credential = definition
        .credential_refs
        .first()
        .filter(|credential| credential.kind == AgentCredentialKind::Login)
        .ok_or_else(|| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    let detail: AgentLoginDetail = serde_json::from_value(
        runtime.execute("items.detail", json!({ "id": credential.item_id }))?,
    )
    .map_err(|_| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    if detail.master_password_reprompt || detail.username.is_empty() {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    let password = runtime.protected_value(
        VAULTMESH_ITEM_KIND_LOGIN,
        VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD,
        &detail.id,
        None,
    )?;
    Ok(AgentManagedWebOpenPlan {
        definition_id: definition.id.to_string(),
        origins,
        recipes,
        username: Zeroizing::new(detail.username),
        password,
        max_output_bytes: definition.output_policy.max_bytes as usize,
        allowed_output_fields: definition.output_policy.allowed_fields.clone(),
        runtime_root,
    })
}

pub(super) fn collect_direct_agent_managed_web_open_plan(
    runtime: &mut DesktopRuntime,
    policy: &crate::agent_broker::AgentDirectConnectorPolicy,
    parameters: &Value,
    runtime_root: PathBuf,
) -> Result<AgentManagedWebOpenPlan, DesktopRuntimeError> {
    if policy.connector_kind != "managed-web" || policy.tool != "vaultmesh_web_session_open" {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    validate_direct_agent_connector_policy(runtime, policy, parameters)?;
    collect_agent_managed_web_open_plan(runtime, &policy.connector_ref.to_string(), runtime_root)
}

pub(super) fn agent_managed_web_credential(
    runtime: &mut DesktopRuntime,
    account_ref: &str,
    kind: AgentManagedWebProtectedKind,
) -> Result<uuid::Uuid, DesktopRuntimeError> {
    let definition_id = uuid::Uuid::parse_str(account_ref)
        .map_err(|_| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    let definition = runtime.agent_connector_definition(definition_id)?;
    if !matches!(
        definition.target_policy,
        AgentTargetPolicy::ManagedWeb { .. }
    ) {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    let credential_kind = match kind {
        AgentManagedWebProtectedKind::Totp | AgentManagedWebProtectedKind::RecoveryCode => {
            AgentCredentialKind::Login
        }
        AgentManagedWebProtectedKind::EmailOtp => AgentCredentialKind::Email,
    };
    definition
        .credential_refs
        .iter()
        .find(|credential| credential.kind == credential_kind)
        .map(|credential| credential.item_id)
        .ok_or_else(|| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))
}

pub(super) fn agent_managed_web_passkey_binding(
    runtime: &mut DesktopRuntime,
    account_ref: &str,
    operation: &str,
) -> Result<Option<uuid::Uuid>, DesktopRuntimeError> {
    let definition_id = uuid::Uuid::parse_str(account_ref)
        .map_err(|_| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    let definition = runtime.agent_connector_definition(definition_id)?;
    if !matches!(
        definition.target_policy,
        AgentTargetPolicy::ManagedWeb { .. }
    ) {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    let kind = if operation == "create" {
        AgentCredentialKind::Login
    } else if operation == "get" {
        AgentCredentialKind::Passkey
    } else {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    };
    definition
        .credential_refs
        .iter()
        .find(|credential| credential.kind == kind)
        .map(|credential| Some(credential.item_id))
        .ok_or_else(|| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))
}
