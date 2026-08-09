use super::*;

impl VaultSession {
    pub fn agent_connector_definitions(
        &self,
    ) -> Result<Vec<AgentConnectorDefinitionSummary>, VaultError> {
        Ok(self
            .payload()?
            .agent_connector_definitions
            .iter()
            .map(AgentConnectorDefinitionSummary::from)
            .collect())
    }

    /// Privileged native-runtime view used to evaluate Agent policy. This must
    /// never be serialized through renderer or Agent metadata APIs.
    pub fn agent_connector_definition_records(
        &self,
    ) -> Result<Vec<AgentConnectorDefinition>, VaultError> {
        Ok(self.payload()?.agent_connector_definitions.clone())
    }

    pub fn agent_audit_events(&self) -> Result<Vec<AgentAuditEvent>, VaultError> {
        Ok(self.payload()?.agent_audit_events.clone())
    }

    pub fn record_agent_audit(
        &mut self,
        event: NewAgentAuditEvent,
    ) -> Result<AgentAuditEvent, VaultError> {
        validate_agent_audit(&event)?;
        let event = AgentAuditEvent {
            event_id: Uuid::new_v4(),
            event,
        };
        let events = &mut self.payload_mut()?.agent_audit_events;
        events.push(event.clone());
        if events.len() > MAX_AGENT_AUDIT_EVENTS {
            events.remove(0).zeroize();
        }
        Ok(event)
    }

    pub fn clear_agent_audit(&mut self) -> Result<(), VaultError> {
        self.payload_mut()?.agent_audit_events.zeroize();
        Ok(())
    }

    pub fn agent_connector_definition(
        &self,
        id: Uuid,
    ) -> Result<AgentConnectorDefinition, VaultError> {
        self.payload()?
            .agent_connector_definitions
            .iter()
            .find(|definition| definition.id == id)
            .cloned()
            .ok_or(VaultError::ItemNotFound)
    }

    pub fn add_agent_connector_definition(
        &mut self,
        input: NewAgentConnectorDefinition,
        now: u64,
    ) -> Result<AgentConnectorDefinitionSummary, VaultError> {
        let definition = self.build_agent_connector_definition(input, now)?;
        let summary = AgentConnectorDefinitionSummary::from(&definition);
        self.payload_mut()?
            .agent_connector_definitions
            .push(definition);
        Ok(summary)
    }

    /// Builds a validated internal connector definition without adding it to
    /// the encrypted payload. It is never exposed through renderer or MCP APIs.
    fn build_agent_connector_definition(
        &self,
        input: NewAgentConnectorDefinition,
        now: u64,
    ) -> Result<AgentConnectorDefinition, VaultError> {
        crate::validate_agent_connector_definition(&input)?;
        self.validate_agent_credential_refs(&input)?;
        Ok(AgentConnectorDefinition {
            id: Uuid::new_v4(),
            display_label: input.display_label,
            environment: input.environment,
            connector_kind: input.connector_kind,
            credential_refs: input.credential_refs,
            target_policy: input.target_policy,
            capability_policy: input.capability_policy,
            output_policy: input.output_policy,
            enabled: input.enabled,
            created_at: now,
            updated_at: now,
        })
    }

    pub fn update_agent_connector_definition(
        &mut self,
        id: Uuid,
        input: NewAgentConnectorDefinition,
        now: u64,
    ) -> Result<AgentConnectorDefinitionSummary, VaultError> {
        crate::validate_agent_connector_definition(&input)?;
        self.validate_agent_credential_refs(&input)?;
        let definition = self
            .payload_mut()?
            .agent_connector_definitions
            .iter_mut()
            .find(|definition| definition.id == id)
            .ok_or(VaultError::ItemNotFound)?;
        let created_at = definition.created_at;
        definition.zeroize();
        *definition = AgentConnectorDefinition {
            id,
            display_label: input.display_label,
            environment: input.environment,
            connector_kind: input.connector_kind,
            credential_refs: input.credential_refs,
            target_policy: input.target_policy,
            capability_policy: input.capability_policy,
            output_policy: input.output_policy,
            enabled: input.enabled,
            created_at,
            updated_at: now,
        };
        Ok(AgentConnectorDefinitionSummary::from(&*definition))
    }

    pub fn delete_agent_connector_definition(&mut self, id: Uuid) -> Result<(), VaultError> {
        let index = self
            .payload()?
            .agent_connector_definitions
            .iter()
            .position(|definition| definition.id == id)
            .ok_or(VaultError::ItemNotFound)?;
        self.payload_mut()?
            .agent_connector_definitions
            .remove(index);
        Ok(())
    }

    pub fn agent_access_token_enabled(&self, item_id: Uuid) -> Result<bool, VaultError> {
        let item = self
            .payload()?
            .secrets
            .iter()
            .find(|item| item.id == item_id)
            .ok_or(VaultError::ItemNotFound)?;
        if item.kind != crate::SecretItemKind::AccessToken {
            return Err(VaultError::InvalidAgentConnectorDefinition);
        }
        Ok(!item.scopes.iter().any(|scope| {
            matches!(
                scope.as_str(),
                "vaultmesh:credential-lifecycle:revoked"
                    | "vaultmesh:credential-lifecycle:needs-review"
            )
        }))
    }

    pub(super) fn validate_agent_credential_refs(
        &self,
        input: &NewAgentConnectorDefinition,
    ) -> Result<(), VaultError> {
        let payload = self.payload()?;
        let all_exist = input
            .credential_refs
            .iter()
            .all(|reference| match reference.kind {
                crate::AgentCredentialKind::Login => payload
                    .items
                    .iter()
                    .any(|item| item.id == reference.item_id),
                crate::AgentCredentialKind::Ssh => payload
                    .ssh_items
                    .iter()
                    .any(|item| item.id == reference.item_id),
                crate::AgentCredentialKind::Secret => payload
                    .secrets
                    .iter()
                    .any(|item| item.id == reference.item_id),
                crate::AgentCredentialKind::Email => payload
                    .email_accounts
                    .iter()
                    .any(|item| item.id == reference.item_id),
                crate::AgentCredentialKind::Passkey => payload.secrets.iter().any(|item| {
                    item.id == reference.item_id
                        && item.kind == crate::SecretItemKind::AuthenticatorKey
                        && item
                            .scopes
                            .iter()
                            .any(|scope| scope == "vaultmesh:passkey:v1")
                }),
            });
        if all_exist {
            Ok(())
        } else {
            Err(VaultError::InvalidAgentConnectorDefinition)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_credential_lifecycle_markers_remain_hidden_and_fail_closed() {
        let mut session = VaultSession::create("correct horse battery staple").unwrap();
        let secret = session
            .add_secret(NewSecretItem {
                title: "Legacy token".into(),
                kind: crate::SecretItemKind::AccessToken,
                provider: None,
                account: None,
                secret: "legacy-token-canary".into(),
                environment: None,
                scopes: Vec::new(),
                expires_at: None,
                website: Some("https://api.example.test".into()),
                notes: None,
                folder: None,
                favorite: false,
                master_password_reprompt: false,
            })
            .unwrap();
        session
            .payload_mut()
            .unwrap()
            .secrets
            .iter_mut()
            .find(|item| item.id == secret.id)
            .unwrap()
            .scopes
            .push("vaultmesh:credential-lifecycle:needs-review".into());

        assert!(!session.agent_access_token_enabled(secret.id).unwrap());
        let detail = session.secret_detail(secret.id).unwrap();
        assert!(detail.scopes.is_empty());
        assert!(
            !serde_json::to_string(&detail)
                .unwrap()
                .contains("lifecycle")
        );
    }
}
