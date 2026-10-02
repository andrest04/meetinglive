namespace MeetingLive.Core.Services;

/// <summary>Maps raw audio amplitude onto a 0..1 meter position.</summary>
public static class AudioLevelMeter
{
    /// <summary>Quietest level shown on the meter, in dBFS. Anything below sits at 0.</summary>
    public const double FloorDecibels = -60;

    private const double MinAmplitude = 1e-6;

    /// <summary>
    /// Linear amplitude (RMS or peak, 0..1) to a dB-scaled meter value in 0..1: -60 dBFS is 0, 0 dBFS is 1.
    /// Speech sits around 0.05 RMS (about -26 dBFS), which lands near the middle instead of near the floor.
    /// </summary>
    public static double ToMeterValue(double amplitude)
    {
        if (double.IsNaN(amplitude))
            return 0;

        var decibels = 20 * Math.Log10(Math.Max(amplitude, MinAmplitude));
        return Math.Clamp((decibels - FloorDecibels) / -FloorDecibels, 0, 1);
    }
}
