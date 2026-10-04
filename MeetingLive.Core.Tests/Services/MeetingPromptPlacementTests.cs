using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class MeetingPromptPlacementTests
{
    [Fact]
    public void TopRight_PlacesWindowAtTopRightWithMargin()
    {
        var position = MeetingPromptPlacement.TopRight(420, 72, 0, 0, 1920, 1040, margin: 24);

        Assert.Equal(new PillPosition(1920 - 420 - 24, 24), position);
    }

    [Fact]
    public void TopRight_WhenAreaHasNonZeroOrigin_OffsetsFromThatOrigin()
    {
        // A secondary monitor to the left of the primary one has a negative origin.
        var position = MeetingPromptPlacement.TopRight(420, 72, -1920, 40, 1920, 1000, margin: 16);

        Assert.Equal(new PillPosition(-1920 + 1920 - 420 - 16, 40 + 16), position);
    }

    [Fact]
    public void TopRight_WhenMarginDoesNotFit_StillStaysInsideArea()
    {
        var position = MeetingPromptPlacement.TopRight(300, 200, 0, 0, 310, 205, margin: 40);

        Assert.True(position.X >= 0 && position.X + 300 <= 310);
        Assert.True(position.Y >= 0 && position.Y + 200 <= 205);
    }
}
