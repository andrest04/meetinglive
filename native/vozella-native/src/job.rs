//! Windows Job Object that kills its processes when the addon's host process dies.
//!
//! The llama-server sidecar is assigned to one job created with
//! `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. The job handle is never closed by us, so the OS
//! closes it when the Electron main process exits for any reason, including a hard crash,
//! and terminates every process still in the job.

#[cfg(windows)]
mod imp {
    use std::sync::OnceLock;

    use napi::bindgen_prelude::*;
    use napi_derive::napi;
    use windows::Win32::{
        Foundation::{CloseHandle, HANDLE},
        System::{
            JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            },
            Threading::{OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE},
        },
    };

    /// The job handle as an integer so the static is `Send + Sync`. Held for the process lifetime.
    static JOB: OnceLock<std::result::Result<isize, String>> = OnceLock::new();

    fn create_job() -> std::result::Result<isize, String> {
        // SAFETY: no security attributes and no name; the returned handle is owned by the static.
        let job = unsafe { CreateJobObjectW(None, None) }
            .map_err(|e| format!("CreateJobObjectW: {e}"))?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        // SAFETY: `info` is a live, correctly sized struct for the extended limit class.
        let set = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                std::ptr::from_ref(&info).cast(),
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            )
        };
        if let Err(e) = set {
            // SAFETY: `job` was created above and is not shared yet.
            let _ = unsafe { CloseHandle(job) };
            return Err(format!("SetInformationJobObject: {e}"));
        }
        Ok(job.0 as isize)
    }

    /// Put `pid` in the kill-on-close job. Throws when the process cannot be opened or assigned.
    #[napi]
    pub fn assign_to_kill_on_close_job(pid: u32) -> Result<()> {
        let job = JOB
            .get_or_init(create_job)
            .clone()
            .map_err(Error::from_reason)?;
        // SAFETY: plain OpenProcess; the handle is closed below on every path.
        let process = unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) }
            .map_err(|e| Error::from_reason(format!("OpenProcess({pid}): {e}")))?;
        // SAFETY: `job` is a live job handle kept by the static; `process` was opened above.
        let assigned = unsafe { AssignProcessToJobObject(HANDLE(job as _), process) };
        // SAFETY: `process` is owned here and closed exactly once.
        let _ = unsafe { CloseHandle(process) };
        assigned.map_err(|e| Error::from_reason(format!("AssignProcessToJobObject({pid}): {e}")))
    }
}

#[cfg(not(windows))]
mod imp {
    use napi::bindgen_prelude::*;
    use napi_derive::napi;

    #[napi]
    pub fn assign_to_kill_on_close_job(_pid: u32) -> Result<()> {
        Err(Error::from_reason(
            "Job objects are only available on Windows",
        ))
    }
}

pub use imp::assign_to_kill_on_close_job;
