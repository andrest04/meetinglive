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
public interface IAsrBackendStatus
{
    /// <summary>Null until a recognizer has been created in this process.</summary>
    AsrBackendUsage? Current { get; }

    /// <summary>Raised on the thread that created the recognizer; UI subscribers must marshal.</summary>
    event EventHandler<AsrBackendUsage>? Changed;

    void Report(AsrBackendUsage usage);
}

public sealed class AsrBackendStatus : IAsrBackendStatus
{
    private readonly object _gate = new();
    private AsrBackendUsage? _current;

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
}
