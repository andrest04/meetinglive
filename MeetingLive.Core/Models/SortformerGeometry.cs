namespace MeetingLive.Core.Models;

/// <summary>
/// Streaming Sortformer chunk geometry. <see cref="Streaming"/> keeps library
/// defaults (~1.6 s). <see cref="Meeting"/> is NVIDIA's published very-high-latency
/// profile for the offline WAV pass (best DER).
/// </summary>
public enum SortformerGeometry
{
    Streaming,
    Meeting,
}
