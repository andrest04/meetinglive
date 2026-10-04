using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class LiveAnswerPromptBuilderTests
{
    [Fact]
    public void Build_WhenLanguageIsSpanish_IncludesQuestionWindowAndKnowledgeInstruction()
    {
        const string question = "¿Cuál es el tercer principio del manifiesto ágil?";
        var window = TranscriptStampFormatter.FormatLine(
            TimeSpan.FromSeconds(40),
            TimeSpan.FromSeconds(55),
            "The class is discussing the Agile Manifesto.");

        var prompt = LiveAnswerPromptBuilder.Build(question, window, "es");

        Assert.Contains(question, prompt, StringComparison.Ordinal);
        Assert.Contains(window, prompt, StringComparison.Ordinal);
        Assert.Contains(
            "If the transcript does not contain the factual answer, answer from knowledge.",
            prompt,
            StringComparison.Ordinal);
        Assert.Contains("Do not refuse just because the meeting did not state the fact.", prompt, StringComparison.Ordinal);
        Assert.Contains("Do not say that you only know what was said.", prompt, StringComparison.Ordinal);
        Assert.Contains("Spanish", prompt, StringComparison.Ordinal);
        Assert.Contains("2 to 5 sentences", prompt, StringComparison.Ordinal);
        Assert.Contains("live class or meeting", prompt, StringComparison.Ordinal);
        Assert.Contains("who asked", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void Build_WhenLanguageIsEnglish_AsksForEnglish()
    {
        const string question = "what is the third principle of the agile manifesto?";

        var prompt = LiveAnswerPromptBuilder.Build(question, "recent class transcript", "en");

        Assert.Contains(question, prompt, StringComparison.Ordinal);
        Assert.Contains("English", prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("Spanish", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void Build_WhenLanguageIsNullOrOther_AsksForSpanish()
    {
        var nullLanguage = LiveAnswerPromptBuilder.Build("which principle comes third in the manifesto", "window text", null);
        var otherLanguage = LiveAnswerPromptBuilder.Build("which principle comes third in the manifesto", "window text", "fr");

        Assert.Contains("Spanish", nullLanguage, StringComparison.Ordinal);
        Assert.DoesNotContain("English", nullLanguage, StringComparison.Ordinal);
        Assert.Contains("Spanish", otherLanguage, StringComparison.Ordinal);
        Assert.DoesNotContain("French", otherLanguage, StringComparison.Ordinal);
    }

    [Fact]
    public void Build_WhenSessionContextIsGiven_AddsContextBlockAndInterpretInstruction()
    {
        var prompt = LiveAnswerPromptBuilder.Build("what is a sprint?", "window text", "en", sessionContext: "Agile course, week 3");

        Assert.Contains("Session context:", prompt, StringComparison.Ordinal);
        Assert.Contains("Agile course, week 3", prompt, StringComparison.Ordinal);
        Assert.Contains("interpret the question", prompt, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void Build_WhenSessionContextIsBlank_OmitsContextBlock(string? sessionContext)
    {
        var prompt = LiveAnswerPromptBuilder.Build("what is a sprint?", "window text", "en", sessionContext);

        Assert.DoesNotContain("Session context:", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void Build_WhenWebSearchIsTrue_AllowsWebSearchAndAsksForShortAnswer()
    {
        var prompt = LiveAnswerPromptBuilder.Build("who competes with Granola?", "window text", "en", webSearch: true);

        Assert.Contains("web search", prompt, StringComparison.Ordinal);
        Assert.Contains("competitors, prices, recent news", prompt, StringComparison.Ordinal);
        Assert.Contains("keep the answer short", prompt, StringComparison.Ordinal);
    }

    [Fact]
    public void Build_WhenWebSearchIsFalse_SaysNothingAboutTheWeb()
    {
        var prompt = LiveAnswerPromptBuilder.Build("who competes with Granola?", "window text", "en", sessionContext: "Sales call");

        Assert.DoesNotContain("web", prompt, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Build_WhenContextAndWebAreGiven_KeepsQuestionAndWindowSections()
    {
        var prompt = LiveAnswerPromptBuilder.Build("q?", "the window", "es", "Course topic", webSearch: true);

        Assert.Contains("Course topic", prompt, StringComparison.Ordinal);
        Assert.Contains("web search", prompt, StringComparison.Ordinal);
        Assert.Contains("Question:", prompt, StringComparison.Ordinal);
        Assert.Contains("Transcript window:", prompt, StringComparison.Ordinal);
        Assert.Contains("the window", prompt, StringComparison.Ordinal);
    }
}
