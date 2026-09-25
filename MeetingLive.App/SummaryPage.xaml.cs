using MeetingLive.Core.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App;

/// <summary>Shows the structured summary of a meeting, and can generate one on demand.</summary>
public sealed partial class SummaryPage : Page
{
    private bool _applyingNoteTemplate;
    private bool _notesModeReady;

    public SummaryPageViewModel ViewModel { get; } = new();

    public SummaryPage()
    {
        InitializeComponent();
        Loaded += (_, _) =>
        {
            ViewModel.EnsureSummaryModelAsync = () => SummaryModelResolver.ResolveAsync(XamlRoot);
            ViewModel.EnsureCliProviderAsync = kind => CliProviderResolver.EnsureAvailableAsync(kind, XamlRoot);
            ViewModel.EnsureXaiProviderAsync = () => XaiProviderResolver.EnsureAvailableAsync(XamlRoot);
            ViewModel.ConfirmRegenerateAsync = ConfirmRegenerateAsync;
        };
        Loaded += (_, _) => _notesModeReady = true;
        Unloaded += (_, _) => _ = ViewModel.SaveNotesAsync();
    }

    protected override async void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        var meetingId = e.Parameter as Guid? ?? AppServices.Workspace.SelectedMeetingId;
        await ViewModel.LoadAsync(meetingId);
        ApplyNoteTemplateSelection();
    }

    private void EmptyCta_Click(object sender, RoutedEventArgs e)
    {
        AppServices.Workspace.NavigateTo(WorkspaceService.Recording);
    }

    private void RelatedMeeting_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is RelatedMeetingItem item && ViewModel.OpenRelatedMeetingCommand.CanExecute(item.Id))
            ViewModel.OpenRelatedMeetingCommand.Execute(item.Id);
    }

    private async Task<bool> ConfirmRegenerateAsync()
    {
        var dialog = AppDialogFactory.CreateConfirm(
            XamlRoot,
            AppStrings.Get("SummaryRegenerate_Title"),
            AppStrings.Format("SummaryRegenerate_Content", ViewModel.Title),
            AppStrings.Get("SummaryRegenerate_Primary"),
            AppStrings.Get("SummaryRegenerate_Cancel"),
            ContentDialogButton.Close);

        var result = await dialog.ShowAsync();
        return result == ContentDialogResult.Primary;
    }

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    public static InfoBarSeverity DraftSeverity(bool isError) =>
        isError ? InfoBarSeverity.Error : InfoBarSeverity.Success;

    private void ApplyNoteTemplateSelection()
    {
        _applyingNoteTemplate = true;
        try
        {
            var id = string.IsNullOrWhiteSpace(ViewModel.SelectedNoteTemplateId)
                ? NoteTemplateCatalog.AutoId
                : ViewModel.SelectedNoteTemplateId;
            CmbNoteTemplate.SelectedItem = ViewModel.NoteTemplates.FirstOrDefault(item => item.Id == id)
                ?? ViewModel.NoteTemplates.FirstOrDefault();
        }
        finally
        {
            _applyingNoteTemplate = false;
        }
    }

    private void NoteTemplate_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_applyingNoteTemplate || sender is not ComboBox { SelectedItem: NoteTemplateOption option })
            return;

        ViewModel.SelectedNoteTemplateId = option.Id;
    }

    private async void SaveCustomTemplate_Click(object sender, RoutedEventArgs e)
    {
        var existing = await AppServices.NoteTemplates.LoadAsync();
        var edited = await CustomNoteTemplateDialog.ShowAsync(XamlRoot, existing);
        if (edited is null)
            return;

        await ViewModel.SaveCustomTemplateAsync(edited);
        ApplyNoteTemplateSelection();
    }

    private void NotesMode_SelectionChanged(SelectorBar sender, SelectorBarSelectionChangedEventArgs args)
    {
        if (!_notesModeReady)
            return;

        var showingNotes = sender.SelectedItem is SelectorBarItem { Tag: "notes" };
        if (showingNotes == ViewModel.IsShowingNotes)
            return;

        if (ViewModel.IsShowingNotes && !showingNotes)
            _ = ViewModel.SaveNotesAsync();

        ViewModel.IsShowingNotes = showingNotes;
    }

    private void Notes_LostFocus(object sender, RoutedEventArgs e)
    {
        _ = ViewModel.SaveNotesAsync();
    }
}
