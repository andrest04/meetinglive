using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage;
using Windows.Storage.FileProperties;

namespace MeetingLive_App.Services;

/// <summary>
/// Shell icon of an executable, loaded once per path. Call it from the UI thread: the file and thumbnail
/// reads are WinRT async calls that run off the UI thread, and only the final <see cref="BitmapImage"/> decode
/// resumes on it. A path that cannot be read (packaged apps, access denied) caches null and the card shows a glyph.
/// </summary>
internal static class AppIconCache
{
    private const uint IconSize = 32;

    private static readonly Dictionary<string, Task<ImageSource?>> Cache = new(StringComparer.OrdinalIgnoreCase);

    public static Task<ImageSource?> GetAsync(string? exePath)
    {
        if (string.IsNullOrWhiteSpace(exePath))
            return Task.FromResult<ImageSource?>(null);

        if (!Cache.TryGetValue(exePath, out var pending))
        {
            pending = LoadAsync(exePath);
            Cache[exePath] = pending;
        }

        return pending;
    }

    private static async Task<ImageSource?> LoadAsync(string exePath)
    {
        try
        {
            var file = await StorageFile.GetFileFromPathAsync(exePath);
            using var thumbnail = await file.GetThumbnailAsync(ThumbnailMode.SingleItem, IconSize, ThumbnailOptions.UseCurrentScale);
            if (thumbnail is null || thumbnail.Size == 0)
                return null;

            var image = new BitmapImage();
            await image.SetSourceAsync(thumbnail);
            return image;
        }
        catch (Exception)
        {
            return null;
        }
    }
}
