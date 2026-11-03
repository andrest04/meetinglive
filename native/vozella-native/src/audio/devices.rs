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
    Ok(keep_active((0..count).map(|index| {
        let device = collection.get_device_at_index(index).ok()?;
        Some(EndpointProbe {
            active: matches!(device.get_state(), Ok(DeviceState::Active)),
            id: device.get_id().ok(),
            name: device.get_friendlyname().ok(),
        })
    })))
}

/// What reading one capture endpoint gave. Kept apart from the COM types so the skipping
/// rule can be tested without devices.
pub(crate) struct EndpointProbe {
    pub active: bool,
    pub id: Option<String>,
    pub name: Option<String>,
}

/// Spec item 82 and S12: only active endpoints with a readable id and name are listed, and
/// one endpoint that cannot be read (`None`) never hides the rest.
pub(crate) fn keep_active(
    probes: impl IntoIterator<Item = Option<EndpointProbe>>,
) -> Vec<MicrophoneInfo> {
    probes
        .into_iter()
        .flatten()
        .filter(|probe| probe.active)
        .filter_map(|probe| {
            Some(MicrophoneInfo {
                id: probe.id?,
                name: probe.name?,
            })
        })
        .collect()
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

    /// S9: every active render endpoint is read, not only the default one, because process
    /// loopback can capture an app that plays to another output. An endpoint that cannot be
    /// read is skipped. A failure to list the endpoints at all gives an empty list.
    fn try_enumerate(&mut self) -> std::result::Result<Vec<SessionSnapshot>, wasapi::WasapiError> {
        let enumerator = DeviceEnumerator::new()?;
        let collection = enumerator.get_device_collection(&Direction::Render)?;
        let count = collection.get_nbr_devices()?;
        let mut out = Vec::new();
        let mut any_endpoint = false;
        for index in 0..count {
            let Ok(device) = collection.get_device_at_index(index) else {
                continue;
            };
            if !matches!(device.get_state(), Ok(DeviceState::Active)) {
                continue;
            }
            any_endpoint = true;
            let _ = self.read_endpoint(&device, &mut out);
        }
        if !any_endpoint {
            // The list gave nothing usable: the default endpoint, as before.
            let device =
                enumerator.get_default_device_for_role(&Direction::Render, &Role::Multimedia)?;
            self.read_endpoint(&device, &mut out)?;
        }
        Ok(out)
    }

    fn read_endpoint(
        &mut self,
        device: &wasapi::Device,
        out: &mut Vec<SessionSnapshot>,
    ) -> std::result::Result<(), wasapi::WasapiError> {
        let manager = device.get_iaudiosessionmanager()?;
        let sessions = manager.get_audiosessionenumerator()?;
        let count = sessions.get_count()?;
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
        Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    fn probe(active: bool, id: Option<&str>, name: Option<&str>) -> Option<EndpointProbe> {
        Some(EndpointProbe {
            active,
            id: id.map(str::to_string),
            name: name.map(str::to_string),
        })
    }

    #[test]
    fn only_active_endpoints_with_id_and_name_are_listed() {
        let list = keep_active([
            probe(true, Some("a"), Some("Mic A")),
            probe(false, Some("b"), Some("Unplugged")),
            probe(true, None, Some("No id")),
            probe(true, Some("d"), None),
        ]);
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].id.as_str(), list[0].name.as_str()), ("a", "Mic A"));
    }

    #[test]
    fn one_unreadable_endpoint_does_not_hide_the_others() {
        let list = keep_active([
            probe(true, Some("a"), Some("Mic A")),
            None,
            probe(true, Some("c"), Some("Mic C")),
        ]);
        let ids: Vec<&str> = list.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(ids, ["a", "c"]);
    }
}
