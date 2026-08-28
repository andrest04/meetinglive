using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;

namespace MeetingLive_App;

/// <summary>
/// App shell: a NavigationView with three sections (Record / Transcript /
/// Summary), each hosted in <c>ContentFrame</c>.
/// </summary>
public sealed partial class MainPage : Page
{
    public MainPage()
    {
        InitializeComponent();

        // The built-in Settings item's Content is localized from the OS language,
        // which can show up as e.g. "Configuración" on a Spanish-language system.
        // The app is English-only, so force the label explicitly.
        if (NavView.SettingsItem is NavigationViewItem settingsItem)
        {
            settingsItem.Content = "Settings";
            AutomationProperties.SetAutomationId(settingsItem, "NavItemSettings");
        }

        Loaded += (_, _) =>
        {
            NavView.SelectedItem = NavView.MenuItems[0];
            ContentFrame.Navigate(typeof(RecordingPage));
        };
    }

    private void NavView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        Type? pageType;

        if (args.IsSettingsSelected)
        {
            pageType = typeof(SettingsPage);
        }
        else if (args.SelectedItem is NavigationViewItem { Tag: string tag })
        {
            pageType = tag switch
            {
                "Recording" => typeof(RecordingPage),
                "Transcript" => typeof(TranscriptPage),
                "Summary" => typeof(SummaryPage),
                _ => null,
            };
        }
        else
        {
            pageType = null;
        }

        if (pageType is not null && ContentFrame.CurrentSourcePageType != pageType)
            ContentFrame.Navigate(pageType);
    }
}
