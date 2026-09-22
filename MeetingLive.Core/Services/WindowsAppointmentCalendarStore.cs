using MeetingLive.Core.Models;
using Windows.ApplicationModel.Appointments;

namespace MeetingLive.Core.Services;

/// <summary>
/// Reads the Windows calendar through <see cref="AppointmentManager.RequestStoreAsync"/>
/// with <see cref="AppointmentStoreAccessType.AllCalendarsReadOnly"/>.
/// Requires the restricted <c>appointmentsSystem</c> capability and a package identity.
/// A missing permission or a missing package identity is returned as <see cref="CalendarStoreFailure"/>, never thrown.
/// </summary>
/// <remarks>
/// <c>AppointmentRecurrence</c> has no series-master id. A recurring appointment's non-empty
/// <c>RoamingId</c> is stored as the series id. If roaming id is empty, series id stays null.
/// <c>OnlineMeetingLink</c> is preferred when the SDK returns one; otherwise the first https URL
/// in location or details is used. <c>Appointment.Uri</c> is the other URI property on this type.
/// <c>Appointment.Invitees</c> are copied as display names and do not include the organizer.
/// The calendar owner is not inserted into that list.
/// </remarks>
public sealed class WindowsAppointmentCalendarStore : ICalendarStore
{
    public async Task<CalendarStoreResult> GetUpcomingAsync(
        DateTimeOffset now,
        IReadOnlySet<string> disabledCalendarIds,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(disabledCalendarIds);

        try
        {
            var store = await AppointmentManager.RequestStoreAsync(AppointmentStoreAccessType.AllCalendarsReadOnly);
            if (store is null)
                return CalendarStoreResult.Failed(CalendarStoreFailure.AccessDenied);

            var calendars = await store.FindAppointmentCalendarsAsync();
            var events = new List<CalendarEvent>();
            Exception? calendarError = null;
            var rangeStart = now - CalendarEventTiming.Lookback;
            var rangeLength = CalendarEventTiming.Lookback + CalendarEventTiming.Lookahead;

            foreach (var calendar in calendars)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var calendarId = calendar.LocalId ?? string.Empty;
                if (calendarId.Length > 0 && disabledCalendarIds.Contains(calendarId))
                    continue;

                try
                {
                    var appointments = await calendar.FindAppointmentsAsync(rangeStart, rangeLength, CreateOptions());
                    var calendarName = calendar.DisplayName ?? string.Empty;
                    foreach (var appointment in appointments)
                    {
                        var mapped = Map(appointment, calendarId, calendarName);
                        if (mapped is not null)
                            events.Add(mapped);
                    }
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    calendarError = ex;
                }
            }

            if (events.Count == 0 && calendarError is not null)
                return CalendarStoreResult.Failed(CalendarAccessFailure.Classify(calendarError));

            events.Sort(static (left, right) =>
            {
                var byStart = left.Start.CompareTo(right.Start);
                return byStart != 0 ? byStart : string.CompareOrdinal(left.EventId, right.EventId);
            });
            return CalendarStoreResult.FromEvents(events);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            return CalendarStoreResult.Failed(CalendarAccessFailure.Classify(ex));
        }
    }

    public async Task<CalendarListResult> GetCalendarsAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var store = await AppointmentManager.RequestStoreAsync(AppointmentStoreAccessType.AllCalendarsReadOnly);
            if (store is null)
                return CalendarListResult.Failed(CalendarStoreFailure.AccessDenied);

            var calendars = await store.FindAppointmentCalendarsAsync();
            cancellationToken.ThrowIfCancellationRequested();
            var items = new List<CalendarListItem>();
            foreach (var calendar in calendars)
            {
                var id = calendar.LocalId ?? string.Empty;
                if (id.Length == 0)
                    continue;

                var name = string.IsNullOrWhiteSpace(calendar.DisplayName) ? id : calendar.DisplayName.Trim();
                items.Add(new CalendarListItem { Id = id, Name = name });
            }

            items.Sort(static (left, right) =>
            {
                var byName = string.Compare(left.Name, right.Name, StringComparison.CurrentCultureIgnoreCase);
                return byName != 0 ? byName : string.CompareOrdinal(left.Id, right.Id);
            });
            return CalendarListResult.FromCalendars(items);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            return CalendarListResult.Failed(CalendarAccessFailure.Classify(ex));
        }
    }

    private static FindAppointmentsOptions CreateOptions()
    {
        var options = new FindAppointmentsOptions { MaxCount = 512 };
        options.FetchProperties.Add(AppointmentProperties.Subject);
        options.FetchProperties.Add(AppointmentProperties.Location);
        options.FetchProperties.Add(AppointmentProperties.Details);
        options.FetchProperties.Add(AppointmentProperties.Organizer);
        options.FetchProperties.Add(AppointmentProperties.Invitees);
        options.FetchProperties.Add(AppointmentProperties.BusyStatus);
        options.FetchProperties.Add(AppointmentProperties.AllDay);
        options.FetchProperties.Add(AppointmentProperties.Recurrence);
        options.FetchProperties.Add(AppointmentProperties.Uri);
        options.FetchProperties.Add(AppointmentProperties.UserResponse);
        options.FetchProperties.Add(AppointmentProperties.IsOrganizedByUser);
        options.FetchProperties.Add("RoamingId");
        options.FetchProperties.Add(AppointmentProperties.OnlineMeetingLink);
        return options;
    }

    private static CalendarEvent? Map(Appointment appointment, string calendarId, string calendarName)
    {
        var eventId = appointment.LocalId;
        if (string.IsNullOrWhiteSpace(eventId))
            return null;

        var attendees = new List<string>();
        if (appointment.Invitees is not null)
        {
            foreach (var invitee in appointment.Invitees)
            {
                if (!string.IsNullOrWhiteSpace(invitee.DisplayName))
                    attendees.Add(invitee.DisplayName.Trim());
            }
        }

        // Invitees exclude the organizer. The owner is not inserted. IsOrganizedByUser is the
        // only identity this API gives us, and it means the owner is absent from Invitees.
        var organizedByUser = appointment.IsOrganizedByUser;
        var appointmentUri = appointment.Uri?.AbsoluteUri;
        return new CalendarEvent
        {
            EventId = eventId,
            CalendarId = string.IsNullOrWhiteSpace(appointment.CalendarId) ? calendarId : appointment.CalendarId,
            CalendarName = calendarName,
            Subject = appointment.Subject ?? string.Empty,
            Start = appointment.StartTime,
            Duration = appointment.Duration < TimeSpan.Zero ? TimeSpan.Zero : appointment.Duration,
            Location = NullIfBlank(appointment.Location),
            Details = NullIfBlank(appointment.Details),
            JoinUrl = CalendarJoinUrl.Resolve(appointment.OnlineMeetingLink, appointmentUri, appointment.Location, appointment.Details),
            OrganizerDisplayName = NullIfBlank(appointment.Organizer?.DisplayName),
            AttendeeDisplayNames = attendees,
            OrganizedByCurrentUser = organizedByUser,
            AttendeesIncludeCurrentUser = CalendarReminder.IncludesCurrentUser(organizedByUser, ownerMatchedInInvitees: false),
            SeriesId = CalendarSeriesId.FromRecurrence(appointment.Recurrence is not null, appointment.RoamingId),
            BusyStatus = MapBusyStatus(appointment.BusyStatus),
            IsAllDay = appointment.AllDay,
            IsDeclined = appointment.UserResponse == AppointmentParticipantResponse.Declined,
        };
    }

    private static CalendarBusyStatus MapBusyStatus(AppointmentBusyStatus status) => status switch
    {
        AppointmentBusyStatus.Free => CalendarBusyStatus.Free,
        AppointmentBusyStatus.Tentative => CalendarBusyStatus.Tentative,
        AppointmentBusyStatus.Busy => CalendarBusyStatus.Busy,
        AppointmentBusyStatus.OutOfOffice => CalendarBusyStatus.OutOfOffice,
        AppointmentBusyStatus.WorkingElsewhere => CalendarBusyStatus.WorkingElsewhere,
        _ => CalendarBusyStatus.Unknown,
    };

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
