using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace MeetingLive.Core.Services;

/// <summary>
/// Live microphone input-level preview for Settings. Opens a <see cref="WasapiCapture"/> on the
/// resolved device and raises <see cref="LevelChanged"/> with a normalized RMS amplitude per
/// buffer — no file writing, nothing persisted or transcribed, and fully independent from
/// <see cref="AudioCaptureService"/>'s real recording pipeline.
/// </summary>
public sealed class MicrophoneLevelMeterService : IMicrophoneLevelMeterService, IDisposable
{
    private readonly object _gate = new();
    private WasapiCapture? _capture;

    public event EventHandler<float>? LevelChanged;

    public void Start(string? deviceId)
    {
        Stop();

        try
        {
            var capture = new WasapiCapture(MicrophoneDeviceResolver.Resolve(deviceId));
            capture.DataAvailable += OnDataAvailable;
            capture.RecordingStopped += OnRecordingStopped;
            capture.StartRecording();
            _capture = capture;
        }
        catch (Exception)
        {
            // Device busy / unavailable / any WASAPI failure — the preview meter is best-effort
            // and must never crash Settings just because the level can't be shown right now.
            _capture = null;
        }
    }

    public void Stop()
    {
        WasapiCapture? capture;
        lock (_gate)
        {
            capture = _capture;
            _capture = null;
        }

        if (capture is null)
            return;

        capture.DataAvailable -= OnDataAvailable;
        capture.RecordingStopped -= OnRecordingStopped;

        try
        {
            capture.StopRecording();
        }
        catch (Exception)
        {
            // Best-effort stop — nothing meaningful to recover from here.
        }

        capture.Dispose();
    }

    private void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        if (e.BytesRecorded == 0 || sender is not WasapiCapture capture)
            return;

        var level = ComputeRmsLevel(e.Buffer, e.BytesRecorded, capture.WaveFormat);
        LevelChanged?.Invoke(this, level);
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        // A capture that stops itself (device removed mid-preview) must still report silence
        // and get disposed rather than leaving Settings holding a dead capture instance.
        // Stop() may already own this instance — dispose only if we still hold it.
        if (sender is not WasapiCapture capture)
            return;

        capture.DataAvailable -= OnDataAvailable;
        capture.RecordingStopped -= OnRecordingStopped;

        var shouldDispose = false;
        lock (_gate)
        {
            if (ReferenceEquals(_capture, capture))
            {
                _capture = null;
                shouldDispose = true;
            }
        }

        if (shouldDispose)
            capture.Dispose();

        LevelChanged?.Invoke(this, 0f);
    }

    /// <summary>Computes a normalized (0.0–1.0) RMS amplitude for one capture buffer, supporting
    /// the sample formats WASAPI capture devices commonly report (32-bit IEEE float, 16-bit PCM,
    /// 32-bit PCM).</summary>
    private static float ComputeRmsLevel(byte[] buffer, int bytesRecorded, WaveFormat format)
    {
        double sumSquares = 0;
        int sampleCount = 0;

        if (format.Encoding == WaveFormatEncoding.IeeeFloat && format.BitsPerSample == 32)
        {
            for (var i = 0; i + 4 <= bytesRecorded; i += 4)
            {
                var sample = BitConverter.ToSingle(buffer, i);
                sumSquares += sample * sample;
                sampleCount++;
            }
        }
        else if (format.BitsPerSample == 16)
        {
            for (var i = 0; i + 2 <= bytesRecorded; i += 2)
            {
                var sample = BitConverter.ToInt16(buffer, i) / 32768f;
                sumSquares += sample * sample;
                sampleCount++;
            }
        }
        else if (format.BitsPerSample == 32)
        {
            for (var i = 0; i + 4 <= bytesRecorded; i += 4)
            {
                var sample = BitConverter.ToInt32(buffer, i) / (float)int.MaxValue;
                sumSquares += sample * sample;
                sampleCount++;
            }
        }
        else
        {
            return 0f;
        }

        if (sampleCount == 0)
            return 0f;

        var rms = Math.Sqrt(sumSquares / sampleCount);
        return (float)Math.Clamp(rms, 0.0, 1.0);
    }

    public void Dispose() => Stop();
}
