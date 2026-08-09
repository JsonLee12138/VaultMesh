use super::*;

const AUTHORIZATION_POLL_INTERVAL: std::time::Duration = std::time::Duration::from_millis(20);

fn replace_with_authorization_error(response: &mut Value, error: AgentBrokerError) {
    let request_id = response.get("requestId").cloned().unwrap_or(Value::Null);
    *response = json!({
        "ok": false,
        "requestId": request_id,
        "error": error
    });
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn wait_for_native_authorization(
    response: &mut Value,
    audit: &mut Option<NewAgentAuditEvent>,
    action: &mut Option<AuthorizedAgentAction>,
    request: &mut Value,
    broker: &Arc<Mutex<AgentBrokerCore>>,
    client_id: Uuid,
    on_native_ui: &dyn Fn(AgentNativeUiSurface),
    now_millis: &dyn Fn() -> u64,
) {
    let mut deadline =
        std::time::Instant::now() + std::time::Duration::from_millis(AUTHORIZATION_TTL_MILLIS);
    loop {
        if let Some(unlock_ref) = response
            .pointer("/error/details/unlockRef")
            .and_then(Value::as_str)
            .map(str::to_owned)
        {
            on_native_ui(AgentNativeUiSurface::Unlock);
            let outcome = loop {
                let now = now_millis();
                let outcome = broker
                    .lock()
                    .map(|mut broker| broker.unlock_wait_outcome(&unlock_ref, client_id, now))
                    .unwrap_or(AgentUnlockWaitOutcome::Expired);
                if outcome != AgentUnlockWaitOutcome::Pending {
                    break outcome;
                }
                if std::time::Instant::now() >= deadline {
                    break AgentUnlockWaitOutcome::Expired;
                }
                std::thread::sleep(AUTHORIZATION_POLL_INTERVAL);
            };
            match outcome {
                AgentUnlockWaitOutcome::Allowed => {
                    deadline = std::time::Instant::now()
                        + std::time::Duration::from_millis(AUTHORIZATION_TTL_MILLIS);
                    let Ok(bytes) = serde_json::to_vec(request) else {
                        replace_with_authorization_error(response, AgentBrokerError::internal());
                        *audit = None;
                        *action = None;
                        return;
                    };
                    let continued = broker.lock().map(|mut broker| {
                        broker.continue_json_for_dispatch(client_id, &bytes, now_millis())
                    });
                    let Ok((next_response, next_audit, next_action)) = continued else {
                        replace_with_authorization_error(response, AgentBrokerError::internal());
                        *audit = None;
                        *action = None;
                        return;
                    };
                    *response = next_response;
                    *audit = next_audit;
                    *action = next_action;
                    continue;
                }
                AgentUnlockWaitOutcome::Denied => {
                    replace_with_authorization_error(
                        response,
                        AgentBrokerError::new(
                            "mcp-unlock-denied",
                            "The independent MCP unlock was cancelled locally.",
                            true,
                        ),
                    );
                    *action = None;
                    return;
                }
                AgentUnlockWaitOutcome::Expired | AgentUnlockWaitOutcome::Pending => {
                    on_native_ui(AgentNativeUiSurface::UnlockExpired(unlock_ref));
                    replace_with_authorization_error(
                        response,
                        AgentBrokerError::agent_unlock_timeout(),
                    );
                    *action = None;
                    return;
                }
            }
        }
        let permission_ref = response
            .pointer("/error/details/authorizationRef")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let confirmation_ref = response
            .pointer("/error/confirmationRef")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let Some((reference, confirmation)) = permission_ref
            .map(|reference| (reference, false))
            .or_else(|| confirmation_ref.map(|reference| (reference, true)))
        else {
            return;
        };

        on_native_ui(AgentNativeUiSurface::Authorization);
        let outcome = loop {
            let now = now_millis();
            let outcome = broker
                .lock()
                .map(|mut broker| {
                    if confirmation {
                        broker.confirmation_wait_outcome(&reference, now)
                    } else {
                        broker.permission_wait_outcome(&reference, now)
                    }
                })
                .unwrap_or(PermissionWaitOutcome::Expired);
            if outcome != PermissionWaitOutcome::Pending {
                break outcome;
            }
            if std::time::Instant::now() >= deadline {
                break PermissionWaitOutcome::Expired;
            }
            std::thread::sleep(AUTHORIZATION_POLL_INTERVAL);
        };

        match outcome {
            PermissionWaitOutcome::Allowed => {
                if confirmation {
                    request["confirmationTicket"] = json!(reference);
                }
                let Ok(bytes) = serde_json::to_vec(request) else {
                    replace_with_authorization_error(response, AgentBrokerError::internal());
                    *audit = None;
                    *action = None;
                    return;
                };
                let continued = broker.lock().map(|mut broker| {
                    broker.continue_json_for_dispatch(client_id, &bytes, now_millis())
                });
                let Ok((next_response, next_audit, next_action)) = continued else {
                    replace_with_authorization_error(response, AgentBrokerError::internal());
                    *audit = None;
                    *action = None;
                    return;
                };
                *response = next_response;
                *audit = next_audit;
                *action = next_action;
            }
            PermissionWaitOutcome::Denied => {
                replace_with_authorization_error(
                    response,
                    AgentBrokerError::authorization_denied(),
                );
                *action = None;
                return;
            }
            PermissionWaitOutcome::Expired | PermissionWaitOutcome::Pending => {
                on_native_ui(AgentNativeUiSurface::AuthorizationExpired(reference));
                replace_with_authorization_error(
                    response,
                    AgentBrokerError::authorization_timeout(),
                );
                *action = None;
                return;
            }
        }
    }
}

pub(crate) fn complete_native_ui_action(
    response: &mut Value,
    on_native_ui: &dyn Fn(AgentNativeUiSurface),
) {
    let native_action = response
        .pointer("/error/nativeActionRequired")
        .and_then(Value::as_str);
    if native_action == Some("open-local-ui") {
        let request_id = response.get("requestId").cloned().unwrap_or(Value::Null);
        on_native_ui(AgentNativeUiSurface::LocalUi);
        *response = json!({
            "ok": true,
            "requestId": request_id,
            "result": { "accepted": true }
        });
    } else if native_action == Some("approve-pairing") {
        on_native_ui(AgentNativeUiSurface::Pairing);
    } else if native_action == Some("unlock-agent") {
        on_native_ui(AgentNativeUiSurface::Unlock);
    }
}

pub(crate) fn attach_persisted_audit(
    response: &mut Value,
    audit: Option<NewAgentAuditEvent>,
    audit_sink: &AgentAuditSink,
) {
    let Some(audit) = audit else { return };
    match audit_sink(audit) {
        Ok(audit_ref) => response["auditRef"] = json!(audit_ref),
        Err(()) => {
            let request_id = response.get("requestId").cloned().unwrap_or(Value::Null);
            *response = json!({
                "ok": false,
                "requestId": request_id,
                "error": AgentBrokerError::new(
                    "audit-unavailable",
                    "VaultMesh could not persist the encrypted Agent audit event.",
                    false,
                )
            });
        }
    }
}

pub(crate) fn execute_authorized_action(
    response: &mut Value,
    audit: &mut Option<NewAgentAuditEvent>,
    action: Option<AuthorizedAgentAction>,
    executor: &AgentToolExecutor,
) {
    let Some(action) = action else { return };
    let (finished_sender, finished_receiver) = std::sync::mpsc::channel();
    let expiry_cancellation = Arc::clone(&action.cancellation);
    let remaining_session = std::time::Duration::from_millis(action.remaining_session_millis);
    let expiry_watcher = std::thread::spawn(move || {
        if finished_receiver.recv_timeout(remaining_session).is_err() {
            expiry_cancellation.store(true, Ordering::Release);
        }
    });
    let execution = executor(
        &action.tool,
        action.account_ref.as_deref(),
        &action.parameters,
        &action.cancellation,
        &action.scope,
    )
    .and_then(|result| {
        if action.cancellation.load(Ordering::Acquire) {
            return Err(AgentBrokerError::new(
                "session-cancelled",
                "The connection session was revoked or expired.",
                false,
            ));
        }
        let output_bytes = serde_json::to_vec(&result)
            .map_err(|_| AgentBrokerError::internal())?
            .len() as u64;
        action
            .output_bytes_used
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |used| {
                used.checked_add(output_bytes)
                    .filter(|next| *next <= MAX_SESSION_OUTPUT_BYTES)
            })
            .map_err(|_| {
                AgentBrokerError::new(
                    "output-quota-exceeded",
                    "The connection session output quota is exhausted.",
                    false,
                )
            })?;
        if let Some(audit) = audit {
            audit.byte_count = output_bytes;
            audit.duration_millis = action.authorized_at.elapsed().as_millis() as u64;
        }
        Ok(result)
    });
    let _ = finished_sender.send(());
    let _ = expiry_watcher.join();
    match execution {
        Ok(result) => response["result"] = result,
        Err(error) => {
            if let Some(audit) = audit {
                audit.duration_millis = action.authorized_at.elapsed().as_millis() as u64;
                audit.decision = AgentAuditDecision::Allowed;
                audit.result_class = if error.code == "adapter-unavailable" {
                    AgentAuditResultClass::Unavailable
                } else {
                    AgentAuditResultClass::Failed
                };
                audit.status_class = Some(error.code.to_owned());
            }
            let request_id = response.get("requestId").cloned().unwrap_or(Value::Null);
            *response = json!({ "ok": false, "requestId": request_id, "error": error });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn pairing_required_opens_the_native_pairing_surface() {
        let notifications = AtomicUsize::new(0);
        let mut response = json!({
            "ok": false,
            "requestId": Uuid::new_v4(),
            "error": AgentBrokerError::native("pairing-required", "approve-pairing")
        });

        complete_native_ui_action(&mut response, &|surface| {
            assert_eq!(surface, AgentNativeUiSurface::Pairing);
            notifications.fetch_add(1, Ordering::Relaxed);
        });

        assert_eq!(notifications.load(Ordering::Relaxed), 1);
        assert_eq!(response["error"]["code"], "pairing-required");
    }

    #[test]
    fn action_authorization_uses_the_native_authorization_wait_surface() {
        let notifications = AtomicUsize::new(0);
        let permission_ref = Uuid::new_v4();
        let mut core = AgentBrokerCore::new().unwrap();
        core.permission_outcomes.insert(
            permission_ref,
            ResolvedPermissionOutcome {
                allowed: false,
                expires_at: AUTHORIZATION_TTL_MILLIS,
            },
        );
        let broker = Arc::new(Mutex::new(core));
        let mut response = json!({
            "ok": false,
            "requestId": Uuid::new_v4(),
            "error": AgentBrokerError::authorization(&permission_ref.to_string())
        });
        let mut request = json!({});
        let mut audit = None;
        let mut action = None;

        wait_for_native_authorization(
            &mut response,
            &mut audit,
            &mut action,
            &mut request,
            &broker,
            Uuid::new_v4(),
            &|surface| {
                assert_eq!(surface, AgentNativeUiSurface::Authorization);
                notifications.fetch_add(1, Ordering::Relaxed);
            },
            &|| 1,
        );

        assert_eq!(notifications.load(Ordering::Relaxed), 1);
        assert_eq!(response["error"]["code"], "authorization-denied");
    }

    #[test]
    fn missing_or_expired_authorization_ends_the_wait_with_a_stable_timeout() {
        let permission_ref = Uuid::new_v4();
        let notifications = Mutex::new(Vec::new());
        let broker = Arc::new(Mutex::new(AgentBrokerCore::new().unwrap()));
        let mut response = json!({
            "ok": false,
            "requestId": Uuid::new_v4(),
            "error": AgentBrokerError::authorization(&permission_ref.to_string())
        });
        let mut request = json!({});
        let mut audit = None;
        let mut action = None;

        wait_for_native_authorization(
            &mut response,
            &mut audit,
            &mut action,
            &mut request,
            &broker,
            Uuid::new_v4(),
            &|surface| notifications.lock().unwrap().push(surface),
            &|| AUTHORIZATION_TTL_MILLIS,
        );

        assert_eq!(
            *notifications.lock().unwrap(),
            vec![
                AgentNativeUiSurface::Authorization,
                AgentNativeUiSurface::AuthorizationExpired(permission_ref.to_string()),
            ]
        );
        assert_eq!(response["error"]["code"], "authorization-timeout");
        assert_eq!(response["error"]["retryable"], true);
    }
}
