namespace MeetingLive.Core.Models;

/// <summary>Small local settings blob — currently just the user's chosen local GGUF summary model.</summary>
public sealed class AppSettings
{
    /// <summary>The <see cref="SummaryModelInfo.FileName"/> of the selected local summary model.</summary>
    public string? SelectedSummaryModelId { get; set; }
}
