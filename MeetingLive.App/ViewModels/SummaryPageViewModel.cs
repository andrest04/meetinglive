using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Loads and displays the structured summary of a meeting (by id, or the most
/// recent one), and can generate one on demand if the recording only has a
/// transcript so far (e.g. no local model had been downloaded yet when it was recorded).
/// </summary>
public partial class SummaryPageViewModel : ObservableObject
{
    private readonly IMeetingRepository _meetings = AppServices.Meetings;
    private MeetingRecord? _record;

    [ObservableProperty]
    private string _title = string.Empty;

    [ObservableProperty]
    private string _summary = string.Empty;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private bool _hasSummary;

    [ObservableProperty]
    private bool _canGenerateSummary;

    [ObservableProperty]
    private bool _isGenerating;

    [ObservableProperty]
    private string _statusText = string.Empty;

    /// <summary>Supplied by the page (needs a XamlRoot for the setup dialog).</summary>
    public Func<Task<string?>>? EnsureSummaryModelAsync { get; set; }

    /// <summary>True once loading has finished and there's nothing to show or generate — precomputed so
    /// the XAML empty-state Visibility binding doesn't need a nested multi-argument x:Bind call.</summary>
    public bool IsEmpty => !IsLoading && !HasSummary && !CanGenerateSummary;

    public async Task LoadAsync(Guid? meetingId)
    {
        IsLoading = true;
        try
        {
            _record = meetingId is { } id
                ? await _meetings.GetByIdAsync(id)
                : (await _meetings.GetAllAsync()).OrderByDescending(m => m.RecordedAt).FirstOrDefault();

            Title = _record?.Title ?? "No summaries yet";
            Summary = _record?.Summary ?? string.Empty;
            HasSummary = !string.IsNullOrWhiteSpace(Summary);
            CanGenerateSummary = _record is not null && !string.IsNullOrWhiteSpace(_record.Transcript) && !HasSummary;
            StatusText = string.Empty;
        }
        finally
        {
            IsLoading = false;
            GenerateSummaryCommand.NotifyCanExecuteChanged();
        }
    }

    [RelayCommand(CanExecute = nameof(CanGenerateSummary))]
    private async Task GenerateSummaryAsync()
    {
        if (_record?.Transcript is not { Length: > 0 } transcript || EnsureSummaryModelAsync is null)
            return;

        IsGenerating = true;
        StatusText = "Generating summary...";
        try
        {
            var modelPath = await EnsureSummaryModelAsync();
            if (modelPath is null)
            {
                StatusText = "Setup cancelled.";
                return;
            }

            var provider = AppServices.CreateSummaryProvider(modelPath);
            var summary = await Task.Run(() => provider.SummarizeAsync(transcript));

            _record.Summary = summary;
            await _meetings.SaveAsync(_record);

            Summary = summary;
            HasSummary = true;
            CanGenerateSummary = false;
            StatusText = "Summary generated.";
        }
        catch (Exception ex)
        {
            StatusText = $"Error generating the summary: {ex.Message}";
        }
        finally
        {
            IsGenerating = false;
            GenerateSummaryCommand.NotifyCanExecuteChanged();
        }
    }

    partial void OnIsLoadingChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));

    partial void OnHasSummaryChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));

    partial void OnCanGenerateSummaryChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));
}
