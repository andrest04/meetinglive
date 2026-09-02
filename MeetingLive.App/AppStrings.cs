using System.Globalization;
using Windows.ApplicationModel.Resources;

namespace MeetingLive_App;

/// <summary>Lookup for <c>Strings/en-us/Resources.resw</c>. XAML uses <c>x:Uid</c>; C# uses this.</summary>
internal static class AppStrings
{
    private static readonly Lazy<ResourceLoader> Loader = new(ResourceLoader.GetForViewIndependentUse);

    public static string Get(string name) => Loader.Value.GetString(name);

    public static string Format(string name, params object?[] args) =>
        string.Format(CultureInfo.CurrentCulture, Loader.Value.GetString(name), args);

    public static string MeetingTitle(DateTime when) =>
        Format("MeetingTitleFormat", when.ToString(Get("MeetingTitleDateFormat"), CultureInfo.CurrentCulture));
}
