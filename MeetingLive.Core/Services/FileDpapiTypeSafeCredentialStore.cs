using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MeetingLive.Core.Services;

/// <summary>
/// Persists <see cref="TypeSafeCredentials"/> with DPAPI <see cref="DataProtectionScope.CurrentUser"/>.
/// </summary>
public sealed class FileDpapiTypeSafeCredentialStore : ITypeSafeCredentialStore
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _path;
    private readonly object _gate = new();

    public FileDpapiTypeSafeCredentialStore(string? path = null)
    {
        _path = path ?? AppPaths.TypeSafeCredentialsFilePath;
    }

    public TypeSafeCredentials? Load()
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
                var credentials = JsonSerializer.Deserialize<TypeSafeCredentials>(json, JsonOptions);
                if (credentials is null || string.IsNullOrWhiteSpace(credentials.ApiKey))
                    return null;

                return credentials;
            }
            catch (Exception ex) when (ex is CryptographicException or JsonException or IOException or UnauthorizedAccessException)
            {
                return null;
            }
        }
    }

    public void Save(TypeSafeCredentials credentials)
    {
        ArgumentNullException.ThrowIfNull(credentials);
        if (string.IsNullOrWhiteSpace(credentials.ApiKey))
            throw new ArgumentException("API key is required.", nameof(credentials));

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
