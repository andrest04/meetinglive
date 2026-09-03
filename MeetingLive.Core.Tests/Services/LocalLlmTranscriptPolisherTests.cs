using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class LocalLlmTranscriptPolisherTests
{
    [Fact]
    public async Task PolishAsync_WhenModelFileDoesNotExist_ThrowsFileNotFoundException()
    {
        var missingModelPath = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid(), "missing-model.gguf");
        var polisher = new LocalLlmTranscriptPolisher(missingModelPath);

        var exception = await Assert.ThrowsAsync<FileNotFoundException>(
            () => polisher.PolishAsync("some transcript", "es"));

        Assert.Equal(missingModelPath, exception.FileName);
    }

    [Fact]
    public void Dispose_WhenModelWasNeverLoaded_DoesNotThrow()
    {
        var polisher = new LocalLlmTranscriptPolisher(Path.Combine(Path.GetTempPath(), "never-loaded.gguf"));

        var exception = Record.Exception(polisher.Dispose);

        Assert.Null(exception);
    }
}
