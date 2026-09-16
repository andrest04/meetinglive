using System.Net;
using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class NemotronModelManagerTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid());

    [Fact]
    public void GetModelPath_CombinesModelsDirectoryAndCatalogFileName()
    {
        var manager = new NemotronModelManager(new HttpClient(), _tempDirectory);

        var path = manager.GetModelPath();

        Assert.Equal(Path.Combine(_tempDirectory, NemotronAsrCatalog.FileName), path);
    }

    [Fact]
    public void IsModelDownloaded_WhenFileMissing_ReturnsFalse()
    {
        var manager = new NemotronModelManager(new HttpClient(), _tempDirectory);

        Assert.False(manager.IsModelDownloaded());
    }

    [Fact]
    public async Task DownloadModelAsync_WritesResponseBytesToModelPath()
    {
        var content = "fake-gguf-bytes"u8.ToArray();
        var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(content),
        });
        var manager = new NemotronModelManager(new HttpClient(handler), _tempDirectory);

        await manager.DownloadModelAsync();

        Assert.True(manager.IsModelDownloaded());
        Assert.Equal(content, await File.ReadAllBytesAsync(manager.GetModelPath()));
        Assert.Equal(NemotronAsrCatalog.DownloadUrl, handler.LastRequest?.RequestUri?.ToString());
    }

    [Fact]
    public async Task DownloadModelAsync_WhenRequestFails_DoesNotLeaveAPartialFile()
    {
        var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound));
        var manager = new NemotronModelManager(new HttpClient(handler), _tempDirectory);

        await Assert.ThrowsAsync<HttpRequestException>(() => manager.DownloadModelAsync());

        Assert.False(manager.IsModelDownloaded());
        Assert.False(File.Exists(manager.GetModelPath() + ".part"));
    }

    [Fact]
    public void DeleteModel_WhenFileExists_RemovesIt()
    {
        Directory.CreateDirectory(_tempDirectory);
        var manager = new NemotronModelManager(new HttpClient(), _tempDirectory);
        File.WriteAllText(manager.GetModelPath(), "content");

        manager.DeleteModel();

        Assert.False(manager.IsModelDownloaded());
    }

    [Fact]
    public void DeleteModel_WhenFileMissing_DoesNotThrow()
    {
        var manager = new NemotronModelManager(new HttpClient(), _tempDirectory);

        var exception = Record.Exception(() => manager.DeleteModel());

        Assert.Null(exception);
    }

    [Fact]
    public void GetDiarizationModelPath_CombinesModelsDirectoryAndCatalogFileName()
    {
        var manager = new NemotronModelManager(new HttpClient(), _tempDirectory);

        var path = manager.GetDiarizationModelPath();

        Assert.Equal(Path.Combine(_tempDirectory, NemotronAsrCatalog.DiarizationFileName), path);
    }

    [Fact]
    public void IsDiarizationModelDownloaded_WhenFileMissing_ReturnsFalse()
    {
        var manager = new NemotronModelManager(new HttpClient(), _tempDirectory);

        Assert.False(manager.IsDiarizationModelDownloaded());
    }

    [Fact]
    public async Task DownloadDiarizationModelAsync_WritesResponseBytesToDiarizationPath()
    {
        var content = "fake-sortformer-bytes"u8.ToArray();
        var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(content),
        });
        var manager = new NemotronModelManager(new HttpClient(handler), _tempDirectory);

        await manager.DownloadDiarizationModelAsync();

        Assert.True(manager.IsDiarizationModelDownloaded());
        Assert.Equal(content, await File.ReadAllBytesAsync(manager.GetDiarizationModelPath()));
        Assert.Equal(NemotronAsrCatalog.DiarizationDownloadUrl, handler.LastRequest?.RequestUri?.ToString());
    }

    [Fact]
    public async Task DownloadDiarizationModelAsync_WhenRequestFails_DoesNotLeaveAPartialFile()
    {
        var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound));
        var manager = new NemotronModelManager(new HttpClient(handler), _tempDirectory);

        await Assert.ThrowsAsync<HttpRequestException>(() => manager.DownloadDiarizationModelAsync());

        Assert.False(manager.IsDiarizationModelDownloaded());
        Assert.False(File.Exists(manager.GetDiarizationModelPath() + ".part"));
    }

    [Fact]
    public void DeleteDiarizationModel_WhenFileExists_RemovesIt()
    {
        Directory.CreateDirectory(_tempDirectory);
        var manager = new NemotronModelManager(new HttpClient(), _tempDirectory);
        File.WriteAllText(manager.GetDiarizationModelPath(), "content");

        manager.DeleteDiarizationModel();

        Assert.False(manager.IsDiarizationModelDownloaded());
    }

    [Fact]
    public void DeleteDiarizationModel_WhenFileMissing_DoesNotThrow()
    {
        var manager = new NemotronModelManager(new HttpClient(), _tempDirectory);

        var exception = Record.Exception(() => manager.DeleteDiarizationModel());

        Assert.Null(exception);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
            Directory.Delete(_tempDirectory, recursive: true);
    }
}
