using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace MeetingLive.Core.Services;

/// <summary>
/// WASAPI session enumeration of the default render endpoint through NAudio
/// (<see cref="AudioSessionManager.Sessions"/>). Not unit-tested: it only translates NAudio objects.
/// Not thread-safe; call it from one polling loop.
/// </summary>
public sealed class NAudioAudioSessionSource : IAudioSessionSource, IDisposable
{
    private MMDevice? _device;
    private List<(uint ProcessId, AudioSessionControl Session)> _cached = new();

    public IReadOnlyList<AudioSessionSnapshot> Enumerate()
    {
        ReleaseDevice();

        var result = new List<AudioSessionSnapshot>();
        var cached = new List<(uint, AudioSessionControl)>();
        try
        {
            using var enumerator = new MMDeviceEnumerator();
            // The default endpoint can change between calls (headphones plugged in), so it is resolved every time.
            _device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            var manager = _device.AudioSessionManager;
            manager.RefreshSessions();
            var sessions = manager.Sessions;
            for (var i = 0; i < sessions.Count; i++)
            {
                var session = sessions[i];
                if (TryRead(session, out var snapshot))
                {
                    result.Add(snapshot);
                    cached.Add((snapshot.ProcessId, session));
                }
            }
        }
        catch (Exception ex) when (ex is System.Runtime.InteropServices.COMException or InvalidOperationException)
        {
            // No render device or the audio service is restarting. Report no sessions.
        }

        _cached = cached;
        return result;
    }

    public IReadOnlyDictionary<uint, float> ReadPeaks()
    {
        var peaks = new Dictionary<uint, float>();
        foreach (var (processId, session) in _cached)
        {
            if (TryReadPeak(session, out var peak))
                peaks[processId] = Math.Max(peaks.GetValueOrDefault(processId), peak);
        }

        return peaks;
    }

    public void Dispose() => ReleaseDevice();

    private void ReleaseDevice()
    {
        _cached = new List<(uint, AudioSessionControl)>();
        _device?.Dispose();
        _device = null;
    }

    private static bool TryRead(AudioSessionControl session, out AudioSessionSnapshot snapshot)
    {
        snapshot = default;
        try
        {
            var peak = TryReadPeak(session, out var value) ? value : 0f;
            snapshot = new AudioSessionSnapshot(
                session.GetProcessID,
                session.IsSystemSoundsSession,
                session.State == AudioSessionState.AudioSessionStateActive,
                peak);
            return true;
        }
        catch (System.Runtime.InteropServices.COMException)
        {
            // Session expired between listing and reading.
            return false;
        }
    }

    private static bool TryReadPeak(AudioSessionControl session, out float peak)
    {
        try
        {
            peak = session.AudioMeterInformation.MasterPeakValue;
            return true;
        }
        catch (System.Runtime.InteropServices.COMException)
        {
            peak = 0f;
            return false;
        }
    }
}
