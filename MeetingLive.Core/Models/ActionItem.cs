namespace MeetingLive.Core.Models;

/// <summary>
/// One checkbox line under a meeting's "## Action Items" Markdown section
/// (<c>- [ ] ...</c> / <c>- [x] ...</c>). A mutable class, not a record, so the
/// WinUI ViewModel wrapper can bind <see cref="IsDone"/> directly.
/// </summary>
public sealed class ActionItem
{
    public string Text { get; set; } = string.Empty;

    public bool IsDone { get; set; }
}
