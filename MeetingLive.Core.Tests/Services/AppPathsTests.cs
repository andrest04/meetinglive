using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class AppPathsTests
{
    [Fact]
    public void InboxDirectory_IsUnderMyDocuments()
    {
        var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        var expected = Path.Combine(documents, "MeetingLive", "Inbox");

        Assert.Equal(expected, AppPaths.InboxDirectory);
    }

    [Fact]
    public void MeetingsDirectory_IsUnderMyDocuments()
    {
        var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        var expected = Path.Combine(documents, "MeetingLive", "Meetings");

        Assert.Equal(expected, AppPaths.MeetingsDirectory);
    }

    [Fact]
    public void RecordingsDirectory_IsUnderMyDocuments()
    {
        var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        var expected = Path.Combine(documents, "MeetingLive", "Recordings");

        Assert.Equal(expected, AppPaths.RecordingsDirectory);
    }

    [Fact]
    public void FoldersFilePath_IsUnderMyDocuments()
    {
        var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        var expected = Path.Combine(documents, "MeetingLive", "folders.json");

        Assert.Equal(expected, AppPaths.FoldersFilePath);
    }

    [Fact]
    public void SettingsFilePath_IsUnderLocalAppData()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var expected = Path.Combine(localAppData, "MeetingLive", "settings.json");

        Assert.Equal(expected, AppPaths.SettingsFilePath);
    }

    [Fact]
    public void XaiCredentialsFilePath_IsUnderLocalAppData()
    {
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var expected = Path.Combine(localAppData, "MeetingLive", "xai-credentials.bin");

        Assert.Equal(expected, AppPaths.XaiCredentialsFilePath);
    }
}
