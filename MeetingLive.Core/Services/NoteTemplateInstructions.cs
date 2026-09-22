namespace MeetingLive.Core.Services;

/// <summary>Resolves the instruction text stamped into a summary prompt for a template id.</summary>
public static class NoteTemplateInstructions
{
    public static async Task<string?> ResolveAsync(
        string? templateId,
        JsonCustomNoteTemplateStore store,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(store);

        var id = NoteTemplateCatalog.NormalizeId(templateId);
        if (id is null)
            return null;

        if (id.Equals(NoteTemplateCatalog.CustomId, StringComparison.OrdinalIgnoreCase))
        {
            var custom = await store.LoadAsync(cancellationToken);
            return string.IsNullOrWhiteSpace(custom?.Instructions) ? null : custom.Instructions.Trim();
        }

        return NoteTemplateCatalog.InstructionsFor(id);
    }
}
