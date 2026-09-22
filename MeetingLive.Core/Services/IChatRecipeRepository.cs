using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

public interface IChatRecipeRepository
{
    /// <summary>User recipes in file order. Built-in recipes are not stored here.</summary>
    Task<IReadOnlyList<ChatRecipe>> GetAllAsync(CancellationToken cancellationToken = default);

    /// <summary>Inserts or replaces the recipe with the same <see cref="ChatRecipe.Id"/>.</summary>
    Task SaveAsync(ChatRecipe recipe, CancellationToken cancellationToken = default);

    /// <summary>Removes the recipe if present. A missing id is a no-op and does not throw.</summary>
    Task DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}
