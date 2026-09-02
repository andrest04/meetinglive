namespace MeetingLive.Core.Models;

public sealed record HardwareProfile(double TotalRamGb, string? GpuName, double? GpuVramGb)
{
    public bool HasDedicatedGpu => GpuVramGb is > 0;

    /// <summary>
    /// True when the primary adapter is an NVIDIA GPU. Matches NVIDIA / GeForce / Quadro / Tesla
    /// in the WMI name (case-insensitive). Does <em>not</em> treat a bare "RTX" as NVIDIA —
    /// that substring is not vendor-specific.
    /// </summary>
    public bool HasNvidiaGpu()
    {
        if (string.IsNullOrWhiteSpace(GpuName))
            return false;

        return GpuName.Contains("NVIDIA", StringComparison.OrdinalIgnoreCase)
            || GpuName.Contains("GeForce", StringComparison.OrdinalIgnoreCase)
            || GpuName.Contains("Quadro", StringComparison.OrdinalIgnoreCase)
            || GpuName.Contains("Tesla", StringComparison.OrdinalIgnoreCase);
    }
}
