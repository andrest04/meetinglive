namespace MeetingLive.Core.Models;

/// <summary>
/// Why the calendar store could not return meetings.
/// Callers must treat these as empty states. The store does not throw for a missing permission.
/// </summary>
public enum CalendarStoreFailure
{
    /// <summary>The user or the OS denied calendar access, or the read failed for another access reason.</summary>
    AccessDenied,

    /// <summary>This process has no package identity, so Windows will not open the appointment store.</summary>
    NoPackageIdentity,

    /// <summary>The read succeeded and no upcoming events were returned.</summary>
    Empty,
}
