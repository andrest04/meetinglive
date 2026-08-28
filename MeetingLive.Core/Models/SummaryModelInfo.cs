namespace MeetingLive.Core.Models;

public enum FitRating
{
    Recommended,
    MayBeSlow,
    NotRecommended,
}

/// <summary>
/// One entry in the curated GGUF model catalog. <see cref="FileName"/> doubles as the
/// stable identifier persisted in <see cref="AppSettings.SelectedSummaryModelId"/> and
/// as the on-disk file name under <c>AppPaths.SummaryModelsDirectory</c>.
/// </summary>
public sealed record SummaryModelInfo(
    string FileName,
    string DisplayName,
    string DownloadUrl,
    double FileSizeGb,
    double MinRamGb,
    string Speed,
    string Quality,
    string UseCase)
{
    public FitRating RateFor(HardwareProfile hardware)
    {
        if (hardware.TotalRamGb >= MinRamGb || (hardware.HasDedicatedGpu && hardware.GpuVramGb >= MinRamGb / 2))
            return FitRating.Recommended;

        if (hardware.TotalRamGb >= MinRamGb * 0.75)
            return FitRating.MayBeSlow;

        return FitRating.NotRecommended;
    }
}
