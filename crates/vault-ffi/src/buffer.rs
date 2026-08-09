use std::ptr;

use zeroize::Zeroize;

use crate::{
    VAULTMESH_STATUS_INVALID_ARGUMENT, VAULTMESH_STATUS_OK, VaultmeshStatus, status::ffi_boundary,
};

/// Rust-owned variable-length response buffer.
///
/// Foreign callers may read `data[0..<len]` but must not resize, reallocate,
/// or free it. Pass the struct to `vaultmesh_buffer_destroy` instead.
#[repr(C)]
#[derive(Debug)]
pub struct VaultmeshBuffer {
    pub data: *mut u8,
    pub len: usize,
}

impl Default for VaultmeshBuffer {
    fn default() -> Self {
        Self {
            data: ptr::null_mut(),
            len: 0,
        }
    }
}

impl VaultmeshBuffer {
    pub(crate) fn from_vec(bytes: Vec<u8>) -> Self {
        debug_assert!(!bytes.is_empty());
        let mut owned = bytes.into_boxed_slice();
        let result = Self {
            data: owned.as_mut_ptr(),
            len: owned.len(),
        };
        std::mem::forget(owned);
        result
    }
}

/// Validates writable, empty out-buffer storage and preserves the empty state
/// for every later failure path.
pub(crate) unsafe fn initialize_out_buffer(
    out_buffer: *mut VaultmeshBuffer,
) -> Result<(), VaultmeshStatus> {
    if out_buffer.is_null() {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT);
    }
    // SAFETY: the operation contract requires writable out-buffer storage.
    let out_buffer = unsafe { &mut *out_buffer };
    if !out_buffer.data.is_null() || out_buffer.len != 0 {
        return Err(VAULTMESH_STATUS_INVALID_ARGUMENT);
    }
    *out_buffer = VaultmeshBuffer::default();
    Ok(())
}

fn wipe_bytes(bytes: &mut [u8]) {
    bytes.zeroize();
}

/// Zeroizes and frees a buffer allocated by `vault-ffi`.
///
/// Calling this operation repeatedly on the same struct is supported because
/// the first call replaces it with the stable `{NULL, 0}` empty state.
///
/// # Safety
///
/// `buffer` must be null or point to writable `VaultmeshBuffer` storage. Any
/// non-empty buffer must be an as-yet-undestroyed allocation returned by this
/// library, with its original `data` and `len` unchanged.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn vaultmesh_buffer_destroy(buffer: *mut VaultmeshBuffer) -> VaultmeshStatus {
    ffi_boundary(|| {
        if buffer.is_null() {
            return VAULTMESH_STATUS_INVALID_ARGUMENT;
        }

        // SAFETY: the caller contract requires writable struct storage.
        let buffer = unsafe { &mut *buffer };
        if buffer.data.is_null() {
            return if buffer.len == 0 {
                VAULTMESH_STATUS_OK
            } else {
                VAULTMESH_STATUS_INVALID_ARGUMENT
            };
        }
        if buffer.len == 0 {
            return VAULTMESH_STATUS_INVALID_ARGUMENT;
        }

        let data = buffer.data;
        let len = buffer.len;
        *buffer = VaultmeshBuffer::default();

        // SAFETY: only an unchanged allocation created as Box<[u8]> by this
        // library is accepted by the public ownership contract.
        let raw_slice = ptr::slice_from_raw_parts_mut(data, len);
        let mut owned = unsafe { Box::from_raw(raw_slice) };
        wipe_bytes(owned.as_mut());
        drop(owned);
        VAULTMESH_STATUS_OK
    })
}

#[cfg(test)]
fn owned_buffer(bytes: &[u8]) -> VaultmeshBuffer {
    VaultmeshBuffer::from_vec(bytes.to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;

    // CT-NATIVE-MEMORY-001: verify the wipe primitive before deallocation.
    #[test]
    fn wipe_helper_clears_the_complete_allocation() {
        let mut secret = *b"ffi secret";
        wipe_bytes(&mut secret);
        assert_eq!(secret, [0; 10]);
    }

    // CT-NATIVE-MEMORY-001: matching destroy empties and can be repeated.
    #[test]
    fn owned_buffer_destroy_is_idempotent_after_first_destroy() {
        let mut buffer = owned_buffer(b"sensitive response");
        assert!(!buffer.data.is_null());

        // SAFETY: `buffer` contains the unchanged library-owned allocation.
        assert_eq!(
            unsafe { vaultmesh_buffer_destroy(&mut buffer) },
            VAULTMESH_STATUS_OK
        );
        assert!(buffer.data.is_null());
        assert_eq!(buffer.len, 0);

        // SAFETY: the same writable struct is now in the documented empty state.
        assert_eq!(
            unsafe { vaultmesh_buffer_destroy(&mut buffer) },
            VAULTMESH_STATUS_OK
        );
    }

    #[test]
    fn invalid_buffer_arguments_fail_without_freeing_unknown_memory() {
        // SAFETY: null is an explicitly handled invalid argument.
        assert_eq!(
            unsafe { vaultmesh_buffer_destroy(ptr::null_mut()) },
            VAULTMESH_STATUS_INVALID_ARGUMENT
        );

        let mut invalid = VaultmeshBuffer {
            data: ptr::null_mut(),
            len: 1,
        };
        // SAFETY: the struct is writable; the invalid fields are rejected before access.
        assert_eq!(
            unsafe { vaultmesh_buffer_destroy(&mut invalid) },
            VAULTMESH_STATUS_INVALID_ARGUMENT
        );
    }
}
