using System.Net;

namespace MeetingLive.Core.Tests.TestHelpers;

/// <summary>
/// Minimal HttpMessageHandler test double. HttpMessageHandler.SendAsync is protected,
/// which mocking libraries like NSubstitute can't intercept directly — subclassing is
/// the standard way to fake an HttpClient's transport in tests.
/// </summary>
public sealed class FakeHttpMessageHandler : HttpMessageHandler
{
    private readonly Func<HttpRequestMessage, int, HttpResponseMessage> _respond;
    private int _callIndex;

    public FakeHttpMessageHandler(Func<HttpRequestMessage, HttpResponseMessage> respond)
        : this((request, _) => respond(request))
    {
    }

    public FakeHttpMessageHandler(Func<HttpRequestMessage, int, HttpResponseMessage> respond)
    {
        _respond = respond;
    }

    public HttpRequestMessage? LastRequest { get; private set; }
    public string? LastRequestBody { get; private set; }
    public IReadOnlyList<HttpRequestMessage> Requests => _requests;
    public IReadOnlyList<string?> RequestBodies => _bodies;

    private readonly List<HttpRequestMessage> _requests = [];
    private readonly List<string?> _bodies = [];

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        LastRequest = request;
        LastRequestBody = request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken);
        _requests.Add(request);
        _bodies.Add(LastRequestBody);
        var index = _callIndex++;
        return _respond(request, index);
    }

    public static HttpResponseMessage JsonResponse(HttpStatusCode statusCode, string json) => new(statusCode)
    {
        Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json"),
    };
}
