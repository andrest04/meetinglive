namespace MeetingLive.Core.Models;

public sealed record HardwareProfile(double TotalRamGb, string? GpuName, double? GpuVramGb)
{
    public bool HasDedicatedGpu => GpuVramGb is > 0;
}
