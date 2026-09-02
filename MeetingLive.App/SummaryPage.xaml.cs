using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App;

/// <summary>Shows the structured summary of a meeting, and can generate one on demand.</summary>
public sealed partial class SummaryPage : Page
{
    public SummaryPageViewModel ViewModel { get; } = new();

    public SummaryPage()
    {
        InitializeComponent();
        Loaded += (_, _) =>
        {
            ViewModel.EnsureSummaryModelAsync = () => SummaryModelResolver.ResolveAsync(XamlRoot);
            ViewModel.EnsureCliProviderAsync = kind => CliProviderResolver.EnsureAvailableAsync(kind, XamlRoot);
            ViewModel.ConfirmRegenerateAsync = ConfirmRegenerateAsync;
        };
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        var meetingId = e.Parameter as Guid? ?? AppServices.Workspace.SelectedMeetingId;
        _ = ViewModel.LoadAsync(meetingId);
    }

    private void EmptyCta_Click(object sender, RoutedEventArgs e)
    {
        AppServices.Workspace.NavigateTo(WorkspaceService.Recording);
    }

    private async Task<bool> ConfirmRegenerateAsync()
    {
        var dialog = new ContentDialog
        {
            XamlRoot = XamlRoot,
            Style = Application.Current.Resources["DefaultContentDialogStyle"] as Style,
            Title = AppStrings.Get("SummaryRegenerate_Title"),
            Content = AppStrings.Format("SummaryRegenerate_Content", ViewModel.Title),
            PrimaryButtonText = AppStrings.Get("SummaryRegenerate_Primary"),
            CloseButtonText = AppStrings.Get("SummaryRegenerate_Cancel"),
            DefaultButton = ContentDialogButton.Close,
        };

        var result = await dialog.ShowAsync();
        return result == ContentDialogResult.Primary;
    }

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;
}
