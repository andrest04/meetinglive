using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

public interface IMeetingRepository
{
    Task<IReadOnlyList<MeetingRecord>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<MeetingRecord?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    Task SaveAsync(MeetingRecord record, CancellationToken cancellationToken = default);

    /// <summary>
    /// Removes the meeting markdown file and its WAV when present. Already-gone
    /// meetings are a no-op — this method does not throw if the record is missing.
    /// </summary>
    Task DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}
