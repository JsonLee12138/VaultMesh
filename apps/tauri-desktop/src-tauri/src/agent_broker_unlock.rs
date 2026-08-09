use super::*;

impl AgentBrokerCore {
    pub(super) fn requires_agent_unlock(tool: &str) -> bool {
        !matches!(tool, "vaultmesh_request_local_ui")
    }

    pub(super) fn require_agent_unlock(
        &mut self,
        client_id: Uuid,
        tool: &str,
        now_millis: u64,
    ) -> Result<(), AgentBrokerError> {
        if !Self::requires_agent_unlock(tool) {
            return Ok(());
        }
        if self
            .access_check
            .as_ref()
            .is_some_and(|check| check(client_id))
        {
            return Ok(());
        }
        let client = self.clients.get(&client_id).ok_or_else(|| {
            AgentBrokerError::new(
                "unknown-client",
                "The Agent client is not connected.",
                false,
            )
        })?;
        let shared_ref = self
            .pending_unlocks
            .iter()
            .find_map(|(unlock_ref, pending)| {
                if self.unlock_outcomes.contains_key(unlock_ref) {
                    return None;
                }
                let shares_unlock = self
                    .access_shares_unlock
                    .as_ref()
                    .map_or(pending.client_id == client_id, |shares| {
                        shares(pending.client_id, client_id)
                    });
                (pending.expires_at > now_millis && shares_unlock).then_some(*unlock_ref)
            });
        let pending = if let Some(unlock_ref) = shared_ref {
            let pending = self
                .pending_unlocks
                .get_mut(&unlock_ref)
                .ok_or_else(AgentBrokerError::internal)?;
            pending.client_ids.insert(client_id);
            pending.clone()
        } else {
            PendingUnlockRecord {
                unlock_ref: Uuid::new_v4(),
                client_id,
                client_ids: HashSet::from([client_id]),
                client_key: client.client_key.clone(),
                created_at: now_millis,
                // The transport call waits only AUTHORIZATION_TTL_MILLIS, but the
                // native request remains actionable so a late local unlock can
                // authorize the next MCP retry without asking for the factor twice.
                expires_at: now_millis.saturating_add(PAIRING_REQUEST_TTL_MILLIS),
            }
        };
        self.pending_unlocks
            .insert(pending.unlock_ref, pending.clone());
        Err(AgentBrokerError::agent_unlock(pending.unlock_ref))
    }

    pub fn pending_unlock_request(
        &mut self,
        now_millis: u64,
    ) -> Option<AgentUnlockRequestSnapshot> {
        self.prune(now_millis);
        self.pending_unlocks.retain(|unlock_ref, request| {
            request.expires_at > now_millis || self.unlock_outcomes.contains_key(unlock_ref)
        });
        self.pending_unlocks
            .values()
            .filter(|request| {
                !self.unlock_outcomes.contains_key(&request.unlock_ref)
                    && !self
                        .access_check
                        .as_ref()
                        .is_some_and(|check| check(request.client_id))
            })
            .min_by_key(|request| request.created_at)
            .map(|request| AgentUnlockRequestSnapshot {
                unlock_ref: request.unlock_ref.to_string(),
                client_id: request.client_id.to_string(),
                client_key: request.client_key.clone(),
                created_at: request.created_at,
                expires_at: request.expires_at,
            })
    }

    pub fn resolve_unlock_request(
        &mut self,
        unlock_ref: &str,
        client_id: Uuid,
        allowed: bool,
        now_millis: u64,
    ) -> Result<(), AgentBrokerError> {
        let unlock_ref = Uuid::parse_str(unlock_ref).map_err(|_| {
            AgentBrokerError::new(
                "invalid-unlock",
                "The MCP unlock request is invalid.",
                false,
            )
        })?;
        let request = self.pending_unlocks.get(&unlock_ref).ok_or_else(|| {
            AgentBrokerError::new(
                "invalid-unlock",
                "The MCP unlock request is unavailable.",
                false,
            )
        })?;
        if request.client_id != client_id {
            return Err(AgentBrokerError::new(
                "invalid-unlock",
                "The MCP unlock request does not belong to this client.",
                false,
            ));
        }
        if request.expires_at <= now_millis {
            self.pending_unlocks.remove(&unlock_ref);
            return Err(AgentBrokerError::new(
                "invalid-unlock",
                "The MCP unlock request has expired.",
                false,
            ));
        }
        self.unlock_outcomes.insert(
            unlock_ref,
            ResolvedPermissionOutcome {
                allowed,
                expires_at: now_millis.saturating_add(AUTHORIZATION_TTL_MILLIS),
            },
        );
        Ok(())
    }

    pub(crate) fn unlock_wait_outcome(
        &mut self,
        unlock_ref: &str,
        client_id: Uuid,
        now_millis: u64,
    ) -> AgentUnlockWaitOutcome {
        let Some(unlock_ref) = Uuid::parse_str(unlock_ref).ok() else {
            return AgentUnlockWaitOutcome::Expired;
        };
        let Some(request) = self.pending_unlocks.get(&unlock_ref) else {
            return AgentUnlockWaitOutcome::Expired;
        };
        if !request.client_ids.contains(&client_id) {
            return AgentUnlockWaitOutcome::Expired;
        }
        if let Some(outcome) = self.unlock_outcomes.get(&unlock_ref) {
            return if outcome.allowed && outcome.expires_at > now_millis {
                AgentUnlockWaitOutcome::Allowed
            } else if outcome.allowed {
                AgentUnlockWaitOutcome::Expired
            } else {
                AgentUnlockWaitOutcome::Denied
            };
        }
        if self
            .access_check
            .as_ref()
            .is_some_and(|check| check(client_id))
        {
            self.unlock_outcomes
                .entry(unlock_ref)
                .or_insert(ResolvedPermissionOutcome {
                    allowed: true,
                    expires_at: now_millis.saturating_add(AUTHORIZATION_TTL_MILLIS),
                });
            return AgentUnlockWaitOutcome::Allowed;
        }
        if request.expires_at > now_millis {
            AgentUnlockWaitOutcome::Pending
        } else {
            AgentUnlockWaitOutcome::Expired
        }
    }

    pub(crate) fn lock_agent_client(&mut self, client_id: Uuid) {
        let affected = self
            .access_lock
            .as_ref()
            .map_or_else(|| vec![client_id], |lock| lock(client_id));
        for affected_id in &affected {
            self.expire_agent_client_authority(*affected_id);
        }
        self.remove_pending_unlock_clients(&affected);
    }

    pub(crate) fn expire_agent_client_authority(&mut self, client_id: Uuid) {
        let session_ids = self
            .sessions
            .values()
            .filter(|session| session.client_id == client_id)
            .map(|session| session.session_id)
            .collect::<Vec<_>>();
        for session_id in session_ids {
            let _ = self.revoke_session(&session_id.to_string());
        }
        self.cleanup_resources(AgentCleanupScope::Client(client_id));
    }

    pub(super) fn remove_pending_unlock_clients(&mut self, client_ids: &[Uuid]) {
        self.pending_unlocks.retain(|_, pending| {
            pending
                .client_ids
                .retain(|client_id| !client_ids.contains(client_id));
            if !pending.client_ids.contains(&pending.client_id)
                && let Some(next) = pending.client_ids.iter().next()
            {
                pending.client_id = *next;
            }
            !pending.client_ids.is_empty()
        });
    }
}
