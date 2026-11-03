//! Microphone list and render-session snapshots (spec 3.1.5 and 3.4.1).

use napi::bindgen_prelude::*;
use napi_derive::napi;
use wasapi::{
    initialize_mta, AudioMeterInformation, DeviceEnumerator, DeviceState, Direction, Role,
    SessionState,
};

#[napi(object)]
pub struct MicrophoneInfo {
    pub id: String,
    pub name: String,
}

#[napi(object)]
pub struct SessionSnapshot {
    pub process_id: u32,
    pub is_system_sounds: bool,
    pub is_state_active: bool,
    pub peak: f64,
}

/// Active capture endpoints. One endpoint that cannot be read is skipped, so it cannot
/// hide the rest (suspected bug S12).
#[napi]
pub fn list_microphones() -> Result<Vec<MicrophoneInfo>> {
    let _ = initialize_mta();
    let enumerator = DeviceEnumerator::new().map_err(to_error)?;
    let collection = enumerator
        .get_device_collection(&Direction::Capture)
        .map_err(to_error)?;
    let count = collection.get_nbr_devices().map_err(to_error)?;
    let mut out = Vec::new();
    for index in 0..count {
        let Ok(device) = collection.get_device_at_index(index) else {
            continue;
        };
        if !matches!(device.get_state(), Ok(DeviceState::Active)) {
            continue;
        }
        let (Ok(id), Ok(name)) = (device.get_id(), device.get_friendlyname()) else {
            continue;
        };
        out.push(MicrophoneInfo { id, name });
    }
    Ok(out)
}

struct CachedSession {
    process_id: u32,
    meter: AudioMeterInformation,
}

/// Polls the sessions of the default render endpoint. Not thread-safe by design: one
/// polling loop owns it, like the C# source.
#[napi]
pub struct SessionMonitor {
    cached: Vec<CachedSession>,
}

#[napi]
impl SessionMonitor {
    #[napi(constructor)]
    pub fn new() -> Self {
        let _ = initialize_mta();
        Self { cached: Vec::new() }
    }

    /// Re-resolves the default render endpoint, lists its sessions and caches their meters.
    /// Any audio-service error yields an empty list.
    #[napi]
    pub fn enumerate(&mut self) -> Vec<SessionSnapshot> {
        self.cached.clear();
        self.try_enumerate().unwrap_or_default()
    }

    /// Cheap: reads the peak of every cached session, no enumeration.
    #[napi]
    pub fn read_peaks(&self) -> Vec<SessionSnapshot> {
        self.cached
            .iter()
            .map(|s| SessionSnapshot {
                process_id: s.process_id,
                is_system_sounds: false,
                is_state_active: false,
                peak: s.meter.get_peak_value().unwrap_or(0.0) as f64,
            })
            .collect()
    }

    #[napi]
    pub fn dispose(&mut self) {
        self.cached.clear();
    }

    fn try_enumerate(&mut self) -> std::result::Result<Vec<SessionSnapshot>, wasapi::WasapiError> {
        let enumerator = DeviceEnumerator::new()?;
        let device =
            enumerator.get_default_device_for_role(&Direction::Render, &Role::Multimedia)?;
        let manager = device.get_iaudiosessionmanager()?;
        let sessions = manager.get_audiosessionenumerator()?;
        let count = sessions.get_count()?;
        let mut out = Vec::new();
        for index in 0..count {
            // A session that fails to read is skipped; the rest still count.
            let Ok(control) = sessions.get_session(index) else {
                continue;
            };
            let Ok(process_id) = control.get_process_id() else {
                continue;
            };
            let is_system_sounds = control
                .get_session_identifier()
                .map(|id| id.contains("AudioSrv"))
                .unwrap_or(false);
            let is_state_active = matches!(control.get_state(), Ok(SessionState::Active));
            let Ok(meter) = control.get_audiometerinformation() else {
                out.push(SessionSnapshot {
                    process_id,
                    is_system_sounds,
                    is_state_active,
                    peak: 0.0,
                });
                continue;
            };
            let peak = meter.get_peak_value().unwrap_or(0.0) as f64;
            out.push(SessionSnapshot {
                process_id,
                is_system_sounds,
                is_state_active,
                peak,
            });
            self.cached.push(CachedSession { process_id, meter });
        }
        Ok(out)
    }
}

impl Default for SessionMonitor {
    fn default() -> Self {
        Self::new()
    }
}

fn to_error(e: wasapi::WasapiError) -> Error {
    Error::from_reason(e.to_string())
}
