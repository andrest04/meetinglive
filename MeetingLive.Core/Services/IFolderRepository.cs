using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

public interface IFolderRepository
{
    Task<IReadOnlyList<FolderRecord>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<FolderRecord?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>Inserts or replaces the folder with the same <see cref="FolderRecord.Id"/>.</summary>
    Task SaveAsync(FolderRecord folder, CancellationToken cancellationToken = default);

    /// <summary>
    /// Removes the folder record if present. Already-gone ids are a no-op.
    /// This does <strong>not</strong> check child folders or meetings — the ViewModel
    /// must refuse delete when the folder still has children or filed sessions.
    /// </summary>
    Task DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}
