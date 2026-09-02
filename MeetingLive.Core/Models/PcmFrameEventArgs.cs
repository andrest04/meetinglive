namespace MeetingLive.Core.Models;

/// <summary>One mixed 16 kHz mono float32 frame from the capture pump, in [-1, 1].</summary>
public sealed class PcmFrameEventArgs(float[] samples, int sampleRate) : EventArgs
{
    public float[] Samples { get; } = samples;

    public int SampleRate { get; } = sampleRate;
}
