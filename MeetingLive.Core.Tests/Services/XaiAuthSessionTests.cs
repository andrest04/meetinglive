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

    private static readonly DateTimeOffset Now = new(2026, 9, 11, 12, 0, 0, TimeSpan.Zero);

    private static InMemoryXaiCredentialStore ExpiredOAuthStore()
    {
        var store = new InMemoryXaiCredentialStore();
        store.Save(new XaiCredentials(XaiCredentialKind.OAuth, "old-access", "old-refresh", Now.AddHours(-1)));
        return store;
    }

    private static XaiAuthSession SessionOver(InMemoryXaiCredentialStore store, FakeHttpMessageHandler handler) =>
        new(store, new XaiOAuthClient(new HttpClient(handler), utcNow: () => Now), utcNow: () => Now);

    private static HttpResponseMessage RefreshedResponse() => FakeHttpMessageHandler.JsonResponse(
        HttpStatusCode.OK,
        """{"access_token":"new-access","refresh_token":"new-refresh","expires_in":3600}""");

    [Fact]
    public async Task GetAccessTokenAsync_WhenSignedOutDuringRefresh_PersistsNothingAndReportsNotSignedIn()
    {
        var store = ExpiredOAuthStore();
        XaiAuthSession session = null!;
        session = SessionOver(store, new FakeHttpMessageHandler(_ =>
        {
            session.SignOut();
            return RefreshedResponse();
        }));

        var exception = await Assert.ThrowsAsync<XaiException>(() => session.GetAccessTokenAsync());

        Assert.Equal(XaiFailureKind.NotSignedIn, exception.Kind);
        Assert.Null(store.Load());
        Assert.False(session.HasCredentials);
    }

    [Fact]
    public async Task GetAccessTokenAsync_WhenAnApiKeyIsSavedDuringRefresh_KeepsTheApiKey()
    {
        var store = ExpiredOAuthStore();
        XaiAuthSession session = null!;
        session = SessionOver(store, new FakeHttpMessageHandler(_ =>
        {
            session.SaveApiKey("pasted-key");
            return RefreshedResponse();
        }));

        var token = await session.GetAccessTokenAsync();

        Assert.Equal("pasted-key", token);
        Assert.Equal(XaiCredentialKind.ApiKey, store.Load()!.Kind);
        Assert.Equal("pasted-key", store.Load()!.AccessToken);
    }

    [Fact]
    public async Task SignOut_DuringAnInFlightRefresh_DoesNotWaitForTheNetwork()
    {
        var store = ExpiredOAuthStore();
        var requestStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new ManualResetEventSlim();
        using (release)
        {
            var session = SessionOver(store, new FakeHttpMessageHandler(_ =>
            {
                requestStarted.TrySetResult();
                release.Wait(TimeSpan.FromSeconds(30));
                return RefreshedResponse();
            }));

            var refresh = Task.Run(() => session.GetAccessTokenAsync());
            await requestStarted.Task.WaitAsync(TimeSpan.FromSeconds(30));

            var signOut = Task.Run(session.SignOut);
            var signedOutFirst = await Task.WhenAny(signOut, Task.Delay(TimeSpan.FromSeconds(30))) == signOut;
            release.Set();

            Assert.True(signedOutFirst);
            await Assert.ThrowsAsync<XaiException>(() => refresh);
            Assert.Null(store.Load());
        }
    }

    [Theory]
    [InlineData(HttpStatusCode.ServiceUnavailable, "")]
    [InlineData(HttpStatusCode.TooManyRequests, """{"error":"rate_limited"}""")]
    public async Task GetAccessTokenAsync_WhenRefreshFailsTransiently_KeepsTheStoredCredentials(HttpStatusCode status, string body)
    {
        var store = ExpiredOAuthStore();
        var session = SessionOver(store, new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(status, body)));

        var exception = await Assert.ThrowsAsync<XaiException>(() => session.GetAccessTokenAsync());

        Assert.Equal(XaiFailureKind.RequestFailed, exception.Kind);
        Assert.Equal("old-refresh", store.Load()!.RefreshToken);
        Assert.True(session.HasCredentials);
    }
}
