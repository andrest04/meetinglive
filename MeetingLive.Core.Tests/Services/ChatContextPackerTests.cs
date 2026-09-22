using System.Globalization;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class ChatContextPackerTests
{
    private static readonly DateTimeOffset Recorded = DateTimeOffset.Parse("2026-09-01T12:00:00Z");

    [Fact]
    public void Pack_LiveScope_UsesLiveTailAndIgnoresSavedTranscript()
    {
        Assert.Equal(2500, ChatContextPacker.LiveTranscriptMaxChars);
        var head = "LIVE_HEAD_MARKER";
        var live = head + new string('b', ChatContextPacker.LiveTranscriptMaxChars) + "LIVE_TAIL_MARKER";
        var expectedTail = live[^ChatContextPacker.LiveTranscriptMaxChars..];
        Assert.DoesNotContain(head, expectedTail);
        var meetingId = Guid.NewGuid();
        var saved = Meeting(
            "Saved session",
            Recorded,
            transcript: "SAVED_MEETING_TRANSCRIPT_SECRET",
            summary: "SAVED_SUMMARY_SECRET");
        saved = WithId(saved, meetingId);

        var packed = Pack(
            ChatScopeKind.Live,
            meetingId: meetingId,
            liveTranscript: live,
            meetings: [saved]);

        Assert.Contains(expectedTail, packed);
        Assert.DoesNotContain(head, packed);
        Assert.DoesNotContain("SAVED_MEETING_TRANSCRIPT_SECRET", packed);
        Assert.DoesNotContain("SAVED_SUMMARY_SECRET", packed);
    }

    [Fact]
    public void Pack_LiveScope_WhenLiveTextEmpty_SaysEmptyAndIgnoresSavedTranscript()
    {
        var saved = Meeting("Saved session", Recorded, transcript: "SAVED_MEETING_TRANSCRIPT_SECRET");

        var packedNull = Pack(ChatScopeKind.Live, meetingId: saved.Id, liveTranscript: null, meetings: [saved]);
        var packedBlank = Pack(ChatScopeKind.Live, meetingId: saved.Id, liveTranscript: "   ", meetings: [saved]);

        Assert.Equal(ChatContextPacker.LiveTranscriptEmptyMessage, packedNull);
        Assert.Equal(ChatContextPacker.LiveTranscriptEmptyMessage, packedBlank);
        Assert.DoesNotContain("SAVED_MEETING_TRANSCRIPT_SECRET", packedNull);
        Assert.DoesNotContain("SAVED_MEETING_TRANSCRIPT_SECRET", packedBlank);
    }

    [Fact]
    public void Pack_FolderScope_DoesNotContainTranscriptBodies()
    {
        const string transcriptSentence = "ZEBRA_TRANSCRIPT_SENTENCE_9f3a";
        var folderId = Guid.NewGuid();
        var meeting = Meeting(
            "Design sync",
            Recorded,
            folderId,
            transcript: transcriptSentence,
            summary: "Shipped the composer",
            notes: "Bring the deck",
            actionItems: [new ActionItem { Text = "Send notes" }]);
        var folder = Folder(folderId, "Design reviews", "Weekly cover");

        var packed = Pack(ChatScopeKind.Folder, folderId, meetings: [meeting], folders: [folder]);

        Assert.Contains("Design sync", packed);
        Assert.Contains("Shipped the composer", packed);
        Assert.Contains("Send notes", packed);
        Assert.Contains("Bring the deck", packed);
        Assert.Contains("Folder: Design reviews", packed);
        Assert.Contains("Note: Weekly cover", packed);
        Assert.DoesNotContain(transcriptSentence, packed);
    }

    [Fact]
    public void Pack_FolderScope_CapsAtTwelveMostRecent()
    {
        Assert.Equal(12, ChatContextPacker.MeetingCap);
        var folderId = Guid.NewGuid();
        var meetings = Enumerable.Range(0, ChatContextPacker.MeetingCap + 1)
            .Select(index => Meeting(
                $"Session {index:00}",
                Recorded.AddDays(index),
                folderId,
                transcript: $"TRANSCRIPT_{index:00}"))
            .ToList();

        var packed = Pack(ChatScopeKind.Folder, folderId, meetings: meetings, folders: [Folder(folderId, "Sprint")]);

        Assert.Contains("Session 12", packed);
        Assert.Contains("Session 01", packed);
        Assert.DoesNotContain("Session 00", packed);
        var newest = packed.IndexOf("Session 12", StringComparison.Ordinal);
        var oldestKept = packed.IndexOf("Session 01", StringComparison.Ordinal);
        Assert.True(newest >= 0 && oldestKept > newest);
    }

    [Fact]
    public void Pack_FolderScope_MatchesExactFolderIdOnly()
    {
        var parentId = Guid.NewGuid();
        var childId = Guid.NewGuid();
        var otherId = Guid.NewGuid();
        var meetings = new[]
        {
            Meeting("Parent session", Recorded, parentId, summary: "PARENT_SUMMARY_TOKEN"),
            Meeting("Child session", Recorded, childId, summary: "CHILD_SUMMARY_TOKEN"),
            Meeting("Other session", Recorded, otherId, summary: "OTHER_SUMMARY_TOKEN"),
            Meeting("Inbox session", Recorded, folderId: null, summary: "INBOX_SUMMARY_TOKEN"),
        };

        var packed = Pack(
            ChatScopeKind.Folder,
            parentId,
            meetings: meetings,
            folders:
            [
                Folder(parentId, "Parent folder"),
                new FolderRecord
                {
                    Id = childId,
                    Name = "Child folder",
                    ParentId = parentId,
                    CreatedAt = Recorded,
                },
            ]);

        Assert.Contains("PARENT_SUMMARY_TOKEN", packed);
        Assert.Contains("Folder: Parent folder", packed);
        Assert.DoesNotContain("CHILD_SUMMARY_TOKEN", packed);
        Assert.DoesNotContain("OTHER_SUMMARY_TOKEN", packed);
        Assert.DoesNotContain("INBOX_SUMMARY_TOKEN", packed);
    }

    [Fact]
    public void Pack_FolderScope_TruncatesSummaryAndNotes()
    {
        Assert.Equal(800, ChatContextPacker.SummaryMaxChars);
        Assert.Equal(400, ChatContextPacker.NotesMaxChars);
        var folderId = Guid.NewGuid();
        var summary = "SUMMARY_HEAD_" + new string('s', ChatContextPacker.SummaryMaxChars);
        var notes = "NOTES_HEAD_" + new string('n', ChatContextPacker.NotesMaxChars);
        var meeting = Meeting("Long notes", Recorded, folderId, summary: summary, notes: notes);

        var packed = Pack(ChatScopeKind.Folder, folderId, meetings: [meeting], folders: [Folder(folderId, "Reviews")]);

        Assert.Contains(summary[..ChatContextPacker.SummaryMaxChars], packed);
        Assert.DoesNotContain(summary, packed);
        Assert.Contains(notes[..ChatContextPacker.NotesMaxChars], packed);
        Assert.DoesNotContain(notes, packed);
    }

    [Fact]
    public void Pack_MeetingScope_IncludesTranscriptTailNotHead()
    {
        Assert.Equal(6000, ChatContextPacker.MeetingTranscriptMaxChars);
        var head = "TRANSCRIPT_HEAD_MARKER";
        var transcript = head + new string('a', ChatContextPacker.MeetingTranscriptMaxChars) + "TRANSCRIPT_TAIL_MARKER";
        var expectedTail = transcript[^ChatContextPacker.MeetingTranscriptMaxChars..];
        Assert.DoesNotContain(head, expectedTail);
        var meeting = Meeting(
            "Sprint review",
            Recorded,
            transcript: transcript,
            summary: "Agreed on the composer",
            notes: "Personal note",
            actionItems: [new ActionItem { Text = "Ship the notes", IsDone = true }]);

        var packed = Pack(ChatScopeKind.Meeting, meetingId: meeting.Id, meetings: [meeting]);

        Assert.Contains("Sprint review", packed);
        Assert.Contains(meeting.RecordedAt.ToString("O", CultureInfo.InvariantCulture), packed);
        Assert.Contains("Agreed on the composer", packed);
        Assert.Contains("Ship the notes", packed);
        Assert.Contains("Personal note", packed);
        Assert.Contains(expectedTail, packed);
        Assert.DoesNotContain(head, packed);
    }

    [Fact]
    public void Pack_MeetingScope_WhenMissing_SaysNotFound()
    {
        var other = Meeting("Unrelated session", Recorded, transcript: "OTHER_TRANSCRIPT_SECRET");

        var packed = Pack(ChatScopeKind.Meeting, meetingId: Guid.NewGuid(), meetings: [other]);

        Assert.Equal(ChatContextPacker.MeetingNotFoundMessage, packed);
        Assert.DoesNotContain("OTHER_TRANSCRIPT_SECRET", packed);
        Assert.DoesNotContain("Unrelated session", packed);
    }

    [Fact]
    public void Pack_MeetingScope_OmitsJevAnalysisAndAudioPath()
    {
        var meeting = Meeting(
            "Reviewed session",
            Recorded,
            summary: "Visible summary",
            audioFilePath: @"C:\secret\audio-path-should-not-leak.wav",
            jev: new MeetingJevAnalysis
            {
                MeetingType = "JEV_SHOULD_NOT_LEAK",
                SuggestedFolderId = "folder-leak-token",
            });

        var packed = Pack(ChatScopeKind.Meeting, meetingId: meeting.Id, meetings: [meeting]);

        Assert.Contains("Visible summary", packed);
        Assert.DoesNotContain("audio-path-should-not-leak", packed);
        Assert.DoesNotContain("JEV_SHOULD_NOT_LEAK", packed);
        Assert.DoesNotContain("folder-leak-token", packed);
    }

    [Fact]
    public void Pack_AllMeetings_CapsAtTwelveAndOmitsTranscripts()
    {
        var meetings = Enumerable.Range(0, ChatContextPacker.MeetingCap + 1)
            .Select(index => Meeting(
                $"Library {index:00}",
                Recorded.AddDays(index),
                folderId: index % 2 == 0 ? Guid.NewGuid() : null,
                transcript: "ALL_MEETINGS_TRANSCRIPT_SECRET",
                summary: $"SUMMARY_{index:00}"))
            .ToList();

        var packed = Pack(ChatScopeKind.AllMeetings, meetings: meetings);

        Assert.Contains("Library 12", packed);
        Assert.Contains("SUMMARY_12", packed);
        Assert.Contains("Library 01", packed);
        Assert.DoesNotContain("Library 00", packed);
        Assert.DoesNotContain("ALL_MEETINGS_TRANSCRIPT_SECRET", packed);
    }

    private static string Pack(
        ChatScopeKind scope,
        Guid? folderId = null,
        Guid? meetingId = null,
        string? liveTranscript = null,
        IReadOnlyList<MeetingRecord>? meetings = null,
        IReadOnlyList<FolderRecord>? folders = null) =>
        ChatContextPacker.Pack(
            scope,
            folderId,
            meetingId,
            liveTranscript,
            meetings ?? [],
            folders ?? []);

    private static MeetingRecord Meeting(
        string title,
        DateTimeOffset recordedAt,
        Guid? folderId = null,
        string? transcript = null,
        string? summary = null,
        string? notes = null,
        IReadOnlyList<ActionItem>? actionItems = null,
        string audioFilePath = "unused.wav",
        MeetingJevAnalysis? jev = null) => new()
    {
        Id = Guid.NewGuid(),
        Title = title,
        RecordedAt = recordedAt,
        AudioFilePath = audioFilePath,
        FolderId = folderId,
        Transcript = transcript,
        Summary = summary,
        Notes = notes,
        ActionItems = actionItems ?? [],
        JevAnalysis = jev,
    };

    private static MeetingRecord WithId(MeetingRecord meeting, Guid id) => new()
    {
        Id = id,
        Title = meeting.Title,
        RecordedAt = meeting.RecordedAt,
        AudioFilePath = meeting.AudioFilePath,
        FolderId = meeting.FolderId,
        Transcript = meeting.Transcript,
        Summary = meeting.Summary,
        Notes = meeting.Notes,
        ActionItems = meeting.ActionItems,
        JevAnalysis = meeting.JevAnalysis,
    };

    private static FolderRecord Folder(Guid id, string name, string? note = null) => new()
    {
        Id = id,
        Name = name,
        Note = note,
        CreatedAt = Recorded,
    };
}
