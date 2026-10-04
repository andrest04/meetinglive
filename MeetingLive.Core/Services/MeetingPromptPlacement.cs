namespace MeetingLive.Core.Services;

/// <summary>Pure placement math for the meeting-detected popup.</summary>
public static class MeetingPromptPlacement
{
    /// <summary>Top-right corner of the work area, inset by <paramref name="margin"/>, then clamped inside it.</summary>
    public static PillPosition TopRight(
        int width, int height,
        int areaX, int areaY, int areaWidth, int areaHeight,
        int margin) =>
        LiveCopilotPillPlacement.Clamp(
            areaX + areaWidth - width - margin,
            areaY + margin,
            width, height, areaX, areaY, areaWidth, areaHeight);
}
