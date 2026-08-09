use super::*;

pub(super) fn collect_direct_agent_http_request(
    runtime: &mut DesktopRuntime,
    policy: &crate::agent_broker::AgentDirectHttpPolicy,
    parameters: &Value,
) -> Result<agent_http::AgentHttpRequestPlan, DesktopRuntimeError> {
    if !matches!(
        policy.operation.request_mode,
        AgentHttpBodyMode::Json | AgentHttpBodyMode::Empty
    ) || !matches!(
        policy.operation.response_mode,
        AgentHttpBodyMode::Json | AgentHttpBodyMode::Empty
    ) {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    let current = crate::agent_direct_policy::generate_direct_http_policy(
        runtime,
        policy.account_ref,
        "secret",
        "vaultmesh_http_request",
        parameters,
    )
    .map_err(|_| DesktopRuntimeError::from(VAULTMESH_STATUS_INVALID_ARGUMENT))?;
    if current.account_ref != policy.account_ref
        || current.item_kind != policy.item_kind
        || current.credential_kind != policy.credential_kind
        || current.origin != policy.origin
        || current.auth_strategy != policy.auth_strategy
        || current.operation != policy.operation
        || current.target_digest != policy.target_digest
        || current.allowed_output_fields != policy.allowed_output_fields
        || current.max_output_bytes != policy.max_output_bytes
        || current.max_output_items != policy.max_output_items
    {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into());
    }
    let authentication = match (
        policy.auth_strategy,
        policy.credential_kind,
        policy.item_kind.as_str(),
    ) {
        (AgentHttpAuthStrategy::Bearer, AgentCredentialKind::Secret, "secret") => {
            agent_http::AgentHttpAuthentication::Bearer(runtime.protected_value(
                VAULTMESH_ITEM_KIND_SECRET,
                VAULTMESH_PROTECTED_FIELD_SECRET_VALUE,
                &policy.account_ref.to_string(),
                None,
            )?)
        }
        _ => return Err(VAULTMESH_STATUS_INVALID_ARGUMENT.into()),
    };
    let discard_response_body = policy.operation.response_mode == AgentHttpBodyMode::Empty;
    Ok(agent_http::AgentHttpRequestPlan {
        origin: policy.origin.clone(),
        operation: policy.operation.clone(),
        input: parameters
            .get(
                if matches!(policy.operation.method.as_str(), "GET" | "HEAD") {
                    "query"
                } else {
                    "body"
                },
            )
            .cloned()
            .unwrap_or_else(|| json!({})),
        authentication,
        tls_spki_sha256: Vec::new(),
        allowed_output_fields: policy.allowed_output_fields.clone(),
        max_output_bytes: policy.max_output_bytes,
        max_output_items: policy.max_output_items,
        discard_response_body,
    })
}
