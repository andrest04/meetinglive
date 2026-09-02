using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class NemotronLanguageMapperTests
{
    [Theory]
    [InlineData("auto", "auto")]
    [InlineData("en", "en-US")]
    [InlineData("es", "es-US")]
    [InlineData("pt", "pt-BR")]
    [InlineData("fr", "fr-FR")]
    [InlineData("de", "de-DE")]
    [InlineData("it", "it-IT")]
    [InlineData("nl", "nl-NL")]
    [InlineData("ja", "ja-JP")]
    [InlineData("zh", "zh-CN")]
    public void ToNemotronLocale_MapsKnownCodes(string code, string expected)
    {
        Assert.Equal(expected, NemotronLanguageMapper.ToNemotronLocale(code));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("unknown")]
    public void ToNemotronLocale_UnknownOrEmpty_ReturnsAuto(string? code)
    {
        Assert.Equal("auto", NemotronLanguageMapper.ToNemotronLocale(code));
    }
}
