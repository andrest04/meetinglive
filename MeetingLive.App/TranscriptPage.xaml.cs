using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App;

/// <summary>Shows the full transcript of a meeting (navigated with a Guid id, or the most recent one).</summary>
public sealed partial class TranscriptPage : Page
{
    public TranscriptPageViewModel ViewModel { get; } = new();

    public TranscriptPage()
    {
        InitializeComponent();
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        var meetingId = e.Parameter as Guid?;
        _ = ViewModel.LoadAsync(meetingId);
    }

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;
}
