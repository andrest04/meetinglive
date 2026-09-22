using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Drafts a project plan the user can copy. Nothing is sent.
/// </summary>
public static class ProjectPlanPromptBuilder
{
    public static string Build(
        string? summary,
        IReadOnlyList<ActionItem> actionItems,
        string? rawNotes,
        IReadOnlyList<string>? attendeeNames)
    {
        ArgumentNullException.ThrowIfNull(actionItems);

        var names = attendeeNames is null
            ? "(none)"
            : string.Join(", ", attendeeNames.Where(name => !string.IsNullOrWhiteSpace(name)).Select(name => name.Trim()));
        if (string.IsNullOrWhiteSpace(names))
            names = "(none)";

        var actions = actionItems.Count == 0
            ? "(none)"
            : string.Join("\n", actionItems.Select(item => "- " + item.Text));
        var notes = string.IsNullOrWhiteSpace(rawNotes) ? "(none)" : rawNotes.Trim();
        var summaryText = string.IsNullOrWhiteSpace(summary) ? "(none)" : summary.Trim();

        return $"""
            # Identity

            You draft a short project plan from a meeting. The user will copy it.
            Nothing is sent from this app.

            # Instructions

            Return only the plan in Markdown. No preamble, no code fences, no commentary.
            Use these headings when the sources support them, and omit a heading that is not supported:

            ### Outcome
            ### Steps
            ### Owners
            ### Open questions

            Rules:
            - Use only the summary, action items, raw notes, and attendee display names below.
            - Do not invent owners, dates, email addresses, or work that was not stated.
            - Do not emit a mailto link.
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
}
