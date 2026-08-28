using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class ModelCatalogTests
{
    [Fact]
    public void SummaryModels_ContainsAllFourCuratedEntries()
    {
        var fileNames = ModelCatalog.SummaryModels.Select(m => m.FileName).ToList();

        Assert.Equal(4, fileNames.Count);
        Assert.Contains("Llama-3.2-1B-Instruct-Q4_K_M.gguf", fileNames);
        Assert.Contains("gemma-4-E2B-it-Q4_K_M.gguf", fileNames);
        Assert.Contains("gemma-4-E4B-it-Q4_K_M.gguf", fileNames);
        Assert.Contains("gemma-4-12b-it-Q4_K_M.gguf", fileNames);
    }

    [Fact]
    public void SummaryModels_AreOrderedByAscendingMinRam()
    {
        var minRamValues = ModelCatalog.SummaryModels.Select(m => m.MinRamGb).ToList();

        Assert.Equal(minRamValues.OrderBy(v => v), minRamValues);
    }

    [Fact]
    public void SummaryModels_AllHaveHttpsDownloadUrlsAndPositiveFileSize()
    {
        foreach (var model in ModelCatalog.SummaryModels)
        {
            Assert.StartsWith("https://", model.DownloadUrl);
            Assert.EndsWith(model.FileName, model.DownloadUrl);
            Assert.True(model.FileSizeGb > 0);
        }
    }
}
