using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class ChatRecipeListTests
{
    [Theory]
    [InlineData(ChatScopeKind.Meeting, ChatRecipe.SingleAvailability)]
    [InlineData(ChatScopeKind.Live, ChatRecipe.SingleAvailability)]
    [InlineData(ChatScopeKind.Folder, ChatRecipe.MultipleAvailability)]
    [InlineData(ChatScopeKind.AllMeetings, ChatRecipe.MultipleAvailability)]
    public void AvailabilityFor_MatchesScope(ChatScopeKind scope, string expected)
    {
        Assert.Equal(expected, ChatRecipeList.AvailabilityFor(scope));
    }

    [Fact]
    public void ForScope_Meeting_ReturnsSingleBuiltInsThenUserRecipes()
    {
        var user = Recipe(Guid.NewGuid(), "Mine", ChatRecipe.SingleAvailability, "Ask this.");
        var otherScope = Recipe(Guid.NewGuid(), "Weekly", ChatRecipe.MultipleAvailability, "Across meetings.");

        var listed = ChatRecipeList.ForScope(ChatScopeKind.Live, [user, otherScope]);

        Assert.Equal(
            ChatRecipeCatalog.BuiltIns.Where(recipe => recipe.Availability == ChatRecipe.SingleAvailability).Select(recipe => recipe.Id),
            listed.Where(recipe => ChatRecipeList.IsBuiltIn(recipe.Id)).Select(recipe => recipe.Id));
        Assert.Equal(user.Id, listed[^1].Id);
        Assert.DoesNotContain(listed, recipe => recipe.Id == otherScope.Id);
        Assert.Same(ChatRecipeCatalog.BuiltIns[0], listed[0]);
    }

    [Fact]
    public void ForScope_WhenUserIdCollidesWithBuiltIn_SkipsUserRow()
    {
        var collision = Recipe(
            ChatRecipeCatalog.DiscussedId,
            "Replaced",
            ChatRecipe.SingleAvailability,
            "This must not replace the built-in.");

        var listed = ChatRecipeList.ForScope(ChatScopeKind.Meeting, [collision]);

        var discussed = Assert.Single(listed, recipe => recipe.Id == ChatRecipeCatalog.DiscussedId);
        Assert.Equal("What's been discussed", discussed.Name);
        Assert.NotEqual("Replaced", discussed.Name);
    }

    [Fact]
    public void ForScope_DoesNotMutateBuiltInInstances()
    {
        var before = ChatRecipeCatalog.BuiltIns.Select(recipe => recipe.Prompt).ToArray();

        _ = ChatRecipeList.ForScope(ChatScopeKind.Folder, []);

        Assert.Equal(before, ChatRecipeCatalog.BuiltIns.Select(recipe => recipe.Prompt));
    }

    private static ChatRecipe Recipe(Guid id, string name, string availability, string prompt) => new()
    {
        Id = id,
        Name = name,
        Prompt = prompt,
        Availability = availability,
        CreatedAt = DateTimeOffset.UnixEpoch,
    };
}
