using System.Collections.ObjectModel;
using CommunityToolkit.Mvvm.ComponentModel;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>Library browser: nested folders, Inbox, and the meetings in the selected folder.</summary>
public partial class HistoryPageViewModel : ObservableObject
{
    private readonly IMeetingRepository _meetings = AppServices.Meetings;
    private readonly IFolderRepository _folders = AppServices.Folders;

    private List<MeetingRecord> _allMeetings = [];
    private List<FolderRecord> _allFolders = [];
    private HashSet<Guid> _folderIds = [];
    private Guid? _selectedFolderId;
    private Guid? _restoreFolderId;
    private int _inFolderCount;

    [ObservableProperty]
    private bool _isLoading;

    [ObservableProperty]
    private bool _hasMeetings;

    [ObservableProperty]
    private bool _isInboxSelected = true;

    [ObservableProperty]
    private bool _isRealFolderSelected;

    [ObservableProperty]
    private string _folderNote = string.Empty;

    [ObservableProperty]
    private string _searchQuery = string.Empty;

    [ObservableProperty]
    private bool _showLibraryEmpty;

    [ObservableProperty]
    private bool _showInboxEmpty;

    [ObservableProperty]
    private bool _showFolderEmpty;

    [ObservableProperty]
    private bool _isStatusOpen;

    [ObservableProperty]
    private string _statusMessage = string.Empty;

    public ObservableCollection<MeetingRecord> Meetings { get; } = [];

    public ObservableCollection<FolderNode> FolderNodes { get; } = [];

    public ObservableCollection<LibraryBreadcrumbItem> Breadcrumbs { get; } = [];

    public string SelectedFolderName { get; private set; } = string.Empty;

    public bool IsEmpty => !IsLoading && !HasMeetings;

    public async Task LoadAsync()
    {
        IsLoading = true;
        try
        {
            await PersistSelectedFolderNoteAsync();

            _allMeetings = [.. await _meetings.GetAllAsync()];
            _allFolders = [.. await _folders.GetAllAsync()];
            _folderIds = _allFolders.Select(folder => folder.Id).ToHashSet();

            RebuildTree();
            var restoreId = _restoreFolderId ?? _selectedFolderId;
            var node = FindNode(FolderNodes, restoreId) ?? FolderNodes[0];
            ApplySelection(node);
        }
        finally
        {
            IsLoading = false;
        }
    }

    public async Task SelectFolderAsync(FolderNode node)
    {
        ArgumentNullException.ThrowIfNull(node);
        if (node.FolderId == _selectedFolderId)
            return;

        await PersistSelectedFolderNoteAsync();
        ApplySelection(node);
    }

    public async Task SelectFolderByIdAsync(Guid? folderId)
    {
        var node = FindNode(FolderNodes, folderId) ?? FolderNodes[0];
        await SelectFolderAsync(node);
    }

    public async Task PersistSelectedFolderNoteAsync()
    {
        if (_selectedFolderId is not { } id)
            return;

        var folder = _allFolders.FirstOrDefault(item => item.Id == id);
        if (folder is null)
            return;

        var note = string.IsNullOrWhiteSpace(FolderNote) ? null : FolderNote.Trim();
        if (string.Equals(folder.Note, note, StringComparison.Ordinal))
            return;

        folder.Note = note;
        await _folders.SaveAsync(folder);
    }

    public async Task<bool> CreateFolderAsync(string name)
    {
        var trimmed = name.Trim();
        if (trimmed.Length == 0)
            return false;

        await PersistSelectedFolderNoteAsync();
        var folder = new FolderRecord
        {
            Id = Guid.NewGuid(),
            Name = trimmed,
            ParentId = _selectedFolderId,
            ColorKey = FolderAccent.NextKey(_allFolders.Select(folder => folder.ColorKey)),
            CreatedAt = DateTimeOffset.Now,
        };
        await _folders.SaveAsync(folder);
        _restoreFolderId = folder.Id;
        await LoadAsync();
        _restoreFolderId = null;
        return true;
    }

    public async Task<bool> RenameSelectedFolderAsync(string name)
    {
        if (_selectedFolderId is not { } id)
            return false;

        var trimmed = name.Trim();
        if (trimmed.Length == 0)
            return false;

        var folder = _allFolders.FirstOrDefault(item => item.Id == id);
        if (folder is null)
            return false;

        await PersistSelectedFolderNoteAsync();
        folder.Name = trimmed;
        await _folders.SaveAsync(folder);
        _restoreFolderId = id;
        await LoadAsync();
        _restoreFolderId = null;
        return true;
    }

    public async Task<bool> UpdateSelectedFolderPersonalityAsync(string colorKey, string iconKey)
    {
        if (_selectedFolderId is not { } id)
            return false;

        var folder = _allFolders.FirstOrDefault(item => item.Id == id);
        if (folder is null)
            return false;

        await PersistSelectedFolderNoteAsync();
        folder.ColorKey = FolderAccent.ResolveKey(colorKey, id);
        folder.IconKey = FolderIcon.ResolveKey(iconKey);
        await _folders.SaveAsync(folder);
        _restoreFolderId = id;
        await LoadAsync();
        _restoreFolderId = null;
        return true;
    }

    public bool CanDeleteSelectedFolder(out string reason)
    {
        reason = string.Empty;
        if (_selectedFolderId is not { } id)
            return false;

        var hasChildren = _allFolders.Any(folder => folder.ParentId == id);
        var hasMeetings = _allMeetings.Any(meeting => meeting.FolderId == id);
        if (!hasChildren && !hasMeetings)
            return true;

        reason = AppStrings.Get("LibraryDeleteFolder_NotEmpty");
        return false;
    }

    public async Task DeleteSelectedFolderAsync()
    {
        if (_selectedFolderId is not { } id)
            return;

        await _folders.DeleteAsync(id);
        _restoreFolderId = null;
        _selectedFolderId = null;
        await LoadAsync();
    }

    public async Task DeleteAsync(Guid id)
    {
        await _meetings.DeleteAsync(id);
        AppServices.Workspace.NotifyDeleted(id);
        _restoreFolderId = _selectedFolderId;
        await LoadAsync();
        _restoreFolderId = null;
    }

    public async Task MoveMeetingAsync(Guid meetingId, Guid? folderId)
    {
        var record = await _meetings.GetByIdAsync(meetingId);
        if (record is null)
            return;

        record.FolderId = folderId;
        await _meetings.SaveAsync(record);
        _restoreFolderId = _selectedFolderId;
        await LoadAsync();
        _restoreFolderId = null;
    }

    public IReadOnlyList<FolderDestination> GetMoveDestinations() =>
        FolderPathList.Flatten(_allFolders, AppStrings.Get("Library_Inbox"))
            .Select(item => new FolderDestination { FolderId = item.FolderId, Path = item.Path })
            .ToList();

    public void ShowStatus(string message)
    {
        StatusMessage = message;
        IsStatusOpen = true;
    }

    partial void OnSearchQueryChanged(string value) => ApplyMeetingFilter();

    partial void OnIsLoadingChanged(bool value)
    {
        OnPropertyChanged(nameof(IsEmpty));
        RefreshEmptyFlags();
    }

    partial void OnHasMeetingsChanged(bool value) => OnPropertyChanged(nameof(IsEmpty));

    private void ApplySelection(FolderNode node)
    {
        _selectedFolderId = node.FolderId;
        SelectedFolderName = node.Name;
        IsInboxSelected = node.FolderId is null;
        IsRealFolderSelected = node.FolderId is not null;
        FolderNote = node.FolderId is { } id
            ? _allFolders.FirstOrDefault(folder => folder.Id == id)?.Note ?? string.Empty
            : string.Empty;
        RebuildBreadcrumbs(node);
        ApplyMeetingFilter();
    }

    private void RebuildTree()
    {
        FolderNodes.Clear();
        FolderNodes.Add(new FolderNode
        {
            FolderId = null,
            Name = AppStrings.Get("Library_Inbox"),
        });

        var byParent = _allFolders.ToLookup(folder => folder.ParentId);
        var expandIds = new HashSet<Guid>();
        var current = (_restoreFolderId ?? _selectedFolderId) is { } targetId
            ? _allFolders.FirstOrDefault(folder => folder.Id == targetId)
            : null;
        var seen = new HashSet<Guid>();
        while (current?.ParentId is { } parentId && seen.Add(parentId))
        {
            expandIds.Add(parentId);
            current = _allFolders.FirstOrDefault(folder => folder.Id == parentId);
        }

        FolderNode Build(FolderRecord folder)
        {
            var node = new FolderNode
            {
                FolderId = folder.Id,
                Name = folder.Name,
                ColorKey = folder.ColorKey,
                IconKey = folder.IconKey,
                IsExpanded = expandIds.Contains(folder.Id),
            };
            foreach (var child in byParent[folder.Id].OrderBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase))
                node.Children.Add(Build(child));
            return node;
        }

        foreach (var root in byParent[null].OrderBy(item => item.Name, StringComparer.CurrentCultureIgnoreCase))
            FolderNodes.Add(Build(root));
    }

    private void RebuildBreadcrumbs(FolderNode selected)
    {
        Breadcrumbs.Clear();
        Breadcrumbs.Add(new LibraryBreadcrumbItem
        {
            FolderId = null,
            Name = AppStrings.Get("Library_Inbox"),
        });

        if (selected.FolderId is null)
            return;

        var chain = new Stack<FolderRecord>();
        var current = _allFolders.FirstOrDefault(folder => folder.Id == selected.FolderId);
        var seen = new HashSet<Guid>();
        while (current is not null && seen.Add(current.Id))
        {
            chain.Push(current);
            current = current.ParentId is { } parentId
                ? _allFolders.FirstOrDefault(folder => folder.Id == parentId)
                : null;
        }

        while (chain.Count > 0)
        {
            var folder = chain.Pop();
            Breadcrumbs.Add(new LibraryBreadcrumbItem { FolderId = folder.Id, Name = folder.Name });
        }
    }

    private void ApplyMeetingFilter()
    {
        IEnumerable<MeetingRecord> folderMeetings = IsInboxSelected
            ? _allMeetings.Where(IsUnfiled)
            : _allMeetings.Where(meeting => meeting.FolderId == _selectedFolderId);

        var inFolder = folderMeetings.OrderByDescending(meeting => meeting.RecordedAt).ToList();
        var query = SearchQuery.Trim();
        var displayed = string.IsNullOrEmpty(query)
            ? inFolder
            : inFolder.Where(meeting => meeting.Title.Contains(query, StringComparison.OrdinalIgnoreCase)).ToList();

        Meetings.Clear();
        foreach (var meeting in displayed)
            Meetings.Add(meeting);

        HasMeetings = Meetings.Count > 0;
        _inFolderCount = inFolder.Count;
        RefreshEmptyFlags();
    }

    private void RefreshEmptyFlags()
    {
        var inboxEmpty = IsInboxSelected && _inFolderCount == 0;
        ShowLibraryEmpty = !IsLoading && inboxEmpty && _allFolders.Count == 0 && _allMeetings.Count == 0;
        ShowInboxEmpty = !IsLoading && inboxEmpty && !ShowLibraryEmpty;
        ShowFolderEmpty = !IsLoading && !IsInboxSelected && _inFolderCount == 0;
    }

    private bool IsUnfiled(MeetingRecord meeting) =>
        meeting.FolderId is null || !_folderIds.Contains(meeting.FolderId.Value);

    private static FolderNode? FindNode(IEnumerable<FolderNode> nodes, Guid? folderId)
    {
        foreach (var node in nodes)
        {
            if (node.FolderId == folderId)
                return node;

            var child = FindNode(node.Children, folderId);
            if (child is not null)
                return child;
        }

        return null;
    }
}
