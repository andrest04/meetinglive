namespace MeetingLive_App.ViewModels;

/// <summary>Steps of the guided local-model setup wizard shown in <c>SummaryModelSetupDialog</c>.</summary>
public enum SummaryModelWizardState
{
    ChoosingEngine,
    DetectingHardware,
    SelectingModel,
    Downloading,
    CheckingCli,
    Completed,
}
