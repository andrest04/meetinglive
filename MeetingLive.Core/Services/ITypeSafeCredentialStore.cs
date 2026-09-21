namespace MeetingLive.Core.Services;

public interface ITypeSafeCredentialStore
{
    TypeSafeCredentials? Load();

    void Save(TypeSafeCredentials credentials);

    void Clear();
}
