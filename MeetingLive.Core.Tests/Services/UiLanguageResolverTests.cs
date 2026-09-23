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
}
