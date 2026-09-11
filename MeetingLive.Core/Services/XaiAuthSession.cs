namespace MeetingLive.Core.Services;

/// <summary>
/// Loads, refreshes, and replaces xAI credentials. Saving an API key replaces OAuth and vice versa.
/// </summary>
public sealed class XaiAuthSession
{
    private static readonly TimeSpan RefreshSkew = TimeSpan.FromSeconds(120);

    private readonly IXaiCredentialStore _store;
    private readonly XaiOAuthClient _oauth;
    private readonly Func<DateTimeOffset> _utcNow;
    private readonly SemaphoreSlim _refreshLock = new(1, 1);

    public XaiAuthSession(
        IXaiCredentialStore store,
        XaiOAuthClient oauth,
        Func<DateTimeOffset>? utcNow = null)
    {
        _store = store ?? throw new ArgumentNullException(nameof(store));
        _oauth = oauth ?? throw new ArgumentNullException(nameof(oauth));
        _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
    }

    public bool HasCredentials
    {
        get
        {
            var credentials = _store.Load();
            return credentials is not null && !string.IsNullOrWhiteSpace(credentials.AccessToken);
        }
    }

    public XaiCredentialKind? CredentialKind => _store.Load()?.Kind;

    public async Task<string> GetAccessTokenAsync(CancellationToken cancellationToken = default)
    {
        var credentials = _store.Load();
        if (credentials is null || string.IsNullOrWhiteSpace(credentials.AccessToken))
            throw new XaiException(XaiFailureKind.NotSignedIn, XaiOAuthClient.NotSignedInMessage);

        if (credentials.Kind == XaiCredentialKind.ApiKey)
            return credentials.AccessToken;

        if (!NeedsRefresh(credentials))
            return credentials.AccessToken;

        await _refreshLock.WaitAsync(cancellationToken);
        try
        {
            credentials = _store.Load();
            if (credentials is null || string.IsNullOrWhiteSpace(credentials.AccessToken))
                throw new XaiException(XaiFailureKind.NotSignedIn, XaiOAuthClient.NotSignedInMessage);

            if (credentials.Kind == XaiCredentialKind.ApiKey || !NeedsRefresh(credentials))
                return credentials.AccessToken;

            if (string.IsNullOrWhiteSpace(credentials.RefreshToken))
                throw new XaiException(XaiFailureKind.NotSignedIn, XaiOAuthClient.NotSignedInMessage);

            var refreshed = await _oauth.RefreshAccessTokenAsync(credentials.RefreshToken, cancellationToken);
            _store.Save(refreshed);
            return refreshed.AccessToken;
        }
        finally
        {
            _refreshLock.Release();
        }
    }

    public void SaveApiKey(string apiKey)
    {
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new ArgumentException("API key is required.", nameof(apiKey));

        _store.Save(new XaiCredentials(XaiCredentialKind.ApiKey, apiKey.Trim(), RefreshToken: null, ExpiresAt: null));
    }

    public void SaveOAuth(XaiCredentials credentials)
    {
        ArgumentNullException.ThrowIfNull(credentials);
        _store.Save(credentials with { Kind = XaiCredentialKind.OAuth });
    }

    public void SignOut() => _store.Clear();

    private bool NeedsRefresh(XaiCredentials credentials)
    {
        var expiresAt = credentials.ExpiresAt ?? XaiJwt.TryReadExpiry(credentials.AccessToken);
        if (expiresAt is null)
            return false;

        return expiresAt.Value - _utcNow() <= RefreshSkew;
    }
}
