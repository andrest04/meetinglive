using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
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
        Loaded += async (_, _) => await ViewModel.LoadCommand.ExecuteAsync(null);
        Unloaded += (_, _) => ViewModel.StopLevelMeter();
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

    private void LanguageComboBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (sender is ComboBox { SelectedItem: TranscriptionLanguageOption option })
            ViewModel.SelectLanguageCommand.Execute(option);
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
