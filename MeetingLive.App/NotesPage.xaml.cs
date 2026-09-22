using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App;

/// <summary>Human notes for the opened meeting. Saves on LostFocus and Unloaded.</summary>
public sealed partial class NotesPage : Page
{
    public NotesPageViewModel ViewModel { get; } = new();

    private bool _notesModeReady;

    public NotesPage()
    {
        InitializeComponent();
        Loaded += (_, _) => _notesModeReady = true;
        Unloaded += (_, _) => _ = ViewModel.SaveNotesAsync();
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        var meetingId = e.Parameter as Guid? ?? AppServices.Workspace.SelectedMeetingId;
        _ = ViewModel.LoadAsync(meetingId);
    }

    private void Notes_LostFocus(object sender, RoutedEventArgs e)
    {
        _ = ViewModel.SaveNotesAsync();
    }

    private void NotesMode_SelectionChanged(SelectorBar sender, SelectorBarSelectionChangedEventArgs args)
    {
        if (!_notesModeReady)
            return;

        if (sender.SelectedItem is SelectorBarItem { Tag: "enhanced" })
            ViewModel.OpenEnhancedCommand.Execute(null);
    }

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;
}
