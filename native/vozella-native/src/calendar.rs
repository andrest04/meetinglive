//! Calendar probe over the WinRT AppointmentStore. Only counts are ever returned,
//! never event content: this is a capability probe, not a reader.

use napi::bindgen_prelude::*;
use napi_derive::napi;

#[napi(object)]
pub struct CalendarProbe {
    pub has_identity: bool,
    pub package_full_name: Option<String>,
    /// "ok" or "error"
    pub status: String,
    /// HRESULT as hex, when status is "error"
    pub hresult: Option<String>,
    pub error: Option<String>,
    pub calendar_count: Option<u32>,
    /// Events in the next 7 days across all calendars (count only).
    pub upcoming_event_count: Option<u32>,
}

#[cfg(windows)]
mod imp {
    use super::CalendarProbe;
    use windows::{
        core::PWSTR,
        ApplicationModel::Appointments::{AppointmentManager, AppointmentStoreAccessType},
        Foundation::{DateTime, TimeSpan},
        Win32::{
            Foundation::WIN32_ERROR,
            Storage::Packaging::Appx::GetCurrentPackageFullName,
            System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED},
        },
    };

    const APPMODEL_ERROR_NO_PACKAGE: u32 = 15700;
    const DAY_TICKS: i64 = 24 * 60 * 60 * 10_000_000;
    const UNIX_EPOCH_TICKS: i64 = 116_444_736_000_000_000;

    /// Package full name of the current process, or None when running unpackaged.
    fn package_full_name() -> Option<String> {
        let mut len: u32 = 0;
        // SAFETY: a null buffer asks the API for the required length.
        let rc = unsafe { GetCurrentPackageFullName(&mut len, None) };
        if rc == WIN32_ERROR(APPMODEL_ERROR_NO_PACKAGE) {
            return None;
        }
        let mut buf = vec![0u16; len as usize];
        // SAFETY: `buf` holds `len` UTF-16 units as the API requested.
        let rc = unsafe { GetCurrentPackageFullName(&mut len, Some(PWSTR(buf.as_mut_ptr()))) };
        if rc.0 != 0 {
            return None;
        }
        buf.truncate(len.saturating_sub(1) as usize);
        Some(String::from_utf16_lossy(&buf))
    }

    fn read_counts() -> windows::core::Result<(u32, u32)> {
        // The worker thread owns its apartment; ignore "already initialized".
        // SAFETY: plain COM initialization for this thread.
        let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
        let store = AppointmentManager::RequestStoreAsync(
            AppointmentStoreAccessType::AllCalendarsReadOnly,
        )?
        .join()?;
        let calendars = store.FindAppointmentCalendarsAsync()?.join()?;
        let now_ticks = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as i64 / 100)
            .unwrap_or(0)
            + UNIX_EPOCH_TICKS;
        let (start, span) = (
            DateTime {
                UniversalTime: now_ticks,
            },
            TimeSpan {
                Duration: 7 * DAY_TICKS,
            },
        );
        let mut events = 0u32;
        for cal in &calendars {
            events += cal.FindAppointmentsAsync(start, span)?.join()?.Size()?;
        }
        Ok((calendars.Size()?, events))
    }

    pub fn probe() -> CalendarProbe {
        let name = package_full_name();
        let mut out = CalendarProbe {
            has_identity: name.is_some(),
            package_full_name: name,
            status: "ok".into(),
            hresult: None,
            error: None,
            calendar_count: None,
            upcoming_event_count: None,
        };
        match read_counts() {
            Ok((c, e)) => {
                out.calendar_count = Some(c);
                out.upcoming_event_count = Some(e);
            }
            Err(e) => {
                out.status = "error".into();
                out.hresult = Some(format!("0x{:08X}", e.code().0 as u32));
                out.error = Some(e.message());
            }
        }
        out
    }
}

#[cfg(not(windows))]
mod imp {
    use super::CalendarProbe;

    pub fn probe() -> CalendarProbe {
        CalendarProbe {
            has_identity: false,
            package_full_name: None,
            status: "error".into(),
            hresult: None,
            error: Some("calendar probe is only available on Windows".into()),
            calendar_count: None,
            upcoming_event_count: None,
        }
    }
}

pub struct CalendarProbeTask;

impl Task for CalendarProbeTask {
    type Output = CalendarProbe;
    type JsValue = CalendarProbe;
    fn compute(&mut self) -> Result<Self::Output> {
        Ok(imp::probe())
    }
    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        Ok(output)
    }
}

/// Runs on the libuv pool so blocking on WinRT async never touches the UI thread.
#[napi]
pub fn probe_calendars_async() -> AsyncTask<CalendarProbeTask> {
    AsyncTask::new(CalendarProbeTask)
}
