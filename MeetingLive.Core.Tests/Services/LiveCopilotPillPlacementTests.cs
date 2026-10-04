using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class LiveCopilotPillPlacementTests
{
    // Work area used by most tests: a 1920x1040 area whose origin is (0, 0).
    private const int AreaX = 0;
    private const int AreaY = 0;
    private const int AreaWidth = 1920;
    private const int AreaHeight = 1040;

    [Fact]
    public void Clamp_WhenFullyInside_ReturnsSamePosition()
    {
        var position = LiveCopilotPillPlacement.Clamp(100, 200, 240, 48, AreaX, AreaY, AreaWidth, AreaHeight);

        Assert.Equal(new PillPosition(100, 200), position);
    }

    [Theory]
    [InlineData(-50, 100, 0, 100)]
    [InlineData(100, -30, 100, 0)]
    [InlineData(5000, 100, 1680, 100)]
    [InlineData(100, 5000, 100, 992)]
    [InlineData(5000, 5000, 1680, 992)]
    public void Clamp_WhenOutsideArea_PullsFullyInside(int x, int y, int expectedX, int expectedY)
    {
        var position = LiveCopilotPillPlacement.Clamp(x, y, 240, 48, AreaX, AreaY, AreaWidth, AreaHeight);

        Assert.Equal(new PillPosition(expectedX, expectedY), position);
    }

    [Fact]
    public void Clamp_WhenAreaHasNonZeroOrigin_StaysInsideThatArea()
    {
        // A secondary monitor to the left of the primary one has a negative origin.
        var position = LiveCopilotPillPlacement.Clamp(-5000, 5000, 240, 48, -1920, 0, 1920, 1040);

        Assert.Equal(new PillPosition(-1920, 992), position);
    }

    [Fact]
    public void Clamp_WhenWindowLargerThanArea_PinsToAreaOrigin()
    {
        var position = LiveCopilotPillPlacement.Clamp(300, 300, 800, 600, 10, 20, 400, 300);

        Assert.Equal(new PillPosition(10, 20), position);
    }

    [Fact]
    public void Clamp_WhenWindowExactlyFillsArea_ReturnsAreaOrigin()
    {
        var position = LiveCopilotPillPlacement.Clamp(50, 50, AreaWidth, AreaHeight, AreaX, AreaY, AreaWidth, AreaHeight);

        Assert.Equal(new PillPosition(AreaX, AreaY), position);
    }

    [Fact]
    public void DefaultBottomRight_PlacesWindowAtBottomRightWithMargin()
    {
        var position = LiveCopilotPillPlacement.DefaultBottomRight(240, 48, AreaX, AreaY, AreaWidth, AreaHeight, margin: 24);

        Assert.Equal(new PillPosition(1920 - 240 - 24, 1040 - 48 - 24), position);
    }

    [Fact]
    public void DefaultBottomRight_WhenAreaHasNonZeroOrigin_OffsetsFromThatOrigin()
    {
        var position = LiveCopilotPillPlacement.DefaultBottomRight(240, 48, 100, 50, 1000, 600, margin: 16);

        Assert.Equal(new PillPosition(100 + 1000 - 240 - 16, 50 + 600 - 48 - 16), position);
    }

    [Fact]
    public void DefaultBottomRight_WhenMarginDoesNotFit_StillStaysInsideArea()
    {
        var position = LiveCopilotPillPlacement.DefaultBottomRight(300, 200, 0, 0, 320, 210, margin: 40);

        Assert.True(position.X >= 0 && position.X + 300 <= 320);
        Assert.True(position.Y >= 0 && position.Y + 200 <= 210);
    }
}
