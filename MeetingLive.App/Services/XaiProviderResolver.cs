using Microsoft.UI.Xaml;
using MeetingLive_App.Dialogs;

namespace MeetingLive_App.Services;

/// <summary>
/// Resolves whether Grok (xAI) credentials exist, walking the user through
/// <see cref="XaiAuthDialog"/> when they don't. Mirrors <see cref="CliProviderResolver"/>
/// but is HTTP auth, not a CLI on PATH.
/// </summary>
public static class XaiProviderResolver
{
    public static bool HasCredentials => AppServices.XaiAuth.HasCredentials;

    /// <summary>True if SuperGrok OAuth or an API key is saved, walking the user through
    /// <see cref="XaiAuthDialog"/> first when it isn't. Returns false only if the user cancels.</summary>
    public static async Task<bool> EnsureAvailableAsync(XamlRoot xamlRoot)
    {
        if (HasCredentials)
            return true;

        return await XaiAuthDialog.ShowAsync(xamlRoot);
    }
}
