using System.Text.Json;
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

    [Fact]
    public void SpeakerDiarizationEnabled_WhenUnset_DefaultsFalse()
    {
        Assert.False(new AppSettings().SpeakerDiarizationEnabled);
    }

    [Fact]
    public void SpeakerDiarizationEnabled_WhenJsonOmitsField_DefaultsFalse()
    {
        var settings = JsonSerializer.Deserialize<AppSettings>(
            "{}",
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.False(settings!.SpeakerDiarizationEnabled);
    }

    [Fact]
    public void TypeSafeEnabled_WhenUnset_DefaultsTrue()
    {
        Assert.True(new AppSettings().TypeSafeEnabled);
    }

    [Fact]
    public void TypeSafeEnabled_WhenJsonOmitsField_DefaultsTrue()
    {
        var settings = JsonSerializer.Deserialize<AppSettings>(
            "{}",
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.True(settings!.TypeSafeEnabled);
    }

    [Fact]
    public void CalendarNotificationsEnabled_WhenUnset_DefaultsTrue()
    {
        Assert.True(new AppSettings().CalendarNotificationsEnabled);
    }

    [Fact]
    public void CalendarNotificationsEnabled_WhenJsonOmitsField_DefaultsTrue()
    {
        var settings = JsonSerializer.Deserialize<AppSettings>(
            "{}",
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.True(settings!.CalendarNotificationsEnabled);
    }

    [Fact]
    public void CalendarNotificationsEnabled_RoundTripsFalse()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var json = JsonSerializer.Serialize(new AppSettings { CalendarNotificationsEnabled = false }, options);
        var settings = JsonSerializer.Deserialize<AppSettings>(json, options);

        Assert.False(settings!.CalendarNotificationsEnabled);
    }

    [Fact]
    public void DisabledCalendarIds_WhenUnsetOrJsonOmitsField_IsEmpty()
    {
        Assert.Empty(new AppSettings().DisabledCalendarIds);

        var settings = JsonSerializer.Deserialize<AppSettings>(
            "{}",
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.Empty(settings!.DisabledCalendarIds);
        Assert.Empty(settings.DisabledCalendarIdsAsSet());
    }

    [Fact]
    public void DisabledCalendarIds_RoundTripsNonEmptyAndDropsBlanks()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var json = JsonSerializer.Serialize(
            new AppSettings { DisabledCalendarIds = ["cal-1", " ", "cal-1"] },
            options);
        var settings = JsonSerializer.Deserialize<AppSettings>(json, options);

        Assert.Equal(["cal-1", " ", "cal-1"], settings!.DisabledCalendarIds);
        var disabled = Assert.Single(settings.DisabledCalendarIdsAsSet());
        Assert.Equal("cal-1", disabled);
    }

    [Fact]
    public void Deserialize_WhenJsonHasRemovedProviderKeys_LoadsAndIgnoresThem()
    {
        var settings = JsonSerializer.Deserialize<AppSettings>(
            """{"selectedSummaryProvider":"Codex","selectedChatProvider":"Xai","selectedLiveAnswerProvider":"ClaudeCode"}""",
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.NotNull(settings);
        Assert.Equal(SummaryProviderKind.Codex, settings.ResolveSummaryProviderKind());
    }

    [Fact]
    public void TypeSafeEnabled_RoundTripsFalse()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var json = JsonSerializer.Serialize(new AppSettings { TypeSafeEnabled = false }, options);
        var settings = JsonSerializer.Deserialize<AppSettings>(json, options);

        Assert.False(settings!.TypeSafeEnabled);
    }

    [Fact]
    public void LiveCopilotPillPosition_WhenUnsetOrJsonOmitsField_IsNull()
    {
        var settings = JsonSerializer.Deserialize<AppSettings>(
            "{}",
            new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.NotNull(settings);
        Assert.Null(settings.LiveCopilotPillX);
        Assert.Null(settings.LiveCopilotPillY);
    }

    [Fact]
    public void LiveCopilotPillPosition_RoundTripsIncludingNegativeCoordinates()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var json = JsonSerializer.Serialize(
            new AppSettings { LiveCopilotPillX = -1500, LiveCopilotPillY = 320 },
            options);
        var settings = JsonSerializer.Deserialize<AppSettings>(json, options);

        Assert.NotNull(settings);
        Assert.Equal(-1500, settings.LiveCopilotPillX);
        Assert.Equal(320, settings.LiveCopilotPillY);
    }
}
