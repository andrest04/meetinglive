using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class RecordingPipelineRulesTests
{
    private const string Audio = @"C:\meetings\take.wav";

    [Fact]
    public void ShouldSaveBeforeTranscribing_NewTakeWithoutDraft_SavesSoAFailedPassKeepsTheAudio()
    {
        Assert.True(RecordingPipelineRules.ShouldSaveBeforeTranscribing(
            liveDraft: null, existingAudioPath: null, Audio));
    }

    [Fact]
    public void ShouldSaveBeforeTranscribing_TakeWithDraft_Saves()
    {
        Assert.True(RecordingPipelineRules.ShouldSaveBeforeTranscribing(
            liveDraft: "hello", existingAudioPath: Audio, Audio));
    }

    [Fact]
    public void ShouldSaveBeforeTranscribing_LinkedMeetingWithOtherAudio_SavesSoTheNewAudioIsNotOrphaned()
    {
        Assert.True(RecordingPipelineRules.ShouldSaveBeforeTranscribing(
            liveDraft: "  ", existingAudioPath: @"C:\meetings\older.wav", Audio));
    }

    [Fact]
    public void ShouldSaveBeforeTranscribing_RetranscribeOfSavedAudio_LeavesThePreviousTranscriptAlone()
    {
        Assert.False(RecordingPipelineRules.ShouldSaveBeforeTranscribing(
            liveDraft: null, existingAudioPath: Audio.ToUpperInvariant(), Audio));
    }

    [Theory]
    [InlineData(null, "offline", false, TranscriptionStageOutcome.OfflineTranscript)]
    [InlineData("draft", "offline", false, TranscriptionStageOutcome.OfflineTranscript)]
    [InlineData("draft", null, false, TranscriptionStageOutcome.LiveDraft)]
    [InlineData("draft", " ", false, TranscriptionStageOutcome.LiveDraft)]
    [InlineData("draft", null, true, TranscriptionStageOutcome.LiveDraftAfterFailure)]
    [InlineData(null, null, false, TranscriptionStageOutcome.NoTranscript)]
    [InlineData(" ", " ", false, TranscriptionStageOutcome.NoTranscript)]
    [InlineData(null, null, true, TranscriptionStageOutcome.FailedWithoutTranscript)]
    public void ResolveTranscriptionStage_ReportsWhatTheMeetingEndsUpWith(
        string? draft, string? offline, bool failed, TranscriptionStageOutcome expected)
    {
        Assert.Equal(expected, RecordingPipelineRules.ResolveTranscriptionStage(draft, offline, failed));
    }
}
