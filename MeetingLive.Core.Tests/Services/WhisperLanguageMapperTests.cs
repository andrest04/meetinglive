using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class WhisperLanguageMapperTests
{
    [Theory]
    [InlineData("auto", "auto")]
    [InlineData("en", "en")]
    [InlineData("es", "es")]
    [InlineData("pt", "pt")]
    [InlineData("fr", "fr")]
    [InlineData("de", "de")]
    [InlineData("it", "it")]
    [InlineData("nl", "nl")]
    [InlineData("ja", "ja")]
    [InlineData("zh", "zh")]
    public void ToWhisperLanguage_MapsKnownCodes(string code, string expected)
    {
        Assert.Equal(expected, WhisperLanguageMapper.ToWhisperLanguage(code));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("unknown")]
    public void ToWhisperLanguage_UnknownOrEmpty_ReturnsAuto(string? code)
    {
        Assert.Equal("auto", WhisperLanguageMapper.ToWhisperLanguage(code));
    }
}
