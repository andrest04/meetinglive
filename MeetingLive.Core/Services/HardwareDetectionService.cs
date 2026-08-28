using System.Management;
using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

public sealed class HardwareDetectionService : IHardwareDetectionService
{
    public HardwareProfile DetectHardware()
    {
        var totalRamGb = GetTotalRamGb();
        var (gpuName, gpuVramGb) = GetPrimaryGpu();
        return new HardwareProfile(totalRamGb, gpuName, gpuVramGb);
    }

    private static double GetTotalRamGb()
    {
        using var searcher = new ManagementObjectSearcher("SELECT TotalPhysicalMemory FROM Win32_ComputerSystem");
        foreach (var item in searcher.Get())
        {
            var bytes = Convert.ToUInt64(item["TotalPhysicalMemory"]);
            return Math.Round(bytes / (1024.0 * 1024 * 1024), 1);
        }

        return 0;
    }

    private static (string? Name, double? VramGb) GetPrimaryGpu()
    {
        using var searcher = new ManagementObjectSearcher("SELECT Name, AdapterRAM FROM Win32_VideoController");
        string? bestName = null;
        double bestVram = 0;

        foreach (var item in searcher.Get())
        {
            var name = item["Name"] as string;
            var adapterRam = item["AdapterRAM"];
            var vramGb = adapterRam is null ? 0 : Convert.ToUInt64(adapterRam) / (1024.0 * 1024 * 1024);

            // AdapterRAM on WMI is a 32-bit field and often misreports for GPUs with 4GB+ VRAM;
            // still useful to pick the adapter with the largest reported value as "primary".
            if (vramGb > bestVram)
            {
                bestVram = vramGb;
                bestName = name;
            }
        }

        return (bestName, bestVram > 0 ? bestVram : null);
    }
}
