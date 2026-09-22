using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Drafts a follow-up email the user can copy. Display names only.
/// This app does not have email addresses and must not invent them.
/// </summary>
public static class FollowUpEmailPromptBuilder
{
    public static string Build(
        string? summary,
        IReadOnlyList<ActionItem> actionItems,
        string? rawNotes,
        IReadOnlyList<string>? attendeeNames)
    {
        ArgumentNullException.ThrowIfNull(actionItems);

        var names = FormatNames(attendeeNames);
        var actions = actionItems.Count == 0
            ? "(none)"
            : string.Join("\n", actionItems.Select(item => "- " + item.Text));
        var notes = string.IsNullOrWhiteSpace(rawNotes) ? "(none)" : rawNotes.Trim();
        var summaryText = string.IsNullOrWhiteSpace(summary) ? "(none)" : summary.Trim();

        return $"""
            # Identity

            You draft a follow-up email the user will copy and send themselves.
            Nothing is sent from this app. You do not have anyone's email address.

            # Instructions

            Return only the email draft. No preamble, no code fences, no commentary.
            Include a subject line and a short body.

            Rules:
            - Use the summary, action items, raw notes, and attendee display names below.
            - Address people by the display names given. Do not invent email addresses.
            - Do not emit a mailto link.
            - Do not invent owners, dates, or commitments that are not in the sources.
            - If the sources are empty, return NONE and nothing else.

            # Sources

            <attendees>
            {names}
            </attendees>
            <summary>
            {summaryText}
            </summary>
            <action_items>
            {actions}
            </action_items>
            <raw_notes>
            {notes}
            </raw_notes>
            """;
    }

    private static string FormatNames(IReadOnlyList<string>? attendeeNames)
    {
        if (attendeeNames is null)
            return "(none)";

        var names = attendeeNames
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name.Trim())
            .ToArray();
        return names.Length == 0 ? "(none)" : string.Join(", ", names);
    }
}
