namespace MeetingLive.Core.Models;

/// <summary>Busy state copied off a Windows appointment. Unknown means the store did not supply one.</summary>
public enum CalendarBusyStatus
{
    Unknown = 0,
    Free,
    Tentative,
    Busy,
    OutOfOffice,
    WorkingElsewhere,
}
