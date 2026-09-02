using System.Runtime.InteropServices;

namespace MeetingLive.Core.Services;

/// <summary>
/// Raises a quiet utterance toward a usable ASR peak. Must run on a whole recording
/// (or a long window), never on 200 ms pump slices — per-chunk peak gain pumps the
/// level and wrecks streaming RNNT.
/// </summary>
public static class PcmLevelNormalizer
{
    /// <summary>Target peak as a fraction of full scale (0.70 ≈ -3 dBFS).</summary>
    public const float TargetPeak = 0.70f;

    /// <summary>Cap makeup gain at +24 dB so room hiss is not turned into fake speech.</summary>
    public const float MaxGain = 16f;

    /// <summary>Peaks at or below this fraction of full scale are treated as silence.</summary>
    public const float SilencePeak = 0.002f;

    public static void NormalizeFloat32(Span<float> samples)
    {
        if (samples.IsEmpty)
            return;

        var peak = 0f;
        for (var i = 0; i < samples.Length; i++)
        {
            var abs = Math.Abs(samples[i]);
            if (abs > peak)
                peak = abs;
        }

        var gain = ResolveGain(peak);
        if (gain <= 1f)
            return;

        for (var i = 0; i < samples.Length; i++)
            samples[i] = Math.Clamp(samples[i] * gain, -1f, 1f);
    }

    public static void NormalizeInt16Le(Span<byte> pcm16Le)
    {
        if (pcm16Le.Length < 2)
            return;

        var samples = MemoryMarshal.Cast<byte, short>(pcm16Le);
        var peak = 0;
        for (var i = 0; i < samples.Length; i++)
        {
            var abs = Math.Abs((int)samples[i]);
            if (abs > peak)
                peak = abs;
        }

        var gain = ResolveGain(peak / 32768f);
        if (gain <= 1f)
            return;

        for (var i = 0; i < samples.Length; i++)
        {
            var scaled = samples[i] * gain;
            if (scaled > short.MaxValue)
                samples[i] = short.MaxValue;
            else if (scaled < short.MinValue)
                samples[i] = short.MinValue;
            else
                samples[i] = (short)Math.Round(scaled);
        }
    }

    public static float ResolveGain(float peakFs)
    {
        if (peakFs <= SilencePeak || peakFs >= TargetPeak)
            return 1f;

        return Math.Min(TargetPeak / peakFs, MaxGain);
    }
}
