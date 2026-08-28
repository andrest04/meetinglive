using System.Net;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class LocalLlmModelManagerTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid());

    private static readonly SummaryModelInfo TestModel = new(
        FileName: "test-model-q4_k_m.gguf",
        DisplayName: "Test Model",
        DownloadUrl: "https://example.com/test-model-q4_k_m.gguf",
        FileSizeGb: 0.01,
        MinRamGb: 4,
        Speed: "Fast",
        Quality: "Good",
        UseCase: "Testing");

    [Fact]
    public void GetModelPath_CombinesModelsDirectoryAndFileName()
    {
        var manager = new LocalLlmModelManager(new HttpClient(), _tempDirectory);

        var path = manager.GetModelPath(TestModel);

        Assert.Equal(Path.Combine(_tempDirectory, TestModel.FileName), path);
    }

    [Fact]
    public void IsModelDownloaded_WhenFileMissing_ReturnsFalse()
    {
        var manager = new LocalLlmModelManager(new HttpClient(), _tempDirectory);

        Assert.False(manager.IsModelDownloaded(TestModel));
    }

    [Fact]
    public async Task DownloadModelAsync_WritesResponseBytesToModelPath()
    {
        var content = "fake-gguf-bytes"u8.ToArray();
        var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(content),
        });
        var manager = new LocalLlmModelManager(new HttpClient(handler), _tempDirectory);

        await manager.DownloadModelAsync(TestModel);

        Assert.True(manager.IsModelDownloaded(TestModel));
        Assert.Equal(content, await File.ReadAllBytesAsync(manager.GetModelPath(TestModel)));
    }

    [Fact]
    public async Task DownloadModelAsync_WhenRequestFails_DoesNotLeaveAPartialFile()
    {
        var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.NotFound));
        var manager = new LocalLlmModelManager(new HttpClient(handler), _tempDirectory);

        await Assert.ThrowsAsync<HttpRequestException>(() => manager.DownloadModelAsync(TestModel));

        Assert.False(manager.IsModelDownloaded(TestModel));
        Assert.False(File.Exists(manager.GetModelPath(TestModel) + ".part"));
    }

    [Fact]
    public void DeleteModel_WhenFileExists_RemovesIt()
    {
        Directory.CreateDirectory(_tempDirectory);
        var manager = new LocalLlmModelManager(new HttpClient(), _tempDirectory);
        File.WriteAllText(manager.GetModelPath(TestModel), "content");

        manager.DeleteModel(TestModel);

        Assert.False(manager.IsModelDownloaded(TestModel));
    }

    [Fact]
    public void DeleteModel_WhenFileMissing_DoesNotThrow()
    {
        var manager = new LocalLlmModelManager(new HttpClient(), _tempDirectory);

        var exception = Record.Exception(() => manager.DeleteModel(TestModel));

        Assert.Null(exception);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
            Directory.Delete(_tempDirectory, recursive: true);
    }
}
