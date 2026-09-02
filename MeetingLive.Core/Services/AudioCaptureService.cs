using System.Buffers.Binary;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Captures microphone + system-audio (WASAPI loopback) simultaneously and mixes
/// them into a single 16kHz mono PCM WAV — the format Nemotron ASR expects — so no
/// voice in the meeting (neither the user's nor the other participants') is lost.
/// The same mixed stream is optionally raised as float32 frames for live streaming ASR.
/// </summary>
public sealed class AudioCaptureService : IAudioCaptureService, IDisposable
{
    private static readonly WaveFormat MixFormat = WaveFormat.CreateIeeeFloatWaveFormat(16000, 1);

    private WasapiCapture? _micCapture;
    private WasapiLoopbackCapture? _systemCapture;
    private WaveFileWriter? _writer;
    private CancellationTokenSource? _pumpCts;
    private Task? _pumpTask;
    private int _paused;

    public bool IsRecording { get; private set; }

    public bool IsPaused => Volatile.Read(ref _paused) != 0;

    public event EventHandler<PcmFrameEventArgs>? PcmFrameAvailable;

    public void Start(string outputWavPath, string? microphoneDeviceId = null)
    {
        if (IsRecording)
            throw new InvalidOperationException("A recording is already in progress.");

        WasapiCapture? micCapture = null;
        WasapiLoopbackCapture? systemCapture = null;
        WaveFileWriter? writer = null;
        CancellationTokenSource? pumpCts = null;
        Task? pumpTask = null;

        Volatile.Write(ref _paused, 0);

        try
        {
            micCapture = new WasapiCapture(MicrophoneDeviceResolver.Resolve(microphoneDeviceId));
            systemCapture = new WasapiLoopbackCapture();

            var micBuffer = CreateBuffer(micCapture.WaveFormat);
            var systemBuffer = CreateBuffer(systemCapture.WaveFormat);

            micCapture.DataAvailable += (_, e) => micBuffer.AddSamples(e.Buffer, 0, e.BytesRecorded);
            systemCapture.DataAvailable += (_, e) => systemBuffer.AddSamples(e.Buffer, 0, e.BytesRecorded);

            var mixer = new MixingSampleProvider(MixFormat);
            mixer.AddMixerInput(ResampleToMixFormat(micBuffer.ToSampleProvider(), micCapture.WaveFormat));
            mixer.AddMixerInput(ResampleToMixFormat(systemBuffer.ToSampleProvider(), systemCapture.WaveFormat));

            var pcm16 = mixer.ToWaveProvider16();
            writer = new WaveFileWriter(outputWavPath, pcm16.WaveFormat);

            pumpCts = new CancellationTokenSource();
            pumpTask = Task.Run(() => PumpLoop(pcm16, writer, pumpCts.Token));

            micCapture.StartRecording();
            systemCapture.StartRecording();

            _micCapture = micCapture;
            _systemCapture = systemCapture;
            _writer = writer;
            _pumpCts = pumpCts;
            _pumpTask = pumpTask;
            IsRecording = true;
        }
        catch
        {
            AbortFailedStart(micCapture, systemCapture, writer, pumpCts, pumpTask);
            throw;
        }
    }

    public void Stop()
    {
        // IDisposable and other sync callers cannot await. UI code must use StopAsync.
        StopAsync().GetAwaiter().GetResult();
    }

    public async Task StopAsync()
    {
        if (!IsRecording)
            return;

        _micCapture?.StopRecording();
        _systemCapture?.StopRecording();

        _pumpCts?.Cancel();
        if (_pumpTask is not null)
        {
            try
            {
                await _pumpTask.ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Pump observes the token and exits; ignore if cancel surfaces.
            }
        }

        _writer?.Flush();
        _writer?.Dispose();
        _writer = null;

        _micCapture?.Dispose();
        _systemCapture?.Dispose();
        _micCapture = null;
        _systemCapture = null;

        _pumpCts?.Dispose();
        _pumpCts = null;
        _pumpTask = null;

        IsRecording = false;
        Volatile.Write(ref _paused, 0);
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

    private static void AbortFailedStart(
        WasapiCapture? micCapture,
        WasapiLoopbackCapture? systemCapture,
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
            catch (OperationCanceledException)
            {
            }
        }

        writer?.Dispose();

        try
        {
            micCapture?.StopRecording();
        }
        catch (Exception)
        {
        }

        micCapture?.Dispose();

        try
        {
            systemCapture?.StopRecording();
        }
        catch (Exception)
        {
        }

        systemCapture?.Dispose();
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
                RaisePcmFrameIfNeeded(buffer, bytesRead, source.WaveFormat.SampleRate);
            }

            var expectedElapsedMs = bytesWritten * 1000.0 / source.WaveFormat.AverageBytesPerSecond;
            var sleepMs = expectedElapsedMs - (stopwatch.Elapsed.TotalMilliseconds - pauseAccumulatedMs);
            if (sleepMs > 0)
                Thread.Sleep((int)sleepMs);
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
        if (IsRecording)
            Stop();
    }
}
