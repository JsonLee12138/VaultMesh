pub(super) fn execute_agent_tool_remote(
    context: &AgentToolContext<'_>,
    tool: &str,
    account_ref: Option<&str>,
    parameters: &Value,
    cancellation: &AtomicBool,
    scope: &AgentExecutionScope,
) -> Result<Value, AgentBrokerError> {
    let runtime = context.runtime;
    let resources = context.resources;
    let managed_web = context.managed_web;
    let email_otp = context.email_otp;
    let app = context.app;
    let vault_unavailable = || {
        AgentBrokerError::new(
            "vault-unavailable",
            "The local Vault runtime is unavailable.",
            true,
        )
    };
    if cancellation.load(Ordering::Acquire) {
        return Err(AgentBrokerError::new(
            "session-cancelled",
            "The connection session was revoked or expired.",
            false,
        ));
    }
    match tool {
        "vaultmesh_http_request" => {
            let account_ref = account_ref.ok_or_else(|| {
                AgentBrokerError::new(
                    "account-required",
                    "An approved account reference is required.",
                    false,
                )
            })?;
            let request = {
                let mut runtime = runtime.lock().map_err(|_| vault_unavailable())?;
                let policy = required_direct_http_policy(scope, account_ref, tool)?;
                collect_direct_agent_http_request(&mut runtime, policy, parameters)
                .map_err(|_| {
                    AgentBrokerError::new(
                        "account-unavailable",
                        "The approved HTTP target or credential is unavailable.",
                        false,
                    )
                })?
            };
            agent_http::execute_agent_request(request, cancellation).map_err(|error| {
                AgentBrokerError::new(
                    error.code,
                    if error.code == "session-cancelled" {
                        "The connection session was revoked or expired."
                    } else {
                        "The approved HTTP operation failed safely."
                    },
                    false,
                )
            })
        }
        "vaultmesh_web_session_open" => {
            let account_ref = account_ref.ok_or_else(|| {
                AgentBrokerError::new(
                    "account-required",
                    "An approved account reference is required.",
                    false,
                )
            })?;
            let runtime_root = app
                .path()
                .app_data_dir()
                .map_err(|_| AgentBrokerError::internal())?
                .join("agent-managed-web");
            let plan = {
                let mut runtime = runtime.lock().map_err(|_| vault_unavailable())?;
                let policy = required_direct_connector_policy(
                    scope,
                    account_ref,
                    tool,
                    "managed-web",
                )?;
                collect_direct_agent_managed_web_open_plan(
                    &mut runtime,
                    policy,
                    parameters,
                    runtime_root,
                )
                .map_err(|_| {
                        AgentBrokerError::new(
                            "account-unavailable",
                            "The approved managed-web definition or login is unavailable.",
                            false,
                        )
                    })?
            };
            managed_web
                .lock()
                .map_err(|_| AgentBrokerError::internal())?
                .open(app, plan, scope, account_ref, unix_millis(), cancellation)
                .map_err(agent_managed_web_error)
        }
        "vaultmesh_web_navigate" => {
            let account_ref = required_agent_account(account_ref)?;
            validate_direct_connector_action(
                runtime,
                scope,
                account_ref,
                tool,
                "managed-web",
                parameters,
            )?;
            let session_ref = agent_string_parameter(parameters, "sessionRef")?;
            let route = agent_string_parameter(parameters, "route")?;
            managed_web
                .lock()
                .map_err(|_| AgentBrokerError::internal())?
                .navigate(session_ref, route, scope, account_ref, cancellation)
                .map_err(agent_managed_web_error)
        }
        "vaultmesh_web_extract" => {
            let account_ref = required_agent_account(account_ref)?;
            validate_direct_connector_action(
                runtime,
                scope,
                account_ref,
                tool,
                "managed-web",
                parameters,
            )?;
            let session_ref = agent_string_parameter(parameters, "sessionRef")?;
            let recipe = agent_string_parameter(parameters, "recipe")?;
            managed_web
                .lock()
                .map_err(|_| AgentBrokerError::internal())?
                .extract(session_ref, recipe, scope, account_ref, cancellation)
                .map_err(agent_managed_web_error)
        }
        "vaultmesh_web_act" => {
            let account_ref = required_agent_account(account_ref)?;
            validate_direct_connector_action(
                runtime,
                scope,
                account_ref,
                tool,
                "managed-web",
                parameters,
            )?;
            let session_ref = agent_string_parameter(parameters, "sessionRef")?;
            let recipe = agent_string_parameter(parameters, "recipe")?;
            let input = parameters.get("input").unwrap_or(&Value::Null);
            managed_web
                .lock()
                .map_err(|_| AgentBrokerError::internal())?
                .act(session_ref, recipe, input, scope, account_ref, cancellation)
                .map_err(agent_managed_web_error)
        }
        "vaultmesh_web_download" => {
            let account_ref = required_agent_account(account_ref)?;
            validate_direct_connector_action(
                runtime,
                scope,
                account_ref,
                tool,
                "managed-web",
                parameters,
            )?;
            let session_ref = agent_string_parameter(parameters, "sessionRef")?;
            let recipe = agent_string_parameter(parameters, "recipe")?;
            let download = managed_web
                .lock()
                .map_err(|_| AgentBrokerError::internal())?
                .download(session_ref, recipe, scope, account_ref, cancellation)
                .map_err(agent_managed_web_error)?;
            resources
                .lock()
                .map_err(|_| AgentBrokerError::internal())?
                .add_result(
                    scope,
                    account_ref,
                    "web-download",
                    &download.basename,
                    &download.mime,
                    download.bytes,
                    unix_millis(),
                )
                .map_err(|code| {
                    AgentBrokerError::new(
                        code,
                        "The managed-web download could not be retained safely.",
                        false,
                    )
                })
        }
        "vaultmesh_web_session_close" => {
            let account_ref = required_agent_account(account_ref)?;
            validate_direct_connector_action(
                runtime,
                scope,
                account_ref,
                tool,
                "managed-web",
                parameters,
            )?;
            let session_ref = agent_string_parameter(parameters, "sessionRef")?;
            managed_web
                .lock()
                .map_err(|_| AgentBrokerError::internal())?
                .close(session_ref, scope, account_ref)
                .map_err(agent_managed_web_error)
        }
        "vaultmesh_passkey_request_begin" => {
            let account_ref = required_agent_account(account_ref)?;
            validate_direct_connector_action(
                runtime,
                scope,
                account_ref,
                tool,
                "managed-web",
                parameters,
            )?;
            let session_ref = agent_string_parameter(parameters, "sessionRef")?;
            let recipe = agent_string_parameter(parameters, "recipe")?;
            let now = unix_millis();
            let result = managed_web
                .lock()
                .map_err(|_| AgentBrokerError::internal())?
                .begin_passkey_request(session_ref, recipe, scope, account_ref, now, cancellation)
                .map_err(agent_managed_web_error)?;
            let request_ref = result
                .get("requestRef")
                .and_then(Value::as_str)
                .ok_or_else(AgentBrokerError::internal)?;
            let (operation, request_json, bound_origin) = managed_web
                .lock()
                .map_err(|_| AgentBrokerError::internal())?
                .passkey_request_description(request_ref, scope, account_ref, now)
                .map_err(agent_managed_web_error)?;
            let valid = passkey_service::PasskeyService::describe(operation, &request_json)
                .is_ok_and(|(_, origin, _)| origin == bound_origin);
            if !valid {
                let _ = managed_web
                    .lock()
                    .map_err(|_| AgentBrokerError::internal())?
                    .take_passkey_request(request_ref, scope, account_ref, now, cancellation);
                return Err(AgentBrokerError::new(
                    "passkey-request-invalid",
                    "The target produced an invalid or origin-mismatched Passkey request.",
                    false,
                ));
            }
            Ok(result)
        }
        "vaultmesh_passkey_perform" => {
            let account_ref = required_agent_account(account_ref)?;
            validate_direct_connector_action(
                runtime,
                scope,
                account_ref,
                tool,
                "managed-web",
                parameters,
            )?;
            let request_ref = agent_string_parameter(parameters, "requestRef")?;
            let now_millis = unix_millis();
            let request = managed_web
                .lock()
                .map_err(|_| AgentBrokerError::internal())?
                .take_passkey_request(request_ref, scope, account_ref, now_millis, cancellation)
                .map_err(agent_managed_web_error)?;
            if !passkey_service::PasskeyService::describe(request.operation, &request.request_json)
                .is_ok_and(|(_, origin, _)| origin == request.origin)
            {
                return Err(AgentBrokerError::new(
                    "passkey-request-invalid",
                    "The bound Passkey request is no longer valid.",
                    false,
                ));
            }
            let binding = {
                let mut runtime = runtime.lock().map_err(|_| vault_unavailable())?;
                let connector_ref = required_direct_connector_ref(scope, account_ref, tool)?;
                agent_managed_web_passkey_binding(
                    &mut runtime,
                    &connector_ref.to_string(),
                    request.operation,
                )
                    .map_err(|_| {
                        AgentBrokerError::new(
                            "account-unavailable",
                            "The approved Passkey binding is unavailable.",
                            false,
                        )
                    })?
            };
            let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
            let response = {
                let mut runtime = runtime.lock().map_err(|_| vault_unavailable())?;
                if request.operation == "create" {
                    passkey_service::PasskeyService::create(
                        &mut runtime,
                        &request.request_json,
                        binding,
                        &now,
                    )
                } else {
                    passkey_service::PasskeyService::get_for_item(
                        &mut runtime,
                        &request.request_json,
                        &now,
                        binding,
                    )
                }
            }
            .map_err(|_| {
                AgentBrokerError::new(
                    "passkey-operation-failed",
                    "The approved Passkey operation failed safely.",
                    false,
                )
            })?;
            let operation = request.operation;
            request
                .complete(&response)
                .map_err(agent_managed_web_error)?;
            Ok(json!({ "status": "completed", "operation": operation }))
        }
        "vaultmesh_otp_fill" => {
            let account_ref = required_agent_account(account_ref)?;
            validate_direct_connector_action(
                runtime,
                scope,
                account_ref,
                tool,
                "managed-web",
                parameters,
            )?;
            let target_ref = agent_string_parameter(parameters, "targetRef")?;
            let (kind, origin) = managed_web
                .lock()
                .map_err(|_| AgentBrokerError::internal())?
                .protected_target_info(target_ref, scope, account_ref)
                .map_err(agent_managed_web_error)?;
            let item_id = {
                let mut runtime = runtime.lock().map_err(|_| vault_unavailable())?;
                let connector_ref = required_direct_connector_ref(scope, account_ref, tool)?;
                agent_managed_web_credential(&mut runtime, &connector_ref.to_string(), kind).map_err(|_| {
                    AgentBrokerError::new(
                        "account-unavailable",
                        "The approved OTP source is unavailable.",
                        false,
                    )
                })?
            };
            let code = match kind {
                AgentManagedWebProtectedKind::Totp => {
                    let (code, remaining) = runtime
                        .lock()
                        .map_err(|_| vault_unavailable())?
                        .agent_totp_code(item_id)
                        .map_err(|_| {
                            AgentBrokerError::new(
                                "otp-unavailable",
                                "The approved TOTP source is unavailable.",
                                false,
                            )
                        })?;
                    if remaining <= 5 {
                        return Err(AgentBrokerError::new(
                            "otp-expiring",
                            "The current TOTP is too close to expiry; retry shortly.",
                            true,
                        ));
                    }
                    code
                }
                AgentManagedWebProtectedKind::EmailOtp => email_otp
                    .lock()
                    .map_err(|_| AgentBrokerError::internal())?
                    .take_agent_candidate_code(item_id, &origin, unix_millis() / 1_000)
                    .map_err(|_| {
                        AgentBrokerError::new(
                            "otp-unavailable",
                            "The approved email OTP is unavailable or expired.",
                            true,
                        )
                    })?,
                AgentManagedWebProtectedKind::RecoveryCode => {
                    return Err(AgentBrokerError::new(
                        "web-target-kind-mismatch",
                        "The protected target does not accept an OTP.",
                        false,
                    ));
                }
            };
            managed_web
                .lock()
                .map_err(|_| AgentBrokerError::internal())?
                .fill_protected(target_ref, kind, code, scope, account_ref, cancellation)
                .map_err(agent_managed_web_error)?;
            Ok(json!({ "status": "submitted", "expired": false }))
        }
        "vaultmesh_recovery_code_consume" => {
            let account_ref = required_agent_account(account_ref)?;
            validate_direct_connector_action(
                runtime,
                scope,
                account_ref,
                tool,
                "managed-web",
                parameters,
            )?;
            let target_ref = agent_string_parameter(parameters, "targetRef")?;
            let (kind, _) = managed_web
                .lock()
                .map_err(|_| AgentBrokerError::internal())?
                .protected_target_info(target_ref, scope, account_ref)
                .map_err(agent_managed_web_error)?;
            if kind != AgentManagedWebProtectedKind::RecoveryCode {
                return Err(AgentBrokerError::new(
                    "web-target-kind-mismatch",
                    "The protected target does not accept a recovery code.",
                    false,
                ));
            }
            let item_id = {
                let mut runtime = runtime.lock().map_err(|_| vault_unavailable())?;
                let connector_ref = required_direct_connector_ref(scope, account_ref, tool)?;
                agent_managed_web_credential(&mut runtime, &connector_ref.to_string(), kind).map_err(|_| {
                    AgentBrokerError::new(
                        "account-unavailable",
                        "The approved recovery-code source is unavailable.",
                        false,
                    )
                })?
            };
            let (code, digest) = runtime
                .lock()
                .map_err(|_| vault_unavailable())?
                .agent_recovery_code(item_id)
                .map_err(|_| {
                    AgentBrokerError::new(
                        "recovery-code-unavailable",
                        "No approved recovery code is available.",
                        false,
                    )
                })?;
            managed_web
                .lock()
                .map_err(|_| AgentBrokerError::internal())?
                .fill_protected(target_ref, kind, code, scope, account_ref, cancellation)
                .map_err(agent_managed_web_error)?;
            let remaining = runtime
                .lock()
                .map_err(|_| vault_unavailable())?
                .consume_agent_recovery_code(item_id, digest)
                .map_err(|_| {
                    AgentBrokerError::new(
                        "recovery-code-commit-failed",
                        "The target accepted the recovery code, but its local consumed state could not be committed.",
                        false,
                    )
                })?;
            Ok(json!({ "status": "consumed", "remaining": remaining }))
        }
        _ => Err(AgentBrokerError::new(
            "adapter-unavailable",
            "This approved Agent adapter is not available in this build.",
            false,
        )),
    }
}
