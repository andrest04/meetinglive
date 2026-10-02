using System.Threading.Channels;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Streams mixed mic+loopback float32 frames into Nemotron 3.5 ASR (NeMo-Speech.cpp C ABI)
/// and publishes committed+interim text as it arrives. Non-empty <see cref="Stop"/>
/// text is the draft saved at Stop; the WAV is re-read afterwards and replaces it.
/// PCM frames are queued with drop-oldest backpressure so native Push/Pull never blocks
/// the capture pump that writes the WAV.
/// </summary>
public sealed class LiveTranscriptionService : ILiveTranscriptionService, IDisposable
{
    private const int MaxQueuedFrames = 8;

    private readonly IAudioCaptureService _audioCapture;
    private readonly NemoSpeechRecognizerFactory _factory;
    private readonly object _gate = new();
    private readonly IAsrBackendStatus? _backendStatus;

    private ChannelWriter<(float[] Samples, int SampleRate)>? _frameWriter;
    private INemoSpeechRecognizer? _recognizer;
    private INemoSpeechStream? _stream;
    private StreamingTranscriptAccumulator? _accumulator;
    private Task? _worker;
    private bool _running;
    private long _totalTicks;
    private long _droppedTicks;

    public LiveTranscriptionService(
        IAudioCaptureService audioCapture,
        INemotronModelManager models,
        INemoSpeechRuntimeManager runtime,
        INemoSpeechAsrEngine engine,
        IHardwareDetectionService hardware,
        IAsrBackendStatus? backendStatus = null)
    {
        _audioCapture = audioCapture;
        _backendStatus = backendStatus;
        _factory = new NemoSpeechRecognizerFactory(models, runtime, engine, hardware, backendStatus);
    }

    public event EventHandler<LiveTranscriptUpdate>? TranscriptUpdated;

    public void Start(string language, DateTimeOffset recordedAt, bool enableSpeakerDiarization = false)
    {
        Stop();

        var locale = NemotronLanguageMapper.ToNemotronLocale(language);
        var recognizer = _factory.Create(enableSpeakerDiarization);
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
        }, OnFrameDropped);

        Interlocked.Exchange(ref _totalTicks, 0);
        Interlocked.Exchange(ref _droppedTicks, 0);

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
        // session aborts the process (ucrtbase 0xC0000409). Close this stream so the
        // offline WAV pass can create another recognizer.
        accumulator?.CommitRemainingInterim();
        stream?.Dispose();
        recognizer?.Dispose();

        // The worker has finished, so the counters are final. Published before returning so
        // Settings reflects the session that just ended.
        _backendStatus?.ReportLiveDrops(new LiveDropSummary(
            TimeSpan.FromTicks(Interlocked.Read(ref _droppedTicks)),
            TimeSpan.FromTicks(Interlocked.Read(ref _totalTicks))));

        return accumulator?.CommittedText ?? string.Empty;
    }

    public void Dispose() => Stop();

    private void OnPcmFrame(object? sender, PcmFrameEventArgs e)
    {
        // Must not wait for native ASR — the capture pump writes the WAV on this thread.
        var writer = _frameWriter;
        if (writer is null)
            return;

        Interlocked.Add(ref _totalTicks, DurationTicks(e.Samples.Length, e.SampleRate));
        writer.TryWrite((e.Samples, e.SampleRate));
    }

    // DropOldest still reports TryWrite as true; this callback is the only signal that a frame was lost.
    private void OnFrameDropped((float[] Samples, int SampleRate) frame) =>
        Interlocked.Add(ref _droppedTicks, DurationTicks(frame.Samples.Length, frame.SampleRate));

    private static long DurationTicks(int sampleCount, int sampleRate) =>
        sampleRate <= 0 ? 0 : sampleCount * TimeSpan.TicksPerSecond / sampleRate;

    private async Task ProcessFramesAsync(ChannelReader<(float[] Samples, int SampleRate)> reader)
    {
        try
        {
            await foreach (var frame in reader.ReadAllAsync().ConfigureAwait(false))
            {
                string? display = null;
                var committed = string.Empty;
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
                        committed = _accumulator.CommittedText;
                    }
                    catch
                    {
                        // Keep the recording alive; a later frame or Stop may still produce text.
                        continue;
                    }
                }

                // Outside the gate, and never a provider or detector call — OnPcmFrame must stay non-blocking.
                if (display is not null)
                    TranscriptUpdated?.Invoke(this, new LiveTranscriptUpdate(display, committed));
            }
        }
        catch (ChannelClosedException)
        {
            // Writer completed while we were reading.
        }
    }
}
