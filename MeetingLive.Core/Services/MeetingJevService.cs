using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Runs Jev on a meeting when the TypeSafe toggle is on and an API key is saved.
/// Failures are non-fatal: the caller keeps the transcript and summary.
/// </summary>
public sealed class MeetingJevService(TypeSafeApiClient api, ITypeSafeCredentialStore store)
{
    public async Task<MeetingJevAnalysis?> TryAnalyzeAsync(
        MeetingRecord record,
        IReadOnlyList<FolderRecord> folders,
        string inboxLabel,
        bool enabled,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(record);
        ArgumentNullException.ThrowIfNull(folders);
        ArgumentNullException.ThrowIfNull(store);

        if (!enabled)
            return null;

        var credentials = store.Load();
        if (credentials is null || string.IsNullOrWhiteSpace(credentials.ApiKey))
            return null;

        if (string.IsNullOrWhiteSpace(record.Transcript))
            return null;

        var request = new MeetingJevRequest
        {
            Title = record.Title,
            Transcript = record.Transcript,
            Summary = record.Summary,
            ActionItems = record.ActionItems.Select(item => item.Text).ToArray(),
            FolderPathItems = FolderPathList.Flatten(folders, inboxLabel),
        };

        try
        {
            var analyzer = new MeetingJevAnalyzer(api, credentials.ApiKey);
            var analysis = await analyzer.AnalyzeAsync(request, cancellationToken);

            record.ActionItems = MeetingJevPresentation.FilterOutContradicted(record.ActionItems, analysis.ActionItems);
            if (MeetingJevPresentation.TryGetSuggestedFolderId(analysis, record.FolderId, out var suggestedFolderId))
                record.FolderId = suggestedFolderId;

            record.JevAnalysis = analysis;
            return analysis;
        }
        catch (TypeSafeException)
        {
            return null;
        }
    }
}
