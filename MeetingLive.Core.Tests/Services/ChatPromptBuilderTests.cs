using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class ChatPromptBuilderTests
{
    [Fact]
    public void Build_AnyScope_TellsModelNotToInvent()
    {
        var prompt = ChatPromptBuilder.Build(
            ChatScopeKind.AllMeetings,
            "packed-context-token",
            [],
            "What did we decide?");

        Assert.Contains("Answer only from the packed context.", prompt);
        Assert.Contains("If the context does not contain the answer, say so.", prompt);
        Assert.Contains("Do not invent quotes, decisions, or attendees.", prompt);
        Assert.Contains("Never claim something was sent.", prompt);
        Assert.Contains("Scope: All meetings", prompt);
        Assert.Contains("packed-context-token", prompt);
        Assert.Contains("What did we decide?", prompt);
        Assert.DoesNotContain(ChatPromptBuilder.RewriteNotesInstruction, prompt);
    }

    [Fact]
    public void Build_WhenMessageContainsRewrite_AddsInstructionOnlyForMeetingScope()
    {
        foreach (var scope in Enum.GetValues<ChatScopeKind>())
        {
            var prompt = ChatPromptBuilder.Build(scope, "ctx", [], "Please REWRITE the notes");

            Assert.Contains("Scope: " + ChatPromptBuilder.ScopeLabel(scope), prompt);
            Assert.Contains("Please REWRITE the notes", prompt);
            if (scope == ChatScopeKind.Meeting)
                Assert.Contains(ChatPromptBuilder.RewriteNotesInstruction, prompt);
            else
                Assert.DoesNotContain(ChatPromptBuilder.RewriteNotesInstruction, prompt);
        }

        var embedded = ChatPromptBuilder.Build(
            ChatScopeKind.Meeting,
            "ctx",
            [],
            "Please rewrites the notes");
        var notASubstring = ChatPromptBuilder.Build(
            ChatScopeKind.Meeting,
            "ctx",
            [],
            "The notes feel Rewritten already");
        var meetingWithoutRewrite = ChatPromptBuilder.Build(
            ChatScopeKind.Meeting,
            "ctx",
            [],
            "Summarize the decisions");

        Assert.Contains(ChatPromptBuilder.RewriteNotesInstruction, embedded);
        Assert.DoesNotContain(ChatPromptBuilder.RewriteNotesInstruction, notASubstring);
        Assert.DoesNotContain(ChatPromptBuilder.RewriteNotesInstruction, meetingWithoutRewrite);
    }

    [Fact]
    public void Build_PriorTurns_KeepsLastEightAndCapsText()
    {
        Assert.Equal(8, ChatPromptBuilder.MaxPriorMessages);
        Assert.Equal(1500, ChatPromptBuilder.MaxPriorMessageChars);
        var messages = Enumerable.Range(0, ChatPromptBuilder.MaxPriorMessages + 1)
            .Select(index => new ChatMessage
            {
                Id = Guid.NewGuid(),
                Role = index % 2 == 0 ? ChatMessage.UserRole : ChatMessage.AssistantRole,
                Text = index == ChatPromptBuilder.MaxPriorMessages
                    ? new string('q', ChatPromptBuilder.MaxPriorMessageChars + 40)
                    : $"turn-{index}",
                CreatedAt = DateTimeOffset.Parse("2026-09-01T00:00:00Z").AddMinutes(index),
            })
            .ToList();

        var prompt = ChatPromptBuilder.Build(ChatScopeKind.Meeting, "ctx", messages, "next question");

        Assert.DoesNotContain("turn-0", prompt);
        Assert.Contains("assistant: turn-1", prompt);
        Assert.Contains("user: turn-2", prompt);
        Assert.Contains(new string('q', ChatPromptBuilder.MaxPriorMessageChars), prompt);
        Assert.DoesNotContain(new string('q', ChatPromptBuilder.MaxPriorMessageChars + 1), prompt);
        Assert.Contains("next question", prompt);
    }
}
