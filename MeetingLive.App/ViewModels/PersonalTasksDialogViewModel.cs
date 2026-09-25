using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using Microsoft.UI.Xaml.Controls;
using Windows.ApplicationModel.DataTransfer;

namespace MeetingLive_App.ViewModels;

public sealed class AskHitViewModel
{
    public required string LineId { get; init; }

    public required int Index { get; init; }

    public required string Text { get; init; }

    public required double Score { get; init; }

    public string ScorePercent => Score.ToString("P0", CultureInfo.CurrentCulture);
}

/// <summary>
/// Jev picks request/commitment lines; the selected summary provider writes a personal checklist.
/// Backs <see cref="Dialogs.PersonalTasksDialog"/>, opened from the meeting chat's recipe list.
/// </summary>
public partial class PersonalTasksDialogViewModel : ObservableObject
{
    private readonly IMeetingRepository _meetings = AppServices.Meetings;
    private string _transcript = string.Empty;
    private bool _typeSafeEnabled;
    private bool _hasApiKey;

    [ObservableProperty]
    private string _topic = string.Empty;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private bool _isAsking;

    [ObservableProperty]
    private bool _hasTranscript;

    [ObservableProperty]
    private string _statusText = string.Empty;

    [ObservableProperty]
    private bool _isVerdictOpen;

    [ObservableProperty]
    private string _verdictMessage = string.Empty;

    [ObservableProperty]
    private InfoBarSeverity _verdictSeverity = InfoBarSeverity.Informational;

    [ObservableProperty]
    private bool _hasHits;

    [ObservableProperty]
    private string _checklistMarkdown = string.Empty;

    [ObservableProperty]
    private bool _hasChecklist;

    public ObservableCollection<AskHitViewModel> Hits { get; } = [];

    public Func<Task<string?>>? EnsureSummaryModelAsync { get; set; }

    public Func<SummaryProviderKind, Task<bool>>? EnsureCliProviderAsync { get; set; }

    public Func<Task<bool>>? EnsureXaiProviderAsync { get; set; }

    public bool CanAsk =>
        HasTranscript &&
        !IsAsking &&
        _typeSafeEnabled &&
        _hasApiKey;

    public async Task LoadAsync(Guid? meetingId)
    {
        IsLoading = true;
        try
        {
            ClearResults();

            var record = meetingId is { } id
                ? await _meetings.GetByIdAsync(id)
                : (await _meetings.GetAllAsync()).OrderByDescending(m => m.RecordedAt).FirstOrDefault();

            if (record is not null)
                AppServices.Workspace.SelectMeeting(record.Id);

            _transcript = record?.Transcript ?? string.Empty;
            HasTranscript = !string.IsNullOrWhiteSpace(_transcript);
            await RefreshTypeSafeGateAsync();
            ApplyEmptyStatus();
        }
        finally
        {
            IsLoading = false;
            NotifyAskCanExecute();
        }
    }

    private bool CanExecuteAsk() => CanAsk;

    [RelayCommand(CanExecute = nameof(CanExecuteAsk))]
    private async Task AskAsync()
    {
        if (!CanAsk)
            return;

        var topic = string.IsNullOrWhiteSpace(Topic) ? null : Topic.Trim();
        var transcript = _transcript;
        await RefreshTypeSafeGateAsync();
        if (!HasTranscript || !_hasApiKey || !_typeSafeEnabled)
        {
            ApplyEmptyStatus();
            NotifyAskCanExecute();
            return;
        }

        var credentials = AppServices.TypeSafeCredentials.Load();
        var apiKey = credentials?.ApiKey;
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            StatusText = AppStrings.Get("PersonalTasks_NoApiKey");
            NotifyAskCanExecute();
            return;
        }

        IsAsking = true;
        StatusText = AppStrings.Get("PersonalTasks_StatusFinding");
        ClearResults();
        NotifyAskCanExecute();
        try
        {
            var result = await MeetingJevPersonalTasks.FindAsync(
                AppServices.TypeSafeApi,
                apiKey,
                transcript,
                topic);

            if (result.Verdict == MeetingJevAskVerdict.Absent)
            {
                ShowAbsent(topic);
                return;
            }

            ShowEvidence(result.Evidence);
            if (result.Evidence.Count == 0)
            {
                ShowAbsent(topic);
                return;
            }

            StatusText = AppStrings.Get("PersonalTasks_StatusWriting");
            var settings = await AppServices.Settings.LoadAsync();
            var provider = await ResolveSummaryProviderAsync(settings.ResolveSummaryProviderKind());
            if (provider is null)
            {
                StatusText = AppStrings.Get("Status_SetupCancelled");
                return;
            }

            var prompt = PersonalTasksPromptBuilder.Build(
                result.Evidence.Select(item => item.Line).ToArray(),
                topic,
                settings.ResolveSummaryLanguage());
            var markdown = await Task.Run(() => provider.CompletePromptAsync(prompt));
            ApplyChecklist(markdown, topic);
        }
        catch (TypeSafeException ex)
        {
            StatusText = ex.Message;
            IsVerdictOpen = false;
        }
        catch (Exception ex)
        {
            StatusText = CliFailureUserMessage.Format(ex);
            IsVerdictOpen = false;
        }
        finally
        {
            IsAsking = false;
            NotifyAskCanExecute();
        }
    }

    public void CopyHit(AskHitViewModel hit)
    {
        ArgumentNullException.ThrowIfNull(hit);
        if (string.IsNullOrWhiteSpace(hit.Text))
            return;

        var package = new DataPackage();
        package.SetText(hit.Text);
        Clipboard.SetContent(package);
        StatusText = AppStrings.Get("PersonalTasks_Copied");
    }

    private async Task<ISummaryProvider?> ResolveSummaryProviderAsync(SummaryProviderKind providerKind) =>
        (await SummaryProviderResolver.ResolveAsync(
            providerKind, EnsureSummaryModelAsync, EnsureCliProviderAsync, EnsureXaiProviderAsync))?.Provider;

    private void ShowEvidence(IReadOnlyList<MeetingJevPersonalTaskEvidence> evidence)
    {
        Hits.Clear();
        foreach (var item in evidence)
        {
            Hits.Add(new AskHitViewModel
            {
                LineId = item.Line.Id,
                Index = item.Line.Index,
                Text = item.Line.Text,
                Score = item.Score,
            });
        }

        HasHits = Hits.Count > 0;
    }

    private void ApplyChecklist(string markdown, string? topic)
    {
        var trimmed = markdown.Trim();
        if (string.Equals(trimmed, "NONE", StringComparison.OrdinalIgnoreCase))
        {
            ShowAbsent(topic);
            return;
        }

        ChecklistMarkdown = trimmed;
        HasChecklist = trimmed.Length > 0;
        StatusText = string.Empty;
        IsVerdictOpen = false;
    }

    private void ShowAbsent(string? topic)
    {
        HasChecklist = false;
        ChecklistMarkdown = string.Empty;
        Hits.Clear();
        HasHits = false;
        VerdictMessage = topic is null
            ? AppStrings.Get("PersonalTasks_NothingAsked")
            : AppStrings.Format("PersonalTasks_TopicAbsent", topic);
        VerdictSeverity = InfoBarSeverity.Informational;
        IsVerdictOpen = true;
        StatusText = string.Empty;
    }

    private void ClearResults()
    {
        Hits.Clear();
        HasHits = false;
        HasChecklist = false;
        ChecklistMarkdown = string.Empty;
        IsVerdictOpen = false;
        VerdictMessage = string.Empty;
    }

    private async Task RefreshTypeSafeGateAsync()
    {
        var settings = await AppServices.Settings.LoadAsync();
        _typeSafeEnabled = settings.TypeSafeEnabled;
        var credentials = AppServices.TypeSafeCredentials.Load();
        _hasApiKey = credentials is not null && !string.IsNullOrWhiteSpace(credentials.ApiKey);
    }

    private void ApplyEmptyStatus()
    {
        if (!HasTranscript)
            StatusText = AppStrings.Get("PersonalTasks_EmptyTranscript");
        else if (!_hasApiKey || !_typeSafeEnabled)
            StatusText = AppStrings.Get("PersonalTasks_NoApiKey");
        else
            StatusText = string.Empty;
    }

    private void NotifyAskCanExecute()
    {
        OnPropertyChanged(nameof(CanAsk));
        AskCommand.NotifyCanExecuteChanged();
    }

    partial void OnIsAskingChanged(bool value) => NotifyAskCanExecute();

    partial void OnHasTranscriptChanged(bool value) => NotifyAskCanExecute();
}
