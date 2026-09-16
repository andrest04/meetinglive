using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class NemotronAsrCatalogTests
{
    [Fact]
    public void MeetingGeometry_MatchesHuggingFaceVeryHighLatencyFrames()
    {
        Assert.Equal(340, NemotronAsrCatalog.MeetingChunkFrames);
        Assert.Equal(40, NemotronAsrCatalog.MeetingRightContextFrames);
        Assert.Equal(40, NemotronAsrCatalog.MeetingFifoFrames);
        Assert.Equal(300, NemotronAsrCatalog.MeetingUpdatePeriodFrames);
        Assert.Equal(188, NemotronAsrCatalog.MeetingSpkcacheFrames);
    }
}
