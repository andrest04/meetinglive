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

    public bool IsRecording { get; private set; }

    public event EventHandler<PcmFrameEventArgs>? PcmFrameAvailable;

    public void Start(string outputWavPath, string? microphoneDeviceId = null)
    {
        if (IsRecording)
            throw new InvalidOperationException("A recording is already in progress.");

        _micCapture = new WasapiCapture(MicrophoneDeviceResolver.Resolve(microphoneDeviceId));
        _systemCapture = new WasapiLoopbackCapture();

        var micBuffer = CreateBuffer(_micCapture.WaveFormat);
        var systemBuffer = CreateBuffer(_systemCapture.WaveFormat);

        _micCapture.DataAvailable += (_, e) => micBuffer.AddSamples(e.Buffer, 0, e.BytesRecorded);
        _systemCapture.DataAvailable += (_, e) => systemBuffer.AddSamples(e.Buffer, 0, e.BytesRecorded);

        var mixer = new MixingSampleProvider(MixFormat);
        mixer.AddMixerInput(ResampleToMixFormat(micBuffer.ToSampleProvider(), _micCapture.WaveFormat));
        mixer.AddMixerInput(ResampleToMixFormat(systemBuffer.ToSampleProvider(), _systemCapture.WaveFormat));

        var pcm16 = mixer.ToWaveProvider16();
        _writer = new WaveFileWriter(outputWavPath, pcm16.WaveFormat);

        _pumpCts = new CancellationTokenSource();
        _pumpTask = Task.Run(() => PumpLoop(pcm16, _writer, _pumpCts.Token));

        _micCapture.StartRecording();
        _systemCapture.StartRecording();
        IsRecording = true;
    }

    public void Stop()
    {
        if (!IsRecording)
            return;

        _micCapture?.StopRecording();
        _systemCapture?.StopRecording();

        _pumpCts?.Cancel();
        _pumpTask?.Wait();

        _writer?.Flush();
        _writer?.Dispose();
        _writer = null;

        _micCapture?.Dispose();
        _systemCapture?.Dispose();
        _micCapture = null;
        _systemCapture = null;

        IsRecording = false;
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
        long bytesWritten = 0;

        while (!cancellationToken.IsCancellationRequested)
        {
            var bytesRead = source.Read(buffer, 0, buffer.Length);
            if (bytesRead > 0)
            {
                writer.Write(buffer, 0, bytesRead);
                bytesWritten += bytesRead;
                RaisePcmFrameIfNeeded(buffer, bytesRead, source.WaveFormat.SampleRate);
            }

            var expectedElapsedMs = bytesWritten * 1000.0 / source.WaveFormat.AverageBytesPerSecond;
            var sleepMs = expectedElapsedMs - stopwatch.Elapsed.TotalMilliseconds;
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
