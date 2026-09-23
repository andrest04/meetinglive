using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App;

/// <summary>
/// Central place for everything configurable in the app: the catalog of local
/// GGUF summary models (download/delete/select which one is active), where app
/// data lives on disk, and a (today, single-option) summary provider selector
/// reserved for a future cloud provider.
/// </summary>
public sealed partial class SettingsPage : Page
{
    public SettingsPageViewModel ViewModel { get; } = new();

    public SettingsPage()
    {
        InitializeComponent();
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        _ = ViewModel.LoadCommand.ExecuteAsync(null);
    }

    protected override void OnNavigatedFrom(NavigationEventArgs e)
    {
        base.OnNavigatedFrom(e);
        ViewModel.StopLevelMeter();
    }

    private async void UiLanguageComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is not ComboBox { SelectedItem: UiLanguageOption option })
            return;

        if (await ViewModel.UiLanguage.ApplyLanguageAsync(option))
            await ShowLanguageRestartNoticeAsync();
    }

    // AppStrings.Loader is a process-lifetime Lazy<ResourceLoader> (see AppStrings.cs), so a
    // language change never takes effect on already-loaded resw text without a restart.
    private async Task ShowLanguageRestartNoticeAsync()
    {
        var dialog = AppDialogFactory.CreateError(
            XamlRoot,
            AppStrings.Get("SettingsLanguageRestart_Title"),
            AppStrings.Get("SettingsLanguageRestart_Content"),
            AppStrings.Get("Dialog_OK"));
        await dialog.ShowAsync();
    }

    private void ModelRadioButton_Checked(object sender, RoutedEventArgs e)
    {
        if (((FrameworkElement)sender).DataContext is ModelOption option)
            ViewModel.LocalModel.SelectModelCommand.Execute(option);
    }

    private void DownloadModelButton_Click(object sender, RoutedEventArgs e)
    {
        if (((FrameworkElement)sender).DataContext is ModelOption option)
            ViewModel.LocalModel.DownloadModelCommand.Execute(option);
    }

    private void DeleteModelButton_Click(object sender, RoutedEventArgs e)
    {
        if (((FrameworkElement)sender).DataContext is ModelOption option)
            ViewModel.LocalModel.DeleteModelCommand.Execute(option);
    }

    private void ProviderRadioButton_Checked(object sender, RoutedEventArgs e)
    {
        if (sender is RadioButton { Tag: string tag } && Enum.TryParse<SummaryProviderKind>(tag, out var kind))
            ViewModel.SummaryProvider.SelectProviderCommand.Execute(kind);
    }

    private async void XaiSignIn_Click(object sender, RoutedEventArgs e)
    {
        var signedIn = await Dialogs.XaiAuthDialog.ShowAsync(XamlRoot);
        if (signedIn)
        {
            await ViewModel.SummaryProvider.RefreshXaiAccountCommand.ExecuteAsync(null);
            ViewModel.SummaryProvider.ShowXaiFeedback(AppStrings.Get("Xai_FeedbackSignedIn"));
        }
    }

    private PasswordBox? _xaiApiKeyBox;

    private void XaiApiKey_PasswordChanged(object sender, RoutedEventArgs e)
    {
        if (sender is not PasswordBox box)
            return;

        _xaiApiKeyBox = box;
        ViewModel.SummaryProvider.XaiApiKeyDraft = box.Password ?? string.Empty;
    }

    private async void XaiSaveApiKey_Click(object sender, RoutedEventArgs e)
    {
        if (!ViewModel.SummaryProvider.CanSaveXaiApiKey)
            return;

        await ViewModel.SummaryProvider.SaveXaiApiKeyCommand.ExecuteAsync(null);
        if (_xaiApiKeyBox is not null)
            _xaiApiKeyBox.Password = string.Empty;
        ViewModel.SummaryProvider.XaiApiKeyDraft = string.Empty;
    }

    private async void XaiSignOut_Click(object sender, RoutedEventArgs e)
    {
        await ViewModel.SummaryProvider.SignOutXaiCommand.ExecuteAsync(null);
    }

    private PasswordBox? _typeSafeApiKeyBox;

    private void TypeSafeEnabledToggleSwitch_Toggled(object sender, RoutedEventArgs e)
    {
        if (sender is ToggleSwitch toggleSwitch)
            ViewModel.TypeSafe.ToggleEnabledCommand.Execute(toggleSwitch.IsOn);
    }

    private void TypeSafeApiKey_PasswordChanged(object sender, RoutedEventArgs e)
    {
        if (sender is not PasswordBox box)
            return;

        _typeSafeApiKeyBox = box;
        ViewModel.TypeSafe.ApiKeyDraft = box.Password ?? string.Empty;
    }

    private async void TypeSafeSaveApiKey_Click(object sender, RoutedEventArgs e)
    {
        if (!ViewModel.TypeSafe.CanSaveApiKey)
            return;

        await ViewModel.TypeSafe.SaveApiKeyCommand.ExecuteAsync(null);
        if (_typeSafeApiKeyBox is not null)
            _typeSafeApiKeyBox.Password = string.Empty;
        ViewModel.TypeSafe.ApiKeyDraft = string.Empty;
    }

    private void TypeSafeClearApiKey_Click(object sender, RoutedEventArgs e)
    {
        ViewModel.TypeSafe.ClearApiKeyCommand.Execute(null);
        if (_typeSafeApiKeyBox is not null)
            _typeSafeApiKeyBox.Password = string.Empty;
        ViewModel.TypeSafe.ApiKeyDraft = string.Empty;
    }

    private void XaiModelComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: string modelId })
            ViewModel.SummaryProvider.SelectXaiModelCommand.Execute(modelId);
    }

    private void XaiEffortComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: string effort })
            ViewModel.SummaryProvider.SelectXaiEffortCommand.Execute(effort);
    }

    private void ClaudeModelComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: string modelId })
            ViewModel.SummaryProvider.SelectClaudeModelCommand.Execute(modelId);
    }

    private void ClaudeEffortComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: string effort })
            ViewModel.SummaryProvider.SelectClaudeEffortCommand.Execute(effort);
    }

    private void CodexModelComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: string modelId })
            ViewModel.SummaryProvider.SelectCodexModelCommand.Execute(modelId);
    }

    private void CodexEffortComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: string effort })
            ViewModel.SummaryProvider.SelectCodexEffortCommand.Execute(effort);
    }

    private void LanguageComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: TranscriptionLanguageOption option })
            ViewModel.Language.SelectLanguageCommand.Execute(option);
    }

    private void SummaryLanguageComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: TranscriptionLanguageOption option })
            ViewModel.Language.SelectSummaryLanguageCommand.Execute(option);
    }

    private void MicrophoneComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: MicrophoneDeviceOption option })
            ViewModel.Microphone.SelectMicrophoneCommand.Execute(option);
    }

    private void LiveTranscriptionToggleSwitch_Toggled(object sender, RoutedEventArgs e)
    {
        if (sender is ToggleSwitch toggleSwitch)
            ViewModel.TranscriptionEngine.ToggleLiveTranscriptionCommand.Execute(toggleSwitch.IsOn);
    }

    private void CalendarNotificationsToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (sender is ToggleSwitch toggleSwitch)
            ViewModel.Calendar.SetNotificationsEnabledCommand.Execute(toggleSwitch.IsOn);
    }

    private void CalendarVisibilityToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (sender is not ToggleSwitch toggleSwitch || toggleSwitch.DataContext is not CalendarVisibilityOption option)
            return;

        _ = ViewModel.Calendar.SetCalendarEnabledAsync(option, toggleSwitch.IsOn);
    }

    private void SpeakerDiarizationToggleSwitch_Toggled(object sender, RoutedEventArgs e)
    {
        if (sender is ToggleSwitch toggleSwitch)
            ViewModel.TranscriptionEngine.ToggleSpeakerDiarizationCommand.Execute(toggleSwitch.IsOn);
    }

    public static bool Not(bool value) => !value;

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    public static Visibility InverseBoolToVisibility(bool value) => value ? Visibility.Collapsed : Visibility.Visible;

    public static string ActiveRadioId(string fileName) => $"RadioSelectModel_{fileName}";

    public static string DownloadButtonId(string fileName) => $"BtnDownloadModel_{fileName}";

    public static string DeleteButtonId(string fileName) => $"BtnDeleteModel_{fileName}";
}
