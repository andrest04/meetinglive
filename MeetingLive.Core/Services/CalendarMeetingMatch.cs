using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>Finds the saved meeting for a calendar event so a click does not create a second record.</summary>
public static class CalendarMeetingMatch
{
    public static MeetingRecord? FindByEventId(IEnumerable<MeetingRecord> meetings, string? calendarEventId)
    {
        ArgumentNullException.ThrowIfNull(meetings);
        if (string.IsNullOrWhiteSpace(calendarEventId))
            return null;

        return meetings
            .Where(meeting => string.Equals(meeting.CalendarEventId, calendarEventId, StringComparison.Ordinal))
            .OrderByDescending(meeting => meeting.RecordedAt)
            .FirstOrDefault();
    }
}
