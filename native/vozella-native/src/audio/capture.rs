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
    Mic,
    System,
    Process { pid: u32, include_tree: bool },
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

/// Runs the capture loop on the calling thread until `stop` is set.
/// `ready` is called exactly once with the init result.
pub fn run(
    source: Source,
    stop: Arc<AtomicBool>,
    ready: impl FnOnce(Result<(), String>),
    mut emit: impl FnMut(Frame),
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
    if client.start_stream().is_err() {
        return stats;
    }

    while !stop.load(Ordering::Relaxed) {
        let _ = h_event.wait_for_event(20); // a timeout is normal during silence
        let mut got_data = false;
        while let Ok(Some(n)) = capture.get_next_packet_size() {
            if n == 0 {
                break;
            }
            raw.clear();
            match capture.read_from_device_to_deque(&mut raw) {
                Ok(info) => {
                    stats.packets += 1;
                    stats.silent_flag_packets += info.flags.silent as u64;
                    stats.discontinuities += info.flags.data_discontinuity as u64;
                }
                Err(_) => break,
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
    stats
}

fn open(source: &Source) -> Res<(AudioClient, Handle, AudioCaptureClient)> {
    // 48 kHz f32 stereo is the format the wasapi example proves for process loopback;
    // the engine converts (AUTOCONVERTPCM) so one path serves all three sources.
    let format = WaveFormat::new(32, 32, &SampleType::Float, 48_000, CHANNELS, None);
    let mut client = match source {
        Source::Mic => DeviceEnumerator::new()?
            .get_default_device(&Direction::Capture)?
            .get_iaudioclient()?,
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
