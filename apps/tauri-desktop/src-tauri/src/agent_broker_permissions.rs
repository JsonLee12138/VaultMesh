use super::*;

impl AgentBrokerCore {
    pub fn authorization_rules(&self) -> Vec<AuthorizationRuleSnapshot> {
        let Some(store) = self.authorization_store.as_ref() else {
            return Vec::new();
        };
        let mut user_ids = self
            .pairing_proofs
            .records()
            .into_iter()
            .map(|record| record.user_id)
            .collect::<HashSet<_>>();
        user_ids.extend(
            self.clients
                .values()
                .map(|client| client.peer.user_id.clone()),
        );
        let mut seen = HashSet::new();
        let mut rules = user_ids
            .into_iter()
            .flat_map(|user_id| store.load(&user_id).unwrap_or_default())
            .filter(|rule| seen.insert(rule.id))
            .map(|rule| AuthorizationRuleSnapshot {
                id: rule.id.to_string(),
                client_key: rule.client_key,
                account_ref: rule.account_ref,
                tool: rule.tool,
                scope: rule.scope,
                effect: rule.effect,
                http_method: rule.http_method,
                path_pattern: rule.path_pattern,
                created_at: rule.created_at,
                updated_at: rule.updated_at,
            })
            .collect::<Vec<_>>();
        rules.sort_by_key(|rule| rule.created_at);
        rules
    }

    pub fn revoke_authorization_rule(
        &mut self,
        rule_id: &str,
        now_millis: u64,
    ) -> Result<(), AgentBrokerError> {
        let rule_id = parse_opaque_id(rule_id, "unknown-permission-rule")?;
        let store = self.authorization_store.as_ref().ok_or_else(|| {
            AgentBrokerError::new(
                "permission-store-unavailable",
                "The persistent authorization store is unavailable.",
                true,
            )
        })?;
        let mut user_ids = self
            .pairing_proofs
            .records()
            .into_iter()
            .map(|record| record.user_id)
            .collect::<HashSet<_>>();
        user_ids.extend(
            self.clients
                .values()
                .map(|client| client.peer.user_id.clone()),
        );
        for user_id in user_ids {
            if store.remove_rule(&user_id, rule_id).map_err(|_| {
                AgentBrokerError::new(
                    "permission-store-unavailable",
                    "The persistent authorization rule could not be removed.",
                    true,
                )
            })? {
                self.restart_connection_sessions(now_millis);
                return Ok(());
            }
        }
        Err(AgentBrokerError::new(
            "unknown-permission-rule",
            "The persistent authorization rule is unavailable.",
            false,
        ))
    }

    pub fn confirmations(&self) -> Vec<ConfirmationSnapshot> {
        let mut confirmations = self
            .confirmations
            .values()
            .map(|confirmation| ConfirmationSnapshot {
                confirmation_ref: confirmation.confirmation_ref.to_string(),
                client_id: confirmation.client_id.to_string(),
                session_id: confirmation.session_id.to_string(),
                account_ref: confirmation.account_ref.clone(),
                account_label: confirmation.account_label.clone(),
                tool: confirmation.tool.clone(),
                risk: confirmation.risk.clone(),
                created_at: confirmation.created_at,
                expires_at: confirmation.expires_at,
                approved: confirmation.approved,
            })
            .collect::<Vec<_>>();
        confirmations.sort_by_key(|confirmation| confirmation.created_at);
        confirmations
    }

    pub fn permission_requests(&self) -> Vec<PermissionRequestSnapshot> {
        let mut requests = self
            .permission_requests
            .values()
            .map(permission_snapshot)
            .collect::<Vec<_>>();
        requests.sort_by_key(|request| request.created_at);
        requests
    }

    pub(crate) fn permission_wait_outcome(
        &mut self,
        permission_ref: &str,
        now_millis: u64,
    ) -> PermissionWaitOutcome {
        self.prune(now_millis);
        let Ok(permission_ref) = Uuid::parse_str(permission_ref) else {
            return PermissionWaitOutcome::Expired;
        };
        if self.permission_requests.contains_key(&permission_ref) {
            return PermissionWaitOutcome::Pending;
        }
        self.permission_outcomes.remove(&permission_ref).map_or(
            PermissionWaitOutcome::Expired,
            |outcome| {
                if outcome.allowed {
                    PermissionWaitOutcome::Allowed
                } else {
                    PermissionWaitOutcome::Denied
                }
            },
        )
    }

    pub(crate) fn confirmation_wait_outcome(
        &mut self,
        confirmation_ref: &str,
        now_millis: u64,
    ) -> PermissionWaitOutcome {
        self.prune(now_millis);
        let Ok(confirmation_ref) = Uuid::parse_str(confirmation_ref) else {
            return PermissionWaitOutcome::Expired;
        };
        if let Some(confirmation) = self.confirmations.get(&confirmation_ref) {
            if confirmation.approved {
                PermissionWaitOutcome::Allowed
            } else {
                PermissionWaitOutcome::Pending
            }
        } else {
            self.confirmation_outcomes
                .remove(&confirmation_ref)
                .map_or(PermissionWaitOutcome::Expired, |_| {
                    PermissionWaitOutcome::Denied
                })
        }
    }

    pub fn activate_pending_direct_action(
        &mut self,
        permission_ref: &str,
        now_millis: u64,
    ) -> Result<Option<PermissionRequestSnapshot>, AgentBrokerError> {
        self.prune(now_millis);
        let permission_ref = parse_opaque_id(permission_ref, "unknown-permission")?;
        let pending = self
            .permission_requests
            .get(&permission_ref)
            .cloned()
            .ok_or_else(|| {
                AgentBrokerError::new(
                    "unknown-permission",
                    "The permission request is expired or unavailable.",
                    false,
                )
            })?;
        if let Some(policy) = pending.direct_ssh_policy {
            let parameters_digest = pending
                .parameters_digest
                .clone()
                .ok_or_else(AgentBrokerError::internal)?;
            self.active_direct_ssh_policies.insert(
                (
                    pending.client_id,
                    pending.account_ref.clone(),
                    pending.tool.clone(),
                    parameters_digest,
                ),
                policy,
            );
        } else if let Some(policy) = pending.direct_http_policy {
            let parameters_digest = pending
                .parameters_digest
                .clone()
                .ok_or_else(AgentBrokerError::internal)?;
            self.active_direct_http_policies.insert(
                (
                    pending.client_id,
                    pending.account_ref.clone(),
                    pending.tool.clone(),
                    parameters_digest,
                ),
                policy,
            );
        } else if let Some(policy) = pending.direct_connector_policy {
            let parameters_digest = pending
                .parameters_digest
                .clone()
                .ok_or_else(AgentBrokerError::internal)?;
            self.active_direct_connector_policies.insert(
                (
                    pending.client_id,
                    pending.account_ref.clone(),
                    pending.tool.clone(),
                    parameters_digest,
                ),
                policy,
            );
        } else {
            return Ok(None);
        }
        let updated = self
            .permission_requests
            .get_mut(&permission_ref)
            .ok_or_else(AgentBrokerError::internal)?;
        updated.activation_required = false;
        Ok(Some(permission_snapshot(updated)))
    }

    #[cfg(test)]
    pub fn resolve_permission(
        &mut self,
        permission_ref: &str,
        decision: PermissionDecision,
        now_millis: u64,
    ) -> Result<PermissionResolution, AgentBrokerError> {
        let choice = match decision {
            PermissionDecision::AllowOnce => PermissionChoice {
                effect: PermissionEffect::Allow,
                scope: PermissionScope::Exact,
                duration: PermissionDuration::Once,
                path_pattern: None,
            },
            PermissionDecision::AllowSession => PermissionChoice {
                effect: PermissionEffect::Allow,
                scope: PermissionScope::Exact,
                duration: PermissionDuration::Connection,
                path_pattern: None,
            },
            PermissionDecision::AlwaysAllow => PermissionChoice {
                effect: PermissionEffect::Allow,
                scope: PermissionScope::Exact,
                duration: PermissionDuration::Permanent,
                path_pattern: None,
            },
            PermissionDecision::DenyOnce => PermissionChoice {
                effect: PermissionEffect::Deny,
                scope: PermissionScope::Exact,
                duration: PermissionDuration::Once,
                path_pattern: None,
            },
            PermissionDecision::AlwaysDeny => PermissionChoice {
                effect: PermissionEffect::Deny,
                scope: PermissionScope::Exact,
                duration: PermissionDuration::Permanent,
                path_pattern: None,
            },
        };
        self.resolve_permission_choice(permission_ref, choice, now_millis)
    }

    pub fn resolve_permission_choice(
        &mut self,
        permission_ref: &str,
        choice: PermissionChoice,
        now_millis: u64,
    ) -> Result<PermissionResolution, AgentBrokerError> {
        self.prune(now_millis);
        let permission_ref = parse_opaque_id(permission_ref, "unknown-permission")?;
        let pending = self
            .permission_requests
            .get(&permission_ref)
            .cloned()
            .ok_or_else(|| {
                AgentBrokerError::new(
                    "unknown-permission",
                    "The permission request is expired or unavailable.",
                    false,
                )
            })?;
        if !permission_available_scopes(&pending).contains(&choice.scope)
            || !permission_choice_is_valid(&pending, &choice)
        {
            return Err(AgentBrokerError::new(
                "permission-scope-denied",
                "The selected authorization scope or HTTP path pattern is invalid.",
                false,
            ));
        }
        if pending.activation_required {
            if choice.effect == PermissionEffect::Allow {
                return Err(AgentBrokerError::new(
                    "action-not-activated",
                    "Activate the broker-owned direct action before allowing this request.",
                    false,
                ));
            }
            if !permission_available_scopes(&pending).contains(&choice.scope) {
                return Err(AgentBrokerError::new(
                    "permission-scope-denied",
                    "The selected authorization scope is not valid for this action.",
                    false,
                ));
            }
            if !permission_available_durations(&pending, choice.effect).contains(&choice.duration) {
                return Err(AgentBrokerError::new(
                    "permission-duration-denied",
                    "The selected authorization duration is not valid for this action risk.",
                    false,
                ));
            }
            if choice.duration == PermissionDuration::Permanent {
                let client = self.clients.get(&pending.client_id).ok_or_else(|| {
                    AgentBrokerError::new(
                        "unknown-client",
                        "The Agent client is not connected.",
                        false,
                    )
                })?;
                let rule = AgentAuthorizationRule {
                    id: Uuid::new_v4(),
                    client_key: client.client_key.clone(),
                    account_ref: pending.account_ref.clone(),
                    target_digest: pending.target_digest.clone(),
                    tool: pending.tool.clone(),
                    scope: choice.scope,
                    effect: PermissionEffect::Deny,
                    parameters_digest: (choice.scope == PermissionScope::Exact)
                        .then(|| pending.parameters_digest.clone())
                        .flatten(),
                    catalog_revision: (choice.scope == PermissionScope::Safe).then(|| {
                        crate::agent_ssh_command_policy::SAFE_SSH_CATALOG_REVISION.to_owned()
                    }),
                    http_method: (choice.scope == PermissionScope::Path)
                        .then(|| {
                            pending
                                .direct_http_policy
                                .as_ref()
                                .map(|policy| policy.operation.method.clone())
                        })
                        .flatten(),
                    path_pattern: (choice.scope == PermissionScope::Path)
                        .then(|| choice.path_pattern.clone())
                        .flatten(),
                    matcher_revision: (choice.scope == PermissionScope::Path).then(|| {
                        crate::agent_http_path_policy::HTTP_PATH_MATCHER_REVISION.to_owned()
                    }),
                    created_at: now_millis,
                    updated_at: now_millis,
                };
                self.authorization_store
                    .as_ref()
                    .ok_or_else(|| {
                        AgentBrokerError::new(
                            "permission-store-unavailable",
                            "The persistent authorization store is unavailable.",
                            true,
                        )
                    })?
                    .upsert(&client.peer.user_id, rule)
                    .map_err(|_| {
                        AgentBrokerError::new(
                            "permission-store-unavailable",
                            "The persistent authorization rule could not be saved.",
                            true,
                        )
                    })?;
            }
            if choice.duration == PermissionDuration::Connection {
                self.grant_permission(
                    pending.session_id,
                    PermissionGrantInput {
                        account_ref: &pending.account_ref,
                        tool: &pending.tool,
                        operation: permission_choice_operation(&pending, &choice),
                        scope: choice.scope,
                        parameters_digest: permission_choice_parameters_digest(&pending, &choice),
                        catalog_revision: permission_choice_catalog_revision(&choice),
                        effect: PermissionEffect::Deny,
                        fresh_confirmation_required: false,
                        remaining_uses: None,
                    },
                )?;
            }
            self.permission_requests.remove(&permission_ref);
            self.permission_outcomes.insert(
                permission_ref,
                ResolvedPermissionOutcome {
                    allowed: false,
                    expires_at: now_millis.saturating_add(AUTHORIZATION_TTL_MILLIS),
                },
            );
            return Ok(PermissionResolution {
                request: permission_snapshot(&pending),
                choice,
            });
        }
        if !permission_available_scopes(&pending).contains(&choice.scope) {
            return Err(AgentBrokerError::new(
                "permission-scope-denied",
                "The selected authorization scope is not valid for this action.",
                false,
            ));
        }
        if !permission_available_durations(&pending, choice.effect).contains(&choice.duration) {
            return Err(AgentBrokerError::new(
                "permission-duration-denied",
                "The selected authorization duration is not valid for this action risk.",
                false,
            ));
        }
        let use_scoped_store =
            self.authorization_store.is_some() && pending.parameters_digest.is_some();
        if !use_scoped_store && choice.duration == PermissionDuration::Permanent {
            return Err(AgentBrokerError::new(
                "permission-store-unavailable",
                "Persistent authorization requires the scoped authorization store.",
                true,
            ));
        }
        let client = self
            .clients
            .get(&pending.client_id)
            .cloned()
            .ok_or_else(|| {
                AgentBrokerError::new(
                    "unknown-client",
                    "The Agent client is not connected.",
                    false,
                )
            })?;
        if choice.duration == PermissionDuration::Permanent {
            let rule = AgentAuthorizationRule {
                id: Uuid::new_v4(),
                client_key: client.client_key.clone(),
                account_ref: pending.account_ref.clone(),
                target_digest: pending.target_digest.clone(),
                tool: pending.tool.clone(),
                scope: choice.scope,
                effect: choice.effect,
                parameters_digest: (choice.scope == PermissionScope::Exact)
                    .then(|| pending.parameters_digest.clone())
                    .flatten(),
                catalog_revision: (choice.scope == PermissionScope::Safe)
                    .then(|| crate::agent_ssh_command_policy::SAFE_SSH_CATALOG_REVISION.to_owned()),
                http_method: (choice.scope == PermissionScope::Path)
                    .then(|| {
                        pending
                            .direct_http_policy
                            .as_ref()
                            .map(|policy| policy.operation.method.clone())
                    })
                    .flatten(),
                path_pattern: (choice.scope == PermissionScope::Path)
                    .then(|| choice.path_pattern.clone())
                    .flatten(),
                matcher_revision: (choice.scope == PermissionScope::Path)
                    .then(|| crate::agent_http_path_policy::HTTP_PATH_MATCHER_REVISION.to_owned()),
                created_at: now_millis,
                updated_at: now_millis,
            };
            self.authorization_store
                .as_ref()
                .ok_or_else(|| {
                    AgentBrokerError::new(
                        "permission-store-unavailable",
                        "The persistent authorization store is unavailable.",
                        true,
                    )
                })?
                .upsert(&client.peer.user_id, rule)
                .map_err(|_| {
                    AgentBrokerError::new(
                        "permission-store-unavailable",
                        "The persistent authorization rule could not be saved.",
                        true,
                    )
                })?;
        }
        let fresh_confirmation_required =
            risk_rank(&pending.risk) >= risk_rank("R2") && choice.effect == PermissionEffect::Allow;
        if choice.effect == PermissionEffect::Deny
            && choice.duration == PermissionDuration::Connection
        {
            self.grant_permission(
                pending.session_id,
                PermissionGrantInput {
                    account_ref: &pending.account_ref,
                    tool: &pending.tool,
                    operation: permission_choice_operation(&pending, &choice),
                    scope: choice.scope,
                    parameters_digest: permission_choice_parameters_digest(&pending, &choice),
                    catalog_revision: permission_choice_catalog_revision(&choice),
                    effect: choice.effect,
                    fresh_confirmation_required: false,
                    remaining_uses: None,
                },
            )?;
        } else if choice.effect == PermissionEffect::Allow && fresh_confirmation_required {
            if choice.duration == PermissionDuration::Connection {
                self.grant_permission(
                    pending.session_id,
                    PermissionGrantInput {
                        account_ref: &pending.account_ref,
                        tool: &pending.tool,
                        operation: permission_choice_operation(&pending, &choice),
                        scope: choice.scope,
                        parameters_digest: permission_choice_parameters_digest(&pending, &choice),
                        catalog_revision: permission_choice_catalog_revision(&choice),
                        effect: PermissionEffect::Allow,
                        fresh_confirmation_required: true,
                        remaining_uses: None,
                    },
                )?;
            }
            self.grant_permission(
                pending.session_id,
                PermissionGrantInput {
                    account_ref: &pending.account_ref,
                    tool: &pending.tool,
                    operation: pending.operation.as_deref(),
                    scope: PermissionScope::Exact,
                    parameters_digest: pending.parameters_digest.as_deref(),
                    catalog_revision: None,
                    effect: PermissionEffect::Allow,
                    fresh_confirmation_required: false,
                    remaining_uses: Some(1),
                },
            )?;
        } else if choice.effect == PermissionEffect::Allow {
            self.grant_permission(
                pending.session_id,
                PermissionGrantInput {
                    account_ref: &pending.account_ref,
                    tool: &pending.tool,
                    operation: permission_choice_operation(&pending, &choice),
                    scope: choice.scope,
                    parameters_digest: permission_choice_parameters_digest(&pending, &choice),
                    catalog_revision: permission_choice_catalog_revision(&choice),
                    effect: PermissionEffect::Allow,
                    fresh_confirmation_required: false,
                    remaining_uses: (choice.duration == PermissionDuration::Once).then_some(1),
                },
            )?;
        }
        self.permission_requests.remove(&permission_ref);
        self.permission_outcomes.insert(
            permission_ref,
            ResolvedPermissionOutcome {
                allowed: choice.effect == PermissionEffect::Allow,
                expires_at: now_millis.saturating_add(AUTHORIZATION_TTL_MILLIS),
            },
        );
        Ok(PermissionResolution {
            request: permission_snapshot(&pending),
            choice,
        })
    }

    pub(super) fn request_permission(
        &mut self,
        client_id: Uuid,
        session_id: Uuid,
        account_ref: &str,
        parameters: &Value,
        now_millis: u64,
    ) -> Result<Value, AgentBrokerError> {
        let requested_tool = parameters
            .get("tool")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                AgentBrokerError::new("invalid-parameters", "A capability is required.", false)
            })?;
        let parameters_digest = parameters
            .get("actionParameters")
            .map(canonical_parameters_digest)
            .transpose()?;
        if SESSION_BASE_TOOLS.contains(&requested_tool) {
            return Err(AgentBrokerError::new(
                "invalid-permission",
                "Broker discovery capabilities do not require account permission.",
                false,
            ));
        }
        self.registry
            .tools
            .iter()
            .find(|tool| tool.name == requested_tool && tool.requires_account)
            .ok_or_else(|| {
                AgentBrokerError::new(
                    "unknown-tool",
                    "The requested capability is unavailable.",
                    false,
                )
            })?;
        let client = self.clients.get(&client_id).cloned().ok_or_else(|| {
            AgentBrokerError::new(
                "unknown-client",
                "The Agent client is not connected.",
                false,
            )
        })?;
        let candidates = if self.account_catalog.is_some() {
            self.refresh_account_catalog()?
        } else {
            Vec::new()
        };
        let action_parameters = parameters.get("actionParameters").ok_or_else(|| {
            AgentBrokerError::new(
                "invalid-permission",
                "A canonical action payload is required.",
                false,
            )
        })?;
        let parameters_digest = parameters_digest
            .as_deref()
            .ok_or_else(AgentBrokerError::internal)?;
        if let Some(definition) = self.connector_definitions.get(account_ref).cloned() {
            if !definition.enabled {
                return Err(AgentBrokerError::new(
                    "account-policy-denied",
                    "The account connector does not allow this capability.",
                    false,
                ));
            }
            if definition.allowed_tools.contains(requested_tool)
                && is_direct_connector_action_tool(&definition.connector_kind, requested_tool)
            {
                return self.request_direct_connector_permission(
                    client_id,
                    session_id,
                    &client,
                    definition.definition_id,
                    account_ref,
                    requested_tool,
                    action_parameters,
                    parameters_digest,
                    now_millis,
                );
            }
        }

        let candidate_id = parse_opaque_id(account_ref, "account-unavailable")?;
        let candidate = candidates
            .iter()
            .find(|candidate| candidate.account_ref == candidate_id)
            .cloned()
            .ok_or_else(|| {
                AgentBrokerError::new(
                    "account-unavailable",
                    "The Vault account is unavailable.",
                    false,
                )
            })?;
        if !candidate_accepts_tool(&candidate.kind, requested_tool) {
            return Err(AgentBrokerError::new(
                "account-policy-denied",
                "This Vault account kind cannot create the requested capability.",
                false,
            ));
        }
        if candidate.kind == "ssh" && is_direct_ssh_action_tool(requested_tool) {
            return self.request_direct_ssh_permission(
                client_id,
                session_id,
                &client,
                &candidate,
                requested_tool,
                action_parameters,
                parameters_digest,
                now_millis,
            );
        }
        if matches!(candidate.kind.as_str(), "login" | "secret")
            && requested_tool == "vaultmesh_http_request"
        {
            return self.request_direct_http_permission(
                client_id,
                session_id,
                &client,
                candidate.account_ref,
                &candidate.kind,
                requested_tool,
                Some((candidate.account_ref, candidate.kind.as_str())),
                action_parameters,
                parameters_digest,
                now_millis,
            );
        }
        Err(AgentBrokerError::action_rule_unavailable(
            &candidate.kind,
            requested_tool,
        ))
    }

    #[allow(clippy::too_many_arguments)]
    fn request_direct_ssh_permission(
        &mut self,
        client_id: Uuid,
        session_id: Uuid,
        client: &AgentClientRecord,
        candidate: &AgentVaultAccountCandidate,
        requested_tool: &str,
        action_parameters: &Value,
        parameters_digest: &str,
        now_millis: u64,
    ) -> Result<Value, AgentBrokerError> {
        let factory = self
            .direct_ssh_policy_factory
            .clone()
            .ok_or_else(|| AgentBrokerError::action_rule_unavailable("ssh", requested_tool))?;
        let policy = factory(candidate.account_ref, requested_tool, action_parameters)?;
        if policy.account_ref != candidate.account_ref || policy.tool != requested_tool {
            return Err(AgentBrokerError::internal());
        }
        let risk = policy.risk.clone();
        let action_display = policy.action_display.clone();
        let operation =
            request_permission_operation(requested_tool, action_parameters).map(str::to_owned);
        let account_ref = candidate.account_ref.to_string();
        let safe = requested_tool == "vaultmesh_ssh_exec" && risk == "R1";
        let catalog_revision = if requested_tool == "vaultmesh_ssh_exec" {
            crate::agent_ssh_command_policy::SAFE_SSH_CATALOG_REVISION
        } else {
            "none"
        };
        let persistent_rule = self.authorization_store.as_ref().and_then(|store| {
            store
                .matching_rule(AgentAuthorizationMatch {
                    user_id: &client.peer.user_id,
                    client_key: &client.client_key,
                    account_ref: &account_ref,
                    target_digest: &policy.target_digest,
                    tool: requested_tool,
                    parameters_digest,
                    safe,
                    catalog_revision,
                    http_method: None,
                    http_path: None,
                })
                .ok()
                .flatten()
        });
        if let Some(rule) = persistent_rule {
            if rule.effect == PermissionEffect::Deny {
                return Ok(json!({ "status": "denied", "mode": "persistent" }));
            }
            if risk_rank(&risk) < risk_rank("R2") {
                self.active_direct_ssh_policies.insert(
                    (
                        client_id,
                        account_ref.clone(),
                        requested_tool.to_owned(),
                        parameters_digest.to_owned(),
                    ),
                    policy,
                );
                self.grant_permission(
                    session_id,
                    PermissionGrantInput {
                        account_ref: &account_ref,
                        tool: requested_tool,
                        operation: (rule.scope == PermissionScope::Exact)
                            .then_some(operation.as_deref())
                            .flatten(),
                        scope: rule.scope,
                        parameters_digest: (rule.scope == PermissionScope::Exact)
                            .then_some(Some(parameters_digest))
                            .flatten(),
                        catalog_revision: rule.catalog_revision.as_deref(),
                        effect: PermissionEffect::Allow,
                        fresh_confirmation_required: false,
                        remaining_uses: None,
                    },
                )?;
                return Ok(json!({ "status": "allowed", "mode": "persistent" }));
            }
        }
        let current_grant = self
            .transport_permission_grants
            .get(&client_id)
            .and_then(|grants| {
                matching_permission_grant_index(
                    grants,
                    &account_ref,
                    requested_tool,
                    operation.as_deref(),
                    parameters_digest,
                    action_parameters,
                )
                .map(|index| grants[index].clone())
            });
        if let Some(grant) = current_grant {
            if grant.effect == PermissionEffect::Deny {
                return Ok(json!({ "status": "denied", "mode": "connection" }));
            }
            if !grant.fresh_confirmation_required {
                self.active_direct_ssh_policies.insert(
                    (
                        client_id,
                        account_ref.clone(),
                        requested_tool.to_owned(),
                        parameters_digest.to_owned(),
                    ),
                    policy,
                );
                self.grant_permission(
                    session_id,
                    PermissionGrantInput {
                        account_ref: &account_ref,
                        tool: requested_tool,
                        operation: grant.operation.as_deref(),
                        scope: grant.scope,
                        parameters_digest: grant.parameters_digest.as_deref(),
                        catalog_revision: grant.catalog_revision.as_deref(),
                        effect: grant.effect,
                        fresh_confirmation_required: grant.fresh_confirmation_required,
                        remaining_uses: grant.remaining_uses,
                    },
                )?;
                return Ok(json!({ "status": "allowed", "mode": "connection" }));
            }
        }
        if let Some(existing) = self.permission_requests.values().find(|pending| {
            pending.client_id == client_id
                && pending.session_id == session_id
                && pending.account_ref == account_ref
                && pending.tool == requested_tool
                && pending.parameters_digest.as_deref() == Some(parameters_digest)
                && pending.expires_at > now_millis
        }) {
            return Ok(json!({
                "status": "pending-action",
                "permissionRef": existing.permission_ref,
                "expiresAt": existing.expires_at
            }));
        }
        let permission_ref = Uuid::new_v4();
        let expires_at = now_millis.saturating_add(PERMISSION_TTL_MILLIS);
        self.permission_requests.insert(
            permission_ref,
            PendingPermission {
                permission_ref,
                client_id,
                session_id,
                account_ref,
                account_label: policy.account_label.clone(),
                environment: policy.environment.clone(),
                tool: requested_tool.to_owned(),
                operation,
                parameters_digest: Some(parameters_digest.to_owned()),
                risk,
                approved_display: policy.approved_display.clone(),
                action_display,
                target_digest: policy.target_digest.clone(),
                source_item_ref: Some(candidate.account_ref),
                source_item_kind: Some(candidate.kind.clone()),
                activation_required: true,
                direct_ssh_policy: Some(policy),
                direct_http_policy: None,
                direct_connector_policy: None,
                created_at: now_millis,
                expires_at,
            },
        );
        Ok(json!({
            "status": "pending-action",
            "permissionRef": permission_ref,
            "expiresAt": expires_at
        }))
    }

    #[allow(clippy::too_many_arguments)]
    fn request_direct_http_permission(
        &mut self,
        client_id: Uuid,
        session_id: Uuid,
        client: &AgentClientRecord,
        direct_account_ref: Uuid,
        account_kind: &str,
        requested_tool: &str,
        source_item: Option<(Uuid, &str)>,
        action_parameters: &Value,
        parameters_digest: &str,
        now_millis: u64,
    ) -> Result<Value, AgentBrokerError> {
        let factory = self.direct_http_policy_factory.clone().ok_or_else(|| {
            AgentBrokerError::action_rule_unavailable(account_kind, requested_tool)
        })?;
        let policy = factory(
            direct_account_ref,
            account_kind,
            requested_tool,
            action_parameters,
        )?;
        if policy.account_ref != direct_account_ref
            || policy.operation.method
                != action_parameters
                    .get("method")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
        {
            return Err(AgentBrokerError::internal());
        }
        let risk = serde_json::to_value(policy.operation.risk)
            .ok()
            .and_then(|value| value.as_str().map(str::to_owned))
            .ok_or_else(AgentBrokerError::internal)?;
        let action_display = format!("{} {}", policy.operation.method, policy.operation.path);
        if action_display.len() > 16_384 || action_display.chars().any(char::is_control) {
            return Err(AgentBrokerError::internal());
        }
        let account_ref = direct_account_ref.to_string();
        let persistent_rule = self.authorization_store.as_ref().and_then(|store| {
            store
                .matching_rule(AgentAuthorizationMatch {
                    user_id: &client.peer.user_id,
                    client_key: &client.client_key,
                    account_ref: &account_ref,
                    target_digest: &policy.target_digest,
                    tool: requested_tool,
                    parameters_digest,
                    safe: false,
                    catalog_revision: "none",
                    http_method: Some(&policy.operation.method),
                    http_path: action_parameters.get("path").and_then(Value::as_str),
                })
                .ok()
                .flatten()
        });
        if let Some(rule) = persistent_rule {
            if rule.effect == PermissionEffect::Deny {
                return Ok(json!({ "status": "denied", "mode": "persistent" }));
            }
            if risk_rank(&risk) < risk_rank("R2") {
                self.active_direct_http_policies.insert(
                    (
                        client_id,
                        account_ref.clone(),
                        requested_tool.to_owned(),
                        parameters_digest.to_owned(),
                    ),
                    policy,
                );
                self.grant_permission(
                    session_id,
                    PermissionGrantInput {
                        account_ref: &account_ref,
                        tool: requested_tool,
                        operation: match rule.scope {
                            PermissionScope::Exact => {
                                action_parameters.get("path").and_then(Value::as_str)
                            }
                            PermissionScope::Path => rule.path_pattern.as_deref(),
                            PermissionScope::Safe | PermissionScope::All => None,
                        },
                        scope: rule.scope,
                        parameters_digest: match rule.scope {
                            PermissionScope::Exact => Some(parameters_digest),
                            PermissionScope::Path => rule.http_method.as_deref(),
                            PermissionScope::Safe | PermissionScope::All => None,
                        },
                        catalog_revision: rule.matcher_revision.as_deref(),
                        effect: PermissionEffect::Allow,
                        fresh_confirmation_required: false,
                        remaining_uses: None,
                    },
                )?;
                return Ok(json!({ "status": "allowed", "mode": "persistent" }));
            }
        }
        if let Some(existing) = self.permission_requests.values().find(|pending| {
            pending.client_id == client_id
                && pending.session_id == session_id
                && pending.account_ref == account_ref
                && pending.tool == requested_tool
                && pending.parameters_digest.as_deref() == Some(parameters_digest)
                && pending.expires_at > now_millis
        }) {
            return Ok(json!({
                "status": "pending-action",
                "permissionRef": existing.permission_ref,
                "expiresAt": existing.expires_at
            }));
        }
        let permission_ref = Uuid::new_v4();
        let expires_at = now_millis.saturating_add(PERMISSION_TTL_MILLIS);
        self.permission_requests.insert(
            permission_ref,
            PendingPermission {
                permission_ref,
                client_id,
                session_id,
                account_ref,
                account_label: policy.account_label.clone(),
                environment: policy.environment.clone(),
                tool: requested_tool.to_owned(),
                operation: action_parameters
                    .get("path")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                parameters_digest: Some(parameters_digest.to_owned()),
                risk,
                approved_display: policy.approved_display.clone(),
                action_display,
                target_digest: policy.target_digest.clone(),
                source_item_ref: source_item.map(|(item_ref, _)| item_ref),
                source_item_kind: source_item.map(|(_, item_kind)| item_kind.to_owned()),
                activation_required: true,
                direct_ssh_policy: None,
                direct_http_policy: Some(policy),
                direct_connector_policy: None,
                created_at: now_millis,
                expires_at,
            },
        );
        Ok(json!({
            "status": "pending-action",
            "permissionRef": permission_ref,
            "expiresAt": expires_at
        }))
    }

    #[allow(clippy::too_many_arguments)]
    fn request_direct_connector_permission(
        &mut self,
        client_id: Uuid,
        session_id: Uuid,
        client: &AgentClientRecord,
        connector_ref: Uuid,
        source_account_ref: &str,
        requested_tool: &str,
        action_parameters: &Value,
        parameters_digest: &str,
        now_millis: u64,
    ) -> Result<Value, AgentBrokerError> {
        let factory = self
            .direct_connector_policy_factory
            .clone()
            .ok_or_else(|| {
                AgentBrokerError::action_rule_unavailable("connector", requested_tool)
            })?;
        let policy = factory(connector_ref, requested_tool, action_parameters)?;
        if policy.account_ref.to_string() != source_account_ref || policy.tool != requested_tool {
            return Err(AgentBrokerError::internal());
        }
        let account_ref = source_account_ref.to_owned();
        let risk = policy.risk.clone();
        let operation = policy.operation.clone();
        let persistent_rule = self.authorization_store.as_ref().and_then(|store| {
            store
                .matching_rule(AgentAuthorizationMatch {
                    user_id: &client.peer.user_id,
                    client_key: &client.client_key,
                    account_ref: &account_ref,
                    target_digest: &policy.target_digest,
                    tool: requested_tool,
                    parameters_digest,
                    safe: false,
                    catalog_revision: "none",
                    http_method: None,
                    http_path: None,
                })
                .ok()
                .flatten()
        });
        if let Some(rule) = persistent_rule {
            if rule.effect == PermissionEffect::Deny {
                return Ok(json!({ "status": "denied", "mode": "persistent" }));
            }
            if risk_rank(&risk) < risk_rank("R2") {
                self.active_direct_connector_policies.insert(
                    (
                        client_id,
                        account_ref.clone(),
                        requested_tool.to_owned(),
                        parameters_digest.to_owned(),
                    ),
                    policy,
                );
                self.grant_permission(
                    session_id,
                    PermissionGrantInput {
                        account_ref: &account_ref,
                        tool: requested_tool,
                        operation: (rule.scope == PermissionScope::Exact)
                            .then_some(operation.as_deref())
                            .flatten(),
                        scope: rule.scope,
                        parameters_digest: (rule.scope == PermissionScope::Exact)
                            .then_some(Some(parameters_digest))
                            .flatten(),
                        catalog_revision: None,
                        effect: PermissionEffect::Allow,
                        fresh_confirmation_required: false,
                        remaining_uses: None,
                    },
                )?;
                return Ok(json!({ "status": "allowed", "mode": "persistent" }));
            }
        }
        let current_grant = self
            .transport_permission_grants
            .get(&client_id)
            .and_then(|grants| {
                matching_permission_grant_index(
                    grants,
                    &account_ref,
                    requested_tool,
                    operation.as_deref(),
                    parameters_digest,
                    action_parameters,
                )
                .map(|index| grants[index].clone())
            });
        if let Some(grant) = current_grant {
            if grant.effect == PermissionEffect::Deny {
                return Ok(json!({ "status": "denied", "mode": "connection" }));
            }
            if !grant.fresh_confirmation_required {
                self.active_direct_connector_policies.insert(
                    (
                        client_id,
                        account_ref.clone(),
                        requested_tool.to_owned(),
                        parameters_digest.to_owned(),
                    ),
                    policy,
                );
                self.grant_permission(
                    session_id,
                    PermissionGrantInput {
                        account_ref: &account_ref,
                        tool: requested_tool,
                        operation: grant.operation.as_deref(),
                        scope: grant.scope,
                        parameters_digest: grant.parameters_digest.as_deref(),
                        catalog_revision: None,
                        effect: grant.effect,
                        fresh_confirmation_required: grant.fresh_confirmation_required,
                        remaining_uses: grant.remaining_uses,
                    },
                )?;
                return Ok(json!({ "status": "allowed", "mode": "connection" }));
            }
        }
        if let Some(existing) = self.permission_requests.values().find(|pending| {
            pending.client_id == client_id
                && pending.session_id == session_id
                && pending.account_ref == account_ref
                && pending.tool == requested_tool
                && pending.parameters_digest.as_deref() == Some(parameters_digest)
                && pending.expires_at > now_millis
        }) {
            return Ok(json!({
                "status": "pending-action",
                "permissionRef": existing.permission_ref,
                "expiresAt": existing.expires_at
            }));
        }
        let permission_ref = Uuid::new_v4();
        let expires_at = now_millis.saturating_add(PERMISSION_TTL_MILLIS);
        self.permission_requests.insert(
            permission_ref,
            PendingPermission {
                permission_ref,
                client_id,
                session_id,
                account_ref,
                account_label: policy.account_label.clone(),
                environment: policy.environment.clone(),
                tool: requested_tool.to_owned(),
                operation,
                parameters_digest: Some(parameters_digest.to_owned()),
                risk,
                approved_display: policy.approved_display.clone(),
                action_display: policy.action_display.clone(),
                target_digest: policy.target_digest.clone(),
                source_item_ref: None,
                source_item_kind: None,
                activation_required: true,
                direct_ssh_policy: None,
                direct_http_policy: None,
                direct_connector_policy: Some(policy),
                created_at: now_millis,
                expires_at,
            },
        );
        Ok(json!({
            "status": "pending-action",
            "permissionRef": permission_ref,
            "expiresAt": expires_at
        }))
    }

    pub(super) fn grant_permission(
        &mut self,
        session_id: Uuid,
        input: PermissionGrantInput<'_>,
    ) -> Result<(), AgentBrokerError> {
        let session = self.sessions.get_mut(&session_id).ok_or_else(|| {
            AgentBrokerError::new(
                "session-denied",
                "The connection session is unavailable.",
                false,
            )
        })?;
        if !session.connection_managed {
            return Err(AgentBrokerError::new(
                "invalid-permission",
                "This connection already has an explicit capability session.",
                false,
            ));
        }
        let client_id = session.client_id;
        session
            .allowed_accounts
            .insert(input.account_ref.to_owned());
        session.allowed_tools.insert(input.tool.to_owned());
        let grants = self
            .transport_permission_grants
            .entry(client_id)
            .or_default();
        if let Some(existing) = grants.iter_mut().find(|grant| {
            grant.account_ref == input.account_ref
                && grant.tool == input.tool
                && grant.operation.as_deref() == input.operation
                && grant.scope == input.scope
                && grant.parameters_digest.as_deref() == input.parameters_digest
                && grant.catalog_revision.as_deref() == input.catalog_revision
                && grant.effect == input.effect
                && grant.fresh_confirmation_required == input.fresh_confirmation_required
        }) {
            existing.remaining_uses = input.remaining_uses;
        } else {
            grants.push(PermissionGrant {
                account_ref: input.account_ref.to_owned(),
                tool: input.tool.to_owned(),
                operation: input.operation.map(str::to_owned),
                scope: input.scope,
                parameters_digest: input.parameters_digest.map(str::to_owned),
                catalog_revision: input.catalog_revision.map(str::to_owned),
                effect: input.effect,
                fresh_confirmation_required: input.fresh_confirmation_required,
                remaining_uses: input.remaining_uses,
            });
        }
        Ok(())
    }

    pub fn approve_confirmation(
        &mut self,
        confirmation_ref: &str,
        now_millis: u64,
    ) -> Result<ConfirmationSnapshot, AgentBrokerError> {
        self.prune(now_millis);
        let confirmation_ref = parse_opaque_id(confirmation_ref, "unknown-confirmation")?;
        let confirmation = self
            .confirmations
            .get_mut(&confirmation_ref)
            .ok_or_else(|| {
                AgentBrokerError::new(
                    "unknown-confirmation",
                    "The confirmation is expired or unavailable.",
                    false,
                )
            })?;
        confirmation.approved = true;
        self.confirmations()
            .into_iter()
            .find(|snapshot| snapshot.confirmation_ref == confirmation_ref.to_string())
            .ok_or_else(AgentBrokerError::internal)
    }

    pub fn reject_confirmation(
        &mut self,
        confirmation_ref: &str,
        now_millis: u64,
    ) -> Result<(), AgentBrokerError> {
        let confirmation_ref = parse_opaque_id(confirmation_ref, "unknown-confirmation")?;
        self.confirmations
            .remove(&confirmation_ref)
            .map(|_| {
                self.confirmation_outcomes.insert(
                    confirmation_ref,
                    ResolvedPermissionOutcome {
                        allowed: false,
                        expires_at: now_millis.saturating_add(AUTHORIZATION_TTL_MILLIS),
                    },
                );
            })
            .ok_or_else(|| {
                AgentBrokerError::new(
                    "unknown-confirmation",
                    "The confirmation is expired or unavailable.",
                    false,
                )
            })
    }
}
