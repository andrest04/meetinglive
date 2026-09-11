using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MeetingLive.Core.Services;

/// <summary>
/// Persists <see cref="XaiCredentials"/> with DPAPI <see cref="DataProtectionScope.CurrentUser"/>.
/// PasswordVault maxes out at 512 characters; xAI JWTs can be larger, so this is a file under
/// <see cref="AppPaths.XaiCredentialsFilePath"/> (or an injected path in tests).
/// </summary>
public sealed class FileDpapiXaiCredentialStore : IXaiCredentialStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _path;
    private readonly object _gate = new();

    public FileDpapiXaiCredentialStore(string? path = null)
    {
        _path = path ?? AppPaths.XaiCredentialsFilePath;
    }

    public XaiCredentials? Load()
    {
        lock (_gate)
        {
            if (!File.Exists(_path))
                return null;

            try
            {
                var encrypted = File.ReadAllBytes(_path);
                if (encrypted.Length == 0)
                    return null;

                var json = Encoding.UTF8.GetString(
                    ProtectedData.Unprotect(encrypted, optionalEntropy: null, DataProtectionScope.CurrentUser));
                var credentials = JsonSerializer.Deserialize<XaiCredentials>(json, JsonOptions);
                if (credentials is null || string.IsNullOrWhiteSpace(credentials.AccessToken))
                    return null;

                return credentials;
            }
            catch (Exception ex) when (ex is CryptographicException or JsonException or IOException or UnauthorizedAccessException)
            {
                return null;
            }
        }
    }

    public void Save(XaiCredentials credentials)
    {
        ArgumentNullException.ThrowIfNull(credentials);
        if (string.IsNullOrWhiteSpace(credentials.AccessToken))
            throw new ArgumentException("Access token is required.", nameof(credentials));

        var directory = Path.GetDirectoryName(_path);
        if (!string.IsNullOrEmpty(directory))
            Directory.CreateDirectory(directory);

        var json = JsonSerializer.Serialize(credentials, JsonOptions);
        var encrypted = ProtectedData.Protect(
            Encoding.UTF8.GetBytes(json),
            optionalEntropy: null,
            DataProtectionScope.CurrentUser);

        lock (_gate)
        {
            File.WriteAllBytes(_path, encrypted);
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            if (!File.Exists(_path))
                return;

            try
            {
                File.Delete(_path);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
            }
        }
    }
}
