using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Streams mixed mic+loopback float32 frames into Nemotron 3.5 ASR (NeMo-Speech.cpp C ABI)
/// and publishes committed+interim text as it arrives. On <see cref="Stop"/> the stream is
/// finished and drained — that text is authoritative; the caller should not re-transcribe
/// the WAV unless this returns empty.
/// </summary>
public sealed class LiveTranscriptionService : ILiveTranscriptionService, IDisposable
{
    private readonly IAudioCaptureService _audioCapture;
    private readonly NemoSpeechRecognizerFactory _factory;
    private readonly object _gate = new();

    private INemoSpeechRecognizer? _recognizer;
    private INemoSpeechStream? _stream;
    private StreamingTranscriptAccumulator? _accumulator;
    private bool _running;

    public LiveTranscriptionService(
        IAudioCaptureService audioCapture,
        INemotronModelManager models,
        INemoSpeechRuntimeManager runtime,
        INemoSpeechAsrEngine engine,
        IHardwareDetectionService hardware)
    {
        _audioCapture = audioCapture;
        _factory = new NemoSpeechRecognizerFactory(models, runtime, engine, hardware);
    }

    public event EventHandler<string>? TranscriptUpdated;

    public void Start(string language)
    {
        Stop();

        var locale = NemotronLanguageMapper.ToNemotronLocale(language);
        var recognizer = _factory.Create();
        INemoSpeechStream stream;
        try
        {
            stream = recognizer.StartStream(locale);
        }
        catch
        {
            recognizer.Dispose();
            throw;
        }

        lock (_gate)
        {
            _recognizer = recognizer;
            _stream = stream;
            _accumulator = new StreamingTranscriptAccumulator();
            _running = true;
        }

        _audioCapture.PcmFrameAvailable += OnPcmFrame;
    }

    public string Stop()
    {
        _audioCapture.PcmFrameAvailable -= OnPcmFrame;

        INemoSpeechStream? stream;
        INemoSpeechRecognizer? recognizer;
        StreamingTranscriptAccumulator? accumulator;
        lock (_gate)
        {
            if (!_running)
                return string.Empty;

            stream = _stream;
            recognizer = _recognizer;
            accumulator = _accumulator;
            _stream = null;
            _recognizer = null;
            _accumulator = null;
            _running = false;
        }

        try
        {
            if (stream is not null && accumulator is not null)
            {
                foreach (var result in stream.FinishAndDrain())
                    accumulator.Apply(result);
                accumulator.CommitRemainingInterim();
            }
        }
        catch
        {
            // Best-effort finish — still return whatever was committed.
        }
        finally
        {
            stream?.Dispose();
            recognizer?.Dispose();
        }

        return accumulator?.CommittedText ?? string.Empty;
    }

    public void Dispose() => Stop();

    private void OnPcmFrame(object? sender, PcmFrameEventArgs e)
    {
        string? display = null;
        lock (_gate)
        {
            if (!_running || _stream is null || _accumulator is null)
                return;

            try
            {
                _stream.Push(e.Samples, e.SampleRate);
                foreach (var result in _stream.PullAvailable())
                    _accumulator.Apply(result);
                display = _accumulator.DisplayText;
            }
            catch
            {
                // Keep the recording alive; a later frame or Stop may still produce text.
                return;
            }
        }

        if (display is not null)
            TranscriptUpdated?.Invoke(this, display);
    }
}
