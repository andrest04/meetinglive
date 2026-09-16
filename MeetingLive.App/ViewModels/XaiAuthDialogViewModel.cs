using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Drives the blocking SuperGrok device-code login (poll + launch browser) or pasted API key
/// flow shown by <c>XaiAuthDialog</c>. Owns the xAI OAuth device-code round trip and API-key
/// validation so the dialog's code-behind stays limited to framework glue.
/// </summary>
public partial class XaiAuthDialogViewModel : ObservableObject
{
    private CancellationTokenSource? _pollCts;

    [ObservableProperty]
    private string _userCode = string.Empty;

    [ObservableProperty]
    private bool _isDeviceCodePanelVisible;

    [ObservableProperty]
    private bool _isBusy;

    [ObservableProperty]
    private string _errorMessage = string.Empty;

    [ObservableProperty]
    private bool _isErrorVisible;

    [ObservableProperty]
    private string _apiKeyDraft = string.Empty;

    /// <summary>True once SuperGrok or an API key was saved successfully.</summary>
    public bool Succeeded { get; private set; }

    /// <summary>Raised once auth succeeds and the host dialog should close.</summary>
    public event EventHandler? Completed;

    [RelayCommand]
    private async Task SignInWithSuperGrokAsync()
    {
        _pollCts?.Cancel();
        _pollCts = new CancellationTokenSource();
        var cancellationToken = _pollCts.Token;
        IsErrorVisible = false;
        SetBusy(true);

        try
        {
            var device = await AppServices.XaiOAuth.RequestDeviceCodeAsync(cancellationToken);
            UserCode = device.UserCode;
            IsDeviceCodePanelVisible = true;
            await Windows.System.Launcher.LaunchUriAsync(device.VerificationUri);

            var credentials = await AppServices.XaiOAuth.PollDeviceCodeTokenAsync(device, cancellationToken);
            AppServices.XaiAuth.SaveOAuth(credentials);
            Succeeded = true;
            Completed?.Invoke(this, EventArgs.Empty);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
        }
        finally
        {
            SetBusy(false);
        }
    }

    [RelayCommand]
    private void SaveApiKey()
    {
        var apiKey = ApiKeyDraft?.Trim();
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            ShowError(AppStrings.Get("XaiAuth_ApiKeyRequired"));
            return;
        }

        try
        {
            AppServices.XaiAuth.SaveApiKey(apiKey);
            ApiKeyDraft = string.Empty;
            Succeeded = true;
            Completed?.Invoke(this, EventArgs.Empty);
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
        }
    }

    private void SetBusy(bool busy)
    {
        IsBusy = busy;
        if (!busy)
            IsDeviceCodePanelVisible = false;
    }

    private void ShowError(string message)
    {
        ErrorMessage = message;
        IsErrorVisible = true;
    }

    /// <summary>Cancels any in-flight device-code polling. Called when the host dialog closes.</summary>
    public void CancelPolling()
    {
        _pollCts?.Cancel();
        _pollCts?.Dispose();
        _pollCts = null;
    }
}
