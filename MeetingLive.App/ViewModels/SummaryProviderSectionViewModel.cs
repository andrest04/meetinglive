using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.UI.Dispatching;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Settings section: the summary provider choice (Local / Claude Code / Codex / xAI) and,
/// for each provider, its model + reasoning-effort selection — including the xAI account
/// sign-in/sign-out flow, since xAI is the only provider with its own credentials.
/// </summary>
public sealed partial class SummaryProviderSectionViewModel : SettingsSectionViewModelBase
{
    [ObservableProperty]
    private SummaryProviderKind _selectedProviderKind = SummaryProviderKind.Local;

    [ObservableProperty]
    private string _cliProviderStatusText = string.Empty;

    [ObservableProperty]
    private string _xaiStatusText = string.Empty;

    [ObservableProperty]
    private string? _selectedXaiModelId;

    [ObservableProperty]
    private bool _isXaiSignedIn;

    [ObservableProperty]
    private bool _isXaiBusy;

    [ObservableProperty]
    private string _xaiStatusDetail = string.Empty;

    [ObservableProperty]
    private bool _isXaiFeedbackOpen;

    [ObservableProperty]
    private string _xaiFeedbackMessage = string.Empty;

    [ObservableProperty]
    private string _xaiApiKeyDraft = string.Empty;

    public bool CanSaveXaiApiKey => !string.IsNullOrWhiteSpace(XaiApiKeyDraft);

    [ObservableProperty]
    private string _selectedClaudeModelId = InferenceCatalog.DefaultClaudeModel;

    [ObservableProperty]
    private string _selectedClaudeEffort = InferenceCatalog.DefaultEffort;

    [ObservableProperty]
    private string _selectedCodexModelId = InferenceCatalog.DefaultCodexModel;

    [ObservableProperty]
    private string _selectedCodexEffort = InferenceCatalog.DefaultEffort;

    [ObservableProperty]
    private string _selectedXaiEffort = InferenceCatalog.DefaultEffort;

    private bool _isLoading;

    private bool _suppressXaiModelCommit;

    private bool _suppressCliInferenceCommit;

    private DispatcherQueueTimer? _xaiFeedbackTimer;

    public ObservableCollection<string> XaiModels { get; } = [];

    public IReadOnlyList<string> ClaudeModels { get; } = InferenceCatalog.ClaudeModels;

    public IReadOnlyList<string> ClaudeEfforts { get; } = InferenceCatalog.ClaudeEfforts;

    public IReadOnlyList<string> CodexModels { get; } = InferenceCatalog.CodexModels;

    public IReadOnlyList<string> CodexEfforts { get; } = InferenceCatalog.CodexEfforts;

    public IReadOnlyList<string> XaiEfforts { get; } = InferenceCatalog.XaiEfforts;

    public bool IsLocalSelected => SelectedProviderKind == SummaryProviderKind.Local;
    public bool IsClaudeCodeSelected => SelectedProviderKind == SummaryProviderKind.ClaudeCode;
    public bool IsCodexSelected => SelectedProviderKind == SummaryProviderKind.Codex;
    public bool IsXaiSelected => SelectedProviderKind == SummaryProviderKind.Xai;

    /// <summary>Only CLI-backed providers have a PATH-detection status to show.</summary>
    public bool ShowCliProviderStatus =>
        SelectedProviderKind is SummaryProviderKind.ClaudeCode or SummaryProviderKind.Codex;

    /// <summary>Mirrors the settings page's overall loading state so a ComboBox
    /// SelectionChanged fired while the page is still loading is ignored.</summary>
    public void SetLoading(bool value) => _isLoading = value;

    /// <summary>Applies everything that is known without network access: the provider kind, each
    /// provider's saved model/effort and, for xAI, the credential state read from the local store
    /// (so Grok never flashes as "not connected") plus a model list seeded with the saved model
    /// (so the selection is stable while the real list loads). Call <see cref="LoadXaiAccountAsync"/>
    /// afterwards for the network part.</summary>
    public void ApplyLoadedSettings(AppSettings settings)
    {
        SelectedProviderKind = settings.ResolveSummaryProviderKind();
        _suppressXaiModelCommit = true;
        if (SelectedProviderKind == SummaryProviderKind.Xai)
        {
            ApplyXaiCredentialStatus();
            // The list must contain the saved model before it becomes SelectedItem, otherwise the
            // ComboBox drops the selection.
            if (IsXaiSignedIn && XaiModels.Count == 0 && !string.IsNullOrWhiteSpace(settings.SelectedXaiModelId))
                XaiModels.Add(settings.SelectedXaiModelId);
        }
        SelectedXaiModelId = settings.SelectedXaiModelId;
        SelectedXaiEffort = settings.ResolveXaiEffort();
        _suppressXaiModelCommit = false;
        _suppressCliInferenceCommit = true;
        SelectedClaudeModelId = settings.ResolveClaudeModelId();
        SelectedClaudeEffort = settings.ResolveClaudeEffort();
        SelectedCodexModelId = settings.ResolveCodexModelId();
        SelectedCodexEffort = settings.ResolveCodexEffort();
        _suppressCliInferenceCommit = false;
    }

    /// <summary>Network part of the load (token refresh + model list). No-op unless xAI is the
    /// selected provider; never throws.</summary>
    public Task LoadXaiAccountAsync() =>
        SelectedProviderKind == SummaryProviderKind.Xai ? RefreshXaiAccountAsync() : Task.CompletedTask;

    /// <summary>True once the live model list has been fetched at least once for the current
    /// credentials, so a later refresh keeps the "ready" detail instead of flashing "loading".</summary>
    private bool _xaiModelsLoaded;

    private void ApplyXaiCredentialStatus()
    {
        var kind = AppServices.XaiAuth.CredentialKind;
        IsXaiSignedIn = kind is not null;
        XaiStatusText = kind switch
        {
            XaiCredentialKind.OAuth => AppStrings.Get("Xai_StatusSuperGrok"),
            XaiCredentialKind.ApiKey => AppStrings.Get("Xai_StatusApiKey"),
            _ => AppStrings.Get("Xai_StatusSignedOut"),
        };

        if (!IsXaiSignedIn)
        {
            _xaiModelsLoaded = false;
            XaiStatusDetail = AppStrings.Get("Xai_StatusSignedOutDetail");
        }
        else if (!_xaiModelsLoaded || string.IsNullOrEmpty(XaiStatusDetail))
        {
            XaiStatusDetail = AppStrings.Get("Xai_StatusLoadingModels");
        }
    }

    [RelayCommand]
    private async Task SelectProviderAsync(SummaryProviderKind kind)
    {
        if (kind == SelectedProviderKind)
            return;

        SelectedProviderKind = kind;
        await SaveSettingsAsync(settings => settings.SelectedSummaryProvider = kind.ToString());
        if (kind == SummaryProviderKind.Xai)
            await RefreshXaiAccountAsync();
    }

    [RelayCommand]
    private async Task SelectClaudeModelAsync(string? modelId)
    {
        if (_isLoading || _suppressCliInferenceCommit || string.IsNullOrWhiteSpace(modelId))
            return;
        if (modelId == SelectedClaudeModelId)
            return;

        SelectedClaudeModelId = modelId;
        await SaveSettingsAsync(settings => settings.SelectedClaudeModelId = modelId);
        ShowXaiFeedback(AppStrings.Format("Xai_FeedbackModel", $"{SelectedClaudeModelId} · {SelectedClaudeEffort}"));
    }

    [RelayCommand]
    private async Task SelectClaudeEffortAsync(string? effort)
    {
        if (_isLoading || _suppressCliInferenceCommit || string.IsNullOrWhiteSpace(effort))
            return;
        if (effort == SelectedClaudeEffort)
            return;

        SelectedClaudeEffort = effort;
        await SaveSettingsAsync(settings => settings.SelectedClaudeEffort = effort);
        ShowXaiFeedback(AppStrings.Format("Xai_FeedbackModel", $"{SelectedClaudeModelId} · {SelectedClaudeEffort}"));
    }

    [RelayCommand]
    private async Task SelectCodexModelAsync(string? modelId)
    {
        if (_isLoading || _suppressCliInferenceCommit || string.IsNullOrWhiteSpace(modelId))
            return;
        if (modelId == SelectedCodexModelId)
            return;

        SelectedCodexModelId = modelId;
        await SaveSettingsAsync(settings => settings.SelectedCodexModelId = modelId);
        ShowXaiFeedback(AppStrings.Format("Xai_FeedbackModel", $"{SelectedCodexModelId} · {SelectedCodexEffort}"));
    }

    [RelayCommand]
    private async Task SelectCodexEffortAsync(string? effort)
    {
        if (_isLoading || _suppressCliInferenceCommit || string.IsNullOrWhiteSpace(effort))
            return;
        if (effort == SelectedCodexEffort)
            return;

        SelectedCodexEffort = effort;
        await SaveSettingsAsync(settings => settings.SelectedCodexEffort = effort);
        ShowXaiFeedback(AppStrings.Format("Xai_FeedbackModel", $"{SelectedCodexModelId} · {SelectedCodexEffort}"));
    }

    [RelayCommand]
    private async Task SelectXaiEffortAsync(string? effort)
    {
        if (_isLoading || _suppressXaiModelCommit || string.IsNullOrWhiteSpace(effort))
            return;
        if (effort == SelectedXaiEffort)
            return;

        SelectedXaiEffort = effort;
        await SaveSettingsAsync(settings => settings.SelectedXaiEffort = effort);
        UpdateXaiReadyDetail();
        ShowXaiFeedback(AppStrings.Format("Xai_FeedbackModel", $"{SelectedXaiModelId} · {SelectedXaiEffort}"));
    }

    [RelayCommand]
    private async Task SaveXaiApiKeyAsync()
    {
        if (!CanSaveXaiApiKey)
            return;

        AppServices.XaiAuth.SaveApiKey(XaiApiKeyDraft);
        XaiApiKeyDraft = string.Empty;
        await RefreshXaiAccountAsync();
        ShowXaiFeedback(AppStrings.Get("Xai_FeedbackApiKey"));
    }

    [RelayCommand]
    private async Task SignOutXaiAsync()
    {
        AppServices.XaiAuth.SignOut();
        await RefreshXaiAccountAsync();
        ShowXaiFeedback(AppStrings.Get("Xai_FeedbackSignedOut"));
    }

    [RelayCommand]
    private async Task SelectXaiModelAsync(string? modelId)
    {
        if (_isLoading || _suppressXaiModelCommit || string.IsNullOrWhiteSpace(modelId))
            return;

        if (modelId == SelectedXaiModelId)
            return;

        SelectedXaiModelId = modelId;
        await SaveSettingsAsync(settings => settings.SelectedXaiModelId = modelId);
        UpdateXaiReadyDetail();
        ShowXaiFeedback(AppStrings.Format("Xai_FeedbackModel", $"{SelectedXaiModelId} · {SelectedXaiEffort}"));
    }

    [RelayCommand]
    private async Task RefreshXaiAccountAsync()
    {
        ApplyXaiCredentialStatus();

        if (!IsXaiSignedIn)
        {
            _suppressXaiModelCommit = true;
            XaiModels.Clear();
            _suppressXaiModelCommit = false;
            return;
        }

        IsXaiBusy = true;
        try
        {
            var token = await AppServices.XaiAuth.GetAccessTokenAsync();
            var models = await AppServices.XaiApi.ListModelsAsync(token);
            var settings = await AppServices.Settings.LoadAsync();
            var resolved = XaiApiClient.ResolveModelId(settings.SelectedXaiModelId, models);

            _suppressXaiModelCommit = true;
            MergeXaiModels(models, resolved);
            if (!string.Equals(SelectedXaiModelId, resolved, StringComparison.Ordinal))
                SelectedXaiModelId = resolved;
            _suppressXaiModelCommit = false;

            if (!string.Equals(settings.SelectedXaiModelId, resolved, StringComparison.Ordinal))
                await SaveSettingsAsync(s => s.SelectedXaiModelId = resolved);

            _xaiModelsLoaded = true;
            UpdateXaiReadyDetail();
        }
        catch (Exception ex)
        {
            _xaiModelsLoaded = false;
            XaiStatusText = AppStrings.Get("Xai_StatusErrorTitle");
            XaiStatusDetail = ex.Message;
        }
        finally
        {
            IsXaiBusy = false;
            _suppressXaiModelCommit = false;
        }
    }

    /// <summary>Makes <see cref="XaiModels"/> match the fetched list in place. The saved/selected
    /// model is never removed while it is still wanted, so the ComboBox keeps its selection
    /// instead of blanking and re-selecting.</summary>
    private void MergeXaiModels(IReadOnlyList<string> models, string resolved)
    {
        var target = new List<string>(models);
        if (!target.Contains(resolved))
            target.Add(resolved);

        for (var i = XaiModels.Count - 1; i >= 0; i--)
        {
            if (!target.Contains(XaiModels[i]))
                XaiModels.RemoveAt(i);
        }

        for (var i = 0; i < target.Count; i++)
        {
            if (i < XaiModels.Count && XaiModels[i] == target[i])
                continue;
            if (!XaiModels.Contains(target[i]))
                XaiModels.Insert(Math.Min(i, XaiModels.Count), target[i]);
        }
    }

    partial void OnXaiApiKeyDraftChanged(string value) =>
        OnPropertyChanged(nameof(CanSaveXaiApiKey));

    private void UpdateXaiReadyDetail()
    {
        if (!IsXaiSignedIn || string.IsNullOrWhiteSpace(SelectedXaiModelId))
            return;

        XaiStatusDetail = AppStrings.Format(
            "Xai_StatusReady",
            $"{SelectedXaiModelId} · {SelectedXaiEffort}");
    }

    public void ShowXaiFeedback(string message)
    {
        XaiFeedbackMessage = message;
        IsXaiFeedbackOpen = true;
        _xaiFeedbackTimer ??= CreateXaiFeedbackTimer();
        _xaiFeedbackTimer.Stop();
        _xaiFeedbackTimer.Start();
    }

    private DispatcherQueueTimer CreateXaiFeedbackTimer()
    {
        var timer = App.DispatcherQueue.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(4);
        timer.IsRepeating = false;
        timer.Tick += (_, _) => IsXaiFeedbackOpen = false;
        return timer;
    }

    partial void OnSelectedProviderKindChanged(SummaryProviderKind value)
    {
        OnPropertyChanged(nameof(IsLocalSelected));
        OnPropertyChanged(nameof(IsClaudeCodeSelected));
        OnPropertyChanged(nameof(IsCodexSelected));
        OnPropertyChanged(nameof(IsXaiSelected));
        OnPropertyChanged(nameof(ShowCliProviderStatus));

        CliProviderStatusText = value is SummaryProviderKind.ClaudeCode or SummaryProviderKind.Codex
            ? CliProviderResolver.IsOnPath(value)
                ? AppStrings.Get("Status_CliOnPath")
                : AppStrings.Get("Status_CliMissing")
            : string.Empty;
    }
}
