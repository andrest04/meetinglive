using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MeetingLive.Core.Services;

/// <summary>TypeSafe System One HTTP API at https://api.typesafe.ai/v1.</summary>
public sealed class TypeSafeApiClient
{
    public const string ApiBaseUrl = "https://api.typesafe.ai/v1";
    public const string DefaultModelId = "jev-latest";

    internal const string UnauthorizedMessage = "TypeSafe API key is missing or invalid.";
    internal const string RateLimitedMessage = "TypeSafe rate limit reached. Try again later.";
    internal const string OverloadedMessage = "TypeSafe is temporarily overloaded. Try again later.";
    internal const string RequestFailedMessage = "TypeSafe could not complete that request.";
    internal const string EmptyOutputMessage = "TypeSafe did not return any answers.";

    private const string UserAgentValue = "MeetingLive";
    private const int MaxAttempts = 3;

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private readonly HttpClient _http;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;

    public TypeSafeApiClient(HttpClient http)
        : this(http, static (delay, cancellationToken) => Task.Delay(delay, cancellationToken))
    {
    }

    internal TypeSafeApiClient(HttpClient http, Func<TimeSpan, CancellationToken, Task> delay)
    {
        _http = http ?? throw new ArgumentNullException(nameof(http));
        _delay = delay ?? throw new ArgumentNullException(nameof(delay));
    }

    public async Task<TypeSafeEvaluationResult> EvaluateAsync(
        string apiKey,
        object state,
        IReadOnlyDictionary<string, TypeSafeQuestion> questions,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(questions);

        var body = JsonSerializer.Serialize(
            new EvaluateRequestDto(state, DefaultModelId, questions),
            JsonOptions);

        using var response = await SendWithRetryAsync(
            () =>
            {
                var request = new HttpRequestMessage(HttpMethod.Post, ApiBaseUrl + "/systemone")
                {
                    Content = new StringContent(body, Encoding.UTF8, "application/json"),
                };
                ApplyHeaders(request, apiKey);
                return request;
            },
            cancellationToken);

        await EnsureSuccessAsync(response, cancellationToken);

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        EvaluateResponseDto? dto;
        try
        {
            dto = await JsonSerializer.DeserializeAsync<EvaluateResponseDto>(stream, JsonOptions, cancellationToken);
        }
        catch (JsonException)
        {
            throw new TypeSafeException(TypeSafeFailureKind.RequestFailed, RequestFailedMessage);
        }

        if (dto?.Answers is null || dto.Answers.Count == 0)
            throw new TypeSafeException(TypeSafeFailureKind.EmptyOutput, EmptyOutputMessage);

        return new TypeSafeEvaluationResult
        {
            Model = string.IsNullOrWhiteSpace(dto.Model) ? DefaultModelId : dto.Model,
            Answers = dto.Answers,
        };
    }

    public async Task<IReadOnlyList<string>> ListModelsAsync(
        string apiKey,
        CancellationToken cancellationToken = default)
    {
        using var response = await SendWithRetryAsync(
            () =>
            {
                var request = new HttpRequestMessage(HttpMethod.Get, ApiBaseUrl + "/models");
                ApplyHeaders(request, apiKey);
                return request;
            },
            cancellationToken);

        await EnsureSuccessAsync(response, cancellationToken);

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        ModelsDto? dto;
        try
        {
            dto = await JsonSerializer.DeserializeAsync<ModelsDto>(stream, JsonOptions, cancellationToken);
        }
        catch (JsonException)
        {
            throw new TypeSafeException(TypeSafeFailureKind.RequestFailed, RequestFailedMessage);
        }

        if (dto?.Models is null)
            return [];

        return dto.Models
            .Select(item => item.Name)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name!)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private async Task<HttpResponseMessage> SendWithRetryAsync(
        Func<HttpRequestMessage> createRequest,
        CancellationToken cancellationToken)
    {
        HttpResponseMessage? response = null;
        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            response?.Dispose();
            using var request = createRequest();
            response = await _http.SendAsync(request, cancellationToken);

            if (!IsRetryable(response.StatusCode) || attempt == MaxAttempts - 1)
                return response;

            var delay = GetRetryDelay(response, attempt);
            _ = await response.Content.ReadAsStringAsync(cancellationToken);
            if (delay > TimeSpan.Zero)
                await _delay(delay, cancellationToken);
        }

        throw new TypeSafeException(TypeSafeFailureKind.RequestFailed, RequestFailedMessage);
    }

    private static void ApplyHeaders(HttpRequestMessage request, string apiKey)
    {
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new TypeSafeException(TypeSafeFailureKind.Unauthorized, UnauthorizedMessage);

        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiKey);
        request.Headers.TryAddWithoutValidation("User-Agent", UserAgentValue);
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
            return;

        // Drain so the connection can be reused; never surface the body (it may echo keys).
        _ = await response.Content.ReadAsStringAsync(cancellationToken);

        throw response.StatusCode switch
        {
            HttpStatusCode.Unauthorized => new TypeSafeException(TypeSafeFailureKind.Unauthorized, UnauthorizedMessage),
            HttpStatusCode.TooManyRequests => new TypeSafeException(TypeSafeFailureKind.RateLimited, RateLimitedMessage),
            (HttpStatusCode)529 => new TypeSafeException(TypeSafeFailureKind.Overloaded, OverloadedMessage),
            _ => new TypeSafeException(TypeSafeFailureKind.RequestFailed, RequestFailedMessage),
        };
    }

    private static bool IsRetryable(HttpStatusCode statusCode) =>
        statusCode is HttpStatusCode.TooManyRequests || (int)statusCode == 529;

    private static TimeSpan GetRetryDelay(HttpResponseMessage response, int attempt)
    {
        if (response.Headers.RetryAfter is { } retryAfter)
        {
            if (retryAfter.Delta is { } delta && delta > TimeSpan.Zero)
                return delta;
            if (retryAfter.Date is { } date)
            {
                var wait = date - DateTimeOffset.UtcNow;
                if (wait > TimeSpan.Zero)
                    return wait;
            }
        }

        return TimeSpan.FromMilliseconds(200 * (1 << attempt));
    }

    private sealed record EvaluateRequestDto(
        [property: JsonPropertyName("state")] object State,
        [property: JsonPropertyName("model")] string Model,
        [property: JsonPropertyName("questions")] IReadOnlyDictionary<string, TypeSafeQuestion> Questions);

    private sealed class EvaluateResponseDto
    {
        [JsonPropertyName("model")]
        public string? Model { get; set; }

        [JsonPropertyName("answers")]
        public Dictionary<string, TypeSafeAnswer>? Answers { get; set; }
    }

    private sealed class ModelsDto
    {
        [JsonPropertyName("models")]
        public List<ModelDto>? Models { get; set; }
    }

    private sealed class ModelDto
    {
        [JsonPropertyName("name")]
        public string? Name { get; set; }
    }
}
