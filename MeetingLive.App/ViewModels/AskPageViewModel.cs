using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
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

/// <summary>Asks Jev to point at transcript lines. Does not generate an answer paragraph.</summary>
public partial class AskPageViewModel : ObservableObject
{
    private readonly IMeetingRepository _meetings = AppServices.Meetings;
    private string _transcript = string.Empty;
    private bool _typeSafeEnabled;
    private bool _hasApiKey;

    [ObservableProperty]
    private string _query = string.Empty;

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

    public ObservableCollection<AskHitViewModel> Hits { get; } = [];

    public bool CanAsk =>
        HasTranscript &&
        !string.IsNullOrWhiteSpace(Query) &&
        !IsAsking &&
        _typeSafeEnabled &&
        _hasApiKey;

    public async Task LoadAsync(Guid? meetingId)
    {
        IsLoading = true;
        try
        {
            Hits.Clear();
            HasHits = false;
            IsVerdictOpen = false;
            VerdictMessage = string.Empty;

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

        var query = Query.Trim();
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
            StatusText = AppStrings.Get("AskPage_NoApiKey");
            NotifyAskCanExecute();
            return;
        }

        IsAsking = true;
        StatusText = string.Empty;
        Hits.Clear();
        HasHits = false;
        IsVerdictOpen = false;
        NotifyAskCanExecute();
        try
        {
            var result = await MeetingJevAsk.AskAsync(
                AppServices.TypeSafeApi,
                apiKey,
                transcript,
                query);

            ApplyResult(result);
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
        StatusText = AppStrings.Get("AskPage_Copied");
    }

    private void ApplyResult(MeetingJevAskResult result)
    {
        Hits.Clear();
        foreach (var hit in result.Hits)
        {
            Hits.Add(new AskHitViewModel
            {
                LineId = hit.LineId,
                Index = hit.Index,
                Text = hit.Text,
                Score = hit.Score,
            });
        }

        HasHits = Hits.Count > 0;
        VerdictMessage = result.Verdict switch
        {
            MeetingJevAskVerdict.Answered => AppStrings.Get("AskPage_VerdictAnswered"),
            MeetingJevAskVerdict.Partial => AppStrings.Get("AskPage_VerdictPartial"),
            _ => AppStrings.Get("AskPage_VerdictAbsent"),
        };
        VerdictSeverity = result.Verdict switch
        {
            MeetingJevAskVerdict.Answered => InfoBarSeverity.Informational,
            MeetingJevAskVerdict.Partial => InfoBarSeverity.Warning,
            _ => InfoBarSeverity.Error,
        };
        IsVerdictOpen = true;
        StatusText = Hits.Count == 0 ? AppStrings.Get("AskPage_NoHits") : string.Empty;
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
            StatusText = AppStrings.Get("AskPage_EmptyTranscript");
        else if (!_hasApiKey || !_typeSafeEnabled)
            StatusText = AppStrings.Get("AskPage_NoApiKey");
        else
            StatusText = string.Empty;
    }

    private void NotifyAskCanExecute()
    {
        OnPropertyChanged(nameof(CanAsk));
        AskCommand.NotifyCanExecuteChanged();
    }

    partial void OnQueryChanged(string value) => NotifyAskCanExecute();

    partial void OnIsAskingChanged(bool value) => NotifyAskCanExecute();

    partial void OnHasTranscriptChanged(bool value) => NotifyAskCanExecute();
}
