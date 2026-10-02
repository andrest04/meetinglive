using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// The Nemotron backend a recognizer was actually created on. <see cref="FallbackReason"/>
/// is set only when CUDA was preferred and ready but creating it failed, so the recognizer
/// runs on CPU instead; a machine without an NVIDIA GPU is Cpu with no reason.
/// </summary>
public sealed record AsrBackendUsage(NemoSpeechBackend Backend, string? FallbackReason);

/// <summary>
/// Shared source of truth for the backend the last live or offline recognizer used.
/// </summary>
/// <summary>
/// How much of a live session's audio never reached the live recognizer because the
/// bounded queue dropped it (the offline pass after Stop still transcribes all of it).
/// </summary>
public sealed record LiveDropSummary(TimeSpan DroppedDuration, TimeSpan TotalDuration)
{
    public double DroppedPercent =>
        TotalDuration <= TimeSpan.Zero ? 0 : DroppedDuration.TotalSeconds / TotalDuration.TotalSeconds * 100;
}

public interface IAsrBackendStatus
{
    /// <summary>Null until a recognizer has been created in this process.</summary>
    AsrBackendUsage? Current { get; }

    /// <summary>Raised on the thread that created the recognizer; UI subscribers must marshal.</summary>
    event EventHandler<AsrBackendUsage>? Changed;

    void Report(AsrBackendUsage usage);

    /// <summary>Null until a live session has stopped in this process.</summary>
    LiveDropSummary? LastLiveDrops { get; }

    /// <summary>Raised on the thread that stopped the live session; UI subscribers must marshal.</summary>
    event EventHandler<LiveDropSummary>? LiveDropsChanged;

    void ReportLiveDrops(LiveDropSummary summary);
}

public sealed class AsrBackendStatus : IAsrBackendStatus
{
    private readonly object _gate = new();
    private AsrBackendUsage? _current;
    private LiveDropSummary? _lastLiveDrops;

    public AsrBackendUsage? Current
    {
        get
        {
            lock (_gate)
                return _current;
        }
    }

    public event EventHandler<AsrBackendUsage>? Changed;

    public void Report(AsrBackendUsage usage)
    {
        ArgumentNullException.ThrowIfNull(usage);

        lock (_gate)
            _current = usage;

        Changed?.Invoke(this, usage);
    }

    public LiveDropSummary? LastLiveDrops
    {
        get
        {
            lock (_gate)
                return _lastLiveDrops;
        }
    }

    public event EventHandler<LiveDropSummary>? LiveDropsChanged;

    public void ReportLiveDrops(LiveDropSummary summary)
    {
        ArgumentNullException.ThrowIfNull(summary);

        lock (_gate)
            _lastLiveDrops = summary;

        LiveDropsChanged?.Invoke(this, summary);
    }
}
