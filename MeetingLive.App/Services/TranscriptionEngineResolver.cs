using Microsoft.UI.Xaml;
using MeetingLive.Core.Services;
using MeetingLive_App.Dialogs;

namespace MeetingLive_App.Services;

/// <summary>
/// Gates Record on a ready Nemotron runtime + GGUF. If either is missing, shows
/// <see cref="TranscriptionEngineSetupDialog"/> to download them. Cancel means do not record.
/// </summary>
public static class TranscriptionEngineResolver
{
    public static async Task<bool> EnsureReadyAsync(XamlRoot xamlRoot)
    {
        if (TranscriptionEngineInstaller.IsReady(AppServices.NemotronModels, AppServices.NemoSpeechRuntime))
            return true;

        return await TranscriptionEngineSetupDialog.ShowAsync(xamlRoot);
    }
}
