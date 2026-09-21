using CommunityToolkit.Mvvm.ComponentModel;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Bindable wrapper around one <see cref="ActionItem"/>, so the checklist in <c>SummaryPage</c>
/// can two-way bind <see cref="IsDone"/> without adding MVVM attributes to the Core model. Writes
/// straight through to the wrapped <see cref="ActionItem"/> on toggle; <c>SummaryPageViewModel</c>
/// listens for the change (via <see cref="ObservableObject.PropertyChanged"/>) to persist it.
/// </summary>
public sealed partial class ActionItemViewModel : ObservableObject
{
    private readonly ActionItem _model;

    public ActionItemViewModel(ActionItem model, ActionItemVerdict? verdict = null)
    {
        _model = model;
        _isDone = model.IsDone;
        ApplyVerdict(verdict);
    }

    public string Text => _model.Text;

    [ObservableProperty]
    private bool _isDone;

    [ObservableProperty]
    private string _verdictCaption = string.Empty;

    public bool ShowVerdictCaption => !string.IsNullOrEmpty(VerdictCaption);

    partial void OnIsDoneChanged(bool value) => _model.IsDone = value;

    partial void OnVerdictCaptionChanged(string value) =>
        OnPropertyChanged(nameof(ShowVerdictCaption));

    public void ApplyVerdict(ActionItemVerdict? verdict)
    {
        VerdictCaption = ActionItemVerdictDisplay.CaptionKind(verdict) switch
        {
            ActionItemVerdictCaptionKind.Verified => AppStrings.Get("Jev_VerdictVerified"),
            ActionItemVerdictCaptionKind.Conflicts => AppStrings.Get("Jev_VerdictConflicts"),
            ActionItemVerdictCaptionKind.NeedsReview => AppStrings.Get("Jev_VerdictNeedsReview"),
            _ => string.Empty,
        };
    }
}
