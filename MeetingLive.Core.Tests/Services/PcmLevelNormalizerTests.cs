using System.Buffers.Binary;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class PcmLevelNormalizerTests
{
    [Fact]
    public void NormalizeInt16Le_Silence_LeavesBufferUnchanged()
    {
        var buffer = new byte[8];

        PcmLevelNormalizer.NormalizeInt16Le(buffer);

        Assert.Equal(new byte[8], buffer);
    }

    [Fact]
    public void NormalizeInt16Le_QuietSpeech_RaisesPeakTowardTarget()
    {
        var buffer = WriteSamples(0, 4120, -4120, 2000);
        var originalPeak = 4120;

        PcmLevelNormalizer.NormalizeInt16Le(buffer);

        var peak = ReadPeak(buffer);
        Assert.True(peak > originalPeak);
        Assert.InRange(peak, 20_000, 24_000);
    }

    [Fact]
    public void NormalizeInt16Le_AlreadyLoud_LeavesBufferUnchanged()
    {
        short loud = 26_000;
        var buffer = WriteSamples(loud, (short)-loud);
        var before = buffer.ToArray();

        PcmLevelNormalizer.NormalizeInt16Le(buffer);

        Assert.Equal(before, buffer);
    }

    [Fact]
    public void NormalizeInt16Le_BelowSilenceFloor_LeavesBufferUnchanged()
    {
        var buffer = WriteSamples(40, -40);
        var before = buffer.ToArray();

        PcmLevelNormalizer.NormalizeInt16Le(buffer);

        Assert.Equal(before, buffer);
    }

    [Fact]
    public void NormalizeFloat32_QuietUtterance_AppliesOneGain()
    {
        var samples = new[] { 0.05f, -0.04f, 0.03f };
        var originalPeak = 0.05f;

        PcmLevelNormalizer.NormalizeFloat32(samples);

        var peak = samples.Max(Math.Abs);
        Assert.True(peak > originalPeak);
        Assert.InRange(peak, 0.65f, 0.75f);
    }

    [Fact]
    public void ResolveGain_DifferentChunkPeaks_WouldPumpLevel()
    {
        var quietChunk = PcmLevelNormalizer.ResolveGain(0.05f);
        var louderChunk = PcmLevelNormalizer.ResolveGain(0.25f);

        Assert.True(quietChunk > louderChunk);
        Assert.True(quietChunk > 1f);
        Assert.True(louderChunk > 1f);
    }

    [Fact]
    public void NormalizeInt16Le_DoesNotOverflowInt16()
    {
        var buffer = WriteSamples(1_000, -1_000);

        PcmLevelNormalizer.NormalizeInt16Le(buffer);

        for (var i = 0; i < buffer.Length; i += 2)
        {
            var sample = BinaryPrimitives.ReadInt16LittleEndian(buffer.AsSpan(i, 2));
            Assert.InRange(sample, short.MinValue, short.MaxValue);
        }
    }

    private static byte[] WriteSamples(params short[] samples)
    {
        var buffer = new byte[samples.Length * 2];
        for (var i = 0; i < samples.Length; i++)
            BinaryPrimitives.WriteInt16LittleEndian(buffer.AsSpan(i * 2, 2), samples[i]);
        return buffer;
    }

    private static int ReadPeak(byte[] buffer)
    {
        var peak = 0;
        for (var i = 0; i < buffer.Length; i += 2)
        {
            var abs = Math.Abs((int)BinaryPrimitives.ReadInt16LittleEndian(buffer.AsSpan(i, 2)));
            if (abs > peak)
                peak = abs;
        }

        return peak;
    }
}
