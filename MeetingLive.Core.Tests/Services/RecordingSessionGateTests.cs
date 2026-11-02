using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class RecordingSessionGateTests
{
    [Fact]
    public void TryBeginStopping_WhileAlreadyStopping_IsRefusedSoTheTakeIsProcessedOnce()
    {
        var gate = Recording();

        Assert.True(gate.TryBeginStopping());

        Assert.False(gate.TryBeginStopping());
        Assert.Equal(RecordingSessionPhase.Stopping, gate.Phase);
    }

    [Fact]
    public void Preparing_BlocksImportAndAnotherStart()
    {
        var gate = new RecordingSessionGate();

        Assert.True(gate.TryBeginPreparing());

        Assert.False(gate.CanImport);
        Assert.False(gate.CanToggle);
        Assert.False(gate.TryBeginPreparing());
    }

    [Fact]
    public void Stopping_BlocksToggleDiscardPauseAndImport()
    {
        var gate = Recording();

        gate.TryBeginStopping();

        Assert.False(gate.CanToggle);
        Assert.False(gate.CanControlCapture);
        Assert.False(gate.CanImport);
    }

    [Fact]
    public void Recording_AllowsStopAndCaptureControlsButNotImport()
    {
        var gate = Recording();

        Assert.True(gate.CanToggle);
        Assert.True(gate.CanControlCapture);
        Assert.False(gate.CanImport);
    }

    [Fact]
    public void CancelPreparing_AfterRecordingStarted_LeavesRecordingPhase()
    {
        var gate = Recording();

        Assert.False(gate.CancelPreparing());

        Assert.Equal(RecordingSessionPhase.Recording, gate.Phase);
    }

    [Fact]
    public void CancelPreparing_WhenStartIsAbandoned_ReturnsToIdle()
    {
        var gate = new RecordingSessionGate();
        gate.TryBeginPreparing();

        Assert.True(gate.CancelPreparing());

        Assert.Equal(RecordingSessionPhase.Idle, gate.Phase);
        Assert.True(gate.CanImport);
    }

    [Fact]
    public void Import_GoesFromPreparingToProcessingToIdle()
    {
        var gate = new RecordingSessionGate();
        gate.TryBeginPreparing();

        Assert.True(gate.MarkProcessing());
        Assert.False(gate.CanToggle);
        Assert.True(gate.MarkIdle());

        Assert.Equal(RecordingSessionPhase.Idle, gate.Phase);
    }

    [Fact]
    public void Stop_GoesFromStoppingToProcessing()
    {
        var gate = Recording();
        gate.TryBeginStopping();

        Assert.True(gate.MarkProcessing());

        Assert.Equal(RecordingSessionPhase.Processing, gate.Phase);
    }

    [Fact]
    public void Discard_GoesFromStoppingToIdle()
    {
        var gate = Recording();
        gate.TryBeginStopping();

        Assert.True(gate.MarkIdle());

        Assert.Equal(RecordingSessionPhase.Idle, gate.Phase);
    }

    [Theory]
    [InlineData(RecordingSessionPhase.Idle)]
    [InlineData(RecordingSessionPhase.Preparing)]
    [InlineData(RecordingSessionPhase.Processing)]
    public void TryBeginStopping_WhenNotRecording_IsRefused(RecordingSessionPhase phase)
    {
        var gate = InPhase(phase);

        Assert.False(gate.TryBeginStopping());
        Assert.Equal(phase, gate.Phase);
    }

    [Fact]
    public void MarkIdle_WhileRecording_IsRefusedSoALateCallbackCannotEndTheNextTake()
    {
        var gate = Recording();

        Assert.False(gate.MarkIdle());

        Assert.Equal(RecordingSessionPhase.Recording, gate.Phase);
    }

    [Theory]
    [InlineData(RecordingSessionPhase.Recording, true)]
    [InlineData(RecordingSessionPhase.Idle, false)]
    [InlineData(RecordingSessionPhase.Preparing, false)]
    [InlineData(RecordingSessionPhase.Stopping, false)]
    [InlineData(RecordingSessionPhase.Processing, false)]
    public void RequiresCloseConfirmation_OnlyWhileATakeIsBeingCaptured(RecordingSessionPhase phase, bool expected)
    {
        Assert.Equal(expected, InPhase(phase).RequiresCloseConfirmation);
    }

    private static RecordingSessionGate Recording() => InPhase(RecordingSessionPhase.Recording);

    private static RecordingSessionGate InPhase(RecordingSessionPhase phase)
    {
        var gate = new RecordingSessionGate();
        if (phase == RecordingSessionPhase.Idle)
            return gate;

        gate.TryBeginPreparing();
        if (phase == RecordingSessionPhase.Preparing)
            return gate;

        if (phase == RecordingSessionPhase.Processing)
        {
            gate.MarkProcessing();
            return gate;
        }

        gate.MarkRecording();
        if (phase == RecordingSessionPhase.Stopping)
            gate.TryBeginStopping();
        return gate;
    }
}
