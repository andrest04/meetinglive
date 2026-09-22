using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class JsonChatRecipeRepositoryTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid());
    private string TempFilePath => Path.Combine(_tempDirectory, "chat-recipes.json");

    [Fact]
    public async Task SaveAsync_ThenGetAllAsync_RoundtripsRecipe()
    {
        var id = Guid.NewGuid();
        var created = DateTimeOffset.Parse("2026-09-01T12:00:00Z");
        var repo = new JsonChatRecipeRepository(TempFilePath);
        var recipe = new ChatRecipe
        {
            Id = id,
            Name = "My follow-up",
            Prompt = "Draft a follow-up from these notes. Do not send it.",
            Availability = ChatRecipe.SingleAvailability,
            CreatedAt = created,
        };

        await repo.SaveAsync(recipe);
        var all = await repo.GetAllAsync();

        var loaded = Assert.Single(all);
        Assert.Equal(id, loaded.Id);
        Assert.Equal("My follow-up", loaded.Name);
        Assert.Equal(recipe.Prompt, loaded.Prompt);
        Assert.Equal(ChatRecipe.SingleAvailability, loaded.Availability);
        Assert.Equal(created, loaded.CreatedAt);
    }

    [Fact]
    public async Task DeleteAsync_ExistingRecipe_RemovesIt()
    {
        var id = Guid.NewGuid();
        var repo = new JsonChatRecipeRepository(TempFilePath);
        await repo.SaveAsync(CreateRecipe(id));

        await repo.DeleteAsync(id);

        Assert.Empty(await repo.GetAllAsync());
    }

    [Fact]
    public async Task DeleteAsync_MissingId_DoesNotThrow()
    {
        var repo = new JsonChatRecipeRepository(TempFilePath);

        var exception = await Record.ExceptionAsync(() => repo.DeleteAsync(Guid.NewGuid()));

        Assert.Null(exception);
        Assert.False(File.Exists(TempFilePath));
    }

    [Fact]
    public async Task SaveAsync_WithPathOverride_DoesNotWriteToAppPaths()
    {
        var id = Guid.NewGuid();
        AssertPathIsNotUnderMeetingLiveAppData(TempFilePath);
        Assert.Equal(Path.Combine(AppPaths.RootDirectory, "chat-recipes.json"), AppPaths.ChatRecipesFilePath);
        Assert.NotEqual(Path.GetFullPath(AppPaths.ChatRecipesFilePath), Path.GetFullPath(TempFilePath));
        var realExisted = File.Exists(AppPaths.ChatRecipesFilePath);
        var repo = new JsonChatRecipeRepository(TempFilePath);

        await repo.SaveAsync(CreateRecipe(id));

        Assert.True(File.Exists(TempFilePath));
        if (realExisted)
        {
            var real = await File.ReadAllTextAsync(AppPaths.ChatRecipesFilePath);
            Assert.DoesNotContain(id.ToString(), real, StringComparison.OrdinalIgnoreCase);
        }
        else
        {
            Assert.False(File.Exists(AppPaths.ChatRecipesFilePath));
        }
    }

    [Fact]
    public async Task SaveAsync_ExistingId_ReplacesRecipe()
    {
        var id = Guid.NewGuid();
        var repo = new JsonChatRecipeRepository(TempFilePath);
        await repo.SaveAsync(CreateRecipe(id, "Old name"));

        await repo.SaveAsync(CreateRecipe(id, "New name", ChatRecipe.MultipleAvailability));
        var all = await repo.GetAllAsync();

        var loaded = Assert.Single(all);
        Assert.Equal("New name", loaded.Name);
        Assert.Equal(ChatRecipe.MultipleAvailability, loaded.Availability);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
            Directory.Delete(_tempDirectory, recursive: true);
    }

    private static void AssertPathIsNotUnderMeetingLiveAppData(string path)
    {
        var appDataRoot = Path.GetFullPath(Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "MeetingLive"));
        var fullPath = Path.GetFullPath(path);
        var prefix = appDataRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        Assert.False(
            fullPath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase),
            $"Temp path '{fullPath}' must not be under '{appDataRoot}'.");
    }

    private static ChatRecipe CreateRecipe(
        Guid id,
        string name = "Custom recipe",
        string availability = ChatRecipe.SingleAvailability) => new()
    {
        Id = id,
        Name = name,
        Prompt = "Summarize the packed notes.",
        Availability = availability,
        CreatedAt = DateTimeOffset.Parse("2026-09-01T12:00:00Z"),
    };
}
