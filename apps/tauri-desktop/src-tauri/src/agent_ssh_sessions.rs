use std::{
    collections::HashMap,
    sync::atomic::{AtomicBool, Ordering},
};

use serde_json::{Value, json};
use zeroize::Zeroizing;

use crate::{
    agent_broker::AgentExecutionScope,
    ssh_service::{AgentSshPtyRequest, AgentSshPtySession, AgentSshTunnel, AgentSshTunnelRequest},
};

const MAX_SESSIONS: usize = 8;
const MAX_SESSIONS_PER_LEASE: usize = 2;
const MAX_READ_BYTES: usize = 32 * 1024;
const MAX_WRITE_BYTES: usize = 16 * 1024;

#[derive(Default)]
pub(crate) struct AgentSshSessionStore {
    sessions: HashMap<String, StoredPtySession>,
    tunnels: HashMap<String, StoredTunnel>,
}

struct StoredPtySession {
    client_id: uuid::Uuid,
    session_id: uuid::Uuid,
    account_ref: String,
    generation: u64,
    sequence: u64,
    cumulative_output_bytes: usize,
    output_limit: usize,
    canaries: Zeroizing<Vec<String>>,
    session: AgentSshPtySession,
}

struct StoredTunnel {
    client_id: uuid::Uuid,
    session_id: uuid::Uuid,
    account_ref: String,
    tunnel: AgentSshTunnel,
}

impl AgentSshSessionStore {
    pub(crate) fn open_tunnel(
        &mut self,
        request: AgentSshTunnelRequest,
        scope: &AgentExecutionScope,
        account_ref: &str,
        now_millis: u64,
        cancellation: &AtomicBool,
    ) -> Result<Value, &'static str> {
        self.prune(now_millis);
        if self.sessions.len().saturating_add(self.tunnels.len()) >= MAX_SESSIONS
            || self
                .tunnels
                .values()
                .any(|tunnel| tunnel.session_id == scope.session_id)
        {
            return Err("ssh-pty-quota-exceeded");
        }
        let tunnel = crate::ssh_service::open_agent_tunnel(request, now_millis, cancellation)
            .map_err(|_| "ssh-operation-failed")?;
        let session_ref = format!("tun_{}", uuid::Uuid::new_v4().simple());
        let result = json!({
            "sessionRef": session_ref,
            "status": "listening",
            "localHost": tunnel.local_host,
            "localPort": tunnel.local_port,
            "expiresAt": tunnel.expires_at
        });
        self.tunnels.insert(
            session_ref,
            StoredTunnel {
                client_id: scope.client_id,
                session_id: scope.session_id,
                account_ref: account_ref.to_owned(),
                tunnel,
            },
        );
        Ok(result)
    }

    pub(crate) fn open(
        &mut self,
        request: AgentSshPtyRequest,
        terminal: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
        cancellation: &AtomicBool,
    ) -> Result<Value, &'static str> {
        if self.sessions.len() >= MAX_SESSIONS
            || self
                .sessions
                .values()
                .filter(|session| session.session_id == scope.session_id)
                .count()
                >= MAX_SESSIONS_PER_LEASE
        {
            return Err("ssh-pty-quota-exceeded");
        }
        if !valid_terminal(terminal) || cancellation.load(Ordering::Acquire) {
            return Err("invalid-parameters");
        }
        let output_limit = request.max_output_bytes;
        let canaries = request.authentication_canaries();
        let session = AgentSshPtySession::open(request, terminal, 80, 24, cancellation)
            .map_err(|_| "ssh-operation-failed")?;
        if cancellation.load(Ordering::Acquire) {
            return Err("session-cancelled");
        }
        let session_ref = format!("pty_{}", uuid::Uuid::new_v4().simple());
        self.sessions.insert(
            session_ref.clone(),
            StoredPtySession {
                client_id: scope.client_id,
                session_id: scope.session_id,
                account_ref: account_ref.to_owned(),
                generation: 1,
                sequence: 0,
                cumulative_output_bytes: 0,
                output_limit,
                canaries: Zeroizing::new(canaries),
                session,
            },
        );
        Ok(json!({
            "sessionRef": session_ref,
            "generation": 1,
            "sequence": 0,
            "terminal": terminal,
            "columns": 80,
            "rows": 24
        }))
    }

    pub(crate) fn read(
        &mut self,
        session_ref: &str,
        after_sequence: u64,
        scope: &AgentExecutionScope,
        account_ref: &str,
        cancellation: &AtomicBool,
    ) -> Result<Value, &'static str> {
        let session = self.bound_session_mut(session_ref, scope, account_ref)?;
        if after_sequence != session.sequence {
            return Err("ssh-pty-sequence-mismatch");
        }
        if cancellation.load(Ordering::Acquire) {
            return Err("session-cancelled");
        }
        let remaining = session
            .output_limit
            .saturating_sub(session.cumulative_output_bytes);
        if remaining == 0 {
            return Err("ssh-pty-output-quota-exceeded");
        }
        let maximum = remaining.min(MAX_READ_BYTES);
        let (raw, eof, exit_status) = session
            .session
            .read_available(maximum)
            .map_err(|_| "ssh-operation-failed")?;
        let sanitized = sanitize_terminal_output(&raw);
        let output = redact_canaries(&String::from_utf8_lossy(&sanitized), &session.canaries);
        session.cumulative_output_bytes = session.cumulative_output_bytes.saturating_add(raw.len());
        if !output.is_empty() || eof {
            session.sequence = session.sequence.saturating_add(1);
        }
        Ok(json!({
            "sessionRef": session_ref,
            "generation": session.generation,
            "sequence": session.sequence,
            "output": output,
            "eof": eof,
            "exitStatus": exit_status,
            "truncated": raw.len() >= maximum
        }))
    }

    pub(crate) fn write(
        &mut self,
        session_ref: &str,
        input: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
        cancellation: &AtomicBool,
    ) -> Result<Value, &'static str> {
        if input.is_empty() || input.len() > MAX_WRITE_BYTES || input.contains('\0') {
            return Err("invalid-parameters");
        }
        let session = self.bound_session_mut(session_ref, scope, account_ref)?;
        if cancellation.load(Ordering::Acquire) {
            return Err("session-cancelled");
        }
        session
            .session
            .write_all(input.as_bytes(), cancellation)
            .map_err(|_| "ssh-operation-failed")?;
        Ok(json!({
            "sessionRef": session_ref,
            "generation": session.generation,
            "acceptedSequence": session.sequence
        }))
    }

    pub(crate) fn resize(
        &mut self,
        session_ref: &str,
        columns: u32,
        rows: u32,
        scope: &AgentExecutionScope,
        account_ref: &str,
    ) -> Result<Value, &'static str> {
        if !(20..=500).contains(&columns) || !(5..=200).contains(&rows) {
            return Err("invalid-parameters");
        }
        let session = self.bound_session_mut(session_ref, scope, account_ref)?;
        session
            .session
            .resize(columns, rows)
            .map_err(|_| "ssh-operation-failed")?;
        Ok(json!({
            "sessionRef": session_ref,
            "generation": session.generation,
            "columns": columns,
            "rows": rows
        }))
    }

    pub(crate) fn close(
        &mut self,
        session_ref: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
    ) -> Result<Value, &'static str> {
        self.bound_session(session_ref, scope, account_ref)?;
        let mut session = self
            .sessions
            .remove(session_ref)
            .ok_or("ssh-pty-session-unavailable")?;
        let exit_status = session.session.close();
        Ok(json!({
            "sessionRef": session_ref,
            "generation": session.generation,
            "closed": true,
            "exitStatus": exit_status
        }))
    }

    pub(crate) fn revoke_client(&mut self, client_id: uuid::Uuid) {
        self.sessions
            .retain(|_, session| session.client_id != client_id);
        self.tunnels
            .retain(|_, tunnel| tunnel.client_id != client_id);
    }

    pub(crate) fn revoke_session(&mut self, session_id: uuid::Uuid) {
        self.sessions
            .retain(|_, session| session.session_id != session_id);
        self.tunnels
            .retain(|_, tunnel| tunnel.session_id != session_id);
    }

    pub(crate) fn clear(&mut self) {
        self.sessions.clear();
        self.tunnels.clear();
    }

    pub(crate) fn prune(&mut self, now_millis: u64) {
        self.tunnels.retain(|_, tunnel| {
            !tunnel.account_ref.is_empty() && tunnel.tunnel.expires_at > now_millis
        });
    }

    fn bound_session(
        &self,
        session_ref: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
    ) -> Result<&StoredPtySession, &'static str> {
        self.sessions
            .get(session_ref)
            .filter(|session| {
                session.client_id == scope.client_id
                    && session.session_id == scope.session_id
                    && session.account_ref == account_ref
            })
            .ok_or("ssh-pty-session-unavailable")
    }

    fn bound_session_mut(
        &mut self,
        session_ref: &str,
        scope: &AgentExecutionScope,
        account_ref: &str,
    ) -> Result<&mut StoredPtySession, &'static str> {
        self.sessions
            .get_mut(session_ref)
            .filter(|session| {
                session.client_id == scope.client_id
                    && session.session_id == scope.session_id
                    && session.account_ref == account_ref
            })
            .ok_or("ssh-pty-session-unavailable")
    }
}

fn valid_terminal(terminal: &str) -> bool {
    matches!(terminal, "xterm-256color" | "xterm" | "vt100")
}

fn redact_canaries(output: &str, canaries: &[String]) -> String {
    let mut redacted = output.to_owned();
    for canary in canaries.iter().filter(|canary| !canary.is_empty()) {
        for representation in [
            canary.clone(),
            base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                canary.as_bytes(),
            ),
            canary
                .as_bytes()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect(),
        ] {
            redacted = redacted.replace(&representation, "[REDACTED]");
        }
    }
    redacted
}

#[derive(Clone, Copy)]
enum EscapeState {
    Ground,
    Escape,
    Csi,
    String,
    StringEscape,
}

fn sanitize_terminal_output(input: &[u8]) -> Vec<u8> {
    let mut output = Vec::with_capacity(input.len());
    let mut state = EscapeState::Ground;
    for &byte in input {
        state = match state {
            EscapeState::Ground => match byte {
                0x1b => EscapeState::Escape,
                0x90 | 0x9d | 0x9e | 0x9f => EscapeState::String,
                0x9b => EscapeState::Csi,
                b'\n' | b'\r' | b'\t' | 0x08 => {
                    output.push(byte);
                    EscapeState::Ground
                }
                0x00..=0x1f | 0x7f..=0x9f => EscapeState::Ground,
                _ => {
                    output.push(byte);
                    EscapeState::Ground
                }
            },
            EscapeState::Escape => match byte {
                b'[' => EscapeState::Csi,
                b']' | b'P' | b'X' | b'^' | b'_' => EscapeState::String,
                _ => EscapeState::Ground,
            },
            EscapeState::Csi => {
                if (0x40..=0x7e).contains(&byte) {
                    EscapeState::Ground
                } else {
                    EscapeState::Csi
                }
            }
            EscapeState::String => match byte {
                0x07 => EscapeState::Ground,
                0x1b => EscapeState::StringEscape,
                _ => EscapeState::String,
            },
            EscapeState::StringEscape => {
                if byte == b'\\' {
                    EscapeState::Ground
                } else if byte == 0x1b {
                    EscapeState::StringEscape
                } else {
                    EscapeState::String
                }
            }
        };
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ct_agent_pty_strips_csi_osc_dcs_and_osc52_payloads() {
        let input = b"safe\x1b[31mred\x1b[0m\x1b]52;c;c2VjcmV0\x07\x1bPprivate\x1b\\done\n";
        let output = String::from_utf8(sanitize_terminal_output(input)).unwrap();
        assert_eq!(output, "safereddone\n");
        assert!(!output.contains("c2VjcmV0"));
        assert!(!output.contains("private"));
    }

    #[test]
    fn ct_agent_pty_terminal_and_secret_output_are_fail_closed() {
        assert!(valid_terminal("xterm-256color"));
        assert!(!valid_terminal("xterm;printenv"));
        let redacted = redact_canaries(
            "plain=canary encoded=Y2FuYXJ5 hex=63616e617279",
            &["canary".into()],
        );
        assert!(!redacted.contains("canary"));
        assert!(!redacted.contains("Y2FuYXJ5"));
        assert!(!redacted.contains("63616e617279"));
    }
}
