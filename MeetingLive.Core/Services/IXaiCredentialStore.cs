namespace MeetingLive.Core.Services;

public interface IXaiCredentialStore
{
    XaiCredentials? Load();

    void Save(XaiCredentials credentials);

    void Clear();
}
