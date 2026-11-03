//! Audio capture: mic, system loopback and per-process loopback.
//!
//! `resample` is platform neutral and always compiled; `capture` and the N-API
//! surface need WASAPI and exist on Windows only.

pub mod resample;

#[cfg(windows)]
pub mod capture;

#[cfg(windows)]
pub mod binding;
