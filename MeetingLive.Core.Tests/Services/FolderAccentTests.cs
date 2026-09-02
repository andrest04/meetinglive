using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class FolderAccentTests
{
    [Fact]
    public void ResolveKey_WhenStoredIsKnown_ReturnsCanonicalKey()
    {
        var id = Guid.NewGuid();

        Assert.Equal("blue", FolderAccent.ResolveKey("Blue", id));
    }

    [Fact]
    public void ResolveKey_WhenStoredMissing_IsStableForSameId()
    {
        var id = Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");

        var first = FolderAccent.ResolveKey(null, id);
        var second = FolderAccent.ResolveKey(null, id);

        Assert.Equal(first, second);
        Assert.Contains(first, FolderAccent.Keys);
    }

    [Fact]
    public void NextKey_SkipsAlreadyUsedColors()
    {
        var next = FolderAccent.NextKey(["blue", "teal"]);

        Assert.Equal("green", next);
    }
}
