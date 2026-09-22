using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>One row in the note-template ComboBox. Display names come from resources.</summary>
public sealed class NoteTemplateOption
{
    public required string Id { get; init; }

    public required string DisplayName { get; init; }

    public static async Task<IReadOnlyList<NoteTemplateOption>> LoadAsync()
    {
        var custom = await AppServices.NoteTemplates.LoadAsync();
        var items = new List<NoteTemplateOption>
        {
            new() { Id = NoteTemplateCatalog.AutoId, DisplayName = AppStrings.Get("NoteTemplate_Auto") },
            new() { Id = NoteTemplateCatalog.OneOnOneId, DisplayName = AppStrings.Get("NoteTemplate_OneOnOne") },
            new() { Id = NoteTemplateCatalog.StandupId, DisplayName = AppStrings.Get("NoteTemplate_Standup") },
            new() { Id = NoteTemplateCatalog.SalesId, DisplayName = AppStrings.Get("NoteTemplate_Sales") },
            new() { Id = NoteTemplateCatalog.UserInterviewId, DisplayName = AppStrings.Get("NoteTemplate_UserInterview") },
        };

        if (custom is not null && !string.IsNullOrWhiteSpace(custom.Name))
        {
            items.Add(new NoteTemplateOption
            {
                Id = NoteTemplateCatalog.CustomId,
                DisplayName = custom.Name.Trim(),
            });
        }

        return items;
    }
}
