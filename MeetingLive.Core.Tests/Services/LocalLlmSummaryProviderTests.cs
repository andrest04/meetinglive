using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

/// <summary>
/// Real inference needs an actual multi-GB GGUF file, which is out of scope for a unit
/// test run — these tests cover the parts that don't require a downloaded model: the
/// "model not on disk yet" failure path a caller relies on to know it must prompt the
/// user to download one first.
/// </summary>
public class LocalLlmSummaryProviderTests
{
    [Fact]
    public async Task SummarizeAsync_WhenModelFileDoesNotExist_ThrowsFileNotFoundException()
    {
        var missingModelPath = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid(), "missing-model.gguf");
        var provider = new LocalLlmSummaryProvider(missingModelPath);

        var exception = await Assert.ThrowsAsync<FileNotFoundException>(
            () => provider.SummarizeAsync("some transcript", "Some meeting", DateTimeOffset.UtcNow));

        Assert.Equal(missingModelPath, exception.FileName);
    }

    [Fact]
    public void Dispose_WhenModelWasNeverLoaded_DoesNotThrow()
    {
        var provider = new LocalLlmSummaryProvider(Path.Combine(Path.GetTempPath(), "never-loaded.gguf"));

        var exception = Record.Exception(provider.Dispose);

        Assert.Null(exception);
    }
}
