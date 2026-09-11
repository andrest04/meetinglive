using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
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

    private void ModelRadioButton_Checked(object sender, RoutedEventArgs e)
    {
        if (((FrameworkElement)sender).DataContext is ModelOption option)
            ViewModel.SelectModelCommand.Execute(option);
    }

    private void DownloadModelButton_Click(object sender, RoutedEventArgs e)
    {
        if (((FrameworkElement)sender).DataContext is ModelOption option)
            ViewModel.DownloadModelCommand.Execute(option);
    }

    private void DeleteModelButton_Click(object sender, RoutedEventArgs e)
    {
        if (((FrameworkElement)sender).DataContext is ModelOption option)
            ViewModel.DeleteModelCommand.Execute(option);
    }

    private void ProviderRadioButton_Checked(object sender, RoutedEventArgs e)
    {
        if (sender is RadioButton { Tag: string tag } && Enum.TryParse<SummaryProviderKind>(tag, out var kind))
            ViewModel.SelectProviderCommand.Execute(kind);
    }

    private async void XaiSignIn_Click(object sender, RoutedEventArgs e)
    {
        var signedIn = await Dialogs.XaiAuthDialog.ShowAsync(XamlRoot);
        if (signedIn)
        {
            await ViewModel.RefreshXaiAccountCommand.ExecuteAsync(null);
            ViewModel.ShowXaiFeedback(AppStrings.Get("Xai_FeedbackSignedIn"));
        }
    }

    private PasswordBox? _xaiApiKeyBox;

    private void XaiApiKey_PasswordChanged(object sender, RoutedEventArgs e)
    {
        if (sender is not PasswordBox box)
            return;

        _xaiApiKeyBox = box;
        ViewModel.XaiApiKeyDraft = box.Password ?? string.Empty;
    }

    private async void XaiSaveApiKey_Click(object sender, RoutedEventArgs e)
    {
        if (!ViewModel.CanSaveXaiApiKey)
            return;

        await ViewModel.SaveXaiApiKeyCommand.ExecuteAsync(null);
        if (_xaiApiKeyBox is not null)
            _xaiApiKeyBox.Password = string.Empty;
        ViewModel.XaiApiKeyDraft = string.Empty;
    }

    private async void XaiSignOut_Click(object sender, RoutedEventArgs e)
    {
        await ViewModel.SignOutXaiCommand.ExecuteAsync(null);
    }

    private void XaiModelComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: string modelId })
            ViewModel.SelectXaiModelCommand.Execute(modelId);
    }

    private void XaiEffortComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: string effort })
            ViewModel.SelectXaiEffortCommand.Execute(effort);
    }

    private void ClaudeModelComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: string modelId })
            ViewModel.SelectClaudeModelCommand.Execute(modelId);
    }

    private void ClaudeEffortComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: string effort })
            ViewModel.SelectClaudeEffortCommand.Execute(effort);
    }

    private void CodexModelComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: string modelId })
            ViewModel.SelectCodexModelCommand.Execute(modelId);
    }

    private void CodexEffortComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: string effort })
            ViewModel.SelectCodexEffortCommand.Execute(effort);
    }

    private void LanguageComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: TranscriptionLanguageOption option })
            ViewModel.SelectLanguageCommand.Execute(option);
    }

    private void SummaryLanguageComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: TranscriptionLanguageOption option })
            ViewModel.SelectSummaryLanguageCommand.Execute(option);
    }

    private void MicrophoneComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: MicrophoneDeviceOption option })
            ViewModel.SelectMicrophoneCommand.Execute(option);
    }

    private void LiveTranscriptionToggleSwitch_Toggled(object sender, RoutedEventArgs e)
    {
        if (sender is ToggleSwitch toggleSwitch)
            ViewModel.ToggleLiveTranscriptionCommand.Execute(toggleSwitch.IsOn);
    }

    public static bool Not(bool value) => !value;

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    public static Visibility InverseBoolToVisibility(bool value) => value ? Visibility.Collapsed : Visibility.Visible;

    public static string ActiveRadioId(string fileName) => $"RadioSelectModel_{fileName}";

    public static string DownloadButtonId(string fileName) => $"BtnDownloadModel_{fileName}";

    public static string DeleteButtonId(string fileName) => $"BtnDeleteModel_{fileName}";
}
