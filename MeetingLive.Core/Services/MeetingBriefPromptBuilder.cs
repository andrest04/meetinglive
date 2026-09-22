using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Glanceable pre-meeting brief. Sources are prior related meetings, this event's
/// subject, attendee display names, and agenda. No mail, web, or people-search.
/// </summary>
public static class MeetingBriefPromptBuilder
{
    public const int MaxPriorMeetings = 3;

    /// <summary>
    /// Hide the brief when there is no prior meeting and the event has no agenda and no attendees.
    /// Callers must not call the model in that case.
    /// </summary>
    public static bool HasUsefulContext(
        IReadOnlyList<MeetingRecord> priorMeetings,
        string? agenda,
        IReadOnlyList<string>? attendees)
    {
        ArgumentNullException.ThrowIfNull(priorMeetings);
        if (priorMeetings.Count > 0)
            return true;

        if (!string.IsNullOrWhiteSpace(agenda))
            return true;

        return attendees?.Any(name => !string.IsNullOrWhiteSpace(name)) == true;
    }

    /// <summary>Blank or NONE means there was nothing useful to show. Callers hide the brief.</summary>
    public static string? Normalize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            return null;

        var text = raw.Trim();
        return text.Equals("NONE", StringComparison.OrdinalIgnoreCase) ? null : text;
    }

    public static string Build(
        string? subject,
        IReadOnlyList<string>? attendees,
        string? agenda,
        IReadOnlyList<MeetingRecord> priorMeetings)
    {
        ArgumentNullException.ThrowIfNull(priorMeetings);

        var attendeeBlock = FormatNames(attendees);
        var agendaBlock = string.IsNullOrWhiteSpace(agenda) ? "(none)" : agenda.Trim();
        var priorBlock = FormatPrior(priorMeetings);

        return $"""
            # Identity

            You write a pre-meeting brief the user can glance at before they walk in.
            You only use the sources below. You do not search the web, mail, or people directories.

            # Instructions

            Respond with 2 or 3 Markdown bullets, and nothing else
            (no preamble, no code fences, no headings, no closing commentary).

            Cover only what the sources support:
            - who is attending
            - what was discussed last time
            - what is still open

            Rules:
            - Use only the subject, attendees, agenda, and prior meetings below.
            - Do not invent people, dates, companies, quotes, or open items.
            - Do not invent email addresses. Do not emit a mailto link.
            - If a prior meeting has no summary, notes, or action items, do not pretend it did.
            - If you cannot ground at least one bullet, return NONE and nothing else.
            - No filler.

            # Sources

            <subject>{subject?.Trim()}</subject>
            <attendees>
            {attendeeBlock}
            </attendees>
            <agenda>
            {agendaBlock}
            </agenda>
            <prior_meetings>
            {priorBlock}
            </prior_meetings>
            """;
    }

    private static string FormatNames(IReadOnlyList<string>? attendees)
    {
        if (attendees is null)
            return "(none)";

        var names = attendees
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .ToArray();
        return names.Length == 0 ? "(none)" : string.Join(", ", names);
    }

    private static string FormatPrior(IReadOnlyList<MeetingRecord> priorMeetings)
    {
        var taken = priorMeetings.Take(MaxPriorMeetings).ToArray();
        if (taken.Length == 0)
            return "(none)";

        return string.Join("\n\n", taken.Select(FormatOne));
    }

    private static string FormatOne(MeetingRecord meeting)
    {
        var summary = string.IsNullOrWhiteSpace(meeting.Summary) ? "(none)" : meeting.Summary.Trim();
        var notes = string.IsNullOrWhiteSpace(meeting.Notes) ? "(none)" : meeting.Notes.Trim();
        var actions = meeting.ActionItems.Count == 0
            ? "(none)"
            : string.Join("; ", meeting.ActionItems.Select(item => item.Text));

        return $"""
            <meeting title="{meeting.Title}">
            <summary>
            {summary}
            </summary>
            <notes>
            {notes}
            </notes>
            <action_items>
            {actions}
            </action_items>
            </meeting>
            """;
    }
}
