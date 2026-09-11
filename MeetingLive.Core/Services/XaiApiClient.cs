using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MeetingLive.Core.Services;

/// <summary>OpenAI-shaped xAI HTTP API at https://api.x.ai/v1.</summary>
public sealed class XaiApiClient
{
    public const string ApiBaseUrl = "https://api.x.ai/v1";

    /// <summary>Best general chat model for meeting notes when the catalog includes it.</summary>
    public const string DefaultModelId = "grok-4.6";

    private static readonly string[] PreferredSummaryModelIds =
    [
        "grok-4.6",
        "grok-4.7",
        "grok-4.3",
        "grok-4.5",
        "grok-4-fast",
    ];

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly HttpClient _http;

    public XaiApiClient(HttpClient http)
    {
        _http = http ?? throw new ArgumentNullException(nameof(http));
    }

    public async Task<IReadOnlyList<string>> ListModelsAsync(
        string accessToken,
        CancellationToken cancellationToken = default)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, ApiBaseUrl + "/models");
        ApplyBearer(request, accessToken);
        using var response = await _http.SendAsync(request, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        ModelsDto? dto;
        try
        {
            dto = await JsonSerializer.DeserializeAsync<ModelsDto>(stream, JsonOptions, cancellationToken);
        }
        catch (JsonException)
        {
            throw new XaiException(XaiFailureKind.RequestFailed, "Grok (xAI) returned an unexpected model list.");
        }

        if (dto?.Data is null)
            return [];

        return dto.Data
            .Select(item => item.Id)
            .Where(id => !string.IsNullOrWhiteSpace(id) && IsSummaryChatModel(id!))
            .Select(id => id!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(id => PreferenceRank(id))
            .ThenBy(id => id, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    /// <summary>
    /// Meeting notes only need text chat. xAI's /v1/models dump also includes Imagine
    /// (image/video), Grok Build, multi-agent research, and reasoning/agent SKUs.
    /// </summary>
    public static bool IsSummaryChatModel(string modelId)
    {
        if (string.IsNullOrWhiteSpace(modelId))
            return false;

        if (!modelId.StartsWith("grok", StringComparison.OrdinalIgnoreCase))
            return false;

        var id = modelId.ToLowerInvariant();
        if (id.Contains("imagine", StringComparison.Ordinal) ||
            id.Contains("image", StringComparison.Ordinal) ||
            id.Contains("video", StringComparison.Ordinal) ||
            id.Contains("multi-agent", StringComparison.Ordinal) ||
            id.Contains("build", StringComparison.Ordinal))
            return false;

        // Keep grok-*-non-reasoning; drop grok-*-reasoning (agent/CoT SKUs).
        if (id.EndsWith("-reasoning", StringComparison.Ordinal) &&
            !id.EndsWith("-non-reasoning", StringComparison.Ordinal))
            return false;

        return true;
    }

    private static int PreferenceRank(string modelId)
    {
        for (var i = 0; i < PreferredSummaryModelIds.Length; i++)
        {
            if (string.Equals(modelId, PreferredSummaryModelIds[i], StringComparison.OrdinalIgnoreCase))
                return i;
        }

        return PreferredSummaryModelIds.Length;
    }

    public async Task<string> CompleteChatAsync(
        string accessToken,
        string modelId,
        string prompt,
        CancellationToken cancellationToken = default,
        string? reasoningEffort = null)
    {
        if (string.IsNullOrWhiteSpace(modelId))
            modelId = DefaultModelId;

        var body = new ChatRequestDto(
            modelId,
            [new ChatMessageDto("user", prompt)],
            0.3,
            string.IsNullOrWhiteSpace(reasoningEffort) ? null : reasoningEffort.Trim());

        using var request = new HttpRequestMessage(HttpMethod.Post, ApiBaseUrl + "/chat/completions")
        {
            Content = new StringContent(JsonSerializer.Serialize(body, JsonOptions), Encoding.UTF8, "application/json"),
        };
        ApplyBearer(request, accessToken);
        using var response = await _http.SendAsync(request, cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        ChatResponseDto? dto;
        try
        {
            dto = await JsonSerializer.DeserializeAsync<ChatResponseDto>(stream, JsonOptions, cancellationToken);
        }
        catch (JsonException)
        {
            throw new XaiException(XaiFailureKind.RequestFailed, "Grok (xAI) returned an unexpected response.");
        }

        var content = dto?.Choices is { Count: > 0 } choices ? choices[0].Message?.Content : null;
        if (string.IsNullOrWhiteSpace(content))
            throw new XaiException(XaiFailureKind.EmptyOutput, "Grok (xAI) did not return any content.");

        return content.Trim();
    }

    /// <summary>
    /// Picks the model id to send. Prefer the saved selection when it is still listed;
    /// otherwise <see cref="DefaultModelId"/> if listed, else the first grok* id, else the default.
    /// </summary>
    public static string ResolveModelId(string? selected, IReadOnlyList<string> listed)
    {
        listed ??= [];
        if (!string.IsNullOrWhiteSpace(selected) &&
            listed.Contains(selected, StringComparer.OrdinalIgnoreCase))
            return selected;

        if (listed.Count == 0)
            return DefaultModelId;

        foreach (var preferred in PreferredSummaryModelIds)
        {
            var match = listed.FirstOrDefault(id =>
                string.Equals(id, preferred, StringComparison.OrdinalIgnoreCase));
            if (match is not null)
                return match;
        }

        return listed[0];
    }

    private static void ApplyBearer(HttpRequestMessage request, string accessToken)
    {
        if (string.IsNullOrWhiteSpace(accessToken))
            throw new XaiException(XaiFailureKind.NotSignedIn, XaiOAuthClient.NotSignedInMessage);

        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
            return;

        // Drain so the connection can be reused; never surface the body (it may echo tokens).
        _ = await response.Content.ReadAsStringAsync(cancellationToken);

        throw response.StatusCode switch
        {
            HttpStatusCode.Unauthorized => new XaiException(XaiFailureKind.NotSignedIn, XaiOAuthClient.NotSignedInMessage),
            HttpStatusCode.PaymentRequired or (HttpStatusCode)429 =>
                new XaiException(
                    XaiFailureKind.SubscriptionOrQuota,
                    "Grok (xAI) quota or subscription limit reached. Try again later, or check your xAI account."),
            _ => new XaiException(XaiFailureKind.RequestFailed, "Grok (xAI) could not complete that request."),
        };
    }

    private sealed class ModelsDto
    {
        [JsonPropertyName("data")]
        public List<ModelDto>? Data { get; set; }
    }

    private sealed class ModelDto
    {
        [JsonPropertyName("id")]
        public string? Id { get; set; }
    }

    private sealed record ChatRequestDto(
        [property: JsonPropertyName("model")] string Model,
        [property: JsonPropertyName("messages")] IReadOnlyList<ChatMessageDto> Messages,
        [property: JsonPropertyName("temperature")] double Temperature,
        [property: JsonPropertyName("reasoning_effort")] string? ReasoningEffort);

    private sealed record ChatMessageDto(
        [property: JsonPropertyName("role")] string Role,
        [property: JsonPropertyName("content")] string Content);

    private sealed class ChatResponseDto
    {
        [JsonPropertyName("choices")]
        public List<ChatChoiceDto>? Choices { get; set; }
    }

    private sealed class ChatChoiceDto
    {
        [JsonPropertyName("message")]
        public ChatMessageDto? Message { get; set; }
    }
}
