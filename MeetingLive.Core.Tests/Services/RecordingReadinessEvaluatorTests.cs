using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class RecordingReadinessEvaluatorTests
{
    [Fact]
    public void Evaluate_WhenLiveOnAndEverythingReady_CanRecord()
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: true,
            liveEngineReady: true,
            whisperReady: true,
            summaryProviderChosen: true,
            localSummarySelected: true,
            localModelDownloaded: true,
            cliOnPath: false);

        Assert.Equal(new RecordingReadiness(
            LiveRequired: true,
            LiveReady: true,
            WhisperReady: true,
            SummaryReady: true,
            CanRecord: true), readiness);
    }

    [Fact]
    public void Evaluate_WhenLiveOffAndLiveEngineMissing_CanRecordIfWhisperAndSummaryReady()
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: false,
            liveEngineReady: false,
            whisperReady: true,
            summaryProviderChosen: true,
            localSummarySelected: true,
            localModelDownloaded: true,
            cliOnPath: false);

        Assert.False(readiness.LiveRequired);
        Assert.False(readiness.LiveReady);
        Assert.True(readiness.WhisperReady);
        Assert.True(readiness.SummaryReady);
        Assert.True(readiness.CanRecord);
    }

    [Fact]
    public void Evaluate_WhenLiveOnAndLiveEngineMissing_CannotRecord()
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: true,
            liveEngineReady: false,
            whisperReady: true,
            summaryProviderChosen: true,
            localSummarySelected: true,
            localModelDownloaded: true,
            cliOnPath: false);

        Assert.True(readiness.LiveRequired);
        Assert.False(readiness.LiveReady);
        Assert.False(readiness.CanRecord);
    }

    [Fact]
    public void Evaluate_WhenWhisperMissing_CannotRecord()
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: false,
            liveEngineReady: true,
            whisperReady: false,
            summaryProviderChosen: true,
            localSummarySelected: true,
            localModelDownloaded: true,
            cliOnPath: false);

        Assert.False(readiness.WhisperReady);
        Assert.False(readiness.CanRecord);
    }

    [Fact]
    public void Evaluate_WhenSummaryProviderUnset_CannotRecord()
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: true,
            liveEngineReady: true,
            whisperReady: true,
            summaryProviderChosen: false,
            localSummarySelected: false,
            localModelDownloaded: true,
            cliOnPath: true);

        Assert.False(readiness.SummaryReady);
        Assert.False(readiness.CanRecord);
    }

    [Fact]
    public void Evaluate_WhenLocalSelectedAndModelMissing_CannotRecord()
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: true,
            liveEngineReady: true,
            whisperReady: true,
            summaryProviderChosen: true,
            localSummarySelected: true,
            localModelDownloaded: false,
            cliOnPath: true);

        Assert.False(readiness.SummaryReady);
        Assert.False(readiness.CanRecord);
    }

    [Fact]
    public void Evaluate_WhenLocalSelectedAndModelDownloaded_SummaryReady()
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: true,
            liveEngineReady: true,
            whisperReady: true,
            summaryProviderChosen: true,
            localSummarySelected: true,
            localModelDownloaded: true,
            cliOnPath: false);

        Assert.True(readiness.SummaryReady);
        Assert.True(readiness.CanRecord);
    }

    [Fact]
    public void Evaluate_WhenCliSelectedAndMissingFromPath_CannotRecord()
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: true,
            liveEngineReady: true,
            whisperReady: true,
            summaryProviderChosen: true,
            localSummarySelected: false,
            localModelDownloaded: true,
            cliOnPath: false);

        Assert.False(readiness.SummaryReady);
        Assert.False(readiness.CanRecord);
    }

    [Fact]
    public void Evaluate_WhenCliSelectedAndOnPath_CanRecord()
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: true,
            liveEngineReady: true,
            whisperReady: true,
            summaryProviderChosen: true,
            localSummarySelected: false,
            localModelDownloaded: false,
            cliOnPath: true);

        Assert.True(readiness.SummaryReady);
        Assert.True(readiness.CanRecord);
    }

    [Fact]
    public void Evaluate_WhenLiveOffAndWhisperMissing_CannotRecord()
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: false,
            liveEngineReady: false,
            whisperReady: false,
            summaryProviderChosen: true,
            localSummarySelected: false,
            localModelDownloaded: false,
            cliOnPath: true);

        Assert.False(readiness.LiveRequired);
        Assert.False(readiness.WhisperReady);
        Assert.True(readiness.SummaryReady);
        Assert.False(readiness.CanRecord);
    }

    [Theory]
    [InlineData(true, true, true, true, true, true, false, true)]
    [InlineData(true, false, true, true, true, true, false, false)]
    [InlineData(false, false, true, true, true, true, false, true)]
    [InlineData(true, true, false, true, true, true, false, false)]
    [InlineData(true, true, true, false, false, false, false, false)]
    [InlineData(true, true, true, true, true, false, false, false)]
    [InlineData(true, true, true, true, false, false, false, false)]
    [InlineData(true, true, true, true, false, false, true, true)]
    public void Evaluate_CanRecord_MatchesRequiredGates(
        bool liveOn,
        bool liveReady,
        bool whisperReady,
        bool summaryChosen,
        bool localSelected,
        bool localDownloaded,
        bool cliOnPath,
        bool expectedCanRecord)
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveOn, liveReady, whisperReady, summaryChosen, localSelected, localDownloaded, cliOnPath);

        Assert.Equal(expectedCanRecord, readiness.CanRecord);
        Assert.Equal((!liveOn || liveReady) && whisperReady && readiness.SummaryReady, readiness.CanRecord);
    }
}
