using System.Buffers.Binary;
using MeetingLive.Core.Services;
using NAudio.Wave;

namespace MeetingLive.Core.Tests.Services;

public sealed class WavHeaderRepairTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(Path.GetTempPath(), "MeetingLiveWavRepair_" + Guid.NewGuid());

    public WavHeaderRepairTests()
    {
        Directory.CreateDirectory(_tempDirectory);
    }

    [Fact]
    public void Repair_ValidFile_LeavesBytesIdentical()
    {
        var path = WriteValidWav("valid.wav", seconds: 1);
        var before = File.ReadAllBytes(path);

        var outcome = WavHeaderRepair.Repair(path);

        Assert.Equal(WavRepairOutcome.Valid, outcome);
        Assert.Equal(before, File.ReadAllBytes(path));
    }

    [Fact]
    public void Repair_ValidFile_DoesNotChangeLastWriteTime()
    {
        var path = WriteValidWav("valid-time.wav", seconds: 1);
        var stamp = new DateTime(2020, 1, 2, 3, 4, 5, DateTimeKind.Utc);
        File.SetLastWriteTimeUtc(path, stamp);

        WavHeaderRepair.Repair(path);

        Assert.Equal(stamp, File.GetLastWriteTimeUtc(path));
    }

    [Fact]
    public void Repair_ZeroSizes_RepairsAndIsReadableWithAllSamples()
    {
        var path = WriteValidWav("zero.wav", seconds: 2);
        var pcmBytes = new FileInfo(path).Length - 46; // NAudio writes an 18-byte fmt chunk: data size at 42, PCM at 46
        ZeroSizeFields(path, dataSizeOffset: 42);

        var outcome = WavHeaderRepair.Repair(path);

        Assert.Equal(WavRepairOutcome.Repaired, outcome);
        using var reader = new WaveFileReader(path);
        Assert.Equal(pcmBytes, reader.Length);
        using var audio = new AudioFileReader(path);
        Assert.Equal(2, (int)audio.TotalTime.TotalSeconds);
    }

    [Fact]
    public void Repair_AppLayoutWith18ByteFmt_Repaired()
    {
        // The real broken recordings have an 18-byte fmt chunk (cbSize = 0) and data at offset 46.
        var path = Path.Combine(_tempDirectory, "fmt18.wav");
        var pcm = SinePcm(16000);
        File.WriteAllBytes(path, BuildWav(fmtExtra: [0, 0], extraChunksBeforeData: [], pcm, riffSize: 0, dataSize: 0));

        var outcome = WavHeaderRepair.Repair(path);

        Assert.Equal(WavRepairOutcome.Repaired, outcome);
        using var reader = new WaveFileReader(path);
        Assert.Equal(pcm.Length, reader.Length);
    }

    [Fact]
    public void Repair_OddTrailingByte_RoundsDataSizeDownToBlockAlign()
    {
        var path = Path.Combine(_tempDirectory, "odd.wav");
        var pcm = SinePcm(8000);
        var withOddByte = pcm.Concat(new byte[] { 0x7F }).ToArray();
        File.WriteAllBytes(path, BuildWav([], [], withOddByte, riffSize: 0, dataSize: 0));
        var lengthBefore = new FileInfo(path).Length;

        var outcome = WavHeaderRepair.Repair(path);

        Assert.Equal(WavRepairOutcome.Repaired, outcome);
        Assert.Equal(lengthBefore, new FileInfo(path).Length);
        using var reader = new WaveFileReader(path);
        Assert.Equal(pcm.Length, reader.Length);
        var bytes = File.ReadAllBytes(path);
        Assert.Equal((uint)(44 + pcm.Length - 8), BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(4)));
    }

    [Fact]
    public void Repair_ExtraListChunkBeforeData_Repaired()
    {
        var path = Path.Combine(_tempDirectory, "list.wav");
        var pcm = SinePcm(16000);
        var list = Chunk("LIST", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        File.WriteAllBytes(path, BuildWav([], list, pcm, riffSize: 0, dataSize: 0));

        var outcome = WavHeaderRepair.Repair(path);

        Assert.Equal(WavRepairOutcome.Repaired, outcome);
        using var reader = new WaveFileReader(path);
        Assert.Equal(pcm.Length, reader.Length);
    }

    [Fact]
    public void Repair_OverstatedDataSize_Repaired()
    {
        var path = Path.Combine(_tempDirectory, "over.wav");
        var pcm = SinePcm(16000);
        File.WriteAllBytes(path, BuildWav([], [], pcm, riffSize: uint.MaxValue, dataSize: uint.MaxValue));

        var outcome = WavHeaderRepair.Repair(path);

        Assert.Equal(WavRepairOutcome.Repaired, outcome);
        using var reader = new WaveFileReader(path);
        Assert.Equal(pcm.Length, reader.Length);
    }

    [Fact]
    public void Repair_ZeroRiffSizeOnly_FixesRiffAndKeepsDataSize()
    {
        var path = WriteValidWav("riff0.wav", seconds: 1);
        var bytes = File.ReadAllBytes(path);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(4), 0);
        File.WriteAllBytes(path, bytes);

        var outcome = WavHeaderRepair.Repair(path);

        Assert.Equal(WavRepairOutcome.Repaired, outcome);
        var repaired = File.ReadAllBytes(path);
        Assert.Equal((uint)(repaired.Length - 8), BinaryPrimitives.ReadUInt32LittleEndian(repaired.AsSpan(4)));
        Assert.Equal(bytes.AsSpan(8).ToArray(), repaired.AsSpan(8).ToArray());
    }

    [Fact]
    public void Repair_NonWavBytes_LeavesFileUntouchedAndReportsNotWav()
    {
        var path = Path.Combine(_tempDirectory, "garbage.wav");
        var garbage = Enumerable.Range(0, 200).Select(i => (byte)i).ToArray();
        File.WriteAllBytes(path, garbage);

        var outcome = WavHeaderRepair.Repair(path);

        Assert.Equal(WavRepairOutcome.NotWav, outcome);
        Assert.Equal(garbage, File.ReadAllBytes(path));
    }

    [Fact]
    public void Repair_TruncatedHeader_LeavesFileUntouchedAndReportsNotWav()
    {
        var path = Path.Combine(_tempDirectory, "short.wav");
        var bytes = BuildWav([], [], SinePcm(100), riffSize: 0, dataSize: 0).AsSpan(0, 30).ToArray();
        File.WriteAllBytes(path, bytes);

        var outcome = WavHeaderRepair.Repair(path);

        Assert.Equal(WavRepairOutcome.NotWav, outcome);
        Assert.Equal(bytes, File.ReadAllBytes(path));
    }

    [Fact]
    public void Repair_CompressedFormat_ReportsUnsupportedAndLeavesFileUntouched()
    {
        var path = Path.Combine(_tempDirectory, "adpcm.wav");
        var bytes = BuildWav([], [], SinePcm(1000), riffSize: 0, dataSize: 0);
        BinaryPrimitives.WriteUInt16LittleEndian(bytes.AsSpan(20), 2); // MS ADPCM
        File.WriteAllBytes(path, bytes);

        var outcome = WavHeaderRepair.Repair(path);

        Assert.Equal(WavRepairOutcome.Unsupported, outcome);
        Assert.Equal(bytes, File.ReadAllBytes(path));
    }

    [Fact]
    public void Repair_MissingFile_ReturnsFailedWithoutThrowing()
    {
        var outcome = WavHeaderRepair.Repair(Path.Combine(_tempDirectory, "nope.wav"));

        Assert.Equal(WavRepairOutcome.Failed, outcome);
    }

    [Fact]
    public void Repair_FileLockedByWriter_ReturnsFailedWithoutThrowing()
    {
        var path = Path.Combine(_tempDirectory, "locked.wav");
        File.WriteAllBytes(path, BuildWav([], [], SinePcm(16000), riffSize: 0, dataSize: 0));
        using var locker = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite);

        var outcome = WavHeaderRepair.Repair(path);

        Assert.Equal(WavRepairOutcome.Failed, outcome);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
            Directory.Delete(_tempDirectory, recursive: true);
    }

    private string WriteValidWav(string name, int seconds)
    {
        var path = Path.Combine(_tempDirectory, name);
        using (var writer = new WaveFileWriter(path, new WaveFormat(16000, 16, 1)))
        {
            var pcm = SinePcm(16000 * seconds);
            writer.Write(pcm, 0, pcm.Length);
        }

        return path;
    }

    private static void ZeroSizeFields(string path, int dataSizeOffset)
    {
        var bytes = File.ReadAllBytes(path);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(4), 0);
        BinaryPrimitives.WriteUInt32LittleEndian(bytes.AsSpan(dataSizeOffset), 0);
        File.WriteAllBytes(path, bytes);
    }

    private static byte[] SinePcm(int sampleCount)
    {
        var pcm = new byte[sampleCount * 2];
        for (var i = 0; i < sampleCount; i++)
        {
            var value = (short)(Math.Sin(2 * Math.PI * 440 * i / 16000) * 8000);
            BinaryPrimitives.WriteInt16LittleEndian(pcm.AsSpan(i * 2), value);
        }

        return pcm;
    }

    private static byte[] Chunk(string id, byte[] payload)
    {
        var chunk = new byte[8 + payload.Length + (payload.Length % 2)];
        System.Text.Encoding.ASCII.GetBytes(id).CopyTo(chunk, 0);
        BinaryPrimitives.WriteUInt32LittleEndian(chunk.AsSpan(4), (uint)payload.Length);
        payload.CopyTo(chunk, 8);
        return chunk;
    }

    private static byte[] BuildWav(byte[] fmtExtra, byte[] extraChunksBeforeData, byte[] pcm, uint riffSize, uint dataSize)
    {
        var fmt = new byte[16 + fmtExtra.Length];
        BinaryPrimitives.WriteUInt16LittleEndian(fmt.AsSpan(0), 1);
        BinaryPrimitives.WriteUInt16LittleEndian(fmt.AsSpan(2), 1);
        BinaryPrimitives.WriteUInt32LittleEndian(fmt.AsSpan(4), 16000);
        BinaryPrimitives.WriteUInt32LittleEndian(fmt.AsSpan(8), 32000);
        BinaryPrimitives.WriteUInt16LittleEndian(fmt.AsSpan(12), 2);
        BinaryPrimitives.WriteUInt16LittleEndian(fmt.AsSpan(14), 16);
        fmtExtra.CopyTo(fmt, 16);

        using var stream = new MemoryStream();
        stream.Write("RIFF"u8);
        stream.Write(BitConverter.GetBytes(riffSize));
        stream.Write("WAVE"u8);
        stream.Write(Chunk("fmt ", fmt));
        stream.Write(extraChunksBeforeData);
        stream.Write("data"u8);
        stream.Write(BitConverter.GetBytes(dataSize));
        stream.Write(pcm);
        return stream.ToArray();
    }
}
