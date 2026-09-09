/// Runtime operation status value.
pub type VaultmeshStatus = u32;

pub const VAULTMESH_STATUS_OK: VaultmeshStatus = 0;
pub const VAULTMESH_STATUS_INVALID_ARGUMENT: VaultmeshStatus = 1;
pub const VAULTMESH_STATUS_CORE_ERROR: VaultmeshStatus = 3;
pub const VAULTMESH_STATUS_LOCKED: VaultmeshStatus = 4;
pub const VAULTMESH_STATUS_IO_ERROR: VaultmeshStatus = 5;
pub const VAULTMESH_STATUS_AUTH_FAILED: VaultmeshStatus = 6;
pub const VAULTMESH_STATUS_VAULT_EXISTS: VaultmeshStatus = 7;
pub const VAULTMESH_STATUS_NOT_FOUND: VaultmeshStatus = 8;
pub const VAULTMESH_STATUS_REAUTH_REQUIRED: VaultmeshStatus = 9;
pub const VAULTMESH_STATUS_VALUE_UNAVAILABLE: VaultmeshStatus = 10;
pub const VAULTMESH_STATUS_CONFLICT: VaultmeshStatus = 11;
