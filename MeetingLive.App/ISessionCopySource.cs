namespace MeetingLive_App;

/// <summary>
/// Implemented by the tab pages hosted in <see cref="SessionPage"/> so the shared header
/// toolbar can copy whatever the active tab is showing.
/// </summary>
public interface ISessionCopySource
{
    /// <summary>The text the user currently sees on the tab, or null when there is nothing to copy.</summary>
    string? GetCopyText();
}
