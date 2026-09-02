using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using Windows.ApplicationModel.DataTransfer;

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

    /// <summary>Supplied by the page (needs a XamlRoot for the setup dialog). Used only when the
    /// selected provider is Local.</summary>
    public Func<Task<string?>>? EnsureSummaryModelAsync { get; set; }

    /// <summary>Supplied by the page (needs a XamlRoot for the setup dialog): confirms the Claude
    /// Code / Codex CLI is on PATH, walking the user through <c>CliToolSetupDialog</c> if not.
    /// Used only when the selected provider is ClaudeCode or Codex.</summary>
    public Func<SummaryProviderKind, Task<bool>>? EnsureCliProviderAsync { get; set; }

    /// <summary>The checklist for the loaded meeting's action items — bound two-way in the UI;
    /// toggling <see cref="ActionItemViewModel.IsDone"/> re-persists the record (see
    /// <see cref="OnActionItemChanged"/>).</summary>
    public ObservableCollection<ActionItemViewModel> ActionItems { get; } = [];

    public bool HasActionItems => ActionItems.Count > 0;

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

            Title = _record?.Title ?? AppStrings.Get("NoSummariesYet");
            Summary = _record?.Summary ?? string.Empty;
            HasSummary = !string.IsNullOrWhiteSpace(Summary);
            CanGenerateSummary = _record is not null && !string.IsNullOrWhiteSpace(_record.Transcript) && !HasSummary;
            StatusText = string.Empty;
            LoadActionItems();
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
        if (_record?.Transcript is not { Length: > 0 } transcript)
            return;

        IsGenerating = true;
        StatusText = AppStrings.Get("Status_GeneratingSummary");
        try
        {
            var settings = await AppServices.Settings.LoadAsync();
            var providerKind = settings.ResolveSummaryProviderKind();
            var provider = await ResolveSummaryProviderAsync(providerKind);
            if (provider is null)
            {
                StatusText = AppStrings.Get("Status_SetupCancelled");
                return;
            }

            var summaryLanguage = settings.ResolveSummaryLanguage();
            var result = await Task.Run(() => provider.SummarizeAsync(
                transcript, _record.Title, _record.RecordedAt, outputLanguage: summaryLanguage));

            _record.Summary = result.SummaryMarkdown;
            _record.ActionItems = result.ActionItems;
            _record.SummaryProvider = result.ProviderId;
            await _meetings.SaveAsync(_record);

            Summary = result.SummaryMarkdown;
            LoadActionItems();
            HasSummary = true;
            CanGenerateSummary = false;
            StatusText = AppStrings.Get("Status_SummaryGenerated");
        }
        catch (Exception ex)
        {
            StatusText = AppStrings.Format("Error_GenerateSummary", ex.Message);
        }
        finally
        {
            IsGenerating = false;
            GenerateSummaryCommand.NotifyCanExecuteChanged();
        }
    }

    /// <summary>Resolves (and, for a CLI provider, gates on availability) the provider to
    /// summarize with, or null if the required gate wasn't satisfied (no model chosen / setup
    /// dialog cancelled) — the caller then aborts generation.</summary>
    private async Task<ISummaryProvider?> ResolveSummaryProviderAsync(SummaryProviderKind providerKind)
    {
        if (providerKind == SummaryProviderKind.Local)
        {
            var modelPath = EnsureSummaryModelAsync is null ? null : await EnsureSummaryModelAsync();
            return modelPath is null ? null : AppServices.CreateSummaryProvider(SummaryProviderKind.Local, modelPath);
        }

        var available = EnsureCliProviderAsync is not null && await EnsureCliProviderAsync(providerKind);
        return available ? AppServices.CreateSummaryProvider(providerKind, localModelPath: null) : null;
    }

    [RelayCommand]
    private void CopyToClipboard()
    {
        if (!HasSummary)
            return;

        var package = new DataPackage();
        package.SetText(Summary);
        Clipboard.SetContent(package);
    }

    [RelayCommand]
    private void OpenFileLocation()
    {
        if (_record is null)
            return;

        var filePath = Path.Combine(AppPaths.MeetingsDirectory, $"{_record.Id}.md");
        Process.Start(new ProcessStartInfo("explorer.exe", $"/select,\"{filePath}\"") { UseShellExecute = true });
    }

    /// <summary>Rebuilds <see cref="ActionItems"/> from <c>_record.ActionItems</c>, re-wiring the
    /// toggle-persist subscription on each wrapper.</summary>
    private void LoadActionItems()
    {
        foreach (var item in ActionItems)
            item.PropertyChanged -= OnActionItemChanged;
        ActionItems.Clear();

        if (_record is not null)
        {
            foreach (var actionItem in _record.ActionItems)
            {
                var itemViewModel = new ActionItemViewModel(actionItem);
                itemViewModel.PropertyChanged += OnActionItemChanged;
                ActionItems.Add(itemViewModel);
            }
        }

        OnPropertyChanged(nameof(HasActionItems));
    }

    /// <summary>Toggling a checkbox writes straight through to the wrapped <see cref="ActionItem"/>
    /// (see <see cref="ActionItemViewModel"/>) — this just re-persists the record so the change
    /// survives navigating away and back.</summary>
    private async void OnActionItemChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName != nameof(ActionItemViewModel.IsDone) || _record is null)
            return;

        await _meetings.SaveAsync(_record);
    }

    partial void OnIsLoadingChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));

    partial void OnHasSummaryChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));

    partial void OnCanGenerateSummaryChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));
}
