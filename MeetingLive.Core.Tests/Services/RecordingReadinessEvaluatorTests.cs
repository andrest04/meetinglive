using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class RecordingReadinessEvaluatorTests
{
    [Fact]
    public void Evaluate_WhenLiveOnAndEverythingReady_CanRecord()
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: true,
            engineReady: true,
            summaryProviderChosen: true,
            localSummarySelected: true,
            localModelDownloaded: true,
            cliOnPath: false);

        Assert.Equal(new RecordingReadiness(
            LiveRequired: true,
            LiveReady: true,
            EngineReady: true,
            SummaryReady: true,
            CanRecord: true), readiness);
    }

    [Fact]
    public void Evaluate_WhenLiveOffAndEngineMissing_CannotRecord()
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: false,
            engineReady: false,
            summaryProviderChosen: true,
            localSummarySelected: true,
            localModelDownloaded: true,
            cliOnPath: false);

        Assert.False(readiness.LiveRequired);
        Assert.False(readiness.EngineReady);
        Assert.True(readiness.SummaryReady);
        Assert.False(readiness.CanRecord);
    }

    [Fact]
    public void Evaluate_WhenLiveOffAndEngineReady_CanRecord()
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: false,
            engineReady: true,
            summaryProviderChosen: true,
            localSummarySelected: true,
            localModelDownloaded: true,
            cliOnPath: false);

        Assert.False(readiness.LiveRequired);
        Assert.True(readiness.EngineReady);
        Assert.True(readiness.CanRecord);
    }

    [Fact]
    public void Evaluate_WhenLiveOnAndEngineMissing_CannotRecord()
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: true,
            engineReady: false,
            summaryProviderChosen: true,
            localSummarySelected: true,
            localModelDownloaded: true,
            cliOnPath: false);

        Assert.True(readiness.LiveRequired);
        Assert.False(readiness.LiveReady);
        Assert.False(readiness.CanRecord);
    }

    [Fact]
    public void Evaluate_WhenSummaryProviderUnset_CannotRecord()
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveTranscriptionEnabled: true,
            engineReady: true,
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
            engineReady: true,
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
            engineReady: true,
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
            engineReady: true,
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
            engineReady: true,
            summaryProviderChosen: true,
            localSummarySelected: false,
            localModelDownloaded: false,
            cliOnPath: true);

        Assert.True(readiness.SummaryReady);
        Assert.True(readiness.CanRecord);
    }

    [Theory]
    [InlineData(true, true, true, true, true, false, true)]
    [InlineData(true, false, true, true, true, false, false)]
    [InlineData(false, false, true, true, true, false, false)]
    [InlineData(false, true, true, true, true, false, true)]
    [InlineData(true, true, false, false, false, false, false)]
    [InlineData(true, true, true, true, false, false, false)]
    [InlineData(true, true, true, false, false, false, false)]
    [InlineData(true, true, true, false, false, true, true)]
    public void Evaluate_CanRecord_MatchesRequiredGates(
        bool liveOn,
        bool engineReady,
        bool summaryChosen,
        bool localSelected,
        bool localDownloaded,
        bool cliOnPath,
        bool expectedCanRecord)
    {
        var readiness = RecordingReadinessEvaluator.Evaluate(
            liveOn, engineReady, summaryChosen, localSelected, localDownloaded, cliOnPath);

        Assert.Equal(expectedCanRecord, readiness.CanRecord);
        Assert.Equal(engineReady && readiness.SummaryReady, readiness.CanRecord);
    }
}
