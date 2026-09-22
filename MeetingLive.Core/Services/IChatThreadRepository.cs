using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

public interface IChatThreadRepository
{
    /// <summary>All threads, newest <see cref="ChatThread.UpdatedAt"/> first.</summary>
    Task<IReadOnlyList<ChatThread>> GetAllAsync(CancellationToken cancellationToken = default);

    Task<ChatThread?> GetByIdAsync(Guid id, CancellationToken cancellationToken = default);

    /// <summary>Inserts or replaces the thread with the same <see cref="ChatThread.Id"/>.</summary>
    Task SaveAsync(ChatThread thread, CancellationToken cancellationToken = default);

    /// <summary>Removes the thread if present. A missing id is a no-op and does not throw.</summary>
    Task DeleteAsync(Guid id, CancellationToken cancellationToken = default);
}
