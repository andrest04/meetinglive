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

    // Expanded window (capsule + chat panel): 64x240 capsule, 380x500 panel, 8 gap.
    private static PillBounds Expanded(DockEdge edge, int capsuleX, int capsuleY, int capsuleW, int capsuleH) =>
        LiveCopilotPillDock.ExpandedBounds(
            edge, capsuleX, capsuleY, capsuleW, capsuleH, 380, 500, 8, AreaX, AreaY, AreaWidth, AreaHeight);

    [Fact]
    public void ExpandedBounds_RightEdge_KeepsCapsuleOnTheRightAndGrowsTowardTheCenter()
    {
        var capsule = new PillPosition(1920 - 64 - 12, 400);

        var bounds = Expanded(DockEdge.Right, capsule.X, capsule.Y, 64, 240);

        Assert.Equal(64 + 8 + 380, bounds.Width);
        Assert.Equal(500, bounds.Height);
        Assert.Equal(capsule.X + 64, bounds.X + bounds.Width);
        Assert.Equal(capsule.Y + 120, bounds.Y + bounds.Height / 2);
    }

    [Fact]
    public void ExpandedBounds_LeftEdge_KeepsCapsuleOnTheLeft()
    {
        var bounds = Expanded(DockEdge.Left, 12, 400, 64, 240);

        Assert.Equal(12, bounds.X);
        Assert.Equal(64 + 8 + 380, bounds.Width);
    }

    [Fact]
    public void ExpandedBounds_TopEdge_OpensBelowTheCapsule()
    {
        var bounds = Expanded(DockEdge.Top, 800, 12, 272, 64);

        Assert.Equal(12, bounds.Y);
        Assert.Equal(64 + 8 + 500, bounds.Height);
        Assert.Equal(380, bounds.Width);
    }

    [Fact]
    public void ExpandedBounds_BottomEdge_OpensAboveTheCapsule()
    {
        var capsuleY = 1040 - 64 - 12;

        var bounds = Expanded(DockEdge.Bottom, 800, capsuleY, 272, 64);

        Assert.Equal(capsuleY + 64, bounds.Y + bounds.Height);
        Assert.Equal(64 + 8 + 500, bounds.Height);
    }

    [Fact]
    public void ExpandedBounds_CapsuleNearTheEnd_IsShiftedBackInsideTheArea()
    {
        // Capsule at the very bottom of the right edge: a 500 tall window cannot stay centered on it.
        var bounds = Expanded(DockEdge.Right, 1920 - 64 - 12, 1040 - 240 - 12, 64, 240);

        Assert.True(bounds.Y >= AreaY && bounds.Y + bounds.Height <= AreaY + AreaHeight);
        Assert.Equal(500, bounds.Height);
    }

    [Fact]
    public void ExpandedBounds_WhenPanelLargerThanArea_ShrinksToTheArea()
    {
        var bounds = LiveCopilotPillDock.ExpandedBounds(
            DockEdge.Right, 400, 50, 64, 240, 380, 500, 8, 0, 0, 500, 300);

        Assert.True(bounds.Width <= 500);
        Assert.True(bounds.Height <= 300);
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
