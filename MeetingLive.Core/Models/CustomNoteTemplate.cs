namespace MeetingLive.Core.Models;

/// <summary>The one user-saved note template. Private to this device. Not shared.</summary>
public sealed class CustomNoteTemplate
{
    public string Name { get; set; } = string.Empty;

    public string Instructions { get; set; } = string.Empty;
}
