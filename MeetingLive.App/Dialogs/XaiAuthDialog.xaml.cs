using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.Dialogs;

/// <summary>
/// Blocking SuperGrok device-code login or pasted API key. Used from Settings,
/// <see cref="XaiProviderResolver"/>, and the first-run summary wizard.
/// </summary>
public sealed partial class XaiAuthDialog : ContentDialog
{
    private CancellationTokenSource? _pollCts;
    private bool _succeeded;

    public XaiAuthDialog()
    {
        InitializeComponent();
        Closed += OnClosed;
    }

    /// <summary>Shows the dialog. Returns true when SuperGrok or an API key was saved.</summary>
    public static async Task<bool> ShowAsync(XamlRoot xamlRoot)
    {
        var dialog = new XaiAuthDialog { XamlRoot = xamlRoot };
        await dialog.ShowAsync();
        return dialog._succeeded;
    }

    private async void SuperGrok_Click(object sender, RoutedEventArgs e)
    {
        _pollCts?.Cancel();
        _pollCts = new CancellationTokenSource();
        var cancellationToken = _pollCts.Token;
        ErrorInfoBar.IsOpen = false;
        SetBusy(true);

        try
        {
            var device = await AppServices.XaiOAuth.RequestDeviceCodeAsync(cancellationToken);
            UserCodeText.Text = device.UserCode;
            DeviceCodePanel.Visibility = Visibility.Visible;
            await Windows.System.Launcher.LaunchUriAsync(device.VerificationUri);

            var credentials = await AppServices.XaiOAuth.PollDeviceCodeTokenAsync(device, cancellationToken);
            AppServices.XaiAuth.SaveOAuth(credentials);
            _succeeded = true;
            Hide();
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

    private void SaveApiKey_Click(object sender, RoutedEventArgs e)
    {
        var apiKey = ApiKeyBox.Password?.Trim();
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            ShowError(AppStrings.Get("XaiAuth_ApiKeyRequired"));
            return;
        }

        try
        {
            AppServices.XaiAuth.SaveApiKey(apiKey);
            ApiKeyBox.Password = string.Empty;
            _succeeded = true;
            Hide();
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
        }
    }

    private void SetBusy(bool busy)
    {
        SuperGrokButton.IsEnabled = !busy;
        SaveApiKeyButton.IsEnabled = !busy;
        ApiKeyBox.IsEnabled = !busy;
        if (!busy)
            DeviceCodePanel.Visibility = Visibility.Collapsed;
    }

    private void ShowError(string message)
    {
        ErrorInfoBar.Message = message;
        ErrorInfoBar.IsOpen = true;
    }

    private void OnClosed(ContentDialog sender, ContentDialogClosedEventArgs args)
    {
        _pollCts?.Cancel();
        _pollCts?.Dispose();
        _pollCts = null;
    }
}
