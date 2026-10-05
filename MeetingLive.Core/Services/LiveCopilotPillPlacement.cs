namespace MeetingLive.Core.Services;

/// <summary>Top-left position of the live copilot pill window in physical screen pixels.</summary>
public readonly record struct PillPosition(int X, int Y);

/// <summary>
/// Pure placement math for the floating live copilot pill. Keeps the window fully inside a
/// monitor work area (the area minus the taskbar) so a saved position from a disconnected
/// monitor or a different DPI can never leave the pill unreachable.
/// </summary>
public static class LiveCopilotPillPlacement
{
    /// <summary>
    /// Returns the position closest to (<paramref name="x"/>, <paramref name="y"/>) that keeps a
    /// <paramref name="width"/> x <paramref name="height"/> window fully inside the work area. A window
    /// larger than the area is pinned to the area's top-left corner.
    /// </summary>
    public static PillPosition Clamp(
        int x, int y, int width, int height,
        int areaX, int areaY, int areaWidth, int areaHeight)
    {
        var maxX = Math.Max(areaX, areaX + areaWidth - width);
        var maxY = Math.Max(areaY, areaY + areaHeight - height);
        return new PillPosition(
            Math.Clamp(x, areaX, maxX),
            Math.Clamp(y, areaY, maxY));
    }
}
