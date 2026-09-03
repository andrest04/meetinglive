using CommunityToolkit.Mvvm.ComponentModel;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>Chrome for an opened meeting session: title and empty-vs-content state.</summary>
public partial class SessionPageViewModel : ObservableObject
{
    private readonly IMeetingRepository _meetings = AppServices.Meetings;
    private Guid? _meetingId;

    [ObservableProperty]
    private string _title = string.Empty;

    [ObservableProperty]
    private bool _isLoading = true;

    [ObservableProperty]
    private bool _hasMeeting;

    /// <summary>True once loading has finished and no meeting is selected — precomputed so the
    /// XAML empty-state Visibility binding doesn't need a nested multi-argument x:Bind call.</summary>
    public bool IsEmpty => !IsLoading && !HasMeeting;

    public async Task LoadAsync(Guid? meetingId)
    {
        IsLoading = true;
        try
        {
            _meetingId = meetingId;
            if (meetingId is not { } id)
            {
                Title = string.Empty;
                HasMeeting = false;
                return;
            }

            var record = await _meetings.GetByIdAsync(id);
            Title = record?.Title ?? string.Empty;
            HasMeeting = record is not null;
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>
    /// Updates the meeting title in frontmatter. The markdown filename stays <c>{id}.md</c>.
    /// </summary>
    public async Task<bool> RenameAsync(string name)
    {
        var trimmed = name.Trim();
        if (trimmed.Length == 0)
            return false;

        if (_meetingId is not { } id)
            return false;

        if (trimmed == Title)
            return true;

        var record = await _meetings.GetByIdAsync(id);
        if (record is null)
            return false;

        record.Title = trimmed;
        await _meetings.SaveAsync(record);
        Title = trimmed;

        if (AppServices.Workspace.LastProcessedMeeting?.Id == id)
            AppServices.Workspace.LastProcessedMeeting.Title = trimmed;

        return true;
    }

    partial void OnIsLoadingChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));

    partial void OnHasMeetingChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));
}
