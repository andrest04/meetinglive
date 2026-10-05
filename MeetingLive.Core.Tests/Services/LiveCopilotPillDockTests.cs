using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class LiveCopilotPillDockTests
{
    // 1920x1040 work area at the origin; vertical capsule 64x184, horizontal 184x64.
    private const int AreaX = 0;
    private const int AreaY = 0;
    private const int AreaWidth = 1920;
    private const int AreaHeight = 1040;
    private const int Margin = 12;

    [Theory]
    [InlineData(DockEdge.Left, true)]
    [InlineData(DockEdge.Right, true)]
    [InlineData(DockEdge.Top, false)]
    [InlineData(DockEdge.Bottom, false)]
    public void IsVertical_OnlyForLeftAndRight(DockEdge edge, bool expected) =>
        Assert.Equal(expected, LiveCopilotPillDock.IsVertical(edge));

    [Fact]
    public void Default_IsRightEdgeCentered()
    {
        Assert.Equal(DockEdge.Right, LiveCopilotPillDock.DefaultEdge);
        Assert.Equal(0.5, LiveCopilotPillDock.DefaultAlong);
    }

    [Theory]
    [InlineData(20, 500, DockEdge.Left)]
    [InlineData(1900, 500, DockEdge.Right)]
    [InlineData(900, 10, DockEdge.Top)]
    [InlineData(900, 1030, DockEdge.Bottom)]
    public void NearestEdge_PicksTheClosestEdge(int centerX, int centerY, DockEdge expected)
    {
        var edge = LiveCopilotPillDock.NearestEdge(centerX, centerY, AreaX, AreaY, AreaWidth, AreaHeight);

        Assert.Equal(expected, edge);
    }

    [Fact]
    public void NearestEdge_DroppedAtScreenCenter_SnapsToAnEdge()
    {
        // 960x520 is 520 from top/bottom and 960 from left/right: the vertical axis wins.
        var edge = LiveCopilotPillDock.NearestEdge(960, 520, AreaX, AreaY, AreaWidth, AreaHeight);

        Assert.Contains(edge, new[] { DockEdge.Top, DockEdge.Bottom });
    }

    [Fact]
    public void NearestEdge_OnExactTie_PrefersRightThenLeftThenBottom()
    {
        // Square 1000x1000 area, center point equidistant from all four edges.
        Assert.Equal(DockEdge.Right, LiveCopilotPillDock.NearestEdge(500, 500, 0, 0, 1000, 1000));
        // Left/top tie only (distance 100 from both): left wins over top.
        Assert.Equal(DockEdge.Left, LiveCopilotPillDock.NearestEdge(100, 100, 0, 0, 1000, 1000));
        // Bottom/left tie only: left wins over bottom.
        Assert.Equal(DockEdge.Left, LiveCopilotPillDock.NearestEdge(100, 900, 0, 0, 1000, 1000));
    }

    [Fact]
    public void NearestEdge_WithNonZeroOrigin_IsRelativeToTheArea()
    {
        // Secondary monitor to the left of the primary one.
        var edge = LiveCopilotPillDock.NearestEdge(-1900, 500, -1920, 0, 1920, 1040);

        Assert.Equal(DockEdge.Left, edge);
    }

    [Fact]
    public void PositionFor_RightEdgeCentered_HugsRightWithMargin()
    {
        var position = LiveCopilotPillDock.PositionFor(
            DockEdge.Right, 0.5, 64, 184, AreaX, AreaY, AreaWidth, AreaHeight, Margin);

        Assert.Equal(new PillPosition(1920 - 64 - Margin, Margin + (1040 - 184 - 2 * Margin) / 2), position);
    }

    [Fact]
    public void PositionFor_LeftEdge_HugsLeftWithMargin()
    {
        var position = LiveCopilotPillDock.PositionFor(
            DockEdge.Left, 0, 64, 184, AreaX, AreaY, AreaWidth, AreaHeight, Margin);

        Assert.Equal(new PillPosition(Margin, Margin), position);
    }

    [Fact]
    public void PositionFor_TopEdge_SlidesAlongX()
    {
        var position = LiveCopilotPillDock.PositionFor(
            DockEdge.Top, 1, 184, 64, AreaX, AreaY, AreaWidth, AreaHeight, Margin);

        Assert.Equal(new PillPosition(1920 - 184 - Margin, Margin), position);
    }

    [Fact]
    public void PositionFor_BottomEdge_HugsBottomWithMargin()
    {
        var position = LiveCopilotPillDock.PositionFor(
            DockEdge.Bottom, 0, 184, 64, AreaX, AreaY, AreaWidth, AreaHeight, Margin);

        Assert.Equal(new PillPosition(Margin, 1040 - 64 - Margin), position);
    }

    [Fact]
    public void PositionFor_WithNonZeroOrigin_OffsetsFromThatOrigin()
    {
        var position = LiveCopilotPillDock.PositionFor(
            DockEdge.Left, 0, 64, 184, -1920, 100, 1920, 1040, Margin);

        Assert.Equal(new PillPosition(-1920 + Margin, 100 + Margin), position);
    }

    [Theory]
    [InlineData(-3.0)]
    [InlineData(7.0)]
    [InlineData(double.NaN)]
    public void PositionFor_AlongOutOfRange_StaysInsideTheArea(double along)
    {
        var position = LiveCopilotPillDock.PositionFor(
            DockEdge.Right, along, 64, 184, AreaX, AreaY, AreaWidth, AreaHeight, Margin);

        Assert.True(position.Y >= AreaY && position.Y + 184 <= AreaY + AreaHeight);
    }

    [Fact]
    public void PositionFor_WhenCapsuleDoesNotFit_PinsToTheAreaStart()
    {
        var position = LiveCopilotPillDock.PositionFor(
            DockEdge.Right, 0.5, 64, 400, 0, 0, 500, 300, Margin);

        Assert.Equal(Margin + 0, position.Y);
    }

    [Theory]
    [InlineData(DockEdge.Right, 0.0)]
    [InlineData(DockEdge.Right, 0.5)]
    [InlineData(DockEdge.Right, 1.0)]
    [InlineData(DockEdge.Left, 0.25)]
    public void AlongFor_RoundTripsVerticalEdges(DockEdge edge, double along)
    {
        var position = LiveCopilotPillDock.PositionFor(
            edge, along, 64, 184, AreaX, AreaY, AreaWidth, AreaHeight, Margin);

        var result = LiveCopilotPillDock.AlongFor(
            edge, position.X, position.Y, 64, 184, AreaX, AreaY, AreaWidth, AreaHeight, Margin);

        Assert.Equal(along, result, precision: 2);
    }

    [Theory]
    [InlineData(DockEdge.Top, 0.0)]
    [InlineData(DockEdge.Top, 0.75)]
    [InlineData(DockEdge.Bottom, 1.0)]
    [InlineData(DockEdge.Bottom, 0.4)]
    public void AlongFor_RoundTripsHorizontalEdges(DockEdge edge, double along)
    {
        var position = LiveCopilotPillDock.PositionFor(
            edge, along, 184, 64, AreaX, AreaY, AreaWidth, AreaHeight, Margin);

        var result = LiveCopilotPillDock.AlongFor(
            edge, position.X, position.Y, 184, 64, AreaX, AreaY, AreaWidth, AreaHeight, Margin);

        Assert.Equal(along, result, precision: 2);
    }

    [Fact]
    public void AlongFor_WhenDraggedPastTheEnds_IsClampedToZeroAndOne()
    {
        Assert.Equal(0, LiveCopilotPillDock.AlongFor(
            DockEdge.Right, 0, -500, 64, 184, AreaX, AreaY, AreaWidth, AreaHeight, Margin));
        Assert.Equal(1, LiveCopilotPillDock.AlongFor(
            DockEdge.Right, 0, 5000, 64, 184, AreaX, AreaY, AreaWidth, AreaHeight, Margin));
    }

    [Fact]
    public void AlongFor_WhenNoRoomToTravel_ReturnsTheDefault()
    {
        var along = LiveCopilotPillDock.AlongFor(
            DockEdge.Right, 0, 0, 64, 400, 0, 0, 500, 300, Margin);

        Assert.Equal(LiveCopilotPillDock.DefaultAlong, along);
    }

    [Theory]
    [InlineData("Left", DockEdge.Left)]
    [InlineData("right", DockEdge.Right)]
    [InlineData("TOP", DockEdge.Top)]
    [InlineData("Bottom", DockEdge.Bottom)]
    [InlineData(null, DockEdge.Right)]
    [InlineData("", DockEdge.Right)]
    [InlineData("diagonal", DockEdge.Right)]
    [InlineData("7", DockEdge.Right)]
    public void ParseEdge_FallsBackToTheDefaultEdge(string? raw, DockEdge expected) =>
        Assert.Equal(expected, LiveCopilotPillDock.ParseEdge(raw));
}
