using System.Buffers.Binary;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Mixes the requested microphone (or none) and one output capture — system loopback or a
/// single process tree — into a 16 kHz mono PCM WAV, the format Nemotron ASR expects.
/// The same mixed stream is optionally raised as float32 frames for live streaming ASR.
/// </summary>
public sealed class AudioCaptureService : IAudioCaptureService, IDisposable
{
    private static readonly WaveFormat MixFormat = WaveFormat.CreateIeeeFloatWaveFormat(16000, 1);

    private static readonly TimeSpan HeaderFlushInterval = TimeSpan.FromSeconds(5);

    private readonly Func<string?, IWaveIn> _createMicrophone;
    private readonly Func<RecordingCaptureSources, IWaveIn> _createOutput;
    private readonly Func<string, WaveFormat, WaveFileWriter> _createWriter;

    private IWaveIn? _micCapture;
    private IWaveIn? _outputCapture;
    private WaveFileWriter? _writer;
    private CancellationTokenSource? _pumpCts;
    private Task? _pumpTask;
    private string? _outputPath;
    private int _paused;
    private int _userStop;
    private int _liveSources;
    private volatile bool _isRecording;
    private volatile Exception? _outputFailure;
    private volatile Exception? _pumpFailure;
    private bool _outputIsProcessCapture;

    private readonly object _stopGate = new();
    private Task? _stopTask;

    public AudioCaptureService()
        : this(
            deviceId => new WasapiCapture(MicrophoneDeviceResolver.Resolve(deviceId)),
            CreateOutputCapture,
            (path, format) => new WaveFileWriter(path, format))
    {
    }

    /// <summary>Lets tests supply capture devices and the WAV sink. No test host has real audio devices.</summary>
    internal AudioCaptureService(
        Func<string?, IWaveIn> createMicrophone,
        Func<RecordingCaptureSources, IWaveIn> createOutput,
        Func<string, WaveFormat, WaveFileWriter> createWriter)
    {
        _createMicrophone = createMicrophone;
        _createOutput = createOutput;
        _createWriter = createWriter;
    }

    public bool IsRecording => _isRecording;

    public bool IsPaused => Volatile.Read(ref _paused) != 0;

    public event EventHandler<PcmFrameEventArgs>? PcmFrameAvailable;

    public event EventHandler<Exception>? OutputCaptureFailed;

    public event EventHandler<CaptureSourceLostEventArgs>? CaptureSourceLost;

    public event EventHandler<Exception>? CaptureFaulted;

    /// <summary>
    /// Whether a capture-thread failure ends the recording, which happens only when it is not the
    /// caller asking to stop and the output is a process-loopback capture. System loopback keeps
    /// recording on an error, and reports it through <see cref="IsSourceLost"/> instead. A null
    /// error is a normal stop.
    /// </summary>
    internal static bool ShouldSurfaceOutputFailure(Exception? error, bool userStop, bool isProcessCapture) =>
        error is not null && !userStop && isProcessCapture;

    /// <summary>
    /// Whether a source that stopped should be reported as lost. A null error is a normal stop,
    /// and an error during the caller's own stop is only teardown.
    /// </summary>
    internal static bool IsSourceLost(Exception? error, bool userStop) => error is not null && !userStop;

    public void Start(string outputWavPath, string? microphoneDeviceId = null)
    {
        Start(outputWavPath, RecordingCaptureSources.SystemLoopback(captureMicrophone: true, microphoneDeviceId));
    }

    public void Start(string outputWavPath, RecordingCaptureSources sources)
    {
        ArgumentNullException.ThrowIfNull(sources);
        sources.ThrowIfInvalid();

        if (IsRecording)
            throw new InvalidOperationException("A recording is already in progress.");

        IWaveIn? micCapture = null;
        IWaveIn? outputCapture = null;
        WaveFileWriter? writer = null;
        CancellationTokenSource? pumpCts = null;
        Task? pumpTask = null;

        Volatile.Write(ref _paused, 0);
        Volatile.Write(ref _userStop, 0);
        _outputFailure = null;
        _pumpFailure = null;
        _outputIsProcessCapture = !sources.UsesSystemLoopback;
        _liveSources = sources.CaptureMicrophone ? 2 : 1;

        try
        {
            var mixer = new MixingSampleProvider(MixFormat);

            if (sources.CaptureMicrophone)
            {
                micCapture = _createMicrophone(sources.MicrophoneDeviceId);
                var micBuffer = CreateBuffer(micCapture.WaveFormat);
                micCapture.DataAvailable += (_, e) => micBuffer.AddSamples(e.Buffer, 0, e.BytesRecorded);
                micCapture.RecordingStopped += OnMicrophoneStopped;
                mixer.AddMixerInput(ResampleToMixFormat(micBuffer.ToSampleProvider(), micCapture.WaveFormat));
            }

            // Exactly one output. Process scope must not also open system loopback.
            outputCapture = _createOutput(sources);

            var outputBuffer = CreateBuffer(outputCapture.WaveFormat);
            outputCapture.DataAvailable += (_, e) => outputBuffer.AddSamples(e.Buffer, 0, e.BytesRecorded);
            outputCapture.RecordingStopped += OnOutputCaptureStopped;
            mixer.AddMixerInput(ResampleToMixFormat(outputBuffer.ToSampleProvider(), outputCapture.WaveFormat));

            var pcm16 = mixer.ToWaveProvider16();
            writer = _createWriter(outputWavPath, pcm16.WaveFormat);

            pumpCts = new CancellationTokenSource();
            pumpTask = Task.Run(() => RunPump(pcm16, writer, pumpCts.Token));

            // A device can fail the moment it starts, and its handler cancels through this field.
            _pumpCts = pumpCts;

            micCapture?.StartRecording();
            outputCapture.StartRecording();

            _micCapture = micCapture;
            _outputCapture = outputCapture;
            _writer = writer;
            _pumpTask = pumpTask;
            _outputPath = outputWavPath;
            _isRecording = true;
        }
        catch
        {
            _pumpCts = null;
            DetachSourceHandlers(micCapture, outputCapture);
            AbortFailedStart(micCapture, outputCapture, writer, pumpCts, pumpTask);
            throw;
        }
    }

    public void Stop()
    {
        // IDisposable and other sync callers cannot await. UI code must use StopAsync.
        StopAsync().GetAwaiter().GetResult();
    }

    /// <summary>Only one teardown ever runs. A caller that arrives during it gets the same task, so it
    /// waits for the same outcome. Device stops can block, so they never run on the caller's thread.</summary>
    public Task StopAsync()
    {
        lock (_stopGate)
        {
            if (_stopTask is not null)
                return _stopTask;

            if (!_isRecording)
                return Task.CompletedTask;

            _stopTask = Task.Run(StopCoreAsync);
            return _stopTask;
        }
    }

    /// <summary>Every step runs whatever the earlier ones did, because a recording that keeps its
    /// file and devices open cannot be transcribed or followed by another. The caller gets what killed
    /// the recording if anything did, otherwise the first error teardown itself hit.</summary>
    private async Task StopCoreAsync()
    {
        Exception? teardownError = null;
        bool Attempt(Action step)
        {
            try
            {
                step();
                return true;
            }
            catch (Exception ex)
            {
                teardownError ??= ex;
                return false;
            }
        }

        var micCapture = _micCapture;
        var outputCapture = _outputCapture;
        var writer = _writer;
        var pumpCts = _pumpCts;
        var pumpTask = _pumpTask;
        var outputPath = _outputPath;

        Volatile.Write(ref _userStop, 1);
        DetachSourceHandlers(micCapture, outputCapture);
        if (micCapture is not null)
            Attempt(micCapture.StopRecording);
        if (outputCapture is not null)
            Attempt(outputCapture.StopRecording);
        if (pumpCts is not null)
            Attempt(pumpCts.Cancel);

        if (pumpTask is not null)
        {
            try
            {
                await pumpTask.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Pump observes the token and exits; ignore if cancel surfaces.
            }
            catch (Exception ex)
            {
                teardownError ??= ex;
            }
        }

        if (writer is not null)
        {
            var flushed = Attempt(writer.Flush);
            var closed = Attempt(writer.Dispose);

            // The file closes even when the disk refuses the final write, and the audio on disk is
            // still the meeting, so its sizes are rewritten if they never made it.
            if (!(flushed && closed) && outputPath is not null)
                _ = WavHeaderRepair.Repair(outputPath);
        }

        if (micCapture is not null)
            Attempt(micCapture.Dispose);
        if (outputCapture is not null)
            Attempt(outputCapture.Dispose);
        if (pumpCts is not null)
            Attempt(pumpCts.Dispose);

        _micCapture = null;
        _outputCapture = null;
        _writer = null;
        _pumpCts = null;
        _pumpTask = null;
        _outputPath = null;
        Volatile.Write(ref _paused, 0);

        var failure = _pumpFailure ?? _outputFailure ?? teardownError;
        _pumpFailure = null;
        _outputFailure = null;

        lock (_stopGate)
        {
            _isRecording = false;
            _stopTask = null;
        }

        if (failure is not null)
            throw failure;
    }

    public void Pause()
    {
        if (IsRecording)
            Volatile.Write(ref _paused, 1);
    }

    public void Resume()
    {
        if (IsRecording)
            Volatile.Write(ref _paused, 0);
    }

    private void OnOutputCaptureStopped(object? sender, StoppedEventArgs e)
    {
        var userStop = Volatile.Read(ref _userStop) != 0;
        if (!ShouldSurfaceOutputFailure(e.Exception, userStop, _outputIsProcessCapture))
        {
            ReportSourceStopped(CaptureSource.Output, e.Exception, userStop);
            return;
        }

        _outputFailure = e.Exception;
        try
        {
            _pumpCts?.Cancel();
        }
        catch (ObjectDisposedException)
        {
        }

        if (e.Exception is not null)
            OutputCaptureFailed?.Invoke(this, e.Exception);
    }

    private void OnMicrophoneStopped(object? sender, StoppedEventArgs e) =>
        ReportSourceStopped(CaptureSource.Microphone, e.Exception, Volatile.Read(ref _userStop) != 0);

    private void ReportSourceStopped(CaptureSource source, Exception? error, bool userStop)
    {
        if (!IsSourceLost(error, userStop))
            return;

        // Both endpoints of a headset can die together on separate capture threads.
        var remaining = Math.Max(Interlocked.Decrement(ref _liveSources), 0);
        CaptureSourceLost?.Invoke(this, new CaptureSourceLostEventArgs(source, remaining, error!));
    }

    private void DetachSourceHandlers(IWaveIn? micCapture, IWaveIn? outputCapture)
    {
        if (micCapture is not null)
            micCapture.RecordingStopped -= OnMicrophoneStopped;
        if (outputCapture is not null)
            outputCapture.RecordingStopped -= OnOutputCaptureStopped;
    }

    private static IWaveIn CreateOutputCapture(RecordingCaptureSources sources) => sources.UsesSystemLoopback
        ? new WasapiLoopbackCapture()
        : new ProcessLoopbackCapture(sources.ProcessId);

    private static void AbortFailedStart(
        IWaveIn? micCapture,
        IWaveIn? outputCapture,
        WaveFileWriter? writer,
        CancellationTokenSource? pumpCts,
        Task? pumpTask)
    {
        pumpCts?.Cancel();
        if (pumpTask is not null)
        {
            try
            {
                pumpTask.GetAwaiter().GetResult();
            }
            catch (Exception)
            {
                // The start failure is what the caller needs to see.
            }
        }

        try
        {
            writer?.Dispose();
        }
        catch (Exception)
        {
        }

        try
        {
            micCapture?.StopRecording();
        }
        catch (Exception)
        {
        }

        try
        {
            micCapture?.Dispose();
        }
        catch (Exception)
        {
        }

        try
        {
            outputCapture?.StopRecording();
        }
        catch (Exception)
        {
        }

        try
        {
            outputCapture?.Dispose();
        }
        catch (Exception)
        {
        }

        pumpCts?.Dispose();
    }

    private static BufferedWaveProvider CreateBuffer(WaveFormat format) => new(format)
    {
        DiscardOnBufferOverflow = true,
        BufferDuration = TimeSpan.FromSeconds(5),
    };

    private static ISampleProvider ResampleToMixFormat(ISampleProvider source, WaveFormat sourceFormat)
    {
        var sample = sourceFormat.Channels == 2 ? source.ToMono() : source;
        return sourceFormat.SampleRate == MixFormat.SampleRate
            ? sample
            : new WdlResamplingSampleProvider(sample, MixFormat.SampleRate);
    }

    /// <summary>A dead pump means nothing more reaches the file, so say so now instead of at Stop.
    /// The fault is kept for StopAsync, which closes the file and rethrows it.</summary>
    private void RunPump(IWaveProvider source, WaveFileWriter writer, CancellationToken cancellationToken)
    {
        try
        {
            PumpLoop(source, writer, cancellationToken);
        }
        catch (Exception ex)
        {
            _pumpFailure = ex;
            if (Volatile.Read(ref _userStop) == 0)
                CaptureFaulted?.Invoke(this, ex);
        }
    }

    private void PumpLoop(IWaveProvider source, WaveFileWriter writer, CancellationToken cancellationToken)
    {
        // MixingSampleProvider.Read() always fills the requested count (silence when a
        // source buffer is empty) — it never returns 0 — so this loop must pace itself
        // against a real-time clock instead of relying on "no data" to throttle itself.
        // Without this, it free-runs as fast as the CPU allows and balloons the WAV file
        // with silence far beyond the meeting's actual duration.
        var buffer = new byte[source.WaveFormat.AverageBytesPerSecond / 5];
        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
        var pauseSlice = new System.Diagnostics.Stopwatch();
        long bytesWritten = 0;
        var pauseAccumulatedMs = 0.0;
        var headerCadence = WavHeaderFlushCadence.ForFormat(source.WaveFormat, HeaderFlushInterval);

        while (!cancellationToken.IsCancellationRequested)
        {
            if (Volatile.Read(ref _paused) != 0)
            {
                if (!pauseSlice.IsRunning)
                    pauseSlice.Restart();

                _ = source.Read(buffer, 0, buffer.Length);
                Thread.Sleep(50);
                continue;
            }

            if (pauseSlice.IsRunning)
            {
                pauseAccumulatedMs += pauseSlice.Elapsed.TotalMilliseconds;
                pauseSlice.Reset();
            }

            var bytesRead = source.Read(buffer, 0, buffer.Length);
            if (bytesRead > 0)
            {
                writer.Write(buffer, 0, bytesRead);
                bytesWritten += bytesRead;

                // Same thread as Write, and Stop awaits the pump before Dispose, so this cannot
                // race either. Flush() rewrites the RIFF/data sizes and restores the position;
                // without it an abrupt exit leaves sizes of 0 and the audio unreadable.
                if (headerCadence.ShouldFlush(bytesWritten))
                    TryFlushHeader(writer);

                RaisePcmFrameIfNeeded(buffer, bytesRead, source.WaveFormat.SampleRate);
            }

            var expectedElapsedMs = bytesWritten * 1000.0 / source.WaveFormat.AverageBytesPerSecond;
            var sleepMs = expectedElapsedMs - (stopwatch.Elapsed.TotalMilliseconds - pauseAccumulatedMs);
            if (sleepMs > 0)
                Thread.Sleep((int)sleepMs);
        }
    }

    private static void TryFlushHeader(WaveFileWriter writer)
    {
        try
        {
            writer.Flush();
        }
        catch (IOException)
        {
            // Best effort (e.g. transient disk error): the final Flush/Dispose still writes the header.
        }
    }

    private void RaisePcmFrameIfNeeded(byte[] pcm16Le, int bytesRead, int sampleRate)
    {
        var handler = PcmFrameAvailable;
        if (handler is null || bytesRead < 2)
            return;

        var sampleCount = bytesRead / 2;
        var samples = new float[sampleCount];
        for (var i = 0; i < sampleCount; i++)
        {
            var pcm = BinaryPrimitives.ReadInt16LittleEndian(pcm16Le.AsSpan(i * 2, 2));
            samples[i] = pcm / 32768f;
        }

        handler(this, new PcmFrameEventArgs(samples, sampleRate));
    }

    public void Dispose()
    {
        try
        {
            Stop();
        }
        catch (Exception)
        {
            // Stop finished its teardown, and Dispose has nobody left to report the error to.
        }
    }
}
