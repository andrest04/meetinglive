namespace MeetingLive.Core.Services;

/// <summary>
/// Join link for an appointment. A dedicated online-meeting or appointment URI wins.
/// Otherwise the first https URL in location, then details.
/// </summary>
public static class CalendarJoinUrl
{
    public static string? Resolve(string? onlineMeetingLink, string? appointmentUri, string? location, string? details) =>
        FirstHttpUri(onlineMeetingLink)
        ?? FirstHttpUri(appointmentUri)
        ?? FirstHttpsInText(location)
        ?? FirstHttpsInText(details);

    public static string? FirstHttpUri(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
            return null;

        if (!Uri.TryCreate(value.Trim(), UriKind.Absolute, out var uri))
            return null;

        if (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)
            return null;

        return uri.AbsoluteUri;
    }

    public static string? FirstHttpsInText(string? text)
    {
        if (string.IsNullOrEmpty(text))
            return null;

        var index = text.IndexOf("https://", StringComparison.OrdinalIgnoreCase);
        if (index < 0)
            return null;

        var end = index;
        while (end < text.Length && !char.IsWhiteSpace(text[end]) && text[end] is not '<' and not '>' and not '"' and not '\'')
            end++;

        var candidate = text[index..end].TrimEnd('.', ',', ';', ')');
        return FirstHttpUri(candidate);
    }
}
