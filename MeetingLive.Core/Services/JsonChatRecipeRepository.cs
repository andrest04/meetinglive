using System.Text.Json;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// JSON-file-backed user recipe store. The optional constructor argument overrides the
/// file path so tests never write into the user's real %LOCALAPPDATA%\MeetingLive data.
/// Built-in recipes are code (<see cref="ChatRecipeCatalog"/>) and must not be saved here.
/// </summary>
public sealed class JsonChatRecipeRepository : IChatRecipeRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private readonly SemaphoreSlim _fileLock = new(1, 1);
    private readonly string _recipesFilePath;

    public JsonChatRecipeRepository(string? recipesFilePath = null)
    {
        _recipesFilePath = recipesFilePath ?? AppPaths.ChatRecipesFilePath;
    }

    public async Task<IReadOnlyList<ChatRecipe>> GetAllAsync(CancellationToken cancellationToken = default)
    {
        await _fileLock.WaitAsync(cancellationToken);
        try
        {
            return await ReadAllUnlockedAsync(cancellationToken);
        }
        finally
        {
            _fileLock.Release();
        }
    }

    public async Task SaveAsync(ChatRecipe recipe, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(recipe);

        await _fileLock.WaitAsync(cancellationToken);
        try
        {
            var recipes = await ReadAllUnlockedAsync(cancellationToken);
            var index = recipes.FindIndex(existing => existing.Id == recipe.Id);
            if (index >= 0)
                recipes[index] = recipe;
            else
                recipes.Add(recipe);

            await WriteAllUnlockedAsync(recipes, cancellationToken);
        }
        finally
        {
            _fileLock.Release();
        }
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken = default)
    {
        await _fileLock.WaitAsync(cancellationToken);
        try
        {
            var recipes = await ReadAllUnlockedAsync(cancellationToken);
            if (recipes.RemoveAll(recipe => recipe.Id == id) == 0)
                return;

            await WriteAllUnlockedAsync(recipes, cancellationToken);
        }
        finally
        {
            _fileLock.Release();
        }
    }

    private async Task<List<ChatRecipe>> ReadAllUnlockedAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_recipesFilePath))
            return [];

        await using var stream = File.OpenRead(_recipesFilePath);
        var recipes = await JsonSerializer.DeserializeAsync<List<ChatRecipe>>(stream, JsonOptions, cancellationToken);
        return recipes ?? [];
    }

    private async Task WriteAllUnlockedAsync(List<ChatRecipe> recipes, CancellationToken cancellationToken)
    {
        var directory = Path.GetDirectoryName(_recipesFilePath);
        if (!string.IsNullOrEmpty(directory))
            Directory.CreateDirectory(directory);

        await using var stream = File.Create(_recipesFilePath);
        await JsonSerializer.SerializeAsync(stream, recipes, JsonOptions, cancellationToken);
    }
}
