using CommunityToolkit.Mvvm.ComponentModel;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>Chrome for an opened meeting session: title and empty-vs-content state.</summary>
public partial class SessionPageViewModel : ObservableObject
{
    private readonly IMeetingRepository _meetings = AppServices.Meetings;
    private Guid? _meetingId;

    public SessionPageViewModel()
    {
        AppServices.Workspace.MeetingChanged += OnMeetingChanged;
    }

    [ObservableProperty]
    private string _title = string.Empty;

    [ObservableProperty]
    private bool _isLoading = true;

    [ObservableProperty]
    private bool _hasMeeting;

    [ObservableProperty]
    private bool _hasTranscript;

    [ObservableProperty]
    private bool _isSuggestingTitle;

    /// <summary>Supplied by the page (needs a XamlRoot for the setup dialog). Used only when the
    /// selected provider is Local.</summary>
    public Func<Task<string?>>? EnsureSummaryModelAsync { get; set; }

    /// <summary>Supplied by the page (needs a XamlRoot for the setup dialog): confirms the Claude
    /// Code / Codex CLI is on PATH, walking the user through <c>CliToolSetupDialog</c> if not.
    /// Used only when the selected provider is ClaudeCode or Codex.</summary>
    public Func<SummaryProviderKind, Task<bool>>? EnsureCliProviderAsync { get; set; }

    /// <summary>True once loading has finished and no meeting is selected — precomputed so the
    /// XAML empty-state Visibility binding doesn't need a nested multi-argument x:Bind call.</summary>
    public bool IsEmpty => !IsLoading && !HasMeeting;

    public bool CanSuggestTitle => HasMeeting && HasTranscript && !IsSuggestingTitle;

    public bool CanRename => HasMeeting && !IsSuggestingTitle;

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
                HasTranscript = false;
                return;
            }

            var record = await _meetings.GetByIdAsync(id);
            Title = record?.Title ?? string.Empty;
            HasMeeting = record is not null;
            HasTranscript = record is not null && !string.IsNullOrWhiteSpace(record.Transcript);
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

    /// <summary>
    /// Title-only inference. Always applies a usable title (unlike auto-suggest on summary).
    /// Returns <c>(true, null)</c> on success, <c>(false, null)</c> on silent abort,
    /// and <c>(false, error)</c> on failure.
    /// </summary>
    public async Task<(bool Applied, string? Error)> SuggestTitleAsync()
    {
        if (IsSuggestingTitle || _meetingId is not { } id)
            return (false, null);

        var record = await _meetings.GetByIdAsync(id);
        if (record is null || string.IsNullOrWhiteSpace(record.Transcript))
            return (false, null);

        IsSuggestingTitle = true;
        try
        {
            var settings = await AppServices.Settings.LoadAsync();
            var providerKind = settings.ResolveSummaryProviderKind();
            var provider = await ResolveSummaryProviderAsync(providerKind);
            if (provider is null)
                return (false, null);

            var summaryLanguage = settings.ResolveSummaryLanguage();
            string raw;
            try
            {
                raw = await Task.Run(() => provider.SuggestTitleAsync(
                    record.Transcript, record.RecordedAt, outputLanguage: summaryLanguage));
            }
            catch (Exception ex)
            {
                return (false, CliFailureUserMessage.Format(ex));
            }

            var next = SuggestedMeetingTitle.FromModelResponse(raw);
            if (next is null)
                return (false, AppStrings.Get("SessionSuggestTitle_Empty"));

            var titleChanged = !string.Equals(record.Title, next, StringComparison.Ordinal);
            if (!await RenameAsync(next))
                return (false, AppStrings.Get("SessionSuggestTitle_Empty"));

            if (titleChanged)
            {
                App.DispatcherQueue.TryEnqueue(() => Title = next);
                AppServices.Workspace.NotifyMeetingChanged(id);
            }

            return (true, null);
        }
        finally
        {
            if (!App.DispatcherQueue.TryEnqueue(() => IsSuggestingTitle = false))
                IsSuggestingTitle = false;
        }
    }

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

    private void OnMeetingChanged(object? sender, Guid id)
    {
        if (_meetingId != id)
            return;

        _ = RefreshTitleAsync(id);
    }

    private async Task RefreshTitleAsync(Guid id)
    {
        var record = await _meetings.GetByIdAsync(id);
        if (_meetingId != id)
            return;

        App.DispatcherQueue.TryEnqueue(() =>
        {
            if (_meetingId != id)
                return;

            Title = record?.Title ?? string.Empty;
            HasMeeting = record is not null;
            HasTranscript = record is not null && !string.IsNullOrWhiteSpace(record.Transcript);
        });
    }

    partial void OnIsLoadingChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));

    partial void OnHasMeetingChanged(bool value)
    {
        OnPropertyChanged(nameof(IsEmpty));
        OnPropertyChanged(nameof(CanSuggestTitle));
        OnPropertyChanged(nameof(CanRename));
    }

    partial void OnHasTranscriptChanged(bool value) => OnPropertyChanged(nameof(CanSuggestTitle));

    partial void OnIsSuggestingTitleChanged(bool value)
    {
        OnPropertyChanged(nameof(CanSuggestTitle));
        OnPropertyChanged(nameof(CanRename));
    }
}
