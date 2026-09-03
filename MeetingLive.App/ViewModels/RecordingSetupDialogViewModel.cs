using CommunityToolkit.Mvvm.ComponentModel;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>Checklist of Record prerequisites shown in <c>RecordingSetupDialog</c>.</summary>
public partial class RecordingSetupDialogViewModel : ObservableObject
{
    [ObservableProperty]
    private string _liveStatusText = string.Empty;

    [ObservableProperty]
    private string _liveDetailText = string.Empty;

    [ObservableProperty]
    private string _engineStatusText = string.Empty;

    [ObservableProperty]
    private string _engineDetailText = string.Empty;

    [ObservableProperty]
    private string _summaryStatusText = string.Empty;

    [ObservableProperty]
    private string _summaryDetailText = string.Empty;

    [ObservableProperty]
    private bool _canRecord;

    public void Apply(RecordingSetupSnapshot snapshot)
    {
        CanRecord = snapshot.Readiness.CanRecord;
        LiveStatusText = snapshot.LiveStatusText;
        LiveDetailText = snapshot.LiveDetailText;
        EngineStatusText = snapshot.EngineStatusText;
        EngineDetailText = snapshot.EngineDetailText;
        SummaryStatusText = snapshot.SummaryStatusText;
        SummaryDetailText = snapshot.SummaryDetailText;
    }
}
