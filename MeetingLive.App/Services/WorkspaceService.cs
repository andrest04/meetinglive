using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive_App.Services;

/// <summary>
/// App-lifetime workspace: the selected meeting, the last processed recording,
/// and the only channel child pages use to request shell navigation.
/// <see cref="MainPage"/> is the sole navigator of <c>ContentFrame</c>.
/// Session tabs (Transcript / Summary / Ask / Notes) live on <c>SessionPage</c>'s inner frame.
/// </summary>
public sealed class WorkspaceService
{
    public const string Recording = ChatScopeResolver.RecordingTag;
    public const string History = ChatScopeResolver.HistoryTag;
    public const string Settings = ChatScopeResolver.SettingsTag;
    public const string Session = ChatScopeResolver.SessionTag;

    public const string TabTranscript = "Transcript";
    public const string TabSummary = "Summary";
    public const string TabAsk = "Ask";
    public const string TabNotes = "Notes";

    public Guid? SelectedMeetingId { get; private set; }

    public MeetingRecord? LastProcessedMeeting { get; private set; }

    public string SessionTab { get; private set; } = TabTranscript;

    /// <summary>Shell tag last passed to <c>MainPage.NavigateContent</c>. Defaults to Record.</summary>
    public string CurrentShellTag { get; private set; } = Recording;

    /// <summary>Library selection. Null is Inbox, not "no page loaded".</summary>
    public Guid? SelectedFolderId { get; private set; }

    /// <summary>Latest live transcript window. Chat reads this only while <see cref="IsCaptureActive"/>.</summary>
    public string LiveTranscript { get; private set; } = string.Empty;

    public event EventHandler<string>? NavigationRequested;

    /// <summary>Shell tag, folder, meeting, or capture state changed. Transcript text alone does not raise this.</summary>
    public event EventHandler? ScopeChanged;

    public event EventHandler<Guid>? MeetingDeleted;

    public event EventHandler<Guid>? MeetingChanged;

    public event EventHandler? TakeNotesRequested;

    public event EventHandler? CallPromptOffered;

    /// <summary>True while Record is capturing or processing, so the call prompt stays quiet
    /// and meeting chat uses the live transcript instead of a saved meeting.</summary>
    private bool _isCaptureActive;

    public bool IsCaptureActive
    {
        get => _isCaptureActive;
        set
        {
            if (_isCaptureActive == value)
                return;

            _isCaptureActive = value;
            ScopeChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    public void SetCurrentShellTag(string tag)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tag);
        if (tag is not (Recording or History or Settings or Session))
            throw new ArgumentOutOfRangeException(nameof(tag), tag, "Unknown workspace navigation tag.");

        if (CurrentShellTag == tag)
            return;

        CurrentShellTag = tag;
        ScopeChanged?.Invoke(this, EventArgs.Empty);
    }

    public void PublishSelectedFolder(Guid? folderId)
    {
        SelectedFolderId = folderId;
        ScopeChanged?.Invoke(this, EventArgs.Empty);
    }

    public void PublishLiveTranscript(string? transcript)
    {
        LiveTranscript = transcript ?? string.Empty;
    }

    public void SelectMeeting(Guid id) => SetSelectedMeetingId(id);

    public void ClearSelection()
    {
        if (LastProcessedMeeting?.Id == SelectedMeetingId)
            LastProcessedMeeting = null;

        SetSelectedMeetingId(null);
    }

    /// <summary>Drops workspace pointers to a meeting that was just deleted, even when
    /// it was last-processed but not the current selection.</summary>
    public void NotifyDeleted(Guid id)
    {
        if (LastProcessedMeeting?.Id == id)
            LastProcessedMeeting = null;

        if (SelectedMeetingId == id)
            SetSelectedMeetingId(null);

        MeetingDeleted?.Invoke(this, id);
    }

    public void NotifyMeetingChanged(Guid id) => MeetingChanged?.Invoke(this, id);

    public void SetLastProcessed(MeetingRecord record)
    {
        ArgumentNullException.ThrowIfNull(record);
        LastProcessedMeeting = record;
        SetSelectedMeetingId(record.Id);
    }

    private void SetSelectedMeetingId(Guid? id)
    {
        if (SelectedMeetingId == id)
            return;

        SelectedMeetingId = id;
        ScopeChanged?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Updates the session tab without requesting shell navigation.</summary>
    public void SetSessionTab(string tab)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tab);
        if (tab is not (TabTranscript or TabSummary or TabAsk or TabNotes))
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
        if (tag is TabTranscript or TabSummary or TabAsk)
            throw new ArgumentOutOfRangeException(nameof(tag), tag, "Transcript, Summary, and Ask are session tabs, not shell destinations.");

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
