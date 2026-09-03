using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class FolderIconTests
{
    [Fact]
    public void ResolveKey_WhenStoredIsKnown_ReturnsCanonicalKey()
    {
        Assert.Equal("briefcase", FolderIcon.ResolveKey("Briefcase"));
    }

    [Fact]
    public void ResolveKey_WhenStoredMissing_ReturnsFolder()
    {
        Assert.Equal("folder", FolderIcon.ResolveKey(null));
    }

    [Fact]
    public void ResolveKey_WhenStoredUnknown_ReturnsFolder()
    {
        Assert.Equal("folder", FolderIcon.ResolveKey("not-a-real-icon"));
    }

    [Fact]
    public void Glyph_ForEveryKey_IsNonEmpty()
    {
        foreach (var key in FolderIcon.Keys)
            Assert.False(string.IsNullOrEmpty(FolderIcon.Glyph(key)));
    }

    [Fact]
    public void Glyph_WhenStoredMissing_UsesDefaultFolderGlyph()
    {
        Assert.Equal("\uE8B7", FolderIcon.Glyph(null));
        Assert.Equal(FolderIcon.Glyph("folder"), FolderIcon.ResolveGlyph(null));
    }
}
