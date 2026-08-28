namespace MeetingLive.Core.Models;

public sealed class MeetingRecord
{
    public required Guid Id { get; init; }
    public required string Title { get; set; }
    public required DateTimeOffset RecordedAt { get; init; }
    public required string AudioFilePath { get; init; }
    public string? Transcript { get; set; }
    public string? Summary { get; set; }
}
