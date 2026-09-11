using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.TestHelpers;

public sealed class InMemoryXaiCredentialStore : IXaiCredentialStore
{
    private XaiCredentials? _credentials;

    public XaiCredentials? Load() => _credentials;

    public void Save(XaiCredentials credentials) => _credentials = credentials;

    public void Clear() => _credentials = null;
}
