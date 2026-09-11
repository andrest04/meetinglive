using System.Net;
using System.Text;
using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class XaiAuthSessionTests
{
    [Fact]
    public async Task GetAccessTokenAsync_WhenExpired_RefreshesAndPersistsRotatedRefreshToken()
    {
        var store = new InMemoryXaiCredentialStore();
        store.Save(new XaiCredentials(
            XaiCredentialKind.OAuth,
            "old-access",
            "old-refresh",
            new DateTimeOffset(2026, 9, 11, 11, 0, 0, TimeSpan.Zero)));

        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            """{"access_token":"new-access","refresh_token":"new-refresh","expires_in":3600}"""));
        var now = new DateTimeOffset(2026, 9, 11, 12, 0, 0, TimeSpan.Zero);
        var oauth = new XaiOAuthClient(new HttpClient(handler), utcNow: () => now);
        var session = new XaiAuthSession(store, oauth, utcNow: () => now);

        var token = await session.GetAccessTokenAsync();

        Assert.Equal("new-access", token);
        var saved = store.Load();
        Assert.NotNull(saved);
        Assert.Equal("new-access", saved!.AccessToken);
        Assert.Equal("new-refresh", saved.RefreshToken);
        Assert.Equal(XaiCredentialKind.OAuth, saved.Kind);
    }

    [Fact]
    public async Task GetAccessTokenAsync_WhenApiKey_DoesNotRefresh()
    {
        var store = new InMemoryXaiCredentialStore();
        store.Save(new XaiCredentials(XaiCredentialKind.ApiKey, "xai-key", null, null));
        var handler = new FakeHttpMessageHandler(_ => throw new InvalidOperationException("network"));
        var session = new XaiAuthSession(store, new XaiOAuthClient(new HttpClient(handler)));

        var token = await session.GetAccessTokenAsync();

        Assert.Equal("xai-key", token);
        Assert.Null(handler.LastRequest);
    }

    [Fact]
    public void SaveApiKey_ReplacesOAuth()
    {
        var store = new InMemoryXaiCredentialStore();
        var session = new XaiAuthSession(store, new XaiOAuthClient(new HttpClient(new FakeHttpMessageHandler(_ => new HttpResponseMessage()))));
        session.SaveOAuth(new XaiCredentials(XaiCredentialKind.OAuth, "access", "refresh", DateTimeOffset.UtcNow.AddHours(1)));

        session.SaveApiKey(" pasted-key ");

        var saved = store.Load();
        Assert.Equal(XaiCredentialKind.ApiKey, saved!.Kind);
        Assert.Equal("pasted-key", saved.AccessToken);
        Assert.Null(saved.RefreshToken);
    }

    [Fact]
    public async Task GetAccessTokenAsync_WhenExpiresInMissing_UsesUnsignedJwtExp()
    {
        var exp = new DateTimeOffset(2026, 9, 11, 11, 0, 0, TimeSpan.Zero).ToUnixTimeSeconds();
        var jwt = UnsignedJwt(exp);
        var store = new InMemoryXaiCredentialStore();
        store.Save(new XaiCredentials(XaiCredentialKind.OAuth, jwt, "refresh", ExpiresAt: null));

        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.OK,
            """{"access_token":"refreshed","refresh_token":"refresh-2","expires_in":60}"""));
        var now = new DateTimeOffset(2026, 9, 11, 12, 0, 0, TimeSpan.Zero);
        var session = new XaiAuthSession(
            store,
            new XaiOAuthClient(new HttpClient(handler), utcNow: () => now),
            utcNow: () => now);

        var token = await session.GetAccessTokenAsync();

        Assert.Equal("refreshed", token);
        Assert.NotNull(handler.LastRequest);
    }

    private static string UnsignedJwt(long expUnix)
    {
        static string B64Url(string json)
        {
            var bytes = Encoding.UTF8.GetBytes(json);
            return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        return $"{B64Url("""{"alg":"none"}""")}.{B64Url($"{{\"exp\":{expUnix}}}")}.sig";
    }
}
