using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive_App.Services;

/// <summary>
/// App-layer Jev run after a summary. Entirely silent by design: it only ever edits the
/// record (dropping contradicted action items, filing a suggested folder — see
/// <see cref="MeetingJevPresentation"/>) before saving it, and never surfaces its own
/// status. Any failure (settings, credentials, network) leaves the transcript and summary
/// untouched.
/// </summary>
internal static class MeetingJevRunner
{
    public static async Task TryAnalyzeAndSaveAsync(
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
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            return;
        }

        if (!settings.TypeSafeEnabled)
            return;

        var credentials = AppServices.TypeSafeCredentials.Load();
        if (credentials is null || string.IsNullOrWhiteSpace(credentials.ApiKey))
            return;

        if (string.IsNullOrWhiteSpace(record.Transcript))
            return;

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
                AppServices.Workspace.NotifyMeetingChanged(record.Id);
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (TypeSafeException)
        {
        }
        catch (Exception)
        {
        }
    }
}
