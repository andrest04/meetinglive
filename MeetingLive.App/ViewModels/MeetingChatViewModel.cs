using System.Collections.ObjectModel;
using System.Globalization;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;
using Windows.ApplicationModel.DataTransfer;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Docked meeting chat. Scope comes from <see cref="WorkspaceService"/>.
/// Send packs context, builds one prompt, and calls the selected summary provider.
/// This is not the session Ask tab.
/// </summary>
public sealed partial class MeetingChatViewModel : ObservableObject
{
    private readonly IChatThreadRepository _threads = AppServices.ChatThreads;
    private readonly IChatRecipeRepository _recipes = AppServices.ChatRecipes;
    private readonly IMeetingRepository _meetings = AppServices.Meetings;
    private readonly IFolderRepository _folders = AppServices.Folders;

    private ChatThread? _openThread;
    private ChatScopeDecision _decision;
    private List<ChatRecipeItem> _scopeRecipes = [];
    private bool _forceAllRecipes;
    private bool _subscribed;
    private int _scopeGeneration;
    private bool _personalTasksAvailable;

    [ObservableProperty]
    private string _draft = string.Empty;

    [ObservableProperty]
    private string _scopeLabel = string.Empty;

    /// <summary>Segoe Fluent glyph shown next to <see cref="ScopeLabel"/> in the header chip.</summary>
    [ObservableProperty]
    private string _scopeGlyph = ScopeGlyphFor(ChatScopeKind.AllMeetings);

    [ObservableProperty]
    private bool _isVisible = true;

    /// <summary>Collapsed by default so the chat doesn't sit open across the whole app; the
    /// scope label and provider picker stay reachable in the collapsed header.</summary>
    [ObservableProperty]
    private bool _isExpanded;

    [ObservableProperty]
    private bool _isSending;

    [ObservableProperty]
    private bool _hasMessages;

    [ObservableProperty]
    private bool _showScopeMismatch;

    [ObservableProperty]
    private bool _isErrorOpen;

    [ObservableProperty]
    private string _errorMessage = string.Empty;

    [ObservableProperty]
    private bool _isHistoryEmpty = true;

    [ObservableProperty]
    private bool _hasRecipeSuggestions;

    [ObservableProperty]
    private bool _showStarterRecipes;

    private const int StarterRecipeCount = 4;

    public ObservableCollection<ChatMessageItem> Messages { get; } = [];

    /// <summary>First scope recipes, offered as one-click prompts while the chat is empty.</summary>
    public ObservableCollection<ChatRecipeItem> StarterRecipes { get; } = [];

    public ObservableCollection<ChatThreadItem> Threads { get; } = [];

    public ObservableCollection<ChatRecipeItem> RecipeSuggestions { get; } = [];

    public Func<Task<string?>>? EnsureSummaryModelAsync { get; set; }

    public Func<SummaryProviderKind, Task<bool>>? EnsureCliProviderAsync { get; set; }

    public Func<Task<bool>>? EnsureXaiProviderAsync { get; set; }

    public bool PrefersMultipleRecipes =>
        _decision.Kind is ChatScopeKind.Folder or ChatScopeKind.AllMeetings;

    /// <summary>"What do I need to do" only makes sense for one specific meeting, and only when
    /// TypeSafe is enabled with an API key (same gate as the Personal tasks dialog).</summary>
    public bool ShowPersonalTasksRecipe => _decision.Kind == ChatScopeKind.Meeting && _personalTasksAvailable;

    public Guid? CurrentMeetingId => _decision.MeetingId;

    public async Task InitializeAsync()
    {
        if (!_subscribed)
        {
            AppServices.Workspace.ScopeChanged += OnWorkspaceScopeChanged;
            _subscribed = true;
        }

        await RefreshScopeAsync();
        await RefreshThreadsAsync();
    }

    [RelayCommand]
    private void NewChat()
    {
        _openThread = null;
        Messages.Clear();
        HasMessages = false;
        Draft = string.Empty;
        ClearError();
        UpdateMismatch();
        // The header actions stay reachable while collapsed; starting a chat should reveal the composer.
        IsExpanded = true;
    }

    [RelayCommand(CanExecute = nameof(CanSend))]
    private async Task SendAsync()
    {
        if (IsSending || !_decision.IsVisible)
            return;

        var originalDraft = Draft;
        var userMessage = originalDraft.Trim();
        if (userMessage.Length == 0)
            return;

        IsSending = true;
        ClearError();
        var (userItem, pendingItem) = AddOptimisticTurn(userMessage);
        Draft = string.Empty;
        try
        {
            var decision = _decision;
            var open = _openThread;
            if (open is not null && !ChatScopeResolver.MatchesOpenThread(open, decision))
                open = null;

            var prior = open is null
                ? (IReadOnlyList<ChatMessage>)[]
                : open.Messages.ToList();
            var meetings = await _meetings.GetAllAsync();
            var folders = await _folders.GetAllAsync();
            var context = ChatContextPacker.Pack(
                decision.Kind,
                decision.FolderId,
                decision.MeetingId,
                AppServices.Workspace.LiveTranscript,
                meetings,
                folders);
            var prompt = ChatPromptBuilder.Build(decision.Kind, context, prior, userMessage);

            var settings = await AppServices.Settings.LoadAsync();
            var provider = await SummaryProviderResolver.ResolveAsync(
                settings.ResolveSummaryProviderKind(),
                EnsureSummaryModelAsync,
                EnsureCliProviderAsync,
                EnsureXaiProviderAsync);
            if (provider is null)
            {
                ShowError(AppStrings.Get("Status_SetupCancelled"));
                return;
            }

            string answer;
            try
            {
                answer = await Task.Run(() => provider.Provider.CompletePromptAsync(prompt));
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception ex)
            {
                var message = ex.Message;
                await InvokeOnUiAsync(() =>
                {
                    ShowError(AppStrings.Format("Chat_SendFailed", message));
                    return Task.CompletedTask;
                });
                return;
            }

            if (string.IsNullOrWhiteSpace(answer))
            {
                await InvokeOnUiAsync(() =>
                {
                    ShowError(AppStrings.Get("Chat_EmptyAnswer"));
                    return Task.CompletedTask;
                });
                return;
            }

            await InvokeOnUiAsync(() => PersistTurnAsync(open, decision, userMessage, answer));
        }
        catch (Exception ex)
        {
            var message = ex.Message;
            await InvokeOnUiAsync(() =>
            {
                ShowError(AppStrings.Format("Chat_SendFailed", message));
                return Task.CompletedTask;
            });
        }
        finally
        {
            try
            {
                await InvokeOnUiAsync(() =>
                {
                    RollBackOptimisticTurn(userItem, pendingItem, originalDraft);
                    IsSending = false;
                    return Task.CompletedTask;
                });
            }
            catch (Exception ex)
            {
                RollBackOptimisticTurn(userItem, pendingItem, originalDraft);
                IsSending = false;
                ShowError(AppStrings.Format("Chat_SendFailed", ex.Message));
            }
        }
    }

    public void ShowSendError(Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        ShowError(AppStrings.Format("Chat_SendFailed", exception.Message));
    }

    public async Task RefreshThreadsAsync()
    {
        var threads = await _threads.GetAllAsync();
        Threads.Clear();
        foreach (var thread in threads)
        {
            Threads.Add(new ChatThreadItem
            {
                Id = thread.Id,
                Title = string.IsNullOrWhiteSpace(thread.Title)
                    ? AppStrings.Get("Chat_Untitled")
                    : thread.Title,
                UpdatedLabel = AppStrings.Format(
                    "Chat_ThreadUpdated",
                    thread.UpdatedAt.ToLocalTime().ToString("g", CultureInfo.CurrentCulture)),
            });
        }

        IsHistoryEmpty = Threads.Count == 0;
    }

    public async Task OpenThreadAsync(Guid id)
    {
        var thread = await _threads.GetByIdAsync(id);
        if (thread is null)
        {
            if (_openThread?.Id == id)
                NewChat();
            await RefreshThreadsAsync();
            return;
        }

        _openThread = thread;
        ShowMessages(thread.Messages);
        UpdateMismatch();
        IsExpanded = true;
    }

    public async Task DeleteThreadAsync(Guid id)
    {
        await _threads.DeleteAsync(id);
        if (_openThread?.Id == id)
        {
            _openThread = null;
            Messages.Clear();
            HasMessages = false;
            UpdateMismatch();
        }

        await RefreshThreadsAsync();
    }

    public void ShowAllRecipes()
    {
        _forceAllRecipes = true;
        ApplyRecipeFilter(null);
    }

    public bool TryFilterRecipesFromDraft()
    {
        if (!Draft.StartsWith('/'))
        {
            _forceAllRecipes = false;
            return false;
        }

        _forceAllRecipes = false;
        ApplyRecipeFilter(Draft[1..].Trim());
        return true;
    }

    public void ApplyRecipe(ChatRecipeItem recipe)
    {
        ArgumentNullException.ThrowIfNull(recipe);
        Draft = recipe.Prompt;
        _forceAllRecipes = false;
    }

    public async Task SendRecipeAsync(ChatRecipeItem recipe)
    {
        ApplyRecipe(recipe);
        if (SendCommand.CanExecute(null))
            await SendCommand.ExecuteAsync(null);
    }

    public async Task CreateRecipeAsync(string name, string prompt, bool multiple)
    {
        var trimmedName = name.Trim();
        var trimmedPrompt = prompt.Trim();
        if (trimmedName.Length == 0 || trimmedPrompt.Length == 0)
            return;

        await _recipes.SaveAsync(new ChatRecipe
        {
            Id = Guid.NewGuid(),
            Name = trimmedName,
            Prompt = trimmedPrompt,
            Availability = multiple ? ChatRecipe.MultipleAvailability : ChatRecipe.SingleAvailability,
            CreatedAt = DateTimeOffset.Now,
        });
        await RefreshRecipesAsync();
    }

    public async Task DeleteRecipeAsync(Guid id)
    {
        if (ChatRecipeList.IsBuiltIn(id))
            return;

        await _recipes.DeleteAsync(id);
        await RefreshRecipesAsync();
    }

    [RelayCommand]
    private void CopyMessage(ChatMessageItem? item)
    {
        if (item is null || string.IsNullOrWhiteSpace(item.Text))
            return;

        try
        {
            var package = new DataPackage();
            package.SetText(item.Text);
            Clipboard.SetContent(package);
        }
        catch (Exception ex)
        {
            ShowError(AppStrings.Format("Chat_CopyFailed", ex.Message));
        }
    }

    private bool CanSend() => !IsSending && IsVisible && !string.IsNullOrWhiteSpace(Draft);

    private async void OnWorkspaceScopeChanged(object? sender, EventArgs e)
    {
        try
        {
            await RefreshScopeAsync();
        }
        catch (Exception ex)
        {
            ShowError(AppStrings.Format("Chat_SendFailed", ex.Message));
        }
    }

    private async Task RefreshScopeAsync()
    {
        var generation = Interlocked.Increment(ref _scopeGeneration);
        var workspace = AppServices.Workspace;
        var decision = ChatScopeResolver.Resolve(
            ChatScopeResolver.ParseSurface(workspace.CurrentShellTag),
            workspace.IsCaptureActive,
            workspace.SelectedFolderId,
            workspace.SelectedMeetingId);
        var label = await BuildScopeLabelAsync(decision);
        await RefreshPersonalTasksAvailabilityAsync();
        if (generation != _scopeGeneration)
            return;

        var scopeChanged = decision.Kind != _decision.Kind
            || decision.FolderId != _decision.FolderId
            || decision.MeetingId != _decision.MeetingId;

        _decision = decision;
        IsVisible = decision.IsVisible;
        if (scopeChanged)
            IsExpanded = false;
        ScopeLabel = label;
        ScopeGlyph = ScopeGlyphFor(decision.Kind);
        OnPropertyChanged(nameof(PrefersMultipleRecipes));
        OnPropertyChanged(nameof(ShowPersonalTasksRecipe));
        OnPropertyChanged(nameof(CurrentMeetingId));
        if (!IsSending)
            UpdateMismatch();
        await RefreshRecipesAsync();
        SendCommand.NotifyCanExecuteChanged();
    }

    private async Task RefreshPersonalTasksAvailabilityAsync()
    {
        var settings = await AppServices.Settings.LoadAsync();
        var credentials = AppServices.TypeSafeCredentials.Load();
        _personalTasksAvailable = settings.TypeSafeEnabled
            && credentials is not null
            && !string.IsNullOrWhiteSpace(credentials.ApiKey);
    }

    private async Task<string> BuildScopeLabelAsync(ChatScopeDecision decision)
    {
        if (!decision.IsVisible)
            return string.Empty;

        switch (decision.Kind)
        {
            case ChatScopeKind.Live:
                return AppStrings.Get("Chat_ScopeLive");
            case ChatScopeKind.Meeting:
                var meeting = decision.MeetingId is { } meetingId
                    ? await _meetings.GetByIdAsync(meetingId)
                    : null;
                return string.IsNullOrWhiteSpace(meeting?.Title)
                    ? AppStrings.Get("Chat_ScopeMeeting")
                    : AppStrings.Format("Chat_ScopeMeetingNamed", meeting.Title);
            case ChatScopeKind.Folder:
                var folder = decision.FolderId is { } folderId
                    ? await _folders.GetByIdAsync(folderId)
                    : null;
                return string.IsNullOrWhiteSpace(folder?.Name)
                    ? AppStrings.Get("Chat_ScopeFolder")
                    : AppStrings.Format("Chat_ScopeFolderNamed", folder.Name);
            default:
                return AppStrings.Get("Chat_ScopeAll");
        }
    }

    private static string ScopeGlyphFor(ChatScopeKind kind) => kind switch
    {
        ChatScopeKind.Live => "",
        ChatScopeKind.Meeting => "",
        ChatScopeKind.Folder => "",
        _ => "",
    };

    private async Task PersistTurnAsync(
        ChatThread? open,
        ChatScopeDecision decision,
        string userMessage,
        string answer)
    {
        var now = DateTimeOffset.Now;
        var snapshot = open?.Messages.ToList();
        var thread = open ?? new ChatThread
        {
            Id = Guid.NewGuid(),
            Title = TitleOrUntitled(userMessage),
            CreatedAt = now,
            UpdatedAt = now,
            ScopeKind = decision.Kind,
            FolderId = decision.FolderId,
            MeetingId = decision.MeetingId,
            Messages = [],
        };

        try
        {
            thread.Messages.Add(new ChatMessage
            {
                Id = Guid.NewGuid(),
                Role = ChatMessage.UserRole,
                Text = userMessage,
                CreatedAt = now,
            });
            thread.Messages.Add(new ChatMessage
            {
                Id = Guid.NewGuid(),
                Role = ChatMessage.AssistantRole,
                Text = answer.Trim(),
                CreatedAt = now,
            });
            thread.UpdatedAt = now;
            await _threads.SaveAsync(thread);
        }
        catch
        {
            if (open is not null && snapshot is not null)
                open.Messages = snapshot;
            throw;
        }

        _openThread = thread;
        ShowMessages(thread.Messages);
        UpdateMismatch();
        await RefreshThreadsAsync();
    }

    private async Task RefreshRecipesAsync()
    {
        if (!_decision.IsVisible)
        {
            _scopeRecipes = [];
            RefreshStarterRecipes();
            ApplyRecipeFilter(null);
            return;
        }

        var user = await _recipes.GetAllAsync();
        _scopeRecipes = ChatRecipeList.ForScope(_decision.Kind, user)
            .Select(ToRecipeItem)
            .ToList();
        RefreshStarterRecipes();
        var query = _forceAllRecipes || !Draft.StartsWith('/')
            ? null
            : Draft[1..].Trim();
        ApplyRecipeFilter(query);
    }

    private void ApplyRecipeFilter(string? query)
    {
        IEnumerable<ChatRecipeItem> source = _scopeRecipes;
        if (!string.IsNullOrWhiteSpace(query))
        {
            source = source.Where(item =>
                item.Name.Contains(query, StringComparison.CurrentCultureIgnoreCase)
                || item.Prompt.Contains(query, StringComparison.CurrentCultureIgnoreCase));
        }

        RecipeSuggestions.Clear();
        foreach (var item in source)
            RecipeSuggestions.Add(item);
        HasRecipeSuggestions = RecipeSuggestions.Count > 0;
    }

    private void RefreshStarterRecipes()
    {
        StarterRecipes.Clear();
        foreach (var item in _scopeRecipes.Take(StarterRecipeCount))
            StarterRecipes.Add(item);
        UpdateStarterVisibility();
    }

    private void UpdateStarterVisibility() =>
        ShowStarterRecipes = StarterRecipes.Count > 0 && !HasMessages && !IsSending;

    private void ShowMessages(IEnumerable<ChatMessage> messages)
    {
        Messages.Clear();
        foreach (var message in messages)
            Messages.Add(ToMessageItem(message));
        HasMessages = Messages.Count > 0;
    }

    private (ChatMessageItem User, ChatMessageItem Pending) AddOptimisticTurn(string userMessage)
    {
        var user = new ChatMessageItem
        {
            Id = Guid.NewGuid(),
            Role = ChatMessage.UserRole,
            Text = userMessage,
            RoleLabel = AppStrings.Get("Chat_RoleUser"),
        };
        var pending = new ChatMessageItem
        {
            Id = Guid.NewGuid(),
            Role = ChatMessage.AssistantRole,
            Text = string.Empty,
            RoleLabel = AppStrings.Get("Chat_RoleAssistant"),
            IsAssistant = true,
            IsPending = true,
        };
        Messages.Add(user);
        Messages.Add(pending);
        HasMessages = true;
        return (user, pending);
    }

    // A successful turn rebuilds Messages, so the optimistic rows are only still present after a failure.
    private void RollBackOptimisticTurn(ChatMessageItem user, ChatMessageItem pending, string originalDraft)
    {
        Messages.Remove(pending);
        if (!Messages.Remove(user))
            return;

        HasMessages = Messages.Count > 0;
        if (string.IsNullOrEmpty(Draft))
            Draft = originalDraft;
    }

    private void UpdateMismatch()
    {
        ShowScopeMismatch = _openThread is not null
            && _decision.IsVisible
            && !ChatScopeResolver.MatchesOpenThread(_openThread, _decision);
    }

    private void ShowError(string message)
    {
        ErrorMessage = message;
        IsErrorOpen = true;
    }

    private void ClearError()
    {
        ErrorMessage = string.Empty;
        IsErrorOpen = false;
    }

    private static string TitleOrUntitled(string userMessage)
    {
        var title = ChatThreadTitle.FromFirstMessage(userMessage);
        return title.Length == 0 ? AppStrings.Get("Chat_Untitled") : title;
    }

    private static ChatMessageItem ToMessageItem(ChatMessage message)
    {
        var isAssistant = string.Equals(message.Role, ChatMessage.AssistantRole, StringComparison.Ordinal);
        return new ChatMessageItem
        {
            Id = message.Id,
            Role = message.Role,
            Text = message.Text,
            RoleLabel = AppStrings.Get(isAssistant ? "Chat_RoleAssistant" : "Chat_RoleUser"),
            IsAssistant = isAssistant,
        };
    }

    private static ChatRecipeItem ToRecipeItem(ChatRecipe recipe) => new()
    {
        Id = recipe.Id,
        Name = recipe.Name,
        Prompt = recipe.Prompt,
        IsBuiltIn = ChatRecipeList.IsBuiltIn(recipe.Id),
    };

    private static Task InvokeOnUiAsync(Func<Task> action)
    {
        var queue = App.DispatcherQueue;
        if (queue is null)
            return Task.FromException(new InvalidOperationException(AppStrings.Get("Chat_UiMarshalFailed")));

        var completion = new TaskCompletionSource();
        if (!queue.TryEnqueue(async () =>
        {
            try
            {
                await action();
                completion.TrySetResult();
            }
            catch (Exception ex)
            {
                completion.TrySetException(ex);
            }
        }))
        {
            completion.TrySetException(new InvalidOperationException(AppStrings.Get("Chat_UiMarshalFailed")));
        }

        return completion.Task;
    }

    partial void OnIsExpandedChanged(bool value)
    {
        if (value)
            _ = RefreshPersonalTasksGateAsync();
    }

    private async Task RefreshPersonalTasksGateAsync()
    {
        try
        {
            await RefreshPersonalTasksAvailabilityAsync();
            OnPropertyChanged(nameof(ShowPersonalTasksRecipe));
        }
        catch (Exception ex)
        {
            ShowError(AppStrings.Format("Chat_SendFailed", ex.Message));
        }
    }

    partial void OnIsSendingChanged(bool value)
    {
        SendCommand.NotifyCanExecuteChanged();
        UpdateStarterVisibility();
    }

    partial void OnHasMessagesChanged(bool value) => UpdateStarterVisibility();

    partial void OnIsVisibleChanged(bool value) => SendCommand.NotifyCanExecuteChanged();

    partial void OnDraftChanged(string value) => SendCommand.NotifyCanExecuteChanged();
}
