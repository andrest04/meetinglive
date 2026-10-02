using System.Text.Json;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class RecordAudioSourceMemoryTests
{
    private static ActiveAudioApp App(uint pid, string name, string? exe) =>
        new(pid, exe, name, IsBrowser: false, IsKnownMeetingApp: false, Peak: 0.1f);

    [Fact]
    public void RememberMicrophone_Device_StoresKindAndId()
    {
        var settings = new AppSettings();

        RecordAudioSourceMemory.RememberMicrophone(settings, RememberedMicrophoneKind.Device, "{0.0.1}.{abc}");

        Assert.Equal("Device", settings.RecordMicrophoneKind);
        Assert.Equal("{0.0.1}.{abc}", settings.RecordMicrophoneDeviceId);
    }

    [Fact]
    public void RememberMicrophone_NonDevice_ClearsTheDeviceId()
    {
        var settings = new AppSettings { RecordMicrophoneKind = "Device", RecordMicrophoneDeviceId = "old" };

        RecordAudioSourceMemory.RememberMicrophone(settings, RememberedMicrophoneKind.None, "ignored");

        Assert.Equal("None", settings.RecordMicrophoneKind);
        Assert.Null(settings.RecordMicrophoneDeviceId);
    }

    [Fact]
    public void RememberMicrophone_KeepsEveryOtherSetting()
    {
        var settings = new AppSettings { SelectedSummaryModelId = "model.gguf", TranscriptionLanguage = "en" };

        RecordAudioSourceMemory.RememberMicrophone(settings, RememberedMicrophoneKind.SystemDefault, null);

        Assert.Equal("model.gguf", settings.SelectedSummaryModelId);
        Assert.Equal("en", settings.TranscriptionLanguage);
    }

    [Fact]
    public void RememberApp_StoresKindPathAndName()
    {
        var settings = new AppSettings();

        RecordAudioSourceMemory.RememberApp(settings, @"C:\Zoom\Zoom.exe", "Zoom");

        Assert.Equal("App", settings.RecordOutputKind);
        Assert.Equal(@"C:\Zoom\Zoom.exe", settings.RecordAppExePath);
        Assert.Equal("Zoom", settings.RecordAppName);
    }

    [Fact]
    public void RememberSystemAudio_ClearsTheApp()
    {
        var settings = new AppSettings { RecordOutputKind = "App", RecordAppExePath = @"C:\Zoom\Zoom.exe", RecordAppName = "Zoom" };

        RecordAudioSourceMemory.RememberSystemAudio(settings);

        Assert.Equal("System", settings.RecordOutputKind);
        Assert.Null(settings.RecordAppExePath);
        Assert.Null(settings.RecordAppName);
    }

    [Fact]
    public void RestoreMicrophone_NothingRemembered_UsesSettingsDeviceWhenPresent()
    {
        var settings = new AppSettings { SelectedMicrophoneDeviceId = "usb" };

        var result = RecordAudioSourceMemory.RestoreMicrophone(settings, ["usb", "other"]);

        Assert.Equal(new RememberedMicrophone(RememberedMicrophoneKind.Device, "usb"), result);
    }

    [Fact]
    public void RestoreMicrophone_NothingRemembered_NoSettingsDevice_IsSystemDefault()
    {
        var result = RecordAudioSourceMemory.RestoreMicrophone(new AppSettings(), ["usb"]);

        Assert.Equal(new RememberedMicrophone(RememberedMicrophoneKind.SystemDefault, null), result);
    }

    [Fact]
    public void RestoreMicrophone_RememberedNone_StaysNone()
    {
        var settings = new AppSettings { RecordMicrophoneKind = "None", SelectedMicrophoneDeviceId = "usb" };

        var result = RecordAudioSourceMemory.RestoreMicrophone(settings, ["usb"]);

        Assert.Equal(RememberedMicrophoneKind.None, result.Kind);
    }

    [Fact]
    public void RestoreMicrophone_RememberedDeviceStillPlugged_IsThatDevice()
    {
        var settings = new AppSettings { RecordMicrophoneKind = "Device", RecordMicrophoneDeviceId = "headset" };

        var result = RecordAudioSourceMemory.RestoreMicrophone(settings, ["usb", "headset"]);

        Assert.Equal(new RememberedMicrophone(RememberedMicrophoneKind.Device, "headset"), result);
    }

    [Fact]
    public void RestoreMicrophone_RememberedDeviceUnplugged_FallsBackToSystemDefaultNotNone()
    {
        var settings = new AppSettings { RecordMicrophoneKind = "Device", RecordMicrophoneDeviceId = "headset" };

        var result = RecordAudioSourceMemory.RestoreMicrophone(settings, ["usb"]);

        Assert.Equal(new RememberedMicrophone(RememberedMicrophoneKind.SystemDefault, null), result);
    }

    [Fact]
    public void RestoreMicrophone_UnknownKind_FallsBackToSettingsMicrophone()
    {
        var settings = new AppSettings { RecordMicrophoneKind = "Garbage", SelectedMicrophoneDeviceId = "usb" };

        var result = RecordAudioSourceMemory.RestoreMicrophone(settings, ["usb"]);

        Assert.Equal(new RememberedMicrophone(RememberedMicrophoneKind.Device, "usb"), result);
    }

    [Fact]
    public void RestoreApp_NothingRemembered_IsNull()
    {
        Assert.Null(RecordAudioSourceMemory.RestoreApp(new AppSettings(), [App(1, "Zoom", @"C:\Zoom\Zoom.exe")]));
    }

    [Fact]
    public void RestoreApp_RememberedSystem_IsNull()
    {
        var settings = new AppSettings { RecordOutputKind = "System", RecordAppExePath = @"C:\Zoom\Zoom.exe" };

        Assert.Null(RecordAudioSourceMemory.RestoreApp(settings, [App(1, "Zoom", @"C:\Zoom\Zoom.exe")]));
    }

    [Fact]
    public void RestoreApp_RememberedAppPlaying_ReturnsItWithCurrentProcessId()
    {
        var settings = new AppSettings { RecordOutputKind = "App", RecordAppExePath = @"C:\Zoom\Zoom.exe" };
        var zoom = App(42, "Zoom", @"c:\zoom\ZOOM.exe");

        var result = RecordAudioSourceMemory.RestoreApp(settings, [App(1, "Chrome", @"C:\Chrome\chrome.exe"), zoom]);

        Assert.Same(zoom, result);
    }

    [Fact]
    public void RestoreApp_RememberedAppNotPlaying_IsNullSoTheCardIsNeverAutoSelected()
    {
        var settings = new AppSettings { RecordOutputKind = "App", RecordAppExePath = @"C:\Zoom\Zoom.exe" };

        Assert.Null(RecordAudioSourceMemory.RestoreApp(settings, [App(1, "Chrome", @"C:\Chrome\chrome.exe")]));
    }

    [Fact]
    public void RestoreApp_RememberedAppWithoutPath_IsNull()
    {
        var settings = new AppSettings { RecordOutputKind = "App", RecordAppExePath = null };

        Assert.Null(RecordAudioSourceMemory.RestoreApp(settings, [App(1, "Zoom", null)]));
    }

    [Fact]
    public void Settings_SurviveAJsonRoundTrip()
    {
        var settings = new AppSettings();
        RecordAudioSourceMemory.RememberMicrophone(settings, RememberedMicrophoneKind.Device, "usb");
        RecordAudioSourceMemory.RememberApp(settings, @"C:\Zoom\Zoom.exe", "Zoom");
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);

        var loaded = JsonSerializer.Deserialize<AppSettings>(JsonSerializer.Serialize(settings, options), options)!;

        Assert.Equal(new RememberedMicrophone(RememberedMicrophoneKind.Device, "usb"),
            RecordAudioSourceMemory.RestoreMicrophone(loaded, ["usb"]));
        Assert.Equal(@"C:\Zoom\Zoom.exe", RecordAudioSourceMemory.RestoreApp(loaded, [App(7, "Zoom", @"C:\Zoom\Zoom.exe")])?.ExePath);
    }
}
