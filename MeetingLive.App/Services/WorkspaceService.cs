using MeetingLive.Core.Models;

namespace MeetingLive_App.Services;

/// <summary>
/// App-lifetime workspace: the selected meeting, the last processed recording,
/// and the only channel child pages use to request shell navigation.
/// <see cref="MainPage"/> is the sole navigator of <c>ContentFrame</c>.
/// Session tabs (Transcript / Summary / Notes) live on <c>SessionPage</c>'s inner frame.
/// </summary>
public sealed class WorkspaceService
{
    public const string Recording = "Recording";
    public const string History = "History";
    public const string Settings = "Settings";
    public const string Session = "Session";

    public const string TabTranscript = "Transcript";
    public const string TabSummary = "Summary";
    public const string TabNotes = "Notes";

    public Guid? SelectedMeetingId { get; private set; }

    public MeetingRecord? LastProcessedMeeting { get; private set; }

    public string SessionTab { get; private set; } = TabTranscript;

    public event EventHandler<string>? NavigationRequested;

    public event EventHandler<Guid>? MeetingDeleted;

    public event EventHandler? TakeNotesRequested;

    public event EventHandler? CallPromptOffered;

    /// <summary>True while Record is capturing or processing, so the call prompt stays quiet.</summary>
    public bool IsCaptureActive { get; set; }

    public void SelectMeeting(Guid id) => SelectedMeetingId = id;

    public void ClearSelection()
    {
        if (LastProcessedMeeting?.Id == SelectedMeetingId)
            LastProcessedMeeting = null;

        SelectedMeetingId = null;
    }

    /// <summary>Drops workspace pointers to a meeting that was just deleted, even when
    /// it was last-processed but not the current selection.</summary>
    public void NotifyDeleted(Guid id)
    {
        if (LastProcessedMeeting?.Id == id)
            LastProcessedMeeting = null;

        if (SelectedMeetingId == id)
            SelectedMeetingId = null;

        MeetingDeleted?.Invoke(this, id);
    }

    public void SetLastProcessed(MeetingRecord record)
    {
        ArgumentNullException.ThrowIfNull(record);
        LastProcessedMeeting = record;
        SelectedMeetingId = record.Id;
    }

    /// <summary>Updates the session tab without requesting shell navigation.</summary>
    public void SetSessionTab(string tab)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tab);
        if (tab is not (TabTranscript or TabSummary or TabNotes))
            throw new ArgumentOutOfRangeException(nameof(tab), tab, "Unknown session tab.");

        SessionTab = tab;
    }

    public void OpenSession(string tab)
    {
        SetSessionTab(tab);
        NavigateTo(Session);
    }

    public void NavigateTo(string tag)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tag);
        if (tag is TabTranscript or TabSummary)
            throw new ArgumentOutOfRangeException(nameof(tag), tag, "Transcript and Summary are session tabs, not shell destinations.");

        if (tag is not (Recording or History or Settings or Session))
            throw new ArgumentOutOfRangeException(nameof(tag), tag, "Unknown workspace navigation tag.");

        NavigationRequested?.Invoke(this, tag);
    }

    private bool _takeNotesPending;

    public void OfferCallPrompt() => CallPromptOffered?.Invoke(this, EventArgs.Empty);

    public void RequestTakeNotes()
    {
        _takeNotesPending = true;
        TakeNotesRequested?.Invoke(this, EventArgs.Empty);
        NavigateTo(Recording);
    }

    public bool ConsumeTakeNotes()
    {
        if (!_takeNotesPending)
            return false;

        _takeNotesPending = false;
        return true;
    }
}
