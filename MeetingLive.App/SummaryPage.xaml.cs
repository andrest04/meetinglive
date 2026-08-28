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
        };
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        var meetingId = e.Parameter as Guid?;
        _ = ViewModel.LoadAsync(meetingId);
    }

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;
}
