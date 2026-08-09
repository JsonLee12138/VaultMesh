use std::{slice, str};

use crate::{VAULTMESH_STATUS_INVALID_ARGUMENT, VaultmeshStatus};

/// Borrowed byte view valid only for the duration of an ABI operation.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct VaultmeshBytes {
    pub data: *const u8,
    pub len: usize,
}

impl VaultmeshBytes {
    /// # Safety
    ///
    /// A non-empty view must reference readable memory for the returned
    /// lifetime. The foreign caller retains ownership of the bytes.
    pub(crate) unsafe fn as_slice<'a>(self) -> Result<&'a [u8], VaultmeshStatus> {
        if self.data.is_null() {
            return if self.len == 0 {
                Ok(&[])
            } else {
                Err(VAULTMESH_STATUS_INVALID_ARGUMENT)
            };
        }

        // SAFETY: guaranteed by the foreign caller contract above.
        Ok(unsafe { slice::from_raw_parts(self.data, self.len) })
    }

    /// # Safety
    ///
    /// The same requirements as `as_slice` apply. The bytes must also be
    /// valid UTF-8 for the duration of the returned borrow.
    pub(crate) unsafe fn as_utf8<'a>(self) -> Result<&'a str, VaultmeshStatus> {
        // SAFETY: forwarded from this operation's caller contract.
        let bytes = unsafe { self.as_slice()? };
        str::from_utf8(bytes).map_err(|_| VAULTMESH_STATUS_INVALID_ARGUMENT)
    }
}
