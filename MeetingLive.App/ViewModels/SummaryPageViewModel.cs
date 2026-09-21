using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using Microsoft.UI.Dispatching;
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
    private DispatcherQueueTimer? _copyConfirmationTimer;
    private IReadOnlyList<FolderPathItem> _folderPaths = [];
    private Guid? _suggestedFolderId;
    private bool _hasTypeSafeKey;
    private bool _typeSafeEnabled = true;

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
    private bool _canRegenerateSummary;

    [ObservableProperty]
    private bool _isGenerating;

    [ObservableProperty]
    private bool _isCopyConfirmationOpen;

    [ObservableProperty]
    private string _statusText = string.Empty;

    [ObservableProperty]
    private bool _isRechecking;

    [ObservableProperty]
    private bool _showJevMeetingType;

    [ObservableProperty]
    private string _jevMeetingTypeText = string.Empty;

    [ObservableProperty]
    private bool _showJevUrgency;

    [ObservableProperty]
    private string _jevUrgencyText = string.Empty;

    [ObservableProperty]
    private bool _showJevWarning;

    [ObservableProperty]
    private string _jevWarningText = string.Empty;

    [ObservableProperty]
    private bool _showFileInFolder;

    [ObservableProperty]
    private string _fileInFolderButtonText = string.Empty;

    public bool HasJevStrip => ShowJevMeetingType || ShowJevUrgency || ShowJevWarning || ShowFileInFolder;

    public bool CanRecheckJev =>
        _record is not null &&
        !string.IsNullOrWhiteSpace(_record.Transcript) &&
        _hasTypeSafeKey &&
        _typeSafeEnabled &&
        !IsGenerating &&
        !IsRechecking;

    /// <summary>Supplied by the page (needs a XamlRoot for the setup dialog). Used only when the
    /// selected provider is Local.</summary>
    public Func<Task<string?>>? EnsureSummaryModelAsync { get; set; }

    /// <summary>Supplied by the page (needs a XamlRoot for the setup dialog): confirms the Claude
    /// Code / Codex CLI is on PATH, walking the user through <c>CliToolSetupDialog</c> if not.
    /// Used only when the selected provider is ClaudeCode or Codex.</summary>
    public Func<SummaryProviderKind, Task<bool>>? EnsureCliProviderAsync { get; set; }

    /// <summary>Supplied by the page (needs a XamlRoot): SuperGrok / API key gate for Xai.</summary>
    public Func<Task<bool>>? EnsureXaiProviderAsync { get; set; }

    /// <summary>Supplied by the page (needs a XamlRoot). Confirms overwrite before regenerating.</summary>
    public Func<Task<bool>>? ConfirmRegenerateAsync { get; set; }

    /// <summary>The checklist for the loaded meeting's action items — bound two-way in the UI;
    /// toggling <see cref="ActionItemViewModel.IsDone"/> re-persists the record (see
    /// <see cref="OnActionItemChanged"/>).</summary>
    public ObservableCollection<ActionItemViewModel> ActionItems { get; } = [];

    public bool HasActionItems => ActionItems.Count > 0;

    /// <summary>True once loading has finished and there's nothing to show or generate — precomputed so
    /// the XAML empty-state Visibility binding doesn't need a nested multi-argument x:Bind call.</summary>
    public bool IsEmpty => !IsLoading && !HasSummary && !CanGenerateSummary;

    /// <summary>Generate or regenerate chrome — precomputed so XAML doesn't nest x:Bind arguments.</summary>
    public bool ShowSummaryActionBar => CanGenerateSummary || CanRegenerateSummary || CanRecheckJev;

    public async Task LoadAsync(Guid? meetingId)
    {
        IsLoading = true;
        try
        {
            _record = meetingId is { } id
                ? await _meetings.GetByIdAsync(id)
                : (await _meetings.GetAllAsync()).OrderByDescending(m => m.RecordedAt).FirstOrDefault();

            if (_record is not null)
                AppServices.Workspace.SelectMeeting(_record.Id);

            Title = _record?.Title ?? AppStrings.Get("NoSummariesYet");
            Summary = _record?.Summary ?? string.Empty;
            HasSummary = !string.IsNullOrWhiteSpace(Summary);
            var hasTranscript = _record is not null && !string.IsNullOrWhiteSpace(_record.Transcript);
            CanGenerateSummary = hasTranscript && !HasSummary;
            CanRegenerateSummary = hasTranscript && HasSummary;
            StatusText = string.Empty;
            await RefreshTypeSafeGateAsync();
            await RefreshFolderPathsAsync();
            LoadActionItems();
            ApplyJevUi();
        }
        finally
        {
            IsLoading = false;
            GenerateSummaryCommand.NotifyCanExecuteChanged();
            RegenerateSummaryCommand.NotifyCanExecuteChanged();
            RecheckJevCommand.NotifyCanExecuteChanged();
        }
    }

    private bool CanExecuteGenerateSummary() => CanGenerateSummary && !IsGenerating;

    private bool CanExecuteRegenerateSummary() => CanRegenerateSummary && !IsGenerating;

    [RelayCommand(CanExecute = nameof(CanExecuteGenerateSummary))]
    private async Task GenerateSummaryAsync()
    {
        if (IsGenerating || _record?.Transcript is not { Length: > 0 } transcript)
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
                transcript, _record.Title, _record.RecordedAt, outputLanguage: summaryLanguage, endedAt: _record.EndedAt));

            var resolvedTitle = SuggestedMeetingTitle.Resolve(_record.Title, result.SuggestedTitle);
            var titleChanged = !string.Equals(resolvedTitle, _record.Title, StringComparison.Ordinal);

            _record.Summary = result.SummaryMarkdown;
            _record.ActionItems = result.ActionItems;
            _record.SummaryProvider = result.ProviderId;
            if (titleChanged)
                _record.Title = resolvedTitle;

            await _meetings.SaveAsync(_record);

            if (titleChanged)
            {
                Title = resolvedTitle;
                if (AppServices.Workspace.LastProcessedMeeting?.Id == _record.Id)
                    AppServices.Workspace.LastProcessedMeeting.Title = resolvedTitle;

                AppServices.Workspace.NotifyMeetingChanged(_record.Id);
            }

            Summary = result.SummaryMarkdown;
            HasSummary = true;
            CanGenerateSummary = false;
            CanRegenerateSummary = true;
            StatusText = AppStrings.Get("Status_SummaryGenerated");

            var jevStatus = await MeetingJevRunner.TryAnalyzeAndSaveAsync(_record, _meetings, CancellationToken.None);
            LoadActionItems();
            ApplyJevUi();
            if (jevStatus is not null)
                StatusText = jevStatus;
        }
        catch (Exception ex)
        {
            StatusText = AppStrings.Format("Error_GenerateSummary", CliFailureUserMessage.Format(ex));
        }
        finally
        {
            IsGenerating = false;
            GenerateSummaryCommand.NotifyCanExecuteChanged();
            RegenerateSummaryCommand.NotifyCanExecuteChanged();
            RecheckJevCommand.NotifyCanExecuteChanged();
        }
    }

    private bool CanExecuteRecheckJev() => CanRecheckJev;

    [RelayCommand(CanExecute = nameof(CanExecuteRecheckJev))]
    private async Task RecheckJevAsync()
    {
        if (_record is null || IsRechecking)
            return;

        IsRechecking = true;
        StatusText = AppStrings.Get("Status_JevChecking");
        try
        {
            await RefreshTypeSafeGateAsync();
            if (_record is null ||
                string.IsNullOrWhiteSpace(_record.Transcript) ||
                !_hasTypeSafeKey ||
                !_typeSafeEnabled)
            {
                StatusText = string.Empty;
                return;
            }

            var jevStatus = await MeetingJevRunner.TryAnalyzeAndSaveAsync(_record, _meetings, CancellationToken.None);
            LoadActionItems();
            ApplyJevUi();
            StatusText = jevStatus ?? AppStrings.Get("Status_JevRechecked");
        }
        finally
        {
            IsRechecking = false;
            RecheckJevCommand.NotifyCanExecuteChanged();
        }
    }

    [RelayCommand]
    private async Task FileInFolderAsync()
    {
        if (_record is null || _suggestedFolderId is not { } folderId)
            return;

        _record.FolderId = folderId;
        await _meetings.SaveAsync(_record);
        AppServices.Workspace.NotifyMeetingChanged(_record.Id);
        ApplyJevUi();
    }

    [RelayCommand(CanExecute = nameof(CanExecuteRegenerateSummary))]
    private async Task RegenerateSummaryAsync()
    {
        if (ConfirmRegenerateAsync is null || !await ConfirmRegenerateAsync())
            return;

        await GenerateSummaryAsync();
    }

    /// <summary>Resolves (and, for a CLI provider, gates on availability) the provider to
    /// summarize with, or null if the required gate wasn't satisfied (no model chosen / setup
    /// dialog cancelled) — the caller then aborts generation.</summary>
    private async Task<ISummaryProvider?> ResolveSummaryProviderAsync(SummaryProviderKind providerKind) =>
        (await SummaryProviderResolver.ResolveAsync(
            providerKind, EnsureSummaryModelAsync, EnsureCliProviderAsync, EnsureXaiProviderAsync))?.Provider;

    [RelayCommand]
    private void CopyToClipboard()
    {
        if (!HasSummary)
            return;

        var package = new DataPackage();
        package.SetText(Summary);
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
    private async Task OpenFileLocationAsync()
    {
        if (_record is null)
            return;

        var filePath = _record.SourcePath;
        if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
        {
            var loaded = await AppServices.Meetings.GetByIdAsync(_record.Id);
            filePath = loaded?.SourcePath;
        }

        if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
            return;

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
            var verdicts = _record.JevAnalysis?.ActionItems;
            foreach (var actionItem in _record.ActionItems)
            {
                var verdict = ActionItemVerdictDisplay.Match(verdicts, actionItem.Text);
                var itemViewModel = new ActionItemViewModel(actionItem, verdict);
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

        try
        {
            await _meetings.SaveAsync(_record);
        }
        catch (Exception ex)
        {
            StatusText = AppStrings.Format("Error_SaveActionItem", ex.Message);
        }
    }

    private async Task RefreshTypeSafeGateAsync()
    {
        var settings = await AppServices.Settings.LoadAsync();
        _typeSafeEnabled = settings.TypeSafeEnabled;
        var credentials = AppServices.TypeSafeCredentials.Load();
        _hasTypeSafeKey = credentials is not null && !string.IsNullOrWhiteSpace(credentials.ApiKey);
        OnPropertyChanged(nameof(CanRecheckJev));
        OnPropertyChanged(nameof(ShowSummaryActionBar));
        RecheckJevCommand.NotifyCanExecuteChanged();
    }

    private async Task RefreshFolderPathsAsync()
    {
        var folders = await AppServices.Folders.GetAllAsync();
        _folderPaths = FolderPathList.Flatten(folders, AppStrings.Get("Library_Inbox"));
    }

    private void ApplyJevUi()
    {
        var analysis = _record?.JevAnalysis;
        if (analysis is null)
        {
            ShowJevMeetingType = false;
            JevMeetingTypeText = string.Empty;
            ShowJevUrgency = false;
            JevUrgencyText = string.Empty;
            ShowJevWarning = false;
            JevWarningText = string.Empty;
            ShowFileInFolder = false;
            FileInFolderButtonText = string.Empty;
            _suggestedFolderId = null;
            OnPropertyChanged(nameof(HasJevStrip));
            return;
        }

        ShowJevMeetingType = MeetingJevPresentation.ShowMeetingType(analysis);
        JevMeetingTypeText = ShowJevMeetingType
            ? FormatMeetingType(analysis.MeetingType!)
            : string.Empty;

        var urgency = MeetingJevPresentation.UrgencyLabelScore(analysis);
        ShowJevUrgency = urgency is not null;
        JevUrgencyText = urgency switch
        {
            0 => AppStrings.Get("Jev_UrgencyRoutine"),
            1 => AppStrings.Get("Jev_UrgencyTimeSensitive"),
            2 => AppStrings.Get("Jev_UrgencyBlocking"),
            _ => string.Empty,
        };

        var pii = MeetingJevPresentation.ShowPiiWarning(analysis);
        var unfaithful = MeetingJevPresentation.ShowFaithfulWarning(analysis);
        ShowJevWarning = pii || unfaithful;
        JevWarningText = (pii, unfaithful) switch
        {
            (true, true) => AppStrings.Get("Jev_WarningPiiAndUnfaithful"),
            (true, false) => AppStrings.Get("Jev_WarningPii"),
            (false, true) => AppStrings.Get("Jev_WarningUnfaithful"),
            _ => string.Empty,
        };

        if (MeetingJevPresentation.TryGetSuggestedFolderId(analysis, _record!.FolderId, out var folderId))
        {
            var path = _folderPaths.FirstOrDefault(item => item.FolderId == folderId)?.Path;
            if (!string.IsNullOrWhiteSpace(path))
            {
                _suggestedFolderId = folderId;
                ShowFileInFolder = true;
                FileInFolderButtonText = AppStrings.Format("Jev_FileInFolder", path);
            }
            else
            {
                _suggestedFolderId = null;
                ShowFileInFolder = false;
                FileInFolderButtonText = string.Empty;
            }
        }
        else
        {
            _suggestedFolderId = null;
            ShowFileInFolder = false;
            FileInFolderButtonText = string.Empty;
        }

        OnPropertyChanged(nameof(HasJevStrip));
    }

    private static string FormatMeetingType(string meetingType)
    {
        var key = "Jev_MeetingType_" + meetingType;
        var label = AppStrings.Get(key);
        return string.IsNullOrEmpty(label) ? meetingType : label;
    }

    partial void OnIsLoadingChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));

    partial void OnHasSummaryChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));

    partial void OnCanGenerateSummaryChanged(bool value)
    {
        OnPropertyChanged(nameof(IsEmpty));
        OnPropertyChanged(nameof(ShowSummaryActionBar));
        GenerateSummaryCommand.NotifyCanExecuteChanged();
    }

    partial void OnCanRegenerateSummaryChanged(bool value)
    {
        OnPropertyChanged(nameof(ShowSummaryActionBar));
        RegenerateSummaryCommand.NotifyCanExecuteChanged();
    }

    partial void OnIsGeneratingChanged(bool value)
    {
        GenerateSummaryCommand.NotifyCanExecuteChanged();
        RegenerateSummaryCommand.NotifyCanExecuteChanged();
        OnPropertyChanged(nameof(CanRecheckJev));
        OnPropertyChanged(nameof(ShowSummaryActionBar));
        RecheckJevCommand.NotifyCanExecuteChanged();
    }

    partial void OnIsRecheckingChanged(bool value)
    {
        OnPropertyChanged(nameof(CanRecheckJev));
        OnPropertyChanged(nameof(ShowSummaryActionBar));
        RecheckJevCommand.NotifyCanExecuteChanged();
    }

    partial void OnShowJevMeetingTypeChanged(bool value) => OnPropertyChanged(nameof(HasJevStrip));

    partial void OnShowJevUrgencyChanged(bool value) => OnPropertyChanged(nameof(HasJevStrip));

    partial void OnShowJevWarningChanged(bool value) => OnPropertyChanged(nameof(HasJevStrip));

    partial void OnShowFileInFolderChanged(bool value) => OnPropertyChanged(nameof(HasJevStrip));
}
