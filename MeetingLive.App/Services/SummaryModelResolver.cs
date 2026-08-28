using Microsoft.UI.Xaml;
using MeetingLive.Core.Services;
using MeetingLive_App.Dialogs;

namespace MeetingLive_App.Services;

/// <summary>
/// Resolves which local GGUF model to summarize with: reuses the saved choice
/// when it's already downloaded on disk, otherwise walks the user through
/// <see cref="SummaryModelSetupDialog"/>. Returns the model's file path.
/// </summary>
public static class SummaryModelResolver
{
    public static async Task<string?> ResolveAsync(XamlRoot xamlRoot)
    {
        var settings = await AppServices.Settings.LoadAsync();
        if (!string.IsNullOrWhiteSpace(settings.SelectedSummaryModelId))
        {
            var model = ModelCatalog.SummaryModels.FirstOrDefault(m => m.FileName == settings.SelectedSummaryModelId);
            if (model is not null && AppServices.LocalLlmModels.IsModelDownloaded(model))
                return AppServices.LocalLlmModels.GetModelPath(model);
        }

        return await SummaryModelSetupDialog.ShowForLocalModelAsync(xamlRoot);
    }
}
