using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class MeetingRetranscriptionTests
{
    private static readonly DateTimeOffset RecordedAt = new(2026, 10, 1, 22, 36, 0, TimeSpan.Zero);

    [Fact]
    public void Evaluate_AudioExistsAndIdle_IsAvailable()
    {
        var result = MeetingRetranscription.Evaluate(Meeting(), isBusy: false, fileExists: _ => true);

        Assert.Equal(RetranscriptionAvailability.Available, result);
    }

    [Fact]
    public void Evaluate_AudioFileMissing_IsNoAudio()
    {
        var result = MeetingRetranscription.Evaluate(Meeting(), isBusy: false, fileExists: _ => false);

        Assert.Equal(RetranscriptionAvailability.NoAudio, result);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void Evaluate_BlankAudioPath_IsNoAudioWithoutProbingTheDisk(string audioPath)
    {
        var probed = false;

        var result = MeetingRetranscription.Evaluate(
            Meeting(audioPath), isBusy: false, fileExists: _ => probed = true);

        Assert.Equal(RetranscriptionAvailability.NoAudio, result);
        Assert.False(probed);
    }

    [Fact]
    public void Evaluate_NullRecord_IsNoAudio()
    {
        var result = MeetingRetranscription.Evaluate(null, isBusy: false, fileExists: _ => true);

        Assert.Equal(RetranscriptionAvailability.NoAudio, result);
    }

    [Fact]
    public void Evaluate_AudioExistsButBusy_IsBusy()
    {
        var result = MeetingRetranscription.Evaluate(Meeting(), isBusy: true, fileExists: _ => true);

        Assert.Equal(RetranscriptionAvailability.Busy, result);
    }

    [Fact]
    public void Evaluate_ChecksTheRecordedAudioPath()
    {
        string? probed = null;

        MeetingRetranscription.Evaluate(Meeting(@"C:\audio\a.wav"), isBusy: false, fileExists: path =>
        {
            probed = path;
            return true;
        });

        Assert.Equal(@"C:\audio\a.wav", probed);
    }

    [Fact]
    public void CreateRequest_DropsLiveDraftSoTheOfflinePassBecomesTheTranscript()
    {
        var record = Meeting();
        record.Transcript = "old transcript";

        var request = MeetingRetranscription.CreateRequest(record);

        Assert.Null(request.LiveDraft);
        Assert.Equal(record.Id, request.MeetingId);
        Assert.Equal(record.AudioFilePath, request.AudioPath);
        Assert.Equal(record.RecordedAt, request.RecordedAt);
        Assert.Equal(record.Title, request.Title);
    }

    [Fact]
    public void CreateRequest_KeepsMeetingContextSoTheSavedRecordDoesNotLoseIt()
    {
        var folderId = Guid.NewGuid();
        var endedAt = RecordedAt.AddMinutes(30);
        var record = Meeting();
        record.EndedAt = endedAt;
        record.FolderId = folderId;
        record.CalendarEventId = "evt";
        record.CalendarId = "cal";
        record.SeriesId = "series";
        record.JoinUrl = "https://meet.example/x";
        record.Attendees = ["Ana", "Luis"];
        record.Brief = "brief";
        record.NoteTemplateId = "template-1";

        var request = MeetingRetranscription.CreateRequest(record, "template instructions");

        Assert.Equal(endedAt, request.EndedAt);
        Assert.Equal(folderId, request.FolderId);
        Assert.Equal("evt", request.CalendarEventId);
        Assert.Equal("cal", request.CalendarId);
        Assert.Equal("series", request.SeriesId);
        Assert.Equal("https://meet.example/x", request.JoinUrl);
        Assert.Equal(["Ana", "Luis"], request.Attendees);
        Assert.Equal("brief", request.Brief);
        Assert.Equal("template-1", request.NoteTemplateId);
        Assert.Equal("template instructions", request.TemplateInstructions);
    }

    [Fact]
    public void CreateRequest_MissingEndedAt_UsesDefaultSoThePipelineTreatsItAsUnknown()
    {
        var request = MeetingRetranscription.CreateRequest(Meeting());

        Assert.Equal(default, request.EndedAt);
    }

    private static MeetingRecord Meeting(string audioPath = @"C:\audio\take.wav") => new()
    {
        Id = Guid.NewGuid(),
        Title = "Weekly sync",
        RecordedAt = RecordedAt,
        AudioFilePath = audioPath,
    };
}
