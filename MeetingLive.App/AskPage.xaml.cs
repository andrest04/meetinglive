using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App;

/// <summary>Asks Jev to point at transcript lines for the opened meeting.</summary>
public sealed partial class AskPage : Page
{
    public AskPageViewModel ViewModel { get; } = new();

    public AskPage()
    {
        InitializeComponent();
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        var meetingId = e.Parameter as Guid? ?? AppServices.Workspace.SelectedMeetingId;
        _ = ViewModel.LoadAsync(meetingId);
    }

    private void Hits_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is AskHitViewModel hit)
            ViewModel.CopyHit(hit);
    }

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;
}
