using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using MeetingLive_App.Services;
using MeetingLive_App.ViewModels;

namespace MeetingLive_App.Dialogs;

/// <summary>
/// Step-by-step Record checklist. Primary runs missing installs (parent closes first —
/// WinUI allows only one ContentDialog at a time). Close/Cancel means do not record.
/// </summary>
public sealed partial class RecordingSetupDialog : ContentDialog
{
    public RecordingSetupDialogViewModel ViewModel { get; } = new();

    public RecordingSetupDialog()
    {
        InitializeComponent();
    }

    public void Apply(RecordingSetupSnapshot snapshot)
    {
        ViewModel.Apply(snapshot);
        IsPrimaryButtonEnabled = !snapshot.Readiness.CanRecord;
        PrimaryButtonText = snapshot.Readiness.CanRecord
            ? AppStrings.Get("RecordingSetup_Done")
            : AppStrings.Get("RecordingSetup_SetUp");
        DefaultButton = snapshot.Readiness.CanRecord
            ? ContentDialogButton.Close
            : ContentDialogButton.Primary;
    }
}
