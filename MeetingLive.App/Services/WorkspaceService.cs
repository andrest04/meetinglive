using MeetingLive.Core.Models;

namespace MeetingLive_App.Services;

/// <summary>
/// App-lifetime workspace: the selected meeting, the last processed recording,
/// and the only channel child pages use to request shell navigation.
/// <see cref="MainPage"/> is the sole navigator of <c>ContentFrame</c>.
/// </summary>
public sealed class WorkspaceService
{
    public const string Recording = "Recording";
    public const string Transcript = "Transcript";
    public const string Summary = "Summary";
    public const string History = "History";
    public const string Settings = "Settings";

    public Guid? SelectedMeetingId { get; private set; }

    public MeetingRecord? LastProcessedMeeting { get; private set; }

    public event EventHandler<string>? NavigationRequested;

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
    }

    public void SetLastProcessed(MeetingRecord record)
    {
        ArgumentNullException.ThrowIfNull(record);
        LastProcessedMeeting = record;
        SelectedMeetingId = record.Id;
    }

    public void NavigateTo(string tag)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(tag);
        if (tag is not (Recording or Transcript or Summary or History or Settings))
            throw new ArgumentOutOfRangeException(nameof(tag), tag, "Unknown workspace navigation tag.");

        NavigationRequested?.Invoke(this, tag);
    }
}
