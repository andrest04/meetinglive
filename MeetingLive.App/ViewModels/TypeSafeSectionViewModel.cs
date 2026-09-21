using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using Microsoft.UI.Dispatching;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Settings section for TypeSafe / Jev. Not a <see cref="SummaryProviderKind"/> —
/// the API key is stored with DPAPI, never in settings.json.
/// </summary>
public sealed partial class TypeSafeSectionViewModel : SettingsSectionViewModelBase
{
    [ObservableProperty]
    private bool _isEnabled = true;

    [ObservableProperty]
    private string _statusText = string.Empty;

    [ObservableProperty]
    private string _statusDetail = string.Empty;

    [ObservableProperty]
    private string _apiKeyDraft = string.Empty;

    [ObservableProperty]
    private bool _hasApiKey;

    [ObservableProperty]
    private bool _isBusy;

    [ObservableProperty]
    private bool _isFeedbackOpen;

    [ObservableProperty]
    private string _feedbackMessage = string.Empty;

    private DispatcherQueueTimer? _feedbackTimer;

    public bool CanSaveApiKey => !string.IsNullOrWhiteSpace(ApiKeyDraft) && !IsBusy;

    public bool CanClearApiKey => HasApiKey && !IsBusy;

    public Task LoadAsync(AppSettings settings)
    {
        IsEnabled = settings.TypeSafeEnabled;
        RefreshStatusFromStore();
        return Task.CompletedTask;
    }

    [RelayCommand]
    private async Task ToggleEnabledAsync(bool isEnabled)
    {
        if (isEnabled == IsEnabled)
            return;

        IsEnabled = isEnabled;
        await SaveSettingsAsync(settings => settings.TypeSafeEnabled = isEnabled);
    }

    [RelayCommand]
    private async Task SaveApiKeyAsync()
    {
        if (!CanSaveApiKey)
            return;

        var apiKey = ApiKeyDraft.Trim();
        AppServices.TypeSafeCredentials.Save(new TypeSafeCredentials(apiKey));
        ApiKeyDraft = string.Empty;
        HasApiKey = true;

        IsBusy = true;
        try
        {
            await AppServices.TypeSafeApi.ListModelsAsync(apiKey);
            StatusText = AppStrings.Get("TypeSafe_StatusReady");
            StatusDetail = string.Empty;
            ShowFeedback(AppStrings.Get("TypeSafe_FeedbackApiKey"));
        }
        catch (TypeSafeException ex)
        {
            StatusText = AppStrings.Get("TypeSafe_StatusErrorTitle");
            StatusDetail = ex.Message;
        }
        catch (Exception ex)
        {
            StatusText = AppStrings.Get("TypeSafe_StatusErrorTitle");
            StatusDetail = ex.Message;
        }
        finally
        {
            IsBusy = false;
        }
    }

    [RelayCommand]
    private void ClearApiKey()
    {
        AppServices.TypeSafeCredentials.Clear();
        ApiKeyDraft = string.Empty;
        RefreshStatusFromStore();
        ShowFeedback(AppStrings.Get("TypeSafe_FeedbackCleared"));
    }

    public void ShowFeedback(string message)
    {
        FeedbackMessage = message;
        IsFeedbackOpen = true;
        _feedbackTimer ??= CreateFeedbackTimer();
        _feedbackTimer.Stop();
        _feedbackTimer.Start();
    }

    private void RefreshStatusFromStore()
    {
        var credentials = AppServices.TypeSafeCredentials.Load();
        HasApiKey = credentials is not null && !string.IsNullOrWhiteSpace(credentials.ApiKey);
        if (HasApiKey)
        {
            StatusText = AppStrings.Get("TypeSafe_StatusApiKeySaved");
            StatusDetail = string.Empty;
            return;
        }

        StatusText = AppStrings.Get("TypeSafe_StatusNotConfigured");
        StatusDetail = string.Empty;
    }

    private DispatcherQueueTimer CreateFeedbackTimer()
    {
        var timer = App.DispatcherQueue.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(4);
        timer.IsRepeating = false;
        timer.Tick += (_, _) => IsFeedbackOpen = false;
        return timer;
    }

    partial void OnApiKeyDraftChanged(string value) =>
        OnPropertyChanged(nameof(CanSaveApiKey));

    partial void OnHasApiKeyChanged(bool value) =>
        OnPropertyChanged(nameof(CanClearApiKey));

    partial void OnIsBusyChanged(bool value)
    {
        OnPropertyChanged(nameof(CanSaveApiKey));
        OnPropertyChanged(nameof(CanClearApiKey));
    }
}
