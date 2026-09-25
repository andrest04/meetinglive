using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App.Dialogs;

/// <summary>
/// Finds personal tasks in the opened meeting, then writes a checklist. Opened from the meeting
/// chat's recipe list (Meeting scope only) instead of a dedicated session tab.
/// </summary>
public sealed partial class PersonalTasksDialog : ContentDialog
{
    public PersonalTasksDialogViewModel ViewModel { get; } = new();

    public PersonalTasksDialog()
    {
        InitializeComponent();
        Loaded += (_, _) =>
        {
            ViewModel.EnsureSummaryModelAsync = () => SummaryModelResolver.ResolveAsync(XamlRoot);
            ViewModel.EnsureCliProviderAsync = kind => CliProviderResolver.EnsureAvailableAsync(kind, XamlRoot);
            ViewModel.EnsureXaiProviderAsync = () => XaiProviderResolver.EnsureAvailableAsync(XamlRoot);
        };
    }

    public static async Task ShowAsync(XamlRoot xamlRoot, Guid? meetingId)
    {
        var dialog = new PersonalTasksDialog { XamlRoot = xamlRoot };
        await dialog.ViewModel.LoadAsync(meetingId);
        await dialog.ShowAsync();
    }

    private void Hits_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is AskHitViewModel hit)
            ViewModel.CopyHit(hit);
    }

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;
}
