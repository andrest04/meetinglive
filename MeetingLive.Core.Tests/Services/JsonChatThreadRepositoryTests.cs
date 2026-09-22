using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class JsonChatThreadRepositoryTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid());
    private string TempFilePath => Path.Combine(_tempDirectory, "chat-threads.json");

    [Fact]
    public async Task SaveAsync_ThenGetByIdAsync_RoundtripsThreadWithTwoMessages()
    {
        var id = Guid.NewGuid();
        var repo = new JsonChatThreadRepository(TempFilePath);
        var thread = CreateThread(id);

        await repo.SaveAsync(thread);
        var loaded = await repo.GetByIdAsync(id);

        Assert.NotNull(loaded);
        Assert.Equal(id, loaded.Id);
        Assert.Equal(thread.Title, loaded.Title);
        Assert.Equal(thread.CreatedAt, loaded.CreatedAt);
        Assert.Equal(thread.UpdatedAt, loaded.UpdatedAt);
        Assert.Equal(ChatScopeKind.Folder, loaded.ScopeKind);
        Assert.Equal(thread.FolderId, loaded.FolderId);
        Assert.Equal(thread.MeetingId, loaded.MeetingId);
        Assert.Equal(2, loaded.Messages.Count);
        Assert.Equal(ChatMessage.UserRole, loaded.Messages[0].Role);
        Assert.Equal("What did we decide?", loaded.Messages[0].Text);
        Assert.Equal(thread.Messages[0].Id, loaded.Messages[0].Id);
        Assert.Equal(thread.Messages[0].CreatedAt, loaded.Messages[0].CreatedAt);
        Assert.Equal(ChatMessage.AssistantRole, loaded.Messages[1].Role);
        Assert.Equal("We decided to ship chat.", loaded.Messages[1].Text);
    }

    [Fact]
    public async Task DeleteAsync_ExistingThread_RemovesIt()
    {
        var id = Guid.NewGuid();
        var repo = new JsonChatThreadRepository(TempFilePath);
        await repo.SaveAsync(CreateThread(id));

        await repo.DeleteAsync(id);

        Assert.Null(await repo.GetByIdAsync(id));
        Assert.Empty(await repo.GetAllAsync());
    }

    [Fact]
    public async Task DeleteAsync_MissingId_DoesNotThrow()
    {
        var repo = new JsonChatThreadRepository(TempFilePath);

        var exception = await Record.ExceptionAsync(() => repo.DeleteAsync(Guid.NewGuid()));

        Assert.Null(exception);
        Assert.False(File.Exists(TempFilePath));
    }

    [Fact]
    public async Task SaveAsync_WithPathOverride_DoesNotWriteToAppPaths()
    {
        var id = Guid.NewGuid();
        AssertPathIsNotUnderMeetingLiveAppData(TempFilePath);
        Assert.Equal(Path.Combine(AppPaths.RootDirectory, "chat-threads.json"), AppPaths.ChatThreadsFilePath);
        Assert.NotEqual(Path.GetFullPath(AppPaths.ChatThreadsFilePath), Path.GetFullPath(TempFilePath));
        var realExisted = File.Exists(AppPaths.ChatThreadsFilePath);
        var repo = new JsonChatThreadRepository(TempFilePath);

        await repo.SaveAsync(CreateThread(id));

        Assert.True(File.Exists(TempFilePath));
        if (realExisted)
        {
            var real = await File.ReadAllTextAsync(AppPaths.ChatThreadsFilePath);
            Assert.DoesNotContain(id.ToString(), real, StringComparison.OrdinalIgnoreCase);
        }
        else
        {
            Assert.False(File.Exists(AppPaths.ChatThreadsFilePath));
        }
    }

    [Fact]
    public async Task GetAllAsync_WhenUpdatedAtDiffers_ReturnsNewestFirst()
    {
        var repo = new JsonChatThreadRepository(TempFilePath);
        var older = CreateThread(title: "Older", updatedAt: DateTimeOffset.Parse("2026-09-01T00:00:00Z"));
        var newer = CreateThread(title: "Newer", updatedAt: DateTimeOffset.Parse("2026-09-02T00:00:00Z"));
        await repo.SaveAsync(older);
        await repo.SaveAsync(newer);

        var all = await repo.GetAllAsync();

        Assert.Equal(2, all.Count);
        Assert.Equal(newer.Id, all[0].Id);
        Assert.Equal(older.Id, all[1].Id);
    }

    [Fact]
    public async Task SaveAsync_ExistingId_ReplacesThread()
    {
        var id = Guid.NewGuid();
        var repo = new JsonChatThreadRepository(TempFilePath);
        await repo.SaveAsync(CreateThread(id, title: "Old title"));
        var updated = CreateThread(id, title: "New title", messages:
        [
            new ChatMessage
            {
                Id = Guid.NewGuid(),
                Role = ChatMessage.UserRole,
                Text = "Only the replacement remains.",
                CreatedAt = DateTimeOffset.Parse("2026-09-03T00:00:00Z"),
            },
        ]);

        await repo.SaveAsync(updated);
        var loaded = await repo.GetByIdAsync(id);
        var all = await repo.GetAllAsync();

        Assert.NotNull(loaded);
        Assert.Equal("New title", loaded.Title);
        Assert.Single(loaded.Messages);
        Assert.Equal("Only the replacement remains.", loaded.Messages[0].Text);
        Assert.Single(all);
    }

    [Fact]
    public async Task GetAllAsync_WhenFileMissing_ReturnsEmpty()
    {
        var repo = new JsonChatThreadRepository(TempFilePath);

        var threads = await repo.GetAllAsync();

        Assert.Empty(threads);
        Assert.False(File.Exists(TempFilePath));
        Assert.False(Directory.Exists(_tempDirectory));
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

    private static ChatThread CreateThread(
        Guid? id = null,
        string title = "Weekly sync",
        DateTimeOffset? updatedAt = null,
        IReadOnlyList<ChatMessage>? messages = null)
    {
        var created = DateTimeOffset.Parse("2026-09-01T12:00:00Z");
        return new ChatThread
        {
            Id = id ?? Guid.NewGuid(),
            Title = title,
            CreatedAt = created,
            UpdatedAt = updatedAt ?? created,
            ScopeKind = ChatScopeKind.Folder,
            FolderId = Guid.Parse("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
            MeetingId = Guid.Parse("bbbbbbbb-cccc-dddd-eeee-ffffffffffff"),
            Messages = messages?.ToList() ??
            [
                new ChatMessage
                {
                    Id = Guid.Parse("11111111-2222-3333-4444-555555555555"),
                    Role = ChatMessage.UserRole,
                    Text = "What did we decide?",
                    CreatedAt = created,
                },
                new ChatMessage
                {
                    Id = Guid.Parse("22222222-3333-4444-5555-666666666666"),
                    Role = ChatMessage.AssistantRole,
                    Text = "We decided to ship chat.",
                    CreatedAt = created.AddMinutes(1),
                },
            ],
        };
    }
}
