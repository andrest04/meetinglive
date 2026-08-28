using CommunityToolkit.Mvvm.ComponentModel;
using MeetingLive.Core.Models;

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

    public ActionItemViewModel(ActionItem model)
    {
        _model = model;
        _isDone = model.IsDone;
    }

    public string Text => _model.Text;

    [ObservableProperty]
    private bool _isDone;

    partial void OnIsDoneChanged(bool value) => _model.IsDone = value;
}
