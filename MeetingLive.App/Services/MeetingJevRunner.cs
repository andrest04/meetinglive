using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive_App.Services;

/// <summary>
/// App-layer Jev run after a summary. Failures never wipe transcript or summary;
/// the caller shows <c>Status_JevFailed</c> when a check was attempted and skipped.
/// </summary>
internal static class MeetingJevRunner
{
    public static async Task<string?> TryAnalyzeAndSaveAsync(
        MeetingRecord record,
        IMeetingRepository meetings,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(record);
        ArgumentNullException.ThrowIfNull(meetings);

        AppSettings settings;
        try
        {
            settings = await AppServices.Settings.LoadAsync();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return AppStrings.Format("Status_JevFailed", CliFailureUserMessage.Format(ex));
        }

        if (!settings.TypeSafeEnabled)
            return null;

        var credentials = AppServices.TypeSafeCredentials.Load();
        if (credentials is null || string.IsNullOrWhiteSpace(credentials.ApiKey))
            return null;

        if (string.IsNullOrWhiteSpace(record.Transcript))
            return null;

        try
        {
            var folders = await AppServices.Folders.GetAllAsync(cancellationToken);
            var analysis = await AppServices.MeetingJev.TryAnalyzeAsync(
                record,
                folders,
                AppStrings.Get("Library_Inbox"),
                settings.TypeSafeEnabled,
                cancellationToken);

            if (analysis is not null)
            {
                await meetings.SaveAsync(record, cancellationToken);
                return null;
            }

            return AppStrings.Format("Status_JevFailed", AppStrings.Get("TypeSafe_CheckFailed"));
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (TypeSafeException ex)
        {
            return AppStrings.Format("Status_JevFailed", ex.Message);
        }
        catch (Exception ex)
        {
            return AppStrings.Format("Status_JevFailed", CliFailureUserMessage.Format(ex));
        }
    }
}
