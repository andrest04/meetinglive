//! Legacy DPAPI: reads blobs written by .NET `ProtectedData.Protect(..., CurrentUser)`.
//! Electron's `safeStorage` cannot read them, so migration goes through here.

#[cfg(windows)]
mod imp {
    use napi::bindgen_prelude::*;
    use napi_derive::napi;
    use windows::{
        core::PWSTR,
        Win32::{
            Foundation::{LocalFree, HLOCAL},
            Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB},
            System::Com::CoTaskMemFree,
        },
    };

    /// Decrypt a legacy `ProtectedData.Protect(..., CurrentUser)` blob (no entropy).
    #[napi]
    pub fn dpapi_unprotect(data: Buffer) -> Result<Buffer> {
        let input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        let mut descr = PWSTR::null();
        // SAFETY: `input` borrows `data` for the call; `output` and `descr` are written by the API.
        unsafe { CryptUnprotectData(&input, Some(&mut descr), None, None, None, 0, &mut output) }
            .map_err(|e| Error::from_reason(format!("CryptUnprotectData: {e}")))?;
        // SAFETY: on success `output` points at `cbData` bytes allocated with LocalAlloc.
        let bytes =
            unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize) }.to_vec();
        // SAFETY: both buffers were allocated by CryptUnprotectData and are freed exactly once.
        unsafe {
            let _ = LocalFree(Some(HLOCAL(output.pbData as _)));
            if !descr.is_null() {
                CoTaskMemFree(Some(descr.0 as _));
            }
        }
        Ok(bytes.into())
    }
}

#[cfg(not(windows))]
mod imp {
    use napi::bindgen_prelude::*;
    use napi_derive::napi;

    #[napi]
    pub fn dpapi_unprotect(_data: Buffer) -> Result<Buffer> {
        Err(Error::from_reason("DPAPI is only available on Windows"))
    }
}

pub use imp::dpapi_unprotect;
