using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class JsonCustomNoteTemplateStoreTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid());
    private string TempFilePath => Path.Combine(_tempDirectory, "custom-note-template.json");

    [Fact]
    public async Task SaveAsync_WithPathOverride_DoesNotWriteToAppPaths()
    {
        var store = new JsonCustomNoteTemplateStore(TempFilePath);
        var marker = "template-" + Guid.NewGuid().ToString("N");

        await store.SaveAsync(new CustomNoteTemplate
        {
            Name = marker,
            Instructions = "Include the decision.",
        });

        Assert.True(File.Exists(TempFilePath));
        if (File.Exists(AppPaths.CustomNoteTemplateFilePath))
        {
            var real = await File.ReadAllTextAsync(AppPaths.CustomNoteTemplateFilePath);
            Assert.DoesNotContain(marker, real, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task SaveThenLoad_RoundtripsTheOneTemplate()
    {
        var store = new JsonCustomNoteTemplateStore(TempFilePath);

        await store.SaveAsync(new CustomNoteTemplate
        {
            Name = "  Customer call  ",
            Instructions = "  Pain and next step.  ",
        });

        var loaded = await store.LoadAsync();

        Assert.NotNull(loaded);
        Assert.Equal("Customer call", loaded.Name);
        Assert.Equal("Pain and next step.", loaded.Instructions);
    }

    [Fact]
    public async Task LoadAsync_WhenFileMissing_ReturnsNull()
    {
        var store = new JsonCustomNoteTemplateStore(TempFilePath);

        Assert.Null(await store.LoadAsync());
    }

    [Fact]
    public async Task SaveAsync_WhenNameOrInstructionsBlank_Throws()
    {
        var store = new JsonCustomNoteTemplateStore(TempFilePath);

        await Assert.ThrowsAsync<ArgumentException>(() => store.SaveAsync(new CustomNoteTemplate
        {
            Name = " ",
            Instructions = "Include the decision.",
        }));
        await Assert.ThrowsAsync<ArgumentException>(() => store.SaveAsync(new CustomNoteTemplate
        {
            Name = "Customer call",
            Instructions = " ",
        }));
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
            Directory.Delete(_tempDirectory, recursive: true);
    }
}
