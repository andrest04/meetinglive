using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Built-in chat recipes. These are code, not rows in chat-recipes.json.
/// Do not save them through <see cref="IChatRecipeRepository"/>.
/// </summary>
public static class ChatRecipeCatalog
{
    private static readonly DateTimeOffset BuiltInCreatedAt = new(2026, 9, 21, 0, 0, 0, TimeSpan.Zero);

    public static readonly Guid DiscussedId = Guid.Parse("11111111-1111-4111-8111-111111111101");
    public static readonly Guid ActionItemsId = Guid.Parse("11111111-1111-4111-8111-111111111102");
    public static readonly Guid FollowUpEmailId = Guid.Parse("11111111-1111-4111-8111-111111111103");
    public static readonly Guid NextStepsId = Guid.Parse("11111111-1111-4111-8111-111111111104");
    public static readonly Guid FeatureRequestsId = Guid.Parse("11111111-1111-4111-8111-111111111201");
    public static readonly Guid RecurringThemesId = Guid.Parse("11111111-1111-4111-8111-111111111202");
    public static readonly Guid WeeklyUpdateId = Guid.Parse("11111111-1111-4111-8111-111111111203");

    public static IReadOnlyList<ChatRecipe> BuiltIns { get; } =
    [
        Recipe(DiscussedId, "What's been discussed", ChatRecipe.SingleAvailability,
            "Give a short recap of what has been discussed so far."),
        Recipe(ActionItemsId, "Action items", ChatRecipe.SingleAvailability,
            "Extract owners and next steps. If the owner is not in the context, say unassigned."),
        Recipe(FollowUpEmailId, "Follow-up email", ChatRecipe.SingleAvailability,
            "Draft a concise follow-up email. Do not send it."),
        Recipe(NextStepsId, "What should I do next", ChatRecipe.SingleAvailability,
            "List my next steps from this meeting."),
        Recipe(FeatureRequestsId, "Top feature requests", ChatRecipe.MultipleAvailability,
            "Group product feedback into themes."),
        Recipe(RecurringThemesId, "Recurring themes", ChatRecipe.MultipleAvailability,
            "Identify patterns across the packed meetings."),
        Recipe(WeeklyUpdateId, "Weekly update", ChatRecipe.MultipleAvailability,
            "Write bullets of decisions, blockers, and next steps. Draft only. Do not send it."),
    ];

    private static ChatRecipe Recipe(Guid id, string name, string availability, string prompt) => new()
    {
        Id = id,
        Name = name,
        Prompt = prompt,
        Availability = availability,
        CreatedAt = BuiltInCreatedAt,
    };
}
