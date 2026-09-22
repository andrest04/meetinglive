namespace MeetingLive.Core.Services;

/// <summary>
/// <c>AppointmentRecurrence</c> has no series-master id.
/// When the appointment is recurring and <c>RoamingId</c> is set, that roaming id is the stable id the API provides.
/// Otherwise the series id stays null. A one-off roaming id is not a series.
/// </summary>
public static class CalendarSeriesId
{
    public static string? FromRecurrence(bool isRecurring, string? roamingId)
    {
        if (!isRecurring || string.IsNullOrWhiteSpace(roamingId))
            return null;

        return roamingId.Trim();
    }
}
