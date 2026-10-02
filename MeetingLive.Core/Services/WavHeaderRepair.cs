using System.Buffers.Binary;

namespace MeetingLive.Core.Services;

public enum WavRepairOutcome
{
    /// <summary>The header is consistent with the file; nothing was written.</summary>
    Valid,

    /// <summary>The RIFF and/or data size fields were rewritten from the real file length.</summary>
    Repaired,

    /// <summary>Not a RIFF/WAVE file with an <c>fmt </c> chunk followed by a <c>data</c> chunk; untouched.</summary>
    NotWav,

    /// <summary>A WAV layout other than PCM / IEEE float; untouched.</summary>
    Unsupported,

    /// <summary>An I/O error (missing, locked or read-only file); nothing is thrown to the caller.</summary>
    Failed,
}

/// <summary>
/// Recovers a recording whose process died before <c>WaveFileWriter</c> could write the RIFF and
/// <c>data</c> chunk sizes (both stay 0), which makes NAudio reject an otherwise intact file.
/// Rewrites only those two uint32 fields, never touches a consistent file and never truncates audio.
/// </summary>
public static class WavHeaderRepair
{
    private const ushort FormatPcm = 1;
    private const ushort FormatIeeeFloat = 3;
    private const int ChunkHeaderSize = 8;

    public static WavRepairOutcome Repair(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);

        try
        {
            Plan plan;
            using (var read = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                var analysis = Analyze(read);
                if (analysis.Outcome is not null)
                    return analysis.Outcome.Value;

                plan = analysis.Plan!;
            }

            using var write = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.Read);
            if (write.Length != plan.FileLength)
                return WavRepairOutcome.Failed;

            Span<byte> value = stackalloc byte[4];
            BinaryPrimitives.WriteUInt32LittleEndian(value, plan.NewRiffSize);
            write.Position = 4;
            write.Write(value);
            BinaryPrimitives.WriteUInt32LittleEndian(value, plan.NewDataSize);
            write.Position = plan.DataSizeOffset;
            write.Write(value);
            write.Flush(flushToDisk: true);
            return WavRepairOutcome.Repaired;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return WavRepairOutcome.Failed;
        }
    }

    private static (WavRepairOutcome? Outcome, Plan? Plan) Analyze(FileStream stream)
    {
        var fileLength = stream.Length;
        if (fileLength > uint.MaxValue)
            return (WavRepairOutcome.Unsupported, null);

        Span<byte> riff = stackalloc byte[12];
        if (!TryReadExactly(stream, 0, riff)
            || !riff[..4].SequenceEqual("RIFF"u8)
            || !riff[8..12].SequenceEqual("WAVE"u8))
            return (WavRepairOutcome.NotWav, null);

        var riffSize = BinaryPrimitives.ReadUInt32LittleEndian(riff[4..8]);

        long position = 12;
        ushort blockAlign = 0;
        Span<byte> header = stackalloc byte[ChunkHeaderSize];
        Span<byte> fmt = stackalloc byte[16];
        while (TryReadExactly(stream, position, header))
        {
            var chunkSize = BinaryPrimitives.ReadUInt32LittleEndian(header[4..8]);
            var bodyOffset = position + ChunkHeaderSize;

            if (header[..4].SequenceEqual("data"u8))
            {
                if (blockAlign == 0)
                    return (WavRepairOutcome.NotWav, null);

                return BuildPlan(fileLength, riffSize, chunkSize, bodyOffset, position + 4, blockAlign);
            }

            if (header[..4].SequenceEqual("fmt "u8))
            {
                if (chunkSize < 16)
                    return (WavRepairOutcome.NotWav, null);

                if (!TryReadExactly(stream, bodyOffset, fmt))
                    return (WavRepairOutcome.NotWav, null);

                var tag = BinaryPrimitives.ReadUInt16LittleEndian(fmt[..2]);
                blockAlign = BinaryPrimitives.ReadUInt16LittleEndian(fmt[12..14]);
                if (tag is not (FormatPcm or FormatIeeeFloat) || blockAlign == 0)
                    return (WavRepairOutcome.Unsupported, null);
            }

            // Chunks are word aligned: an odd size is followed by one pad byte.
            position = bodyOffset + chunkSize + (chunkSize & 1);
            if (position >= fileLength)
                break;
        }

        return (WavRepairOutcome.NotWav, null);
    }

    private static (WavRepairOutcome? Outcome, Plan? Plan) BuildPlan(
        long fileLength, uint riffSize, uint dataSize, long dataOffset, long dataSizeOffset, ushort blockAlign)
    {
        var available = fileLength - dataOffset;
        if (available < 0)
            return (WavRepairOutcome.NotWav, null);

        var dataBroken = (dataSize == 0 && available >= blockAlign) || dataOffset + dataSize > fileLength;
        var riffBroken = riffSize == 0 || riffSize + 8L > fileLength;
        if (!dataBroken && !riffBroken)
            return (WavRepairOutcome.Valid, null);

        var newData = dataBroken ? available - (available % blockAlign) : dataSize;
        var endOfAudio = dataBroken ? dataOffset + newData : fileLength;
        var plan = new Plan(fileLength, dataSizeOffset, (uint)newData, (uint)(endOfAudio - 8));
        return (null, plan);
    }

    private static bool TryReadExactly(FileStream stream, long position, Span<byte> buffer)
    {
        if (position + buffer.Length > stream.Length)
            return false;

        stream.Position = position;
        stream.ReadExactly(buffer);
        return true;
    }

    private sealed record Plan(long FileLength, long DataSizeOffset, uint NewDataSize, uint NewRiffSize);
}
