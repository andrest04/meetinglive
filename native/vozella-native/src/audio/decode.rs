//! Audio file decoding through Media Foundation (spec 2.8, 5): any file the OS can read
//! comes out as 16 kHz mono PCM16, whatever the source channel count (fixes C2).

use super::resample::Downsampler48to16;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use wasapi::initialize_mta;
use windows::core::HSTRING;
use windows::Win32::Media::MediaFoundation::{
    IMFSourceReader, MFAudioFormat_Float, MFCreateMediaType, MFCreateSourceReaderFromURL,
    MFMediaType_Audio, MFShutdown, MFStartup, MFSTARTUP_FULL, MF_MT_AUDIO_AVG_BYTES_PER_SECOND,
    MF_MT_AUDIO_BITS_PER_SAMPLE, MF_MT_AUDIO_BLOCK_ALIGNMENT, MF_MT_AUDIO_NUM_CHANNELS,
    MF_MT_AUDIO_SAMPLES_PER_SECOND, MF_MT_MAJOR_TYPE, MF_MT_SUBTYPE, MF_SOURCE_READERF_ENDOFSTREAM,
    MF_SOURCE_READER_FIRST_AUDIO_STREAM, MF_VERSION,
};

const MF_RATE: u32 = 48_000;
const AUDIO_STREAM: u32 = MF_SOURCE_READER_FIRST_AUDIO_STREAM.0 as u32;
const ALL_STREAMS: u32 = 0xFFFF_FFFE;

#[napi]
pub struct AudioDecoder {
    reader: Option<IMFSourceReader>,
    resampler: Downsampler48to16,
    channels: usize,
    done: bool,
}

fn fail<E: std::fmt::Display>(what: &str, e: E) -> Error {
    Error::from_reason(format!("{what}: {e}"))
}

fn float_type(
    channels: u32,
) -> windows::core::Result<windows::Win32::Media::MediaFoundation::IMFMediaType> {
    unsafe {
        let t = MFCreateMediaType()?;
        t.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio)?;
        t.SetGUID(&MF_MT_SUBTYPE, &MFAudioFormat_Float)?;
        t.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 32)?;
        t.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, MF_RATE)?;
        t.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, channels)?;
        t.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, channels * 4)?;
        t.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, MF_RATE * channels * 4)?;
        Ok(t)
    }
}

/// Opens an audio file. Fails when the OS has no decoder for it.
#[napi]
pub fn open_audio_decoder(path: String) -> Result<AudioDecoder> {
    let _ = initialize_mta();
    unsafe {
        MFStartup(MF_VERSION, MFSTARTUP_FULL).map_err(|e| fail("Media Foundation start", e))?;
        let opened = open_reader(&path);
        match opened {
            Ok((reader, channels)) => Ok(AudioDecoder {
                reader: Some(reader),
                resampler: Downsampler48to16::new(channels as usize),
                channels: channels as usize,
                done: false,
            }),
            Err(e) => {
                let _ = MFShutdown();
                Err(e)
            }
        }
    }
}

unsafe fn open_reader(path: &str) -> Result<(IMFSourceReader, u32)> {
    let reader = MFCreateSourceReaderFromURL(&HSTRING::from(path), None)
        .map_err(|e| fail("could not open the audio file", e))?;
    reader
        .SetStreamSelection(ALL_STREAMS, false)
        .map_err(|e| fail("stream selection", e))?;
    reader
        .SetStreamSelection(AUDIO_STREAM, true)
        .map_err(|e| fail("the file has no audio stream", e))?;
    let native = reader
        .GetNativeMediaType(AUDIO_STREAM, 0)
        .map_err(|e| fail("the file has no audio stream", e))?;
    let native_channels = native
        .GetUINT32(&MF_MT_AUDIO_NUM_CHANNELS)
        .unwrap_or(2)
        .max(1);
    // Ask for float at 48 kHz with the source channels; fall back to stereo if the
    // converter refuses an unusual layout.
    for channels in [native_channels, 2] {
        let wanted = float_type(channels).map_err(|e| fail("media type", e))?;
        if reader
            .SetCurrentMediaType(AUDIO_STREAM, None, &wanted)
            .is_ok()
        {
            return Ok((reader, channels));
        }
    }
    Err(Error::from_reason(
        "no decoder for this audio format".to_string(),
    ))
}

#[napi]
impl AudioDecoder {
    /// Next chunk of 16 kHz mono PCM16 little-endian, or null at the end of the file.
    #[napi]
    pub fn read(&mut self) -> Result<Option<Buffer>> {
        let Some(reader) = self.reader.clone() else {
            return Ok(None);
        };
        let mut out: Vec<i16> = Vec::new();
        // Pull until we have about a second or the file ends.
        while out.len() < 16_000 && !self.done {
            let mut flags = 0u32;
            let mut sample = None;
            unsafe {
                reader
                    .ReadSample(
                        AUDIO_STREAM,
                        0,
                        None,
                        Some(&mut flags),
                        None,
                        Some(&mut sample),
                    )
                    .map_err(|e| fail("decode failed", e))?;
            }
            if flags & (MF_SOURCE_READERF_ENDOFSTREAM.0 as u32) != 0 {
                self.done = true;
            }
            let Some(sample) = sample else { continue };
            unsafe {
                let buffer = sample
                    .ConvertToContiguousBuffer()
                    .map_err(|e| fail("decode failed", e))?;
                let mut data = std::ptr::null_mut();
                let mut len = 0u32;
                buffer
                    .Lock(&mut data, None, Some(&mut len))
                    .map_err(|e| fail("decode failed", e))?;
                let bytes = std::slice::from_raw_parts(data, len as usize);
                let floats: Vec<f32> = bytes
                    .as_chunks::<4>()
                    .0
                    .iter()
                    .map(|b| f32::from_le_bytes(*b))
                    .collect();
                let usable = floats.len() / self.channels * self.channels;
                self.resampler.process(&floats[..usable], &mut out);
                let _ = buffer.Unlock();
            }
        }
        if out.is_empty() {
            return Ok(None);
        }
        let mut pcm = Vec::with_capacity(out.len() * 2);
        for s in out {
            pcm.extend_from_slice(&s.to_le_bytes());
        }
        Ok(Some(Buffer::from(pcm)))
    }

    #[napi]
    pub fn close(&mut self) {
        if self.reader.take().is_some() {
            unsafe {
                let _ = MFShutdown();
            }
        }
    }
}

impl Drop for AudioDecoder {
    fn drop(&mut self) {
        self.close();
    }
}
