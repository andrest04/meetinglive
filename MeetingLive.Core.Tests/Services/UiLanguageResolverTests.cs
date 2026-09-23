using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class UiLanguageResolverTests
{
    [Fact]
    public void ResolveCulture_English_ReturnsEnglishCulture()
    {
        var culture = UiLanguageResolver.ResolveCulture(UiLanguageResolver.English);

        Assert.NotNull(culture);
        Assert.Equal("en-US", culture!.Name);
    }

    [Fact]
    public void ResolveCulture_Spanish_ReturnsSpanishCulture()
    {
        var culture = UiLanguageResolver.ResolveCulture(UiLanguageResolver.Spanish);

        Assert.NotNull(culture);
        Assert.Equal("es", culture!.Name);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ResolveCulture_WhenNullOrBlank_ReturnsNull(string? tag)
    {
        Assert.Null(UiLanguageResolver.ResolveCulture(tag));
    }

    [Fact]
    public void ResolveCulture_WhenUnrecognizedTag_ReturnsNull()
    {
        Assert.Null(UiLanguageResolver.ResolveCulture("xx-99-INVALID!"));
    }

    [Fact]
    public void MatchPrimarySubtag_WhenCandidateHasRegion_MatchesAvailablePrimaryOnly()
    {
        var match = UiLanguageResolver.MatchPrimarySubtag("es-ES", ["en-US", "es"]);

        Assert.Equal("es", match);
    }

    [Fact]
    public void MatchPrimarySubtag_WhenAvailableHasRegion_MatchesCandidatePrimaryOnly()
    {
        var match = UiLanguageResolver.MatchPrimarySubtag("en-GB", ["en-US", "es"]);

        Assert.Equal("en-US", match);
    }

    [Fact]
    public void MatchPrimarySubtag_IsCaseInsensitive()
    {
        var match = UiLanguageResolver.MatchPrimarySubtag("ES-es", ["en-US", "es"]);

        Assert.Equal("es", match);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void MatchPrimarySubtag_WhenCandidateNullOrBlank_ReturnsNull(string? candidateTag)
    {
        Assert.Null(UiLanguageResolver.MatchPrimarySubtag(candidateTag, ["en-US", "es"]));
    }

    [Fact]
    public void MatchPrimarySubtag_WhenNoMatch_ReturnsNull()
    {
        Assert.Null(UiLanguageResolver.MatchPrimarySubtag("fr-FR", ["en-US", "es"]));
    }
}
