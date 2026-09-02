using CommunityToolkit.Mvvm.ComponentModel;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>Loads and persists human notes for the opened meeting.</summary>
public partial class NotesPageViewModel : ObservableObject
{
    private readonly IMeetingRepository _meetings = AppServices.Meetings;
    private Guid? _recordId;

    [ObservableProperty]
    private string _notes = string.Empty;

    [ObservableProperty]
    private bool _hasMeeting;

    public async Task LoadAsync(Guid? meetingId)
    {
        await SaveNotesAsync();

        if (meetingId is not { } id)
        {
            _recordId = null;
            Notes = string.Empty;
            HasMeeting = false;
            return;
        }

        var record = await _meetings.GetByIdAsync(id);
        _recordId = record?.Id;
        Notes = record?.Notes ?? string.Empty;
        HasMeeting = record is not null;
    }

    /// <summary>
    /// Reloads the meeting, writes <see cref="Notes"/>, and saves the same record so
    /// transcript, summary, and folder filing are not wiped.
    /// </summary>
    public async Task SaveNotesAsync()
    {
        if (_recordId is not { } id)
            return;

        var record = await _meetings.GetByIdAsync(id);
        if (record is null)
            return;

        var notes = string.IsNullOrWhiteSpace(Notes) ? null : Notes;
        if (string.Equals(record.Notes, notes, StringComparison.Ordinal))
            return;

        record.Notes = notes;
        await _meetings.SaveAsync(record);
    }
}
