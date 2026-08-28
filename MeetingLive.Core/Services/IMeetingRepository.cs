using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

public interface IMeetingRepository
{
    Task<IReadOnlyList<MeetingRecord>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<MeetingRecord?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    Task SaveAsync(MeetingRecord record, CancellationToken cancellationToken = default);
}
