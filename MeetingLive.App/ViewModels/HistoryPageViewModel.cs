using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>Lists past meetings, newest first, for navigating to their transcript/summary.</summary>
public partial class HistoryPageViewModel : ObservableObject
{
    private readonly IMeetingRepository _meetings = AppServices.Meetings;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private bool _hasMeetings;

    public ObservableCollection<MeetingRecord> Meetings { get; } = [];

    /// <summary>True once loading has finished and there's nothing to show — precomputed so the
    /// XAML empty-state Visibility binding doesn't need a nested multi-argument x:Bind call.</summary>
    public bool IsEmpty => !IsLoading && !HasMeetings;

    public async Task LoadAsync()
    {
        IsLoading = true;
        try
        {
            var records = await _meetings.GetAllAsync();
            Meetings.Clear();
            foreach (var record in records.OrderByDescending(m => m.RecordedAt))
                Meetings.Add(record);

            HasMeetings = Meetings.Count > 0;
        }
        finally
        {
            IsLoading = false;
        }
    }

    public async Task DeleteAsync(Guid id)
    {
        await _meetings.DeleteAsync(id);
        AppServices.Workspace.NotifyDeleted(id);
        await LoadAsync();
    }

    partial void OnIsLoadingChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));

    partial void OnHasMeetingsChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));
}
