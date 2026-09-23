using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive.Core.Strings;

namespace MeetingLive.Core.Tests.Services;

public class ChatRecipeCatalogTests
{
    [Fact]
    public void BuiltIns_ListsSingleAndMultipleRecipes()
    {
        var builtIns = ChatRecipeCatalog.BuiltIns;
        var byId = builtIns.ToDictionary(recipe => recipe.Id);

        Assert.Equal(
            [
                CoreStrings.Get("RecipeDiscussedName"),
                CoreStrings.Get("RecipeActionItemsName"),
                CoreStrings.Get("RecipeFollowUpEmailName"),
                CoreStrings.Get("RecipeNextStepsName"),
                CoreStrings.Get("RecipeFeatureRequestsName"),
                CoreStrings.Get("RecipeRecurringThemesName"),
                CoreStrings.Get("RecipeWeeklyUpdateName"),
            ],
            builtIns.Select(recipe => recipe.Name).ToList());
        Assert.All(builtIns.Take(4), recipe => Assert.Equal(ChatRecipe.SingleAvailability, recipe.Availability));
        Assert.All(builtIns.Skip(4), recipe => Assert.Equal(ChatRecipe.MultipleAvailability, recipe.Availability));
        Assert.Equal(builtIns.Count, builtIns.Select(recipe => recipe.Id).Distinct().Count());
        Assert.Contains("discussed so far", byId[ChatRecipeCatalog.DiscussedId].Prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("unassigned", byId[ChatRecipeCatalog.ActionItemsId].Prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Do not send it.", byId[ChatRecipeCatalog.FollowUpEmailId].Prompt);
        Assert.Contains("next steps", byId[ChatRecipeCatalog.NextStepsId].Prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("themes", byId[ChatRecipeCatalog.FeatureRequestsId].Prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("patterns", byId[ChatRecipeCatalog.RecurringThemesId].Prompt, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Draft only", byId[ChatRecipeCatalog.WeeklyUpdateId].Prompt);
        Assert.Contains("Do not send it.", byId[ChatRecipeCatalog.WeeklyUpdateId].Prompt);
    }
}
