using System.Diagnostics;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using Windows.ApplicationModel.DataTransfer;

namespace MeetingLive_App.ViewModels;

/// <summary>Loads and displays the full transcript of a meeting (by id, or the most recent one).</summary>
public partial class TranscriptPageViewModel : ObservableObject
{
    private readonly IMeetingRepository _meetings = AppServices.Meetings;
    private Guid? _recordId;

    [ObservableProperty]
    private string _title = string.Empty;

    [ObservableProperty]
    private string _transcript = string.Empty;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private bool _hasContent;

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
            Title = record?.Title ?? "No transcripts yet";
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
