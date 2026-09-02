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
    public void ResolveNavigationPaneLength_WhenUnset_ReturnsDefault()
    {
        var settings = new AppSettings();

        Assert.Equal(AppSettings.DefaultNavigationPaneLength, settings.ResolveNavigationPaneLength());
    }

    [Theory]
    [InlineData(150, AppSettings.MinNavigationPaneLength)]
    [InlineData(200, 200)]
    [InlineData(320, 320)]
    [InlineData(600, AppSettings.MaxNavigationPaneLength)]
    public void ResolveNavigationPaneLength_ClampsToAllowedRange(double stored, double expected)
    {
        var settings = new AppSettings { NavigationPaneLength = stored };

        Assert.Equal(expected, settings.ResolveNavigationPaneLength());
    }

    [Fact]
    public void ResolveSummaryLanguage_WhenEnglish_ReturnsEnglish()
    {
        var settings = new AppSettings { SummaryLanguage = "en" };

        Assert.Equal("en", settings.ResolveSummaryLanguage());
    }
}
