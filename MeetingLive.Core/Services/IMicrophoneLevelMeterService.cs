namespace MeetingLive.Core.Services;

/// <summary>
/// Live microphone input-level preview for the Settings page — independent from
/// <see cref="IAudioCaptureService"/>, writes nothing to disk, and exists only so the user can
/// visually confirm the selected microphone is picking up sound before starting a real recording.
/// </summary>
public interface IMicrophoneLevelMeterService
{
    /// <summary>Raised (on a background thread — the caller must marshal to the UI thread) with
    /// the current input amplitude, normalized to 0.0 (silence) – 1.0 (peak).</summary>
    event EventHandler<float>? LevelChanged;

    /// <summary>Opens the given microphone (or the OS default when <paramref name="deviceId"/> is
    /// null/empty/stale) and starts raising <see cref="LevelChanged"/>. Never throws — if the
    /// device can't be opened (e.g. busy), this is a no-op and no levels are raised.</summary>
    void Start(string? deviceId);

    /// <summary>Stops and disposes the preview capture. Safe to call multiple times, and safe to
    /// call when not started.</summary>
    void Stop();
}
