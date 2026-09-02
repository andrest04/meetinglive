using System.Diagnostics;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using Microsoft.UI.Dispatching;
using Windows.ApplicationModel.DataTransfer;

namespace MeetingLive_App.ViewModels;

/// <summary>Loads and displays the full transcript of a meeting (by id, or the most recent one).</summary>
public partial class TranscriptPageViewModel : ObservableObject
{
    private readonly IMeetingRepository _meetings = AppServices.Meetings;
    private Guid? _recordId;
    private DispatcherQueueTimer? _copyConfirmationTimer;

    [ObservableProperty]
    private string _title = string.Empty;

    [ObservableProperty]
    private string _transcript = string.Empty;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private bool _hasContent;

    [ObservableProperty]
    private bool _isCopyConfirmationOpen;

    /// <summary>True once loading has finished and there's nothing to show — precomputed so the
    /// XAML empty-state Visibility binding doesn't need a nested multi-argument x:Bind call.</summary>
    public bool IsEmpty => !IsLoading && !HasContent;

    public async Task LoadAsync(Guid? meetingId)
    {
        IsLoading = true;
        try
        {
            var record = meetingId is { } id
                ? await _meetings.GetByIdAsync(id)
                : (await _meetings.GetAllAsync()).OrderByDescending(m => m.RecordedAt).FirstOrDefault();

            _recordId = record?.Id;
            if (record is not null)
                AppServices.Workspace.SelectMeeting(record.Id);

            Title = record?.Title ?? AppStrings.Get("NoTranscriptsYet");
            Transcript = record?.Transcript ?? string.Empty;
            HasContent = !string.IsNullOrWhiteSpace(Transcript);
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private void CopyToClipboard()
    {
        if (!HasContent)
            return;

        var package = new DataPackage();
        package.SetText(Transcript);
        Clipboard.SetContent(package);
        ShowCopyConfirmation();
    }

    private void ShowCopyConfirmation()
    {
        IsCopyConfirmationOpen = true;
        _copyConfirmationTimer ??= CreateCopyConfirmationTimer();
        _copyConfirmationTimer.Stop();
        _copyConfirmationTimer.Start();
    }

    private DispatcherQueueTimer CreateCopyConfirmationTimer()
    {
        var timer = App.DispatcherQueue.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(2.5);
        timer.IsRepeating = false;
        timer.Tick += (_, _) => IsCopyConfirmationOpen = false;
        return timer;
    }

    [RelayCommand]
    private void OpenFileLocation()
    {
        if (_recordId is not { } id)
            return;

        var filePath = Path.Combine(AppPaths.MeetingsDirectory, $"{id}.md");
        Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{filePath}\"") { UseShellExecute = true });
    }

    partial void OnIsLoadingChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));

    partial void OnHasContentChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));
}
