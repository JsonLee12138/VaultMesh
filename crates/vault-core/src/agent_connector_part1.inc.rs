use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zeroize::Zeroize;

use crate::VaultError;

const MAX_LABEL_CHARS: usize = 128;
const MAX_TARGET_CHARS: usize = 2_048;
const MAX_POLICY_ENTRIES: usize = 64;
const MAX_CREDENTIAL_REFS: usize = 16;
const MAX_OUTPUT_BYTES: u32 = 256 * 1024;
pub(crate) const MAX_AGENT_AUDIT_EVENTS: usize = 500;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentConnectorKind {
    Ssh,
    ManagedWeb,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub enum AgentRiskTier {
    R0,
    R1,
    R2,
    R3,
    R4,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentCredentialKind {
    Login,
    Ssh,
    Secret,
    Email,
    Passkey,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentHttpAuthStrategy {
    Bearer,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentHttpBodyMode {
    #[default]
    Json,
    Empty,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentHttpOperationPolicy {
    pub name: String,
    pub method: String,
    pub path: String,
    pub request_fields: Vec<String>,
    pub response_fields: Vec<String>,
    #[serde(default)]
    pub request_mode: AgentHttpBodyMode,
    #[serde(default)]
    pub response_mode: AgentHttpBodyMode,
    pub risk: AgentRiskTier,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentSshTunnelPolicy {
    pub name: String,
    pub local_host: String,
    pub local_port: u16,
    pub destination_host: String,
    pub destination_port: u16,
    pub max_connections: u8,
    pub ttl_millis: u64,
    pub risk: AgentRiskTier,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentWebRecipeKind {
    Login,
    Navigate,
    Extract,
    Action,
    Download,
    Totp,
    EmailOtp,
    RecoveryCode,
    PasskeyRegistration,
    PasskeyAssertion,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentWebFieldSource {
    Text,
    Href,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentWebFieldPolicy {
    pub name: String,
    pub selector: String,
    pub source: AgentWebFieldSource,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentWebInputPolicy {
    pub name: String,
    pub selector: String,
    pub max_length: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentWebRecipePolicy {
    pub name: String,
    pub kind: AgentWebRecipeKind,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username_selector: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password_selector: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submit_selector: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub success_selector: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_selector: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selector: Option<String>,
    #[serde(default)]
    pub fields: Vec<AgentWebFieldPolicy>,
    #[serde(default)]
    pub inputs: Vec<AgentWebInputPolicy>,
    pub risk: AgentRiskTier,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentCredentialRef {
    pub kind: AgentCredentialKind,
    pub item_id: Uuid,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(
    tag = "connector",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum AgentTargetPolicy {
    Ssh {
        host: String,
        port: u16,
        host_key_sha256: String,
        tunnel_policies: Vec<AgentSshTunnelPolicy>,
    },
    ManagedWeb {
        origins: Vec<String>,
        recipes: Vec<AgentWebRecipePolicy>,
        persist_session: bool,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentCapabilityPolicy {
    pub allowed_tools: Vec<String>,
    pub risk_ceiling: AgentRiskTier,
    pub destructive_enabled: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentOutputPolicy {
    pub allowed_fields: Vec<String>,
    pub max_bytes: u32,
    pub max_items: u32,
    pub disclose_target: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewAgentConnectorDefinition {
    pub display_label: String,
    pub environment: String,
    pub connector_kind: AgentConnectorKind,
    pub credential_refs: Vec<AgentCredentialRef>,
    pub target_policy: AgentTargetPolicy,
    pub capability_policy: AgentCapabilityPolicy,
    pub output_policy: AgentOutputPolicy,
    pub enabled: bool,
}

#[derive(Clone, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentConnectorDefinition {
    pub id: Uuid,
    pub display_label: String,
    pub environment: String,
    pub connector_kind: AgentConnectorKind,
    pub credential_refs: Vec<AgentCredentialRef>,
    pub target_policy: AgentTargetPolicy,
    pub capability_policy: AgentCapabilityPolicy,
    pub output_policy: AgentOutputPolicy,
    pub enabled: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

impl std::fmt::Debug for AgentConnectorDefinition {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AgentConnectorDefinition")
            .field("id", &self.id)
            .field("display_label", &self.display_label)
            .field("environment", &self.environment)
            .field("connector_kind", &self.connector_kind)
            .field("credential_ref_count", &self.credential_refs.len())
            .field("target_policy", &"[ENCRYPTED POLICY]")
            .field("capability_policy", &self.capability_policy)
            .field("output_policy", &self.output_policy)
            .field("enabled", &self.enabled)
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .finish()
    }
}

impl Zeroize for AgentConnectorDefinition {
    fn zeroize(&mut self) {
        self.display_label.zeroize();
        self.environment.zeroize();
        self.credential_refs.clear();
        zeroize_target_policy(&mut self.target_policy);
        self.capability_policy
            .allowed_tools
            .iter_mut()
            .for_each(Zeroize::zeroize);
        self.capability_policy.allowed_tools.clear();
        self.output_policy
            .allowed_fields
            .iter_mut()
            .for_each(Zeroize::zeroize);
        self.output_policy.allowed_fields.clear();
        self.enabled = false;
    }
}

impl Drop for AgentConnectorDefinition {
    fn drop(&mut self) {
        self.zeroize();
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentConnectorDefinitionSummary {
    pub id: Uuid,
    pub display_label: String,
    pub environment: String,
    pub connector_kind: AgentConnectorKind,
    pub capability_names: Vec<String>,
    pub enabled: bool,
    pub health: AgentConnectorDefinitionHealth,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentConnectorDefinitionHealth {
    Ready,
    Disabled,
    ReapprovalRequired,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentAuditDecision {
    Allowed,
    Denied,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentAuditResultClass {
    Succeeded,
    Denied,
    Failed,
    Cancelled,
    Unavailable,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AgentAuditConfirmation {
    None,
    Session,
    Fresh,
    Privileged,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewAgentAuditEvent {
    pub occurred_at: u64,
    pub client_id: Uuid,
    pub client_kind: String,
    pub session_id: Uuid,
    pub account_ref: Uuid,
    pub account_label: String,
    pub environment: String,
    pub tool: String,
    pub target_class: String,
    pub approved_display: String,
    pub risk: AgentRiskTier,
    pub decision: AgentAuditDecision,
    pub confirmation: AgentAuditConfirmation,
    pub duration_millis: u64,
    pub result_class: AgentAuditResultClass,
    pub status_class: Option<String>,
    pub item_count: u32,
    pub byte_count: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AgentAuditEvent {
    pub event_id: Uuid,
    #[serde(flatten)]
    pub event: NewAgentAuditEvent,
}

impl Zeroize for AgentAuditEvent {
    fn zeroize(&mut self) {
        self.event.client_kind.zeroize();
        self.event.account_label.zeroize();
        self.event.environment.zeroize();
        self.event.tool.zeroize();
        self.event.target_class.zeroize();
        self.event.approved_display.zeroize();
        self.event.status_class.zeroize();
    }
}

pub fn validate_agent_audit(event: &NewAgentAuditEvent) -> Result<(), VaultError> {
    let valid = event.occurred_at > 0
        && valid_audit_text(&event.client_kind, 128)
        && valid_audit_text(&event.account_label, 128)
        && valid_audit_text(&event.environment, 128)
        && event.tool.starts_with("vaultmesh_")
        && valid_audit_text(&event.tool, 128)
        && valid_audit_text(&event.target_class, 128)
        && valid_audit_text(&event.approved_display, 256)
        && event
            .status_class
            .as_deref()
            .is_none_or(|status| valid_audit_text(status, 64));
    if valid {
        Ok(())
    } else {
        Err(VaultError::InvalidAgentAudit)
    }
}

fn valid_audit_text(value: &str, maximum: usize) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= maximum
        && !value.chars().any(char::is_control)
        && !value.contains("../")
        && !value.contains("\\..\\")
}

impl From<&AgentConnectorDefinition> for AgentConnectorDefinitionSummary {
    fn from(definition: &AgentConnectorDefinition) -> Self {
        Self {
            id: definition.id,
            display_label: definition.display_label.clone(),
            environment: definition.environment.clone(),
            connector_kind: definition.connector_kind,
            capability_names: definition.capability_policy.allowed_tools.clone(),
            enabled: definition.enabled,
            health: if definition.enabled {
                AgentConnectorDefinitionHealth::Ready
            } else {
                AgentConnectorDefinitionHealth::Disabled
            },
        }
    }
}
