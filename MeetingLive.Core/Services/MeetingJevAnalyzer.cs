using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

public sealed class MeetingJevRequest
{
    public required string Title { get; init; }

    public required string Transcript { get; init; }

    public string? Summary { get; init; }

    public IReadOnlyList<string> ActionItems { get; init; } = [];

    public IReadOnlyList<FolderPathItem>? FolderPathItems { get; init; }
}

/// <summary>
/// Builds one TypeSafe fan-out request for a meeting and composes the typed answers in code.
/// </summary>
public sealed class MeetingJevAnalyzer
{
    public const double AutoAcceptConfidence = 0.8;

    internal const int MaxTranscriptCharacters = 48_000;
    internal const int MaxActionItems = 20;
    internal const int MaxFolderOptionsIncludingInbox = 254;

    private readonly TypeSafeApiClient _api;
    private readonly string _apiKey;

    public MeetingJevAnalyzer(TypeSafeApiClient api, string apiKey)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _apiKey = apiKey ?? throw new ArgumentNullException(nameof(apiKey));
    }

    public async Task<MeetingJevAnalysis> AnalyzeAsync(
        MeetingJevRequest request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);

        var actionItemTexts = (request.ActionItems ?? []).Take(MaxActionItems).ToList();
        var includeFolders = request.FolderPathItems is { Count: > 0 };
        var hasSummary = !string.IsNullOrWhiteSpace(request.Summary);
        var state = BuildState(request, actionItemTexts, includeFolders);

        var questions = BuildQuestions(actionItemTexts, includeFolders, hasSummary, request.FolderPathItems);
        var result = await _api.EvaluateAsync(_apiKey, state, questions, cancellationToken);

        return Compose(result, actionItemTexts, hasSummary, includeFolders);
    }

    private static Dictionary<string, object?> BuildState(
        MeetingJevRequest request,
        IReadOnlyList<string> actionItemTexts,
        bool includeFolders)
    {
        var transcript = request.Transcript ?? "";
        var truncated = transcript.Length > MaxTranscriptCharacters;
        if (truncated)
            transcript = transcript[..MaxTranscriptCharacters];

        var state = new Dictionary<string, object?>
        {
            ["meeting"] = new Dictionary<string, string> { ["title"] = request.Title ?? "" },
            ["transcript"] = transcript,
            ["summary"] = request.Summary,
            ["action_items"] = actionItemTexts
                .Select((text, index) => new Dictionary<string, object?> { ["index"] = index, ["text"] = text })
                .ToList(),
        };

        if (truncated)
            state["transcript_truncated"] = true;

        if (includeFolders)
            state["folders"] = BuildFolderState(request.FolderPathItems!);

        return state;
    }

    private static List<Dictionary<string, string>> BuildFolderState(IReadOnlyList<FolderPathItem> folders)
    {
        var inboxPath = folders.FirstOrDefault(item => item.FolderId is null)?.Path ?? "Inbox";
        var stateFolders = new List<Dictionary<string, string>>
        {
            new() { ["id"] = "inbox", ["path"] = inboxPath },
        };

        foreach (var item in folders)
        {
            if (stateFolders.Count >= MaxFolderOptionsIncludingInbox)
                break;

            var id = FolderChoiceId(item);
            if (stateFolders.Any(existing => existing["id"] == id))
                continue;

            stateFolders.Add(new Dictionary<string, string> { ["id"] = id, ["path"] = item.Path });
        }

        return stateFolders;
    }

    private static Dictionary<string, TypeSafeQuestion> BuildQuestions(
        IReadOnlyList<string> actionItemTexts,
        bool includeFolders,
        bool hasSummary,
        IReadOnlyList<FolderPathItem>? folderPathItems)
    {
        var questions = new Dictionary<string, TypeSafeQuestion>
        {
            ["meeting_type"] = TypeSafeQuestion.Choice(
                "Which meeting type best matches `meeting.title` and `transcript`?",
                new Dictionary<string, string?>
                {
                    ["standup"] = "A recurring status sync: yesterday/today/blockers, short updates from several people.",
                    ["one_on_one"] = "A conversation between two people about work, feedback, or career — not a panel interview.",
                    ["interview"] = "A hiring or candidate interview, including screening or debrief of a candidate.",
                    ["planning"] = "Planning upcoming work: roadmap, sprint planning, scoping, or prioritization.",
                    ["review"] = "A retrospective, demo, design review, or performance/code review of work already done.",
                    ["lecture"] = "One person presenting or teaching; others mostly listen.",
                    ["sales"] = "A sales call, pitch, or commercial negotiation with a customer or prospect.",
                    ["support"] = "Troubleshooting, incident response, or helping someone unblock a problem.",
                    ["other"] = "None of the other types is a reasonable fit.",
                }),
            ["spoken_language"] = TypeSafeQuestion.Choice(
                "What language is primarily spoken in `transcript`?",
                new Dictionary<string, string?>
                {
                    ["es"] = "Primarily Spanish.",
                    ["en"] = "Primarily English.",
                    ["mixed"] = "Substantial amounts of more than one language.",
                    ["other"] = "Primarily a language that is neither Spanish nor English.",
                }),
            ["urgency"] = TypeSafeQuestion.Score(
                "How time-critical is the work discussed in `transcript`?",
                [
                    "Routine: no deadline and no blocker; delaying follow-up would not harm in-progress work.",
                    "Time-sensitive: a deadline or follow-up is expected soon, but nobody is currently blocked.",
                    "Blocking: someone cannot proceed until a decision, approval, or deliverable from this meeting lands.",
                ]),
            ["contains_decisions"] = TypeSafeQuestion.Noul(
                "Does `transcript` contain at least one decision that was actually made, not merely discussed as a possibility?",
                trueCriteria: "Someone chose an option, approved a plan, or settled a question.",
                falseCriteria: "Topics were discussed but no decision was reached."),
            ["contains_commitments"] = TypeSafeQuestion.Noul(
                "Does `transcript` contain at least one commitment — a person agreeing to do specific work?",
                trueCriteria: "Someone accepted an action, deadline, or deliverable.",
                falseCriteria: "No one agreed to do specific work."),
            ["pii_present"] = TypeSafeQuestion.Noul(
                "Does `transcript` contain credentials, government identification numbers, API keys, passwords, or similar secrets? Ordinary names of people in the meeting, company names, and job titles do not count.",
                trueCriteria: "Credentials, government IDs, or secrets are present.",
                falseCriteria: "No credentials, government IDs, or secrets. Ordinary meeting names are fine."),
        };

        if (hasSummary)
        {
            questions["summary_faithful"] = TypeSafeQuestion.Noul(
                "Is `summary` faithful to `transcript`? Judge only whether the summary invents facts, decisions, or action items that are absent from the transcript.",
                trueCriteria: "The summary stays within what the transcript supports.",
                falseCriteria: "The summary invents facts, decisions, or action items not in the transcript.");
        }

        if (includeFolders && folderPathItems is not null)
            questions["folder"] = TypeSafeQuestion.Choice(
                "Which Library folder should this meeting be filed in, based on `meeting.title` and `transcript`? Choose `none` if no listed folder is a good fit.",
                BuildFolderCriteria(folderPathItems));

        for (var i = 0; i < actionItemTexts.Count; i++)
        {
            questions[$"item_{i}_relation"] = TypeSafeQuestion.Choice(
                $"Does `transcript` support, contradict, or say nothing about the claim in `action_items[{i}].text`?",
                new Dictionary<string, string?>
                {
                    ["supports"] = "The transcript contains evidence that this action item was actually agreed or assigned.",
                    ["contradicts"] = "The transcript conflicts with this action item (it was rejected, assigned to someone else, or stated as not happening).",
                    ["says_nothing"] = "The transcript does not mention this action item in a way that confirms or denies it.",
                });
        }

        return questions;
    }

    private static Dictionary<string, string?> BuildFolderCriteria(IReadOnlyList<FolderPathItem> folders)
    {
        var inboxPath = folders.FirstOrDefault(item => item.FolderId is null)?.Path ?? "Inbox — unfiled meetings.";
        var criteria = new Dictionary<string, string?>
        {
            ["inbox"] = inboxPath,
        };

        foreach (var item in folders)
        {
            if (criteria.Count >= MaxFolderOptionsIncludingInbox)
                break;

            var id = FolderChoiceId(item);
            if (string.Equals(id, "none", StringComparison.OrdinalIgnoreCase) || criteria.ContainsKey(id))
                continue;

            criteria[id] = item.Path;
        }

        criteria["none"] = "None of the listed folders is a reasonable filing location.";
        return criteria;
    }

    private static string FolderChoiceId(FolderPathItem item) =>
        item.FolderId is { } folderId ? folderId.ToString("D") : "inbox";

    private static MeetingJevAnalysis Compose(
        TypeSafeEvaluationResult result,
        IReadOnlyList<string> actionItemTexts,
        bool hasSummary,
        bool includeFolders)
    {
        var answers = result.Answers;
        var meetingType = ReadChoice(answers, "meeting_type");
        var language = ReadChoice(answers, "spoken_language");
        var urgency = ReadScore(answers, "urgency");

        var analysis = new MeetingJevAnalysis
        {
            MeetingType = meetingType?.Choice,
            MeetingTypeConfidence = meetingType?.Confidence,
            SpokenLanguage = language?.Choice,
            UrgencyScore = urgency?.Score ?? 0,
            UrgencyConfidence = urgency?.Confidence,
            ContainsDecisions = ReadNoul(answers, "contains_decisions") ?? 0,
            ContainsCommitments = ReadNoul(answers, "contains_commitments") ?? 0,
            PiiRisk = ReadNoul(answers, "pii_present") ?? 0,
            SummaryFaithful = hasSummary ? ReadNoul(answers, "summary_faithful") : null,
            SuggestedFolderId = includeFolders ? ReadChoice(answers, "folder")?.Choice : null,
            FolderConfidence = includeFolders ? ReadChoice(answers, "folder")?.Confidence : null,
            Model = result.Model,
            AnalyzedAt = DateTimeOffset.UtcNow,
        };

        var verdicts = new List<ActionItemVerdict>(actionItemTexts.Count);
        for (var i = 0; i < actionItemTexts.Count; i++)
        {
            var answer = ReadChoice(answers, $"item_{i}_relation");
            if (answer?.Choice is null)
                continue;

            verdicts.Add(new ActionItemVerdict
            {
                Text = actionItemTexts[i],
                Relation = answer.Choice,
                Confidence = answer.Confidence,
            });
        }

        analysis.ActionItems = verdicts;
        return analysis;
    }

    private static TypeSafeAnswer? ReadChoice(IReadOnlyDictionary<string, TypeSafeAnswer> answers, string id) =>
        answers.TryGetValue(id, out var answer) &&
        string.Equals(answer.Type, "choice", StringComparison.OrdinalIgnoreCase)
            ? answer
            : null;

    private static TypeSafeAnswer? ReadScore(IReadOnlyDictionary<string, TypeSafeAnswer> answers, string id) =>
        answers.TryGetValue(id, out var answer) &&
        string.Equals(answer.Type, "score", StringComparison.OrdinalIgnoreCase)
            ? answer
            : null;

    private static double? ReadNoul(IReadOnlyDictionary<string, TypeSafeAnswer> answers, string id) =>
        answers.TryGetValue(id, out var answer) &&
        string.Equals(answer.Type, "noul", StringComparison.OrdinalIgnoreCase)
            ? answer.Noul
            : null;
}
