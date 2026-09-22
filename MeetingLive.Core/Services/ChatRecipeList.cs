using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Recipes the composer may offer for a scope. Built-ins stay in code.
/// A user row whose id collides with a built-in is skipped, not shown in its place.
/// </summary>
public static class ChatRecipeList
{
    public static string AvailabilityFor(ChatScopeKind scopeKind) => scopeKind switch
    {
        ChatScopeKind.Meeting or ChatScopeKind.Live => ChatRecipe.SingleAvailability,
        ChatScopeKind.Folder or ChatScopeKind.AllMeetings => ChatRecipe.MultipleAvailability,
        _ => throw new ArgumentOutOfRangeException(nameof(scopeKind), scopeKind, "Unknown chat scope."),
    };

    public static bool IsBuiltIn(Guid id) =>
        ChatRecipeCatalog.BuiltIns.Any(recipe => recipe.Id == id);

    public static IReadOnlyList<ChatRecipe> ForScope(
        ChatScopeKind scopeKind,
        IReadOnlyList<ChatRecipe> userRecipes)
    {
        ArgumentNullException.ThrowIfNull(userRecipes);

        var availability = AvailabilityFor(scopeKind);
        var builtIns = ChatRecipeCatalog.BuiltIns
            .Where(recipe => string.Equals(recipe.Availability, availability, StringComparison.Ordinal))
            .ToList();
        var builtInIds = builtIns.Select(recipe => recipe.Id).ToHashSet();
        var users = userRecipes.Where(recipe =>
            recipe is not null
            && string.Equals(recipe.Availability, availability, StringComparison.Ordinal)
            && !builtInIds.Contains(recipe.Id));

        return builtIns.Concat(users).ToList();
    }
}
