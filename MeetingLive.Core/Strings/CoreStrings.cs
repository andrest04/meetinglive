using System.Globalization;
using System.Resources;

namespace MeetingLive.Core.Strings;

public static class CoreStrings
{
    private static readonly ResourceManager Resources = new("MeetingLive.Core.Strings.CoreStrings", typeof(CoreStrings).Assembly);

    public static string Get(string name) => Resources.GetString(name, CultureInfo.CurrentUICulture) ?? name;

    public static string Format(string name, params object?[] args) =>
        string.Format(CultureInfo.CurrentCulture, Get(name), args);
}
