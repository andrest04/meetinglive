using NAudio.Wave;

namespace MeetingLive.Core.Tests.Services;

/// <summary>A capture device the test drives by hand. Real audio devices are not available to tests.</summary>
internal sealed class FakeWaveIn : IWaveIn
{
    private int _stopCalls;
    private int _disposeCalls;

    public WaveFormat WaveFormat { get; set; } = WaveFormat.CreateIeeeFloatWaveFormat(16000, 1);

    public Exception? StartError { get; init; }

    public Exception? StopError { get; init; }

    /// <summary>Holds StopRecording open so that a second caller overlaps the first.</summary>
    public TimeSpan StopDelay { get; init; }

    public int StopCalls => Volatile.Read(ref _stopCalls);

    public int DisposeCalls => Volatile.Read(ref _disposeCalls);

    public event EventHandler<WaveInEventArgs>? DataAvailable;

    public event EventHandler<StoppedEventArgs>? RecordingStopped;

    public void StartRecording()
    {
        if (StartError is not null)
            throw StartError;
    }

    public void StopRecording()
    {
        Interlocked.Increment(ref _stopCalls);
        if (StopDelay > TimeSpan.Zero)
            Thread.Sleep(StopDelay);

        if (StopError is not null)
            throw StopError;

        RaiseStopped(null);
    }

    public void Dispose() => Interlocked.Increment(ref _disposeCalls);

    /// <summary>What a device raises when it dies, or when it stops normally for a null error.</summary>
    public void RaiseStopped(Exception? error) =>
        RecordingStopped?.Invoke(this, error is null ? new StoppedEventArgs() : new StoppedEventArgs(error));

    public void RaiseSamples(float value, int sampleCount)
    {
        var bytes = new byte[sampleCount * sizeof(float)];
        for (var i = 0; i < sampleCount; i++)
            BitConverter.TryWriteBytes(bytes.AsSpan(i * sizeof(float)), value);

        DataAvailable?.Invoke(this, new WaveInEventArgs(bytes, bytes.Length));
    }
}

/// <summary>A real file that starts refusing writes past a size, the way a full disk does.</summary>
internal sealed class DiskFullStream : Stream
{
    private readonly FileStream _inner;
    private readonly long _capacity;
    private bool _full;

    public DiskFullStream(string path, long capacity)
    {
        _inner = new FileStream(path, FileMode.Create, FileAccess.ReadWrite, FileShare.Read);
        _capacity = capacity;
    }

    public override bool CanRead => false;

    public override bool CanSeek => true;

    public override bool CanWrite => true;

    public override long Length => _inner.Length;

    public override long Position
    {
        get => _inner.Position;
        set => _inner.Position = value;
    }

    public override void Flush() => _inner.Flush();

    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();

    public override long Seek(long offset, SeekOrigin origin) => _inner.Seek(offset, origin);

    public override void SetLength(long value) => _inner.SetLength(value);

    public override void Write(byte[] buffer, int offset, int count)
    {
        // Once full, every write fails, including the header rewrite at close.
        _full |= _inner.Length + count > _capacity;
        if (_full)
            throw new IOException("There is not enough space on the disk.");

        _inner.Write(buffer, offset, count);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
            _inner.Dispose();

        base.Dispose(disposing);
    }
}
