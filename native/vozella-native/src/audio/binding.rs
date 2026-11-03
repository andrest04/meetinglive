//! N-API surface for audio capture (Windows only). Platform specifics live in `capture`.

use super::capture::{self, Source};
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;

#[napi(object)]
pub struct StartOptions {
    /// "mic" | "system" | "process"
    pub kind: String,
    /// Mic mode: capture endpoint id. Missing or unusable means the default input.
    pub device_id: Option<String>,
    pub pid: Option<u32>,
    /// Process mode: include child processes (default true).
    pub include_tree: Option<bool>,
}

#[napi(object)]
pub struct AudioFrame {
    /// 320 samples of 16 kHz mono PCM16 little-endian (640 bytes, 20 ms).
    pub pcm: Buffer,
    pub ts_ms: f64,
    pub synthesized: bool,
}

#[napi(object)]
pub struct StopInfo {
    /// Why the capture ended by itself. Missing for a requested stop.
    pub error: Option<String>,
}

#[napi(object)]
pub struct CaptureStats {
    pub frames: f64,
    pub real_samples: f64,
    pub synthesized_samples: f64,
    pub packets: f64,
    pub silent_flag_packets: f64,
    pub discontinuities: f64,
}

#[napi]
pub struct CaptureHandle {
    stop: Arc<AtomicBool>,
    thread: Mutex<Option<JoinHandle<capture::Stats>>>,
}

#[napi]
impl CaptureHandle {
    /// Stops capture, joins the thread and returns counters.
    #[napi]
    pub fn stop(&self) -> Result<CaptureStats> {
        self.stop.store(true, Ordering::Relaxed);
        let t = self.thread.lock().unwrap().take();
        let s = match t {
            Some(t) => t
                .join()
                .map_err(|_| Error::from_reason("capture thread panicked"))?,
            None => capture::Stats::default(),
        };
        Ok(CaptureStats {
            frames: s.frames as f64,
            real_samples: s.real_samples as f64,
            synthesized_samples: s.synthesized_samples as f64,
            packets: s.packets as f64,
            silent_flag_packets: s.silent_flag_packets as f64,
            discontinuities: s.discontinuities as f64,
        })
    }
}

/// Starts capture. Blocks until the device is initialised (or fails), then streams
/// frames to `on_frame` from a Rust thread. `on_stopped` fires once when the capture ends.
#[napi]
pub fn start_capture(
    opts: StartOptions,
    on_frame: ThreadsafeFunction<AudioFrame, ()>,
    on_stopped: ThreadsafeFunction<StopInfo, ()>,
) -> Result<CaptureHandle> {
    let source = match opts.kind.as_str() {
        "mic" => Source::Mic {
            device_id: opts.device_id.clone(),
        },
        "system" => Source::System,
        "process" => Source::Process {
            pid: opts.pid.ok_or_else(|| Error::from_reason("pid required"))?,
            include_tree: opts.include_tree.unwrap_or(true),
        },
        k => return Err(Error::from_reason(format!("unknown kind {k}"))),
    };
    let stop = Arc::new(AtomicBool::new(false));
    let (tx, rx) = mpsc::channel::<std::result::Result<(), String>>();
    let stop2 = stop.clone();
    let thread = std::thread::Builder::new()
        .name("vozella-capture".into())
        .spawn(move || {
            capture::run(
                source,
                stop2,
                move |r| {
                    let _ = tx.send(r);
                },
                move |f| {
                    let mut bytes = Vec::with_capacity(f.pcm.len() * 2);
                    for s in &f.pcm {
                        bytes.extend_from_slice(&s.to_le_bytes());
                    }
                    on_frame.call(
                        Ok(AudioFrame {
                            pcm: Buffer::from(bytes),
                            ts_ms: f.ts_ms,
                            synthesized: f.synthesized,
                        }),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                },
                move |error| {
                    on_stopped.call(
                        Ok(StopInfo { error }),
                        ThreadsafeFunctionCallMode::NonBlocking,
                    );
                },
            )
        })
        .map_err(|e| Error::from_reason(e.to_string()))?;
    let what = if opts.kind == "process" {
        "Process loopback activation"
    } else {
        "Audio device start"
    };
    match capture::wait_ready(&rx, capture::READY_TIMEOUT, &stop, what) {
        Ok(()) => Ok(CaptureHandle {
            stop,
            thread: Mutex::new(Some(thread)),
        }),
        Err(e) => Err(Error::from_reason(e)),
    }
}
