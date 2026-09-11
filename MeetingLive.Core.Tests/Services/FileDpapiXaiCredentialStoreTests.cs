using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class FileDpapiXaiCredentialStoreTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "MeetingLiveXaiTests_" + Guid.NewGuid());

    [Fact]
    public void InMemoryStore_RoundTrip_PreservesFields()
    {
        var store = new InMemoryXaiCredentialStore();
        var original = new XaiCredentials(
            XaiCredentialKind.OAuth,
            "access",
            "refresh",
            new DateTimeOffset(2026, 9, 11, 12, 0, 0, TimeSpan.Zero));

        store.Save(original);

        Assert.Equal(original, store.Load());
        store.Clear();
        Assert.Null(store.Load());
    }

    [Fact]
    public void FileStore_RoundTrip_ProtectsAndRestores()
    {
        Directory.CreateDirectory(_directory);
        var path = Path.Combine(_directory, "xai-credentials.bin");
        var store = new FileDpapiXaiCredentialStore(path);
        var original = new XaiCredentials(
            XaiCredentialKind.ApiKey,
            "xai-super-secret-key",
            null,
            null);

        store.Save(original);

        Assert.True(File.Exists(path));
        var onDisk = File.ReadAllText(path);
        Assert.DoesNotContain("xai-super-secret-key", onDisk, StringComparison.Ordinal);
        Assert.Equal(original, store.Load());

        store.Clear();
        Assert.False(File.Exists(path));
        Assert.Null(store.Load());
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_directory))
                Directory.Delete(_directory, recursive: true);
        }
        catch (IOException)
        {
        }
    }
}
