using CommunityToolkit.Mvvm.ComponentModel;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>Chrome for an opened meeting session: title and empty-vs-content state.</summary>
public partial class SessionPageViewModel : ObservableObject
{
    private readonly IMeetingRepository _meetings = AppServices.Meetings;

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

    partial void OnIsLoadingChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));

    partial void OnHasMeetingChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));
}
