using MeetingLive.Core.Models;

namespace MeetingLive.Core.Tests.Models;

public class AppSettingsTests
{
    [Fact]
    public void ResolveTranscriptionLanguage_WhenUnset_ReturnsSpanish()
    {
        var settings = new AppSettings();

        Assert.Equal("es", settings.ResolveTranscriptionLanguage());
    }

    [Theory]
    [InlineData("en")]
    [InlineData("auto")]
    [InlineData("es")]
    public void ResolveTranscriptionLanguage_WhenSet_ReturnsPinnedCode(string code)
    {
        var settings = new AppSettings { TranscriptionLanguage = code };

        Assert.Equal(code, settings.ResolveTranscriptionLanguage());
    }

    [Fact]
    public void ResolveSummaryLanguage_WhenUnset_ReturnsSpanish()
    {
        var settings = new AppSettings();

        Assert.Equal("es", settings.ResolveSummaryLanguage());
    }

    [Fact]
    public void ResolveSummaryLanguage_WhenEnglish_ReturnsEnglish()
    {
        var settings = new AppSettings { SummaryLanguage = "en" };

        Assert.Equal("en", settings.ResolveSummaryLanguage());
    }
}
