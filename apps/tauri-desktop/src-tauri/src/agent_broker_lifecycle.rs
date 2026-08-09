use super::*;

impl AgentBrokerCore {
    pub fn revoke_all_sessions(&mut self) {
        self.sessions
            .values()
            .for_each(|session| session.cancellation.store(true, Ordering::Release));
        self.sessions.clear();
        self.transport_permission_grants.clear();
        self.confirmations.clear();
        self.permission_requests.clear();
        self.permission_outcomes.clear();
        self.confirmation_outcomes.clear();
        self.remove_all_direct_action_policies();
        self.cleanup_resources(AgentCleanupScope::All);
    }

    pub fn restart_connection_sessions(&mut self, now_millis: u64) {
        let paired_clients = self
            .clients
            .values()
            .filter(|client| client.pairing_state == PairingState::Paired)
            .map(|client| client.client_id)
            .collect::<Vec<_>>();
        self.revoke_all_sessions();
        for client_id in paired_clients {
            let _ = self.ensure_connection_session(client_id, now_millis);
        }
    }

    pub fn suspend_for_vault_lock(&mut self) {
        if let Some(lock) = self.access_lock.as_ref() {
            for client_id in self.clients.keys().copied().collect::<Vec<_>>() {
                let _ = lock(client_id);
            }
        }
        self.revoke_all_sessions();
        self.seen_requests.clear();
        self.connector_definitions.clear();
        self.pending_unlocks.clear();
        self.unlock_outcomes.clear();
    }

    pub fn take_audit(&mut self) -> Option<NewAgentAuditEvent> {
        self.audit_queue.pop()
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn clients(&self) -> Vec<AgentClientSnapshot> {
        let mut clients = self
            .clients
            .keys()
            .filter_map(|client_id| self.client_snapshot(*client_id))
            .collect::<Vec<_>>();
        clients.sort_by_key(|client| client.connected_at);
        clients
    }

    pub fn admin_clients(&self) -> Vec<AgentClientAdminSnapshot> {
        let mut groups = HashMap::<String, AgentClientAdminSnapshot>::new();
        for record in self.pairing_proofs.records() {
            groups.insert(
                record.pairing_ref.clone(),
                AgentClientAdminSnapshot {
                    client_id: record.pairing_ref,
                    client_key: record.client_key,
                    pairing_state: PairingState::Paired,
                    active_session_count: 0,
                    activities: Vec::new(),
                },
            );
        }
        let mut live_clients = self.clients.values().collect::<Vec<_>>();
        live_clients.sort_by_key(|client| client.connected_at);
        for client in live_clients {
            let identity = AgentPairingIdentity {
                client_key: &client.client_key,
                user_id: &client.peer.user_id,
            };
            let group_key = client
                .pairing_ref
                .clone()
                .unwrap_or_else(|| identity.pairing_ref());
            let session_count = self
                .sessions
                .values()
                .filter(|session| session.client_id == client.client_id)
                .count();
            let group = groups
                .entry(group_key)
                .or_insert_with(|| AgentClientAdminSnapshot {
                    client_id: client.client_id.to_string(),
                    client_key: client.client_key.clone(),
                    pairing_state: client.pairing_state,
                    active_session_count: 0,
                    activities: Vec::new(),
                });
            group.active_session_count += session_count;
            group.activities.push(AgentClientActivitySnapshot {
                client_id: client.client_id.to_string(),
                process_id: client.peer.process_id,
                connected_at: client.connected_at,
                active_session_count: session_count,
            });
        }
        let mut clients = groups.into_values().collect::<Vec<_>>();
        for client in &mut clients {
            client
                .activities
                .sort_by_key(|activity| activity.connected_at);
        }
        clients.sort_by(|left, right| left.client_key.cmp(&right.client_key));
        clients
    }

    #[cfg(test)]
    pub fn sessions(&self) -> Vec<ConnectionSessionSnapshot> {
        let mut sessions = self
            .sessions
            .keys()
            .filter_map(|session_id| self.session_snapshot(*session_id))
            .collect::<Vec<_>>();
        sessions.sort_by_key(|session| session.issued_at);
        sessions
    }

    pub fn session(
        &mut self,
        client_id: Uuid,
        now_millis: u64,
    ) -> Result<AgentSessionSnapshot, AgentBrokerError> {
        self.prune(now_millis);
        let pairing_state = self
            .clients
            .get(&client_id)
            .map(|client| client.pairing_state);
        if pairing_state == Some(PairingState::Paired) {
            self.ensure_connection_session(client_id, now_millis)?;
        }
        let client = self.client_snapshot(client_id).ok_or_else(|| {
            AgentBrokerError::new(
                "unknown-client",
                "The Agent client is not connected.",
                false,
            )
        })?;
        let session = self
            .sessions
            .values()
            .filter(|session| session.client_id == client_id)
            .max_by_key(|session| session.issued_at)
            .and_then(|session| self.session_snapshot(session.session_id));
        Ok(AgentSessionSnapshot { client, session })
    }

    pub fn revoke_client(&mut self, client_id: &str) -> Result<(), AgentBrokerError> {
        let live_client = Uuid::parse_str(client_id)
            .ok()
            .and_then(|id| self.clients.get(&id).cloned());
        let persisted_record = live_client
            .as_ref()
            .and_then(|client| client.pairing_ref.as_deref())
            .and_then(|pairing_ref| self.pairing_proofs.record(pairing_ref))
            .or_else(|| self.pairing_proofs.record(client_id));
        let (client_key, user_id, pairing_ref) = if let Some(record) = persisted_record {
            (record.client_key, record.user_id, Some(record.pairing_ref))
        } else if let Some(client) = live_client {
            (client.client_key, client.peer.user_id, client.pairing_ref)
        } else {
            return Err(AgentBrokerError::new(
                "unknown-client",
                "The Agent client is unavailable.",
                false,
            ));
        };
        let matching_clients = self
            .clients
            .iter()
            .filter_map(|(candidate_id, candidate)| {
                (candidate.client_key == client_key && candidate.peer.user_id == user_id)
                    .then_some(*candidate_id)
            })
            .collect::<HashSet<_>>();
        for matching_id in &matching_clients {
            self.clients.remove(matching_id);
        }
        self.sessions.retain(|_, session| {
            let keep = !matching_clients.contains(&session.client_id);
            if !keep {
                session.cancellation.store(true, Ordering::Release);
            }
            keep
        });
        for matching_id in &matching_clients {
            self.transport_permission_grants.remove(matching_id);
            self.remove_direct_action_policies_for_client(*matching_id);
        }
        self.permission_requests
            .retain(|_, request| !matching_clients.contains(&request.client_id));
        for matching_id in matching_clients {
            if let Some(lock) = self.access_lock.as_ref() {
                let _ = lock(matching_id);
            }
            if let Some(disconnect) = self.access_disconnect.as_ref() {
                disconnect(matching_id);
            }
            self.cleanup_resources(AgentCleanupScope::Client(matching_id));
        }
        let authorization_result = self
            .authorization_store
            .as_ref()
            .map_or(Ok(()), |store| store.remove_client(&user_id, &client_key));
        let revoke_result = if let Some(pairing_ref) = pairing_ref {
            self.pairing_proofs.revoke_record(&pairing_ref)
        } else {
            self.pairing_proofs.revoke(&AgentPairingIdentity {
                client_key: &client_key,
                user_id: &user_id,
            })
        };
        revoke_result
            .and(authorization_result)
            .map_err(|_| {
                AgentBrokerError::new(
                    "pairing-revoke-incomplete",
                    "The active Agent client was revoked, but its persisted pairing proof could not be removed.",
                    false,
                )
            })
    }

    pub(crate) fn revoke_session(&mut self, session_id: &str) -> Result<(), AgentBrokerError> {
        let session_id = parse_opaque_id(session_id, "unknown-session")?;
        let result = self.sessions.remove(&session_id).map(|session| {
            session.cancellation.store(true, Ordering::Release);
            if session.connection_managed {
                self.transport_permission_grants.remove(&session.client_id);
                self.remove_direct_action_policies_for_client(session.client_id);
            }
        });
        if result.is_some() {
            self.permission_requests
                .retain(|_, request| request.session_id != session_id);
            self.cleanup_resources(AgentCleanupScope::Session(session_id));
        }
        result.ok_or_else(|| {
            AgentBrokerError::new(
                "unknown-session",
                "The connection session is unavailable.",
                false,
            )
        })
    }

    pub fn disconnect(&mut self, client_id: Uuid) {
        if let Some(disconnect) = self.access_disconnect.as_ref() {
            disconnect(client_id);
        } else if let Some(lock) = self.access_lock.as_ref() {
            let _ = lock(client_id);
        }
        self.clients.remove(&client_id);
        self.sessions.retain(|_, session| {
            let keep = session.client_id != client_id;
            if !keep {
                session.cancellation.store(true, Ordering::Release);
            }
            keep
        });
        self.transport_permission_grants.remove(&client_id);
        self.remove_direct_action_policies_for_client(client_id);
        self.permission_requests
            .retain(|_, request| request.client_id != client_id);
        self.remove_pending_unlock_clients(&[client_id]);
        self.cleanup_resources(AgentCleanupScope::Client(client_id));
    }

    pub fn clear(&mut self) {
        if let Some(lock) = self.access_lock.as_ref() {
            for client_id in self.clients.keys().copied().collect::<Vec<_>>() {
                let _ = lock(client_id);
                if let Some(disconnect) = self.access_disconnect.as_ref() {
                    disconnect(client_id);
                }
            }
        }
        self.sessions
            .values()
            .for_each(|session| session.cancellation.store(true, Ordering::Release));
        self.sessions.clear();
        self.transport_permission_grants.clear();
        self.clients.clear();
        self.pending_pairings.clear();
        self.pending_unlocks.clear();
        self.unlock_outcomes.clear();
        self.seen_requests.clear();
        self.connector_definitions.clear();
        self.confirmations.clear();
        self.permission_requests.clear();
        self.permission_outcomes.clear();
        self.confirmation_outcomes.clear();
        self.audit_queue.clear();
        self.cleanup_resources(AgentCleanupScope::All);
    }
}
