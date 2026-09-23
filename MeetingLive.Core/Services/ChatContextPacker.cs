using System.Globalization;
using System.Text;
using MeetingLive.Core.Models;
using MeetingLive.Core.Strings;

namespace MeetingLive.Core.Services;

/// <summary>
/// Builds the only meeting text a chat model is allowed to see.
/// Never reads <see cref="MeetingRecord.JevAnalysis"/> or local audio paths.
/// Transcripts are included only for <see cref="ChatScopeKind.Live"/> and
/// <see cref="ChatScopeKind.Meeting"/>, and only as a tail.
/// </summary>
public static class ChatContextPacker
{
    public const int LiveTranscriptMaxChars = 2500;
    public const int MeetingTranscriptMaxChars = 6000;
    public const int SummaryMaxChars = 800;
    public const int NotesMaxChars = 400;
    public const int MeetingCap = 12;

    public static string LiveTranscriptEmptyMessage => CoreStrings.Get("ChatLiveTranscriptEmpty");
    public static string MeetingNotFoundMessage => CoreStrings.Get("ChatMeetingNotFound");
    public static string TranscriptEmptyMessage => CoreStrings.Get("ChatTranscriptEmpty");
    public static string FolderNotSelectedMessage => CoreStrings.Get("ChatFolderNotSelected");
    public static string FolderNotFoundMessage => CoreStrings.Get("ChatFolderNotFound");
    public static string NoMeetingsInFolderMessage => CoreStrings.Get("ChatNoMeetingsInFolder");
    public static string NoMeetingsSavedMessage => CoreStrings.Get("ChatNoMeetingsSaved");

    public static string Pack(
        ChatScopeKind scopeKind,
        Guid? folderId,
        Guid? meetingId,
        string? liveTranscript,
        IReadOnlyList<MeetingRecord> meetings,
        IReadOnlyList<FolderRecord> folders)
    {
        ArgumentNullException.ThrowIfNull(meetings);
        ArgumentNullException.ThrowIfNull(folders);

        return scopeKind switch
        {
            ChatScopeKind.Live => PackLive(liveTranscript),
            ChatScopeKind.Meeting => PackMeeting(meetingId, meetings),
            ChatScopeKind.Folder => PackMany(scopeKind, folderId, meetings, folders),
            ChatScopeKind.AllMeetings => PackMany(scopeKind, folderId, meetings, folders),
            _ => throw new ArgumentOutOfRangeException(nameof(scopeKind), scopeKind, "Unknown chat scope."),
        };
    }

    private static string PackLive(string? liveTranscript)
    {
        if (string.IsNullOrWhiteSpace(liveTranscript))
            return LiveTranscriptEmptyMessage;

        var tail = Tail(liveTranscript, LiveTranscriptMaxChars);
        return "Live transcript:" + Environment.NewLine + tail;
    }

    private static string PackMeeting(Guid? meetingId, IReadOnlyList<MeetingRecord> meetings)
    {
        var meeting = meetingId is null
            ? null
            : meetings.FirstOrDefault(candidate => candidate.Id == meetingId);
        if (meeting is null)
            return MeetingNotFoundMessage;

        var builder = new StringBuilder();
        AppendSharedFields(builder, meeting, summaryMaxChars: int.MaxValue, notesMaxChars: int.MaxValue);
        AppendTranscript(builder, meeting.Transcript, MeetingTranscriptMaxChars);
        return builder.ToString().TrimEnd();
    }

    private static string PackMany(
        ChatScopeKind scopeKind,
        Guid? folderId,
        IReadOnlyList<MeetingRecord> meetings,
        IReadOnlyList<FolderRecord> folders)
    {
        var builder = new StringBuilder();
        if (scopeKind == ChatScopeKind.Folder)
        {
            if (folderId is null)
                return FolderNotSelectedMessage;

            AppendFolderHeader(builder, folderId.Value, folders);
        }
        else
        {
            builder.AppendLine("All meetings:");
        }

        var matching = Matching(scopeKind, folderId, meetings).ToList();
        var selected = matching
            .OrderByDescending(meeting => meeting.RecordedAt)
            .ThenByDescending(meeting => meeting.Id)
            .Take(MeetingCap)
            .ToList();
        if (selected.Count == 0)
        {
            builder.Append(scopeKind == ChatScopeKind.Folder
                ? NoMeetingsInFolderMessage
                : NoMeetingsSavedMessage);
            return builder.ToString().TrimEnd();
        }

        if (selected.Count < matching.Count)
        {
            builder.Append("Showing the ")
                .Append(MeetingCap)
                .Append(" most recent of ")
                .Append(matching.Count)
                .AppendLine(" meetings. Older meetings were omitted.");
        }

        for (var i = 0; i < selected.Count; i++)
        {
            if (i > 0)
                builder.AppendLine();
            AppendSharedFields(builder, selected[i], SummaryMaxChars, NotesMaxChars);
        }

        return builder.ToString().TrimEnd();
    }

    private static void AppendFolderHeader(StringBuilder builder, Guid folderId, IReadOnlyList<FolderRecord> folders)
    {
        var folder = folders.FirstOrDefault(candidate => candidate.Id == folderId);
        if (folder is null)
        {
            builder.AppendLine(FolderNotFoundMessage);
            return;
        }

        builder.Append("Folder: ").AppendLine(folder.Name);
        builder.Append("Note: ").AppendLine(string.IsNullOrWhiteSpace(folder.Note) ? "(none)" : folder.Note);
    }

    private static IEnumerable<MeetingRecord> Matching(
        ChatScopeKind scopeKind,
        Guid? folderId,
        IReadOnlyList<MeetingRecord> meetings)
    {
        if (scopeKind == ChatScopeKind.AllMeetings)
            return meetings;

        if (folderId is null)
            return [];

        return meetings.Where(meeting => meeting.FolderId == folderId);
    }

    private static void AppendSharedFields(
        StringBuilder builder,
        MeetingRecord meeting,
        int summaryMaxChars,
        int notesMaxChars)
    {
        builder.Append("Title: ").AppendLine(meeting.Title);
        builder.Append("Recorded: ")
            .AppendLine(meeting.RecordedAt.ToString("O", CultureInfo.InvariantCulture));
        builder.Append("Summary: ").AppendLine(CapPrefix(meeting.Summary, summaryMaxChars));
        AppendActionItems(builder, meeting.ActionItems);
        builder.Append("Notes: ").AppendLine(CapPrefix(meeting.Notes, notesMaxChars));
    }

    private static void AppendActionItems(StringBuilder builder, IReadOnlyList<ActionItem>? items)
    {
        var texts = items?
            .Where(item => item is not null && !string.IsNullOrWhiteSpace(item.Text))
            .ToList() ?? [];
        builder.AppendLine("Action items:");
        if (texts.Count == 0)
        {
            builder.AppendLine("(none)");
            return;
        }

        foreach (var item in texts)
        {
            var mark = item.IsDone ? "x" : " ";
            var text = item.Text.ReplaceLineEndings(" ");
            builder.Append("- [").Append(mark).Append("] ").AppendLine(text);
        }
    }

    private static void AppendTranscript(StringBuilder builder, string? transcript, int maxChars)
    {
        var tail = Tail(transcript, maxChars);
        if (tail is null)
        {
            builder.AppendLine(TranscriptEmptyMessage);
            return;
        }

        builder.AppendLine("Transcript:");
        builder.AppendLine(tail);
    }

    private static string CapPrefix(string? value, int maxChars)
    {
        if (string.IsNullOrWhiteSpace(value))
            return "(none)";

        return value.Length <= maxChars ? value : value[..maxChars];
    }

    private static string? Tail(string? value, int maxChars)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        return value.Length <= maxChars ? value : value[^maxChars..];
    }
}
