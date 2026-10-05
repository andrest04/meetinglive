namespace MeetingLive.Core.Services;

/// <summary>Screen edge the live copilot capsule is docked to.</summary>
public enum DockEdge
{
    Left,
    Right,
    Top,
    Bottom
}

/// <summary>
/// Pure dock math for the live copilot capsule: which edge a drop snaps to, where the capsule sits on
/// an edge, and how far along that edge it is (0..1). The capsule is never free-floating, so only an
/// edge and a fractional offset are persisted; that stays valid across monitors and DPI changes.
/// </summary>
public static class LiveCopilotPillDock
{
    /// <summary>Edge used when nothing is saved: the middle of the right edge.</summary>
    public const DockEdge DefaultEdge = DockEdge.Right;

    /// <summary>Offset along the edge used when nothing is saved: centered.</summary>
    public const double DefaultAlong = 0.5;

    /// <summary>The capsule is vertical on the left and right edges and horizontal on top and bottom.</summary>
    public static bool IsVertical(DockEdge edge) => edge is DockEdge.Left or DockEdge.Right;

    /// <summary>
    /// The edge closest to the capsule center. An exact tie prefers Right, then Left, then Bottom, then
    /// Top, so the result is deterministic and favors the default edge.
    /// </summary>
    public static DockEdge NearestEdge(
        int centerX, int centerY,
        int areaX, int areaY, int areaWidth, int areaHeight)
    {
        var right = areaX + areaWidth - centerX;
        var left = centerX - areaX;
        var bottom = areaY + areaHeight - centerY;
        var top = centerY - areaY;

        var edge = DockEdge.Right;
        var best = right;
        if (left < best) { edge = DockEdge.Left; best = left; }
        if (bottom < best) { edge = DockEdge.Bottom; best = bottom; }
        if (top < best) edge = DockEdge.Top;
        return edge;
    }

    /// <summary>
    /// Top-left position of a <paramref name="width"/> x <paramref name="height"/> capsule docked to
    /// <paramref name="edge"/>, <paramref name="margin"/> away from it, at fractional offset
    /// <paramref name="along"/> (0 = start, 1 = end) of the free travel along that edge. The offset is
    /// clamped and a non-finite value falls back to <see cref="DefaultAlong"/>. A capsule longer than
    /// the edge is pinned to its start.
    /// </summary>
    public static PillPosition PositionFor(
        DockEdge edge, double along, int width, int height,
        int areaX, int areaY, int areaWidth, int areaHeight, int margin)
    {
        var t = double.IsFinite(along) ? Math.Clamp(along, 0, 1) : DefaultAlong;

        if (IsVertical(edge))
        {
            var x = edge == DockEdge.Left ? areaX + margin : areaX + areaWidth - width - margin;
            var y = areaY + margin + (int)Math.Round(t * TravelRange(areaHeight, height, margin));
            return new PillPosition(x, y);
        }

        var px = areaX + margin + (int)Math.Round(t * TravelRange(areaWidth, width, margin));
        var py = edge == DockEdge.Top ? areaY + margin : areaY + areaHeight - height - margin;
        return new PillPosition(px, py);
    }

    /// <summary>
    /// Inverse of <see cref="PositionFor"/>: the 0..1 offset along <paramref name="edge"/> for a capsule
    /// whose top-left is (<paramref name="x"/>, <paramref name="y"/>). Clamped; when the capsule has no
    /// room to travel the result is <see cref="DefaultAlong"/>.
    /// </summary>
    public static double AlongFor(
        DockEdge edge, int x, int y, int width, int height,
        int areaX, int areaY, int areaWidth, int areaHeight, int margin)
    {
        var (offset, range) = IsVertical(edge)
            ? (y - areaY - margin, TravelRange(areaHeight, height, margin))
            : (x - areaX - margin, TravelRange(areaWidth, width, margin));

        return range <= 0 ? DefaultAlong : Math.Clamp((double)offset / range, 0, 1);
    }

    /// <summary>Parses a persisted edge name, ignoring case; anything unknown yields <see cref="DefaultEdge"/>.</summary>
    public static DockEdge ParseEdge(string? raw) =>
        Enum.TryParse<DockEdge>(raw, ignoreCase: true, out var edge) && Enum.IsDefined(edge)
            ? edge
            : DefaultEdge;

    private static int TravelRange(int areaLength, int capsuleLength, int margin) =>
        Math.Max(0, areaLength - capsuleLength - 2 * margin);
}
