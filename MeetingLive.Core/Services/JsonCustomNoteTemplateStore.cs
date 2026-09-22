using System.Text.Json;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// JSON file for the single custom note template. The optional constructor argument
/// overrides the path so tests never write into the user's real app data.
/// </summary>
public sealed class JsonCustomNoteTemplateStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    private readonly SemaphoreSlim _fileLock = new(1, 1);
    private readonly string _filePath;

    public JsonCustomNoteTemplateStore(string? filePath = null)
    {
        _filePath = filePath ?? AppPaths.CustomNoteTemplateFilePath;
    }

    public async Task<CustomNoteTemplate?> LoadAsync(CancellationToken cancellationToken = default)
    {
        await _fileLock.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(_filePath))
                return null;

            await using var stream = File.OpenRead(_filePath);
            return await JsonSerializer.DeserializeAsync<CustomNoteTemplate>(stream, JsonOptions, cancellationToken);
        }
        finally
        {
            _fileLock.Release();
        }
    }

    public async Task SaveAsync(CustomNoteTemplate template, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(template);
        if (string.IsNullOrWhiteSpace(template.Name))
            throw new ArgumentException("A custom template needs a name.", nameof(template));
        if (string.IsNullOrWhiteSpace(template.Instructions))
            throw new ArgumentException("A custom template needs instructions.", nameof(template));

        template.Name = template.Name.Trim();
        template.Instructions = template.Instructions.Trim();

        await _fileLock.WaitAsync(cancellationToken);
        try
        {
            var directory = Path.GetDirectoryName(_filePath);
            if (!string.IsNullOrEmpty(directory))
                Directory.CreateDirectory(directory);

            await using var stream = File.Create(_filePath);
            await JsonSerializer.SerializeAsync(stream, template, JsonOptions, cancellationToken);
        }
        finally
        {
            _fileLock.Release();
        }
    }
}
