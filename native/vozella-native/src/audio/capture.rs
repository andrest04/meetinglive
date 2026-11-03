//! WASAPI capture thread: mic, system loopback, or process-tree loopback.
//!
//! Produces fixed 20 ms frames of 16 kHz mono PCM16. When the endpoint delivers no
//! packets (loopback is silent-by-absence), zero frames are synthesized from the wall
//! clock so the stream stays time-aligned with other sources.

use super::resample::Downsampler48to16;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use wasapi::{
    initialize_mta, AudioCaptureClient, AudioClient, DeviceEnumerator, Direction, Handle,
    SampleType, StreamMode, WaveFormat,
};

pub const OUT_RATE: usize = 16_000;
pub const FRAME_SAMPLES: usize = 320; // 20 ms
/// Synthesize silence only once we are this far behind the wall clock.
const FILL_THRESHOLD_SAMPLES: usize = 3 * FRAME_SAMPLES;
const CHANNELS: usize = 2;

#[derive(Clone, Debug)]
pub enum Source {
    /// `device_id` is a capture endpoint id; None or an unusable id means the default.
    Mic {
        device_id: Option<String>,
    },
    System,
    Process {
        pid: u32,
        include_tree: bool,
    },
}

pub struct Frame {
    pub pcm: Vec<i16>,
    /// Media time of the first sample, ms since stream start (frame index * 20).
    pub ts_ms: f64,
    /// True if any sample in the frame was synthesized because the device sent nothing.
    pub synthesized: bool,
}

#[derive(Default, Clone, Debug)]
pub struct Stats {
    pub frames: u64,
    pub real_samples: u64,
    pub synthesized_samples: u64,
    pub packets: u64,
    pub silent_flag_packets: u64,
    pub discontinuities: u64,
}

type Res<T> = Result<T, Box<dyn std::error::Error>>;

/// How often a process capture checks that its target is still alive.
const PROCESS_POLL: std::time::Duration = std::time::Duration::from_millis(250);

/// Runs the capture loop on the calling thread until `stop` is set.
/// `ready` is called exactly once with the init result. `stopped` is called once at the
/// end with the error that ended the capture, or None for a requested stop.
pub fn run(
    source: Source,
    stop: Arc<AtomicBool>,
    ready: impl FnOnce(Result<(), String>),
    mut emit: impl FnMut(Frame),
    stopped: impl FnOnce(Option<String>),
) -> Stats {
    let _ = initialize_mta(); // per-thread COM; MTA works for all three sources
    let (client, h_event, capture) = match open(&source) {
        Ok(v) => {
            ready(Ok(()));
            v
        }
        Err(e) => {
            ready(Err(e.to_string()));
            return Stats::default();
        }
    };
    let mut stats = Stats::default();
    let mut ds = Downsampler48to16::new(CHANNELS);
    let mut raw: VecDeque<u8> = VecDeque::new();
    let mut out: Vec<i16> = Vec::new();
    let mut filler: Vec<bool> = Vec::new(); // parallel to `out`
    let mut total_out: u64 = 0;
    let mut frame_idx: u64 = 0;
    let start = Instant::now();
    if let Err(e) = client.start_stream() {
        stopped(Some(format!("could not start the stream: {e}")));
        return stats;
    }
    let target_pid = match &source {
        Source::Process { pid, .. } => Some(*pid),
        _ => None,
    };
    let mut last_poll = Instant::now();
    let mut fault: Option<String> = None;

    'outer: while !stop.load(Ordering::Relaxed) {
        if let Some(pid) = target_pid {
            if last_poll.elapsed() >= PROCESS_POLL {
                last_poll = Instant::now();
                if !super::process::is_alive(pid) {
                    fault = Some("the captured application exited".to_string());
                    break;
                }
            }
        }
        let _ = h_event.wait_for_event(20); // a timeout is normal during silence
        let mut got_data = false;
        loop {
            let n = match capture.get_next_packet_size() {
                Ok(Some(n)) => n,
                Ok(None) => 0,
                Err(e) => {
                    fault = Some(format!("the audio device failed: {e}"));
                    break 'outer;
                }
            };
            if n == 0 {
                break;
            }
            raw.clear();
            match capture.read_from_device_to_deque(&mut raw) {
                Ok(info) => {
                    zero_if_silent(&mut raw, info.flags.silent);
                    stats.packets += 1;
                    stats.silent_flag_packets += info.flags.silent as u64;
                    stats.discontinuities += info.flags.data_discontinuity as u64;
                }
                Err(e) => {
                    fault = Some(format!("the audio device failed: {e}"));
                    break 'outer;
                }
            }
            let floats: Vec<f32> = raw
                .make_contiguous()
                .as_chunks::<4>()
                .0
                .iter()
                .map(|b| f32::from_le_bytes(*b))
                .collect();
            let before = out.len();
            ds.process(&floats, &mut out);
            filler.resize(out.len(), false);
            let added = (out.len() - before) as u64;
            stats.real_samples += added;
            total_out += added;
            got_data = true;
        }
        if !got_data {
            let expected = (start.elapsed().as_secs_f64() * OUT_RATE as f64) as u64;
            let deficit = expected.saturating_sub(total_out) as usize;
            if deficit >= FILL_THRESHOLD_SAMPLES {
                let n = deficit / FRAME_SAMPLES * FRAME_SAMPLES;
                out.resize(out.len() + n, 0);
                filler.resize(out.len(), true);
                stats.synthesized_samples += n as u64;
                total_out += n as u64;
            }
        }
        while out.len() >= FRAME_SAMPLES {
            let pcm: Vec<i16> = out.drain(..FRAME_SAMPLES).collect();
            let synthesized = filler.drain(..FRAME_SAMPLES).any(|f| f);
            emit(Frame {
                pcm,
                ts_ms: frame_idx as f64 * 20.0,
                synthesized,
            });
            frame_idx += 1;
            stats.frames += 1;
        }
    }
    let _ = client.stop_stream();
    stopped(fault);
    stats
}

/// A packet flagged SILENT carries uninitialised memory: it must read as silence (spec 3.2).
fn zero_if_silent(raw: &mut VecDeque<u8>, silent: bool) {
    if silent {
        raw.iter_mut().for_each(|b| *b = 0);
    }
}

/// How long a device may take to initialise before the start gives up (spec 3.2: 12 s).
pub const READY_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(12);

/// Waits for the capture thread to report that the device is open. The wasapi crate waits
/// for process-loopback activation without a limit, so a stuck activation would otherwise
/// freeze the caller for good. On a timeout the thread is told to stop and left behind.
pub fn wait_ready(
    rx: &std::sync::mpsc::Receiver<Result<(), String>>,
    timeout: std::time::Duration,
    stop: &AtomicBool,
    what: &str,
) -> Result<(), String> {
    match rx.recv_timeout(timeout) {
        Ok(result) => result,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            stop.store(true, Ordering::Relaxed);
            Err(format!(
                "{what} did not finish within {} seconds.",
                timeout.as_secs()
            ))
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            Err("capture thread exited before init".to_string())
        }
    }
}

fn open(source: &Source) -> Res<(AudioClient, Handle, AudioCaptureClient)> {
    // 48 kHz f32 stereo is the format the wasapi example proves for process loopback;
    // the engine converts (AUTOCONVERTPCM) so one path serves all three sources.
    let format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, CHANNELS, None);
    let mut client = match source {
        Source::Mic { device_id } => {
            resolve_microphone(device_id.as_deref())?.get_iaudioclient()?
        }
        Source::System => DeviceEnumerator::new()?
            .get_default_device(&Direction::Render)?
            .get_iaudioclient()?,
        Source::Process { pid, include_tree } => {
            AudioClient::new_application_loopback_client(*pid, *include_tree)?
        }
    };
    // Loopback (system and process) is a Capture-direction stream on a render client.
    let mode = StreamMode::EventsShared {
        autoconvert: true,
        buffer_duration_hns: 0,
    };
    client.initialize_client(&format, &Direction::Capture, &mode)?;
    let h_event = client.set_get_eventhandle()?;
    let capture = client.get_audiocaptureclient()?;
    Ok((client, h_event, capture))
}

/// Spec 3.1.4: a non-empty id that resolves to an active capture endpoint wins; anything
/// else (empty, unplugged, stale) falls back to the default capture device.
pub fn resolve_microphone(device_id: Option<&str>) -> Res<wasapi::Device> {
    let enumerator = DeviceEnumerator::new()?;
    if let Some(id) = device_id.filter(|id| !id.is_empty()) {
        if let Ok(device) = enumerator.get_device(id) {
            if matches!(device.get_state(), Ok(wasapi::DeviceState::Active)) {
                return Ok(device);
            }
        }
    }
    Ok(enumerator.get_default_device(&Direction::Capture)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn silent_packets_read_as_zeros_and_others_are_kept() {
        let mut silent: VecDeque<u8> = VecDeque::from(vec![9, 8, 7, 6]);
        zero_if_silent(&mut silent, true);
        assert_eq!(silent, VecDeque::from(vec![0, 0, 0, 0]));
        let mut loud: VecDeque<u8> = VecDeque::from(vec![9, 8, 7, 6]);
        zero_if_silent(&mut loud, false);
        assert_eq!(loud, VecDeque::from(vec![9, 8, 7, 6]));
    }

    #[test]
    fn a_stuck_start_times_out_with_the_spec_message_and_tells_the_thread_to_stop() {
        let (_tx, rx) = mpsc::channel::<Result<(), String>>();
        let stop = AtomicBool::new(false);
        let err = wait_ready(
            &rx,
            Duration::from_millis(20),
            &stop,
            "Process loopback activation",
        )
        .unwrap_err();
        assert_eq!(
            err,
            "Process loopback activation did not finish within 0 seconds."
        );
        assert!(stop.load(Ordering::Relaxed));
    }

    #[test]
    fn a_ready_or_failed_start_is_passed_through() {
        let stop = AtomicBool::new(false);
        let (tx, rx) = mpsc::channel();
        tx.send(Ok(())).unwrap();
        assert!(wait_ready(&rx, READY_TIMEOUT, &stop, "x").is_ok());
        tx.send(Err("no device".to_string())).unwrap();
        assert_eq!(
            wait_ready(&rx, READY_TIMEOUT, &stop, "x").unwrap_err(),
            "no device"
        );
        drop(tx);
        assert!(wait_ready(&rx, READY_TIMEOUT, &stop, "x").is_err());
        assert!(!stop.load(Ordering::Relaxed));
    }
}
