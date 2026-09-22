using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class ChatThreadTitleTests
{
    [Fact]
    public void FromFirstMessage_TrimsAndCapsAtSixtyCharacters()
    {
        var title = ChatThreadTitle.FromFirstMessage("  " + new string('a', 80) + "  ");

        Assert.Equal(60, title.Length);
        Assert.Equal(new string('a', 60), title);
    }

    [Fact]
    public void FromFirstMessage_CollapsesLineBreaks()
    {
        var title = ChatThreadTitle.FromFirstMessage("First line\r\nsecond");

        Assert.Equal("First line second", title);
    }
}
