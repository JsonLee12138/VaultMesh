//! Stable native boundary shared by the SwiftUI/AppKit and WinUI clients.
//!
//! ABI v1 deliberately exposes C operations and owned byte buffers rather
//! than Rust layouts. See `include/vaultmesh.h` for the platform binding.

mod browser_ops;
mod buffer;
mod input;
mod items;
mod privileged;
mod runtime;
mod status;
mod storage;
mod vault;

pub use browser_ops::vaultmesh_browser_core_operation;
pub use buffer::{VaultmeshBuffer, vaultmesh_buffer_destroy};
pub use input::VaultmeshBytes;
pub use items::{
    VAULTMESH_ITEM_KIND_IDENTITY, VAULTMESH_ITEM_KIND_LOGIN, VAULTMESH_ITEM_KIND_PAYMENT_CARD,
    VAULTMESH_ITEM_KIND_SECRET, VAULTMESH_ITEM_KIND_SSH_CREDENTIAL,
    VAULTMESH_ITEM_METADATA_SCHEMA_VERSION, vaultmesh_item_detail, vaultmesh_items_list,
};
pub use privileged::{
    VAULTMESH_PROTECTED_FIELD_CARD_NUMBER, VAULTMESH_PROTECTED_FIELD_CARD_PIN,
    VAULTMESH_PROTECTED_FIELD_CARD_SECURITY_CODE, VAULTMESH_PROTECTED_FIELD_LOGIN_PASSWORD,
    VAULTMESH_PROTECTED_FIELD_LOGIN_TOTP, VAULTMESH_PROTECTED_FIELD_SECRET_VALUE,
    VAULTMESH_PROTECTED_FIELD_SSH_KEY_PASSPHRASE, VAULTMESH_PROTECTED_FIELD_SSH_PASSWORD,
    VAULTMESH_PROTECTED_FIELD_SSH_PRIVATE_KEY, VAULTMESH_PROTECTED_FIELD_SSH_PUBLIC_KEY,
    vaultmesh_item_protected_value,
};
pub use runtime::{
    DesktopRuntime, DesktopRuntimeError, DesktopRuntimeStatus, ManagedSshHostKeyMaterial,
};
pub use status::{
    VAULTMESH_STATUS_AUTH_FAILED, VAULTMESH_STATUS_CONFLICT, VAULTMESH_STATUS_CORE_ERROR,
    VAULTMESH_STATUS_INCOMPATIBLE_ABI, VAULTMESH_STATUS_INVALID_ARGUMENT,
    VAULTMESH_STATUS_IO_ERROR, VAULTMESH_STATUS_LOCKED, VAULTMESH_STATUS_NOT_FOUND,
    VAULTMESH_STATUS_OK, VAULTMESH_STATUS_PANIC, VAULTMESH_STATUS_REAUTH_REQUIRED,
    VAULTMESH_STATUS_VALUE_UNAVAILABLE, VAULTMESH_STATUS_VAULT_EXISTS, VaultmeshStatus,
};
pub use vault::{
    VaultmeshVault, vaultmesh_vault_create, vaultmesh_vault_destroy, vaultmesh_vault_lock,
    vaultmesh_vault_quick_unlock_key, vaultmesh_vault_status, vaultmesh_vault_unlock,
    vaultmesh_vault_unlock_with_key,
};
pub use vaultmesh_core::{
    AgentAuditConfirmation, AgentAuditDecision, AgentAuditEvent, AgentAuditResultClass,
    AgentCapabilityPolicy, AgentConnectorDefinition, AgentConnectorDefinitionSummary,
    AgentConnectorKind, AgentCredentialKind, AgentCredentialRef, AgentHttpAuthStrategy,
    AgentHttpBodyMode, AgentHttpOperationPolicy, AgentOutputPolicy, AgentRiskTier,
    AgentSshTunnelPolicy, AgentTargetPolicy, AgentWebFieldPolicy, AgentWebFieldSource,
    AgentWebInputPolicy, AgentWebRecipeKind, AgentWebRecipePolicy, ApiKeyLocation,
    ApiRequestAuthenticationMaterial, ApiRequestBodyInput, ApiRequestExecutionPlan,
    ApiRequestInput, ApiRequestPair, ApiRequestPlanSummary, ApiRequestValueMaterial,
    NewAgentAuditEvent, NewAgentConnectorDefinition, validate_agent_audit,
};

use status::ffi_boundary;

/// Native ABI major version. ABI v1 is fail-closed on any version mismatch.
pub const ABI_VERSION: u32 = 1;

/// Returns the ABI version without requiring a negotiated request.
#[unsafe(no_mangle)]
pub extern "C" fn vaultmesh_abi_version() -> u32 {
    ABI_VERSION
}

/// Checks whether a caller can invoke ABI v1 operations.
#[unsafe(no_mangle)]
pub extern "C" fn vaultmesh_abi_check(requested_version: u32) -> VaultmeshStatus {
    ffi_boundary(|| {
        status::check_abi(requested_version).map_or_else(|status| status, |()| VAULTMESH_STATUS_OK)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exported_version_matches_the_rust_constant() {
        assert_eq!(vaultmesh_abi_version(), ABI_VERSION);
    }

    #[test]
    fn abi_check_fails_closed_on_version_mismatch() {
        assert_eq!(vaultmesh_abi_check(ABI_VERSION), VAULTMESH_STATUS_OK);
        assert_eq!(
            vaultmesh_abi_check(ABI_VERSION + 1),
            VAULTMESH_STATUS_INCOMPATIBLE_ABI
        );
    }
}
