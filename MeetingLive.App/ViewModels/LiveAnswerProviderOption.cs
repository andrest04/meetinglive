using MeetingLive.Core.Models;

namespace MeetingLive_App.ViewModels;

/// <summary>One row in the live-answer provider combo. Display names come from resources.</summary>
public sealed class LiveAnswerProviderOption
{
    public required SummaryProviderKind Kind { get; init; }

    public required string DisplayName { get; init; }

    public override string ToString() => DisplayName;
}
