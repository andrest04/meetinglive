using System.Threading.Channels;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Streams mixed mic+loopback float32 frames into Nemotron 3.5 ASR (NeMo-Speech.cpp C ABI)
/// and publishes committed+interim text as it arrives for the Record-page preview.
/// The caller should still offline-recognize the WAV for the saved transcript.
/// PCM frames are queued with drop-oldest backpressure so native Push/Pull never blocks
/// the capture pump that writes the WAV.
/// </summary>
public sealed class LiveTranscriptionService : ILiveTranscriptionService, IDisposable
{
    private const int MaxQueuedFrames = 8;

    private readonly IAudioCaptureService _audioCapture;
    private readonly NemoSpeechRecognizerFactory _factory;
    private readonly object _gate = new();

    private ChannelWriter<(float[] Samples, int SampleRate)>? _frameWriter;
    private INemoSpeechRecognizer? _recognizer;
    private INemoSpeechStream? _stream;
    private StreamingTranscriptAccumulator? _accumulator;
    private Task? _worker;
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

    public void Start(string language, DateTimeOffset recordedAt)
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

        var channel = Channel.CreateBounded<(float[] Samples, int SampleRate)>(new BoundedChannelOptions(MaxQueuedFrames)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = true,
        });

        lock (_gate)
        {
            _recognizer = recognizer;
            _stream = stream;
            _accumulator = new StreamingTranscriptAccumulator(recordedAt);
            _running = true;
        }

        _frameWriter = channel.Writer;
        _worker = Task.Run(() => ProcessFramesAsync(channel.Reader));
        _audioCapture.PcmFrameAvailable += OnPcmFrame;
    }

    public void SetClockSkew(TimeSpan skew)
    {
        lock (_gate)
        {
            if (_accumulator is not null)
                _accumulator.ClockSkew = skew;
        }
    }

    public string Stop()
    {
        _audioCapture.PcmFrameAvailable -= OnPcmFrame;

        var writer = Interlocked.Exchange(ref _frameWriter, null);
        writer?.TryComplete();

        var worker = Interlocked.Exchange(ref _worker, null);
        if (worker is not null)
        {
            try
            {
                worker.GetAwaiter().GetResult();
            }
            catch (Exception ex) when (ex is OperationCanceledException or ChannelClosedException)
            {
                // Worker observed shutdown; still finish the native stream below.
            }
        }

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

        // Do not call FinishAndDrain: nemo_speech_asr_stream_finish on a long CUDA
        // session aborts the process (ucrtbase 0xC0000409). Offline TranscribeAsync
        // re-reads the WAV with a new stream. Close this stream so the recognizer
        // can be destroyed before the offline pass creates another.
        accumulator?.CommitRemainingInterim();
        stream?.Dispose();
        recognizer?.Dispose();

        return accumulator?.CommittedText ?? string.Empty;
    }

    public void Dispose() => Stop();

    private void OnPcmFrame(object? sender, PcmFrameEventArgs e)
    {
        // Must not wait for native ASR — the capture pump writes the WAV on this thread.
        _frameWriter?.TryWrite((e.Samples, e.SampleRate));
    }

    private async Task ProcessFramesAsync(ChannelReader<(float[] Samples, int SampleRate)> reader)
    {
        try
        {
            await foreach (var frame in reader.ReadAllAsync().ConfigureAwait(false))
            {
                string? display = null;
                lock (_gate)
                {
                    if (!_running || _stream is null || _accumulator is null)
                        continue;

                    try
                    {
                        _stream.Push(frame.Samples, frame.SampleRate);
                        foreach (var result in _stream.PullAvailable())
                            _accumulator.Apply(result);
                        display = _accumulator.DisplayText;
                    }
                    catch
                    {
                        // Keep the recording alive; a later frame or Stop may still produce text.
                        continue;
                    }
                }

                if (display is not null)
                    TranscriptUpdated?.Invoke(this, display);
            }
        }
        catch (ChannelClosedException)
        {
            // Writer completed while we were reading.
        }
    }
}
