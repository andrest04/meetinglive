using System.ComponentModel;
using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using MeetingLive.Core.Models;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;
using Windows.System;
using Windows.UI.Core;

namespace MeetingLive_App;

/// <summary>
/// App shell: a NavigationView hosting Record / Library / Settings in
/// <c>ContentFrame</c>. This page is the only navigator of that frame — child
/// pages request moves through <see cref="WorkspaceService"/>. An opened meeting
/// is <see cref="SessionPage"/>; the pane stays on Library while it is showing.
/// </summary>
public sealed partial class MainPage : Page
{
    private bool _isNavigating;
    private bool _paneDragging;
    private bool _applyingChatProvider;
    private bool _chatReady;
    private bool _suppressRecipeFlyout;
    private bool _recipeFlyoutFromSlash;
    private double _paneDragStartX;
    private double _paneDragStartLength;

    public MeetingChatViewModel Chat { get; } = new();

    public MainPage()
    {
        InitializeComponent();
        Chat.PropertyChanged += OnChatPropertyChanged;

        // The built-in Settings item's Content is localized from the OS language,
        // which can show up as e.g. "Configuración" on a Spanish-language system.
        // The app is English-only, so force the label explicitly.
        if (NavView.SettingsItem is NavigationViewItem settingsItem)
        {
            settingsItem.Content = AppStrings.Get("Nav_Settings");
            AutomationProperties.SetAutomationId(settingsItem, "NavItemSettings");
        }

        AppServices.Workspace.NavigationRequested += OnWorkspaceNavigationRequested;
        AppServices.Workspace.CallPromptOffered += (_, _) => CallPromptBar.IsOpen = true;

        ToolTipService.SetToolTip(PaneGrip, AppStrings.Get("Nav_ResizePane"));
        AutomationProperties.SetName(PaneGrip, AppStrings.Get("Nav_ResizePane"));

        Loaded += async (_, _) =>
        {
            if (NavView.SelectedItem is null)
                NavView.SelectedItem = NavView.MenuItems[0];

            Chat.EnsureSummaryModelAsync = () => SummaryModelResolver.ResolveAsync(XamlRoot);
            Chat.EnsureCliProviderAsync = kind => CliProviderResolver.EnsureAvailableAsync(kind, XamlRoot);
            Chat.EnsureXaiProviderAsync = () => XaiProviderResolver.EnsureAvailableAsync(XamlRoot);
            try
            {
                await Chat.InitializeAsync();
            }
            catch (Exception ex)
            {
                Chat.ShowSendError(ex);
            }

            _chatReady = true;
            ApplyChatProviderSelection();
            Chat.Messages.CollectionChanged += (_, _) => ScrollChatToEnd();

            var settings = await AppServices.Settings.LoadAsync();
            NavView.OpenPaneLength = settings.ResolveNavigationPaneLength();
            PositionPaneGrip();
            UpdatePaneGripVisibility();
        };
    }

    public static Visibility BoolToVisibility(bool value) => value ? Visibility.Visible : Visibility.Collapsed;

    public static Visibility InvertBoolToVisibility(bool value) => value ? Visibility.Collapsed : Visibility.Visible;

    private void OnChatPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (!_chatReady)
            return;

        if (e.PropertyName == nameof(MeetingChatViewModel.SelectedProvider))
            ApplyChatProviderSelection();
    }

    private void ApplyChatProviderSelection()
    {
        _applyingChatProvider = true;
        try
        {
            CmbMeetingChatProvider.SelectedItem = Chat.SelectedProvider;
        }
        finally
        {
            _applyingChatProvider = false;
        }
    }

    private async void ChatProvider_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_applyingChatProvider)
            return;
        if (sender is not ComboBox { SelectedItem: LiveAnswerProviderOption option })
            return;
        if (Chat.SelectedProvider?.Kind == option.Kind)
            return;

        try
        {
            await Chat.SaveProviderAsync(option.Kind);
        }
        catch (Exception ex)
        {
            Chat.ShowSendError(ex);
        }
    }

    private void TxtMeetingChat_PreviewKeyDown(object sender, KeyRoutedEventArgs e)
    {
        if (e.Key != VirtualKey.Enter)
            return;

        var shift = InputKeyboardSource.GetKeyStateForCurrentThread(VirtualKey.Shift);
        if (shift.HasFlag(CoreVirtualKeyStates.Down))
            return;

        e.Handled = true;
        if (Chat.SendCommand.CanExecute(null))
            _ = Chat.SendCommand.ExecuteAsync(null);
    }

    private void TxtMeetingChat_TextChanged(object sender, TextChangedEventArgs e)
    {
        if (_suppressRecipeFlyout)
            return;

        if (Chat.TryFilterRecipesFromDraft())
        {
            _recipeFlyoutFromSlash = true;
            ChatRecipeFlyout.ShowAt(TxtMeetingChat);
            return;
        }

        ChatRecipeFlyout.Hide();
    }

    private void ChatRecipeFlyout_Opening(object sender, object e)
    {
        if (_recipeFlyoutFromSlash)
        {
            _recipeFlyoutFromSlash = false;
            return;
        }

        Chat.ShowAllRecipes();
    }

    private async void ChatHistoryFlyout_Opening(object sender, object e)
    {
        try
        {
            await Chat.RefreshThreadsAsync();
        }
        catch (Exception ex)
        {
            Chat.ShowSendError(ex);
        }
    }

    private void ChatRecipe_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is not ChatRecipeItem item)
            return;

        _suppressRecipeFlyout = true;
        try
        {
            Chat.ApplyRecipe(item);
        }
        finally
        {
            ChatRecipeFlyout.Hide();
            TxtMeetingChat.Focus(FocusState.Programmatic);
            TxtMeetingChat.SelectionStart = TxtMeetingChat.Text.Length;
            App.DispatcherQueue.TryEnqueue(() => _suppressRecipeFlyout = false);
        }
    }

    private async void CreateChatRecipe_Click(object sender, RoutedEventArgs e)
    {
        ChatRecipeFlyout.Hide();

        var nameBox = new TextBox
        {
            Header = AppStrings.Get("Chat_RecipeName.Header"),
            PlaceholderText = AppStrings.Get("Chat_RecipeName.PlaceholderText"),
        };
        AutomationProperties.SetName(nameBox, AppStrings.Get("Chat_RecipeName.Header"));

        var promptBox = new TextBox
        {
            Header = AppStrings.Get("Chat_RecipePrompt.Header"),
            PlaceholderText = AppStrings.Get("Chat_RecipePrompt.PlaceholderText"),
            AcceptsReturn = true,
            TextWrapping = TextWrapping.Wrap,
            MinHeight = 80,
        };
        AutomationProperties.SetName(promptBox, AppStrings.Get("Chat_RecipePrompt.Header"));

        var availability = new RadioButtons
        {
            Header = AppStrings.Get("Chat_RecipeAvailability.Header"),
            SelectedIndex = Chat.PrefersMultipleRecipes ? 1 : 0,
        };
        availability.Items.Add(AppStrings.Get("Chat_RecipeSingle"));
        availability.Items.Add(AppStrings.Get("Chat_RecipeMultiple"));
        AutomationProperties.SetName(availability, AppStrings.Get("Chat_RecipeAvailability.Header"));

        var panel = new StackPanel { Spacing = 12 };
        panel.Children.Add(nameBox);
        panel.Children.Add(promptBox);
        panel.Children.Add(availability);

        var dialog = AppDialogFactory.CreateConfirm(
            XamlRoot,
            AppStrings.Get("Chat_CreateRecipeTitle"),
            panel,
            AppStrings.Get("Chat_CreateRecipePrimary"),
            AppStrings.Get("Chat_CreateRecipeCancel"),
            ContentDialogButton.Primary);
        dialog.Closing += (_, args) =>
        {
            if (args.Result == ContentDialogResult.Primary
                && (string.IsNullOrWhiteSpace(nameBox.Text) || string.IsNullOrWhiteSpace(promptBox.Text)))
                args.Cancel = true;
        };

        if (await dialog.ShowAsync() != ContentDialogResult.Primary)
            return;

        try
        {
            await Chat.CreateRecipeAsync(nameBox.Text, promptBox.Text, availability.SelectedIndex == 1);
        }
        catch (Exception ex)
        {
            Chat.ShowSendError(ex);
        }
    }

    private async void DeleteChatRecipe_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: Guid id })
            return;

        var name = Chat.RecipeSuggestions.FirstOrDefault(item => item.Id == id)?.Name ?? string.Empty;
        var dialog = AppDialogFactory.CreateConfirm(
            XamlRoot,
            AppStrings.Get("Chat_DeleteRecipeTitle"),
            AppStrings.Format("Chat_DeleteRecipeContent", name),
            AppStrings.Get("Chat_DeleteRecipePrimary"),
            AppStrings.Get("Chat_DeleteRecipeCancel"),
            ContentDialogButton.Close);
        if (await dialog.ShowAsync() != ContentDialogResult.Primary)
            return;

        try
        {
            await Chat.DeleteRecipeAsync(id);
        }
        catch (Exception ex)
        {
            Chat.ShowSendError(ex);
        }
    }

    private async void ChatThread_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is not ChatThreadItem item)
            return;

        ChatHistoryFlyout.Hide();
        try
        {
            await Chat.OpenThreadAsync(item.Id);
            ScrollChatToEnd();
        }
        catch (Exception ex)
        {
            Chat.ShowSendError(ex);
        }
    }

    private async void DeleteChatThread_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: Guid id })
            return;

        var title = Chat.Threads.FirstOrDefault(item => item.Id == id)?.Title ?? string.Empty;
        var dialog = AppDialogFactory.CreateConfirm(
            XamlRoot,
            AppStrings.Get("Chat_DeleteThreadTitle"),
            AppStrings.Format("Chat_DeleteThreadContent", title),
            AppStrings.Get("Chat_DeleteThreadPrimary"),
            AppStrings.Get("Chat_DeleteThreadCancel"),
            ContentDialogButton.Close);
        if (await dialog.ShowAsync() != ContentDialogResult.Primary)
            return;

        try
        {
            await Chat.DeleteThreadAsync(id);
        }
        catch (Exception ex)
        {
            Chat.ShowSendError(ex);
        }
    }

    private void CopyChatMessage_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: ChatMessageItem item })
            return;

        if (Chat.CopyMessageCommand.CanExecute(item))
            Chat.CopyMessageCommand.Execute(item);
    }

    private void ScrollChatToEnd()
    {
        if (ChatTranscript.Items.Count == 0)
            return;

        ChatTranscript.UpdateLayout();
        ChatTranscript.ScrollIntoView(ChatTranscript.Items[^1]);
    }

    public static string CallPromptTitle() => AppStrings.Get("CallPrompt_Title");

    public static string CallPromptBody() => AppStrings.Get("CallPrompt_Body");

    public static string CallPromptTakeNotes() => AppStrings.Get("CallPrompt_TakeNotes");

    private void CallPromptTakeNotes_Click(object sender, RoutedEventArgs e)
    {
        CallPromptBar.IsOpen = false;
        AppServices.Workspace.RequestTakeNotes();
    }

    private void NavView_DisplayModeChanged(NavigationView sender, NavigationViewDisplayModeChangedEventArgs args) =>
        UpdatePaneGripVisibility();

    private void NavView_PaneOpened(NavigationView sender, object args) => UpdatePaneGripVisibility();

    private void NavView_PaneClosed(NavigationView sender, object args) => UpdatePaneGripVisibility();

    private void PaneGrip_PointerPressed(object sender, PointerRoutedEventArgs e)
    {
        _paneDragging = true;
        _paneDragStartX = e.GetCurrentPoint(this).Position.X;
        _paneDragStartLength = NavView.OpenPaneLength;
        PaneGrip.CapturePointer(e.Pointer);
        e.Handled = true;
    }

    private void PaneGrip_PointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_paneDragging)
            return;

        var delta = e.GetCurrentPoint(this).Position.X - _paneDragStartX;
        NavView.OpenPaneLength = Math.Clamp(
            _paneDragStartLength + delta,
            AppSettings.MinNavigationPaneLength,
            AppSettings.MaxNavigationPaneLength);
        PositionPaneGrip();
        e.Handled = true;
    }

    private async void PaneGrip_PointerReleased(object sender, PointerRoutedEventArgs e)
    {
        if (!_paneDragging)
            return;

        _paneDragging = false;
        PaneGrip.ReleasePointerCapture(e.Pointer);
        PositionPaneGrip();
        e.Handled = true;

        var settings = await AppServices.Settings.LoadAsync();
        settings.NavigationPaneLength = NavView.OpenPaneLength;
        await AppServices.Settings.SaveAsync(settings);
    }

    private void PositionPaneGrip() =>
        PaneGrip.Margin = new Thickness(NavView.OpenPaneLength - 4, 0, 0, 0);

    private void UpdatePaneGripVisibility()
    {
        var show = NavView.DisplayMode == NavigationViewDisplayMode.Expanded && NavView.IsPaneOpen;
        PaneGrip.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        if (show)
            PositionPaneGrip();
    }

    private void OnWorkspaceNavigationRequested(object? sender, string tag)
    {
        if (_isNavigating)
            return;

        _isNavigating = true;
        try
        {
            SyncPane(tag);
            NavigateContent(tag);
        }
        finally
        {
            _isNavigating = false;
        }
    }

    private void NavView_ItemInvoked(NavigationView sender, NavigationViewItemInvokedEventArgs args)
    {
        if (_isNavigating || args.IsSettingsInvoked)
            return;

        if (args.InvokedItemContainer is not NavigationViewItem { Tag: string tag })
            return;

        // Pane stays on Library while a session is open; re-clicking Library must
        // still show the folder list even though the item is already selected.
        if (tag != WorkspaceService.History || ContentFrame.CurrentSourcePageType != typeof(SessionPage))
            return;

        _isNavigating = true;
        try
        {
            NavigateContent(WorkspaceService.History);
        }
        finally
        {
            _isNavigating = false;
        }
    }

    private void NavView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (_isNavigating)
            return;

        string? tag;
        if (args.IsSettingsSelected)
        {
            tag = WorkspaceService.Settings;
        }
        else if (args.SelectedItem is NavigationViewItem { Tag: string selectedTag })
        {
            tag = selectedTag;
        }
        else
        {
            return;
        }

        _isNavigating = true;
        try
        {
            NavigateContent(tag);
        }
        finally
        {
            _isNavigating = false;
        }
    }

    private void SyncPane(string tag)
    {
        if (tag == WorkspaceService.Settings)
        {
            NavView.SelectedItem = NavView.SettingsItem;
            return;
        }

        var paneTag = tag == WorkspaceService.Session ? WorkspaceService.History : tag;

        foreach (var item in NavView.MenuItems)
        {
            if (item is NavigationViewItem { Tag: string itemTag } navItem && itemTag == paneTag)
            {
                NavView.SelectedItem = navItem;
                return;
            }
        }
    }

    private void NavigateContent(string tag)
    {
        var pageType = tag switch
        {
            WorkspaceService.Recording => typeof(RecordingPage),
            WorkspaceService.History => typeof(HistoryPage),
            WorkspaceService.Settings => typeof(SettingsPage),
            WorkspaceService.Session => typeof(SessionPage),
            _ => null,
        };

        if (pageType is null)
            return;

        AppServices.Workspace.SetCurrentShellTag(tag);

        var openSession = pageType == typeof(SessionPage);
        if (!openSession && ContentFrame.CurrentSourcePageType == pageType)
            return;

        object? parameter = openSession ? AppServices.Workspace.SelectedMeetingId : null;
        ContentFrame.Navigate(pageType, parameter);
    }
}
