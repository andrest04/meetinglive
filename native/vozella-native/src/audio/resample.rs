//! Streaming 48 kHz -> 16 kHz mono conversion (pure Rust, platform neutral).
//!
//! Input is interleaved f32 at 48 kHz with any channel count; output is i16 at 16 kHz.
//! Downmix is an average of channels. The 3:1 decimation is preceded by a
//! windowed-sinc low-pass (Blackman, fc = 7.2 kHz) so energy above 8 kHz does not alias.

const TAPS: usize = 63;
const FACTOR: usize = 3;

pub struct Downsampler48to16 {
    channels: usize,
    coeffs: [f32; TAPS],
    history: Vec<f32>, // mono samples at 48 kHz, last TAPS-1 retained
}

impl Downsampler48to16 {
    pub fn new(channels: usize) -> Self {
        let fc = 7200.0_f64 / 48000.0;
        let m = (TAPS - 1) as f64;
        let mut c = [0f32; TAPS];
        let mut sum = 0.0;
        for (i, v) in c.iter_mut().enumerate() {
            let x = i as f64 - m / 2.0;
            let sinc = if x == 0.0 {
                2.0 * fc
            } else {
                (2.0 * std::f64::consts::PI * fc * x).sin() / (std::f64::consts::PI * x)
            };
            let w = 0.42 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / m).cos()
                + 0.08 * (4.0 * std::f64::consts::PI * i as f64 / m).cos();
            let h = sinc * w;
            sum += h;
            *v = h as f32;
        }
        for v in c.iter_mut() {
            *v /= sum as f32;
        }
        Self {
            channels: channels.max(1),
            coeffs: c,
            history: vec![0.0; TAPS - 1],
        }
    }

    /// Consume interleaved f32 frames, append 16 kHz mono i16 samples to `out`.
    pub fn process(&mut self, interleaved: &[f32], out: &mut Vec<i16>) {
        let ch = self.channels;
        self.history.reserve(interleaved.len() / ch);
        for frame in interleaved.chunks_exact(ch) {
            self.history.push(frame.iter().sum::<f32>() / ch as f32);
        }
        // history[0..TAPS-1] is the previous tail; produce an output each FACTOR samples.
        let mut pos = 0;
        while pos + TAPS <= self.history.len() {
            let acc: f32 = self.history[pos..pos + TAPS]
                .iter()
                .zip(self.coeffs.iter())
                .map(|(a, b)| a * b)
                .sum();
            out.push((acc.clamp(-1.0, 1.0) * 32767.0).round() as i16);
            pos += FACTOR;
        }
        // Keep the samples still needed from `pos` on.
        self.history.drain(..pos);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(freq: f32, n: usize, ch: usize) -> Vec<f32> {
        (0..n)
            .flat_map(|i| {
                let v = (2.0 * std::f32::consts::PI * freq * i as f32 / 48000.0).sin() * 0.5;
                std::iter::repeat_n(v, ch)
            })
            .collect()
    }

    fn rms(x: &[i16]) -> f64 {
        (x.iter().map(|&v| (v as f64).powi(2)).sum::<f64>() / x.len() as f64).sqrt()
    }

    #[test]
    fn passes_1k_tone_at_expected_rate_and_level() {
        let mut d = Downsampler48to16::new(2);
        let mut out = Vec::new();
        d.process(&tone(1000.0, 48000, 2), &mut out);
        assert!((out.len() as i64 - 16000).abs() <= 25, "len {}", out.len());
        let r = rms(&out[200..]);
        assert!((r - 0.5 * 32767.0 / 2f64.sqrt()).abs() < 400.0, "rms {r}");
    }

    #[test]
    fn rejects_above_nyquist_tone() {
        let mut d = Downsampler48to16::new(1);
        let mut out = Vec::new();
        d.process(&tone(12000.0, 48000, 1), &mut out);
        assert!(rms(&out[200..]) < 300.0);
    }

    #[test]
    fn chunked_equals_whole() {
        let sig = tone(440.0, 9600, 2);
        let mut a = Downsampler48to16::new(2);
        let mut whole = Vec::new();
        a.process(&sig, &mut whole);
        let mut b = Downsampler48to16::new(2);
        let mut parts = Vec::new();
        for c in sig.chunks(2 * 481) {
            b.process(c, &mut parts);
        }
        assert_eq!(whole, parts);
    }
}
