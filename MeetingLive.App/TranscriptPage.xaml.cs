using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App;

/// <summary>Shows the full transcript of a meeting (navigated with a Guid id).</summary>
public sealed partial class TranscriptPage : Page, ISessionCopySource
{
    public TranscriptPageViewModel ViewModel { get; } = new();

    public TranscriptPage()
    {
        InitializeComponent();
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

    public string? GetCopyText() => ViewModel.HasContent ? ViewModel.Transcript : null;

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;
}
