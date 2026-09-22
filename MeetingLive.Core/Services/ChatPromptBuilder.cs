using System.Text;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Builds the single prompt passed to <c>ISummaryProvider.CompletePromptAsync</c>.
/// The packed context is included as-is. Prior turns are capped here; storage is not.
/// </summary>
public static class ChatPromptBuilder
{
    public const int MaxPriorMessages = 8;
    public const int MaxPriorMessageChars = 1500;

    public const string RewriteNotesInstruction =
        "Rewrite the notes from the packed meeting and return the rewritten notes as markdown. Do not save the file.";

    public static string ScopeLabel(ChatScopeKind scopeKind) => scopeKind switch
    {
        ChatScopeKind.AllMeetings => "All meetings",
        ChatScopeKind.Folder => "Folder",
        ChatScopeKind.Meeting => "Meeting",
        ChatScopeKind.Live => "Live",
        _ => throw new ArgumentOutOfRangeException(nameof(scopeKind), scopeKind, "Unknown chat scope."),
    };

    public static string Build(
        ChatScopeKind scopeKind,
        string packedContext,
        IReadOnlyList<ChatMessage> priorMessages,
        string userMessage)
    {
        ArgumentNullException.ThrowIfNull(packedContext);
        ArgumentNullException.ThrowIfNull(priorMessages);
        ArgumentNullException.ThrowIfNull(userMessage);

        var builder = new StringBuilder();
        builder.AppendLine("Answer only from the packed context.");
        builder.AppendLine("If the context does not contain the answer, say so.");
        builder.AppendLine("Do not invent quotes, decisions, or attendees.");
        builder.AppendLine("Drafts (email, Slack, or spec) are drafts. Never claim something was sent.");
        builder.Append("Scope: ").AppendLine(ScopeLabel(scopeKind));

        if (AsksToRewriteNotes(scopeKind, userMessage))
        {
            builder.AppendLine();
            builder.AppendLine(RewriteNotesInstruction);
        }

        builder.AppendLine();
        builder.AppendLine("# Context");
        builder.AppendLine(packedContext);
        builder.AppendLine();
        builder.AppendLine("# Prior turns");
        AppendPriorTurns(builder, priorMessages);
        builder.AppendLine();
        builder.AppendLine("# User message");
        builder.Append(userMessage);
        return builder.ToString();
    }

    private static bool AsksToRewriteNotes(ChatScopeKind scopeKind, string userMessage) =>
        scopeKind == ChatScopeKind.Meeting
        && userMessage.Contains("rewrite", StringComparison.OrdinalIgnoreCase);

    private static void AppendPriorTurns(StringBuilder builder, IReadOnlyList<ChatMessage> priorMessages)
    {
        if (priorMessages.Count == 0)
        {
            builder.AppendLine("(none)");
            return;
        }

        var start = Math.Max(0, priorMessages.Count - MaxPriorMessages);
        for (var i = start; i < priorMessages.Count; i++)
        {
            var message = priorMessages[i];
            ArgumentNullException.ThrowIfNull(message);
            var text = message.Text ?? string.Empty;
            if (text.Length > MaxPriorMessageChars)
                text = text[..MaxPriorMessageChars];
            builder.Append(message.Role).Append(": ").AppendLine(text);
        }
    }
}
