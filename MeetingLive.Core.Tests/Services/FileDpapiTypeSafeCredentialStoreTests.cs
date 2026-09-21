using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class FileDpapiTypeSafeCredentialStoreTests : IDisposable
{
    private readonly string _directory = Path.Combine(Path.GetTempPath(), "MeetingLiveTypeSafeTests_" + Guid.NewGuid());

    [Fact]
    public void InMemoryStore_RoundTrip_PreservesFields()
    {
        var store = new InMemoryTypeSafeCredentialStore();
        var original = new TypeSafeCredentials("ts-secret-key");

        store.Save(original);

        Assert.Equal(original, store.Load());
        store.Clear();
        Assert.Null(store.Load());
    }

    [Fact]
    public void FileStore_RoundTrip_ProtectsAndRestores()
    {
        Directory.CreateDirectory(_directory);
        var path = Path.Combine(_directory, "typesafe-credentials.bin");
        var store = new FileDpapiTypeSafeCredentialStore(path);
        var original = new TypeSafeCredentials("ts-super-secret-key");

        store.Save(original);

        Assert.True(File.Exists(path));
        var onDisk = File.ReadAllText(path);
        Assert.DoesNotContain("ts-super-secret-key", onDisk, StringComparison.Ordinal);
        Assert.Equal(original, store.Load());
        Assert.DoesNotContain("ts-super-secret-key", original.ToString(), StringComparison.Ordinal);

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
