using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.TestHelpers;

public sealed class InMemoryTypeSafeCredentialStore : ITypeSafeCredentialStore
{
    private TypeSafeCredentials? _credentials;

    public TypeSafeCredentials? Load() => _credentials;

    public void Save(TypeSafeCredentials credentials) => _credentials = credentials;

    public void Clear() => _credentials = null;
}
