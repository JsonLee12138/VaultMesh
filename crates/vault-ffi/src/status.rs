use std::panic::{AssertUnwindSafe, catch_unwind};

/// Fixed-width C ABI status value. Values are append-only for ABI v1.
pub type VaultmeshStatus = u32;

pub const VAULTMESH_STATUS_OK: VaultmeshStatus = 0;
pub const VAULTMESH_STATUS_INVALID_ARGUMENT: VaultmeshStatus = 1;
pub const VAULTMESH_STATUS_INCOMPATIBLE_ABI: VaultmeshStatus = 2;
pub const VAULTMESH_STATUS_CORE_ERROR: VaultmeshStatus = 3;
pub const VAULTMESH_STATUS_LOCKED: VaultmeshStatus = 4;
pub const VAULTMESH_STATUS_IO_ERROR: VaultmeshStatus = 5;
pub const VAULTMESH_STATUS_AUTH_FAILED: VaultmeshStatus = 6;
pub const VAULTMESH_STATUS_VAULT_EXISTS: VaultmeshStatus = 7;
pub const VAULTMESH_STATUS_NOT_FOUND: VaultmeshStatus = 8;
pub const VAULTMESH_STATUS_REAUTH_REQUIRED: VaultmeshStatus = 9;
pub const VAULTMESH_STATUS_VALUE_UNAVAILABLE: VaultmeshStatus = 10;
pub const VAULTMESH_STATUS_CONFLICT: VaultmeshStatus = 11;
pub const VAULTMESH_STATUS_PANIC: VaultmeshStatus = 255;

pub(crate) fn check_abi(requested_version: u32) -> Result<(), VaultmeshStatus> {
    if requested_version == crate::ABI_VERSION {
        Ok(())
    } else {
        Err(VAULTMESH_STATUS_INCOMPATIBLE_ABI)
    }
}

/// Contains all Rust unwinding before it can reach a foreign caller.
pub(crate) fn ffi_boundary(operation: impl FnOnce() -> VaultmeshStatus) -> VaultmeshStatus {
    catch_unwind(AssertUnwindSafe(operation)).unwrap_or(VAULTMESH_STATUS_PANIC)
}

#[cfg(test)]
mod tests {
    use super::*;

    // CT-NATIVE-ABI-001: a Rust panic is converted to a stable status.
    #[test]
    fn panic_is_contained_at_the_ffi_boundary() {
        let status = ffi_boundary(|| panic!("contract-test panic"));
        assert_eq!(status, VAULTMESH_STATUS_PANIC);
    }
}
