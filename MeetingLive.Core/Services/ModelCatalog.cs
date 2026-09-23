using MeetingLive.Core.Models;
using MeetingLive.Core.Strings;

namespace MeetingLive.Core.Services;

/// <summary>
/// Curated list of quantized GGUF models suitable for local, in-process meeting
/// summarization via LLamaSharp. Not benchmarked live — RAM/quality figures are
/// community-documented baselines, compared against the detected <see cref="HardwareProfile"/>.
/// All entries are Q4_K_M quantizations (the standard size/quality default), downloaded
/// on demand the same way the Nemotron ASR GGUF is. The 1B Llama entry is hosted on Hugging
/// Face by bartowski; the Gemma 4 entries are hosted by unsloth.
/// </summary>
public static class ModelCatalog
{
    public static readonly IReadOnlyList<SummaryModelInfo> SummaryModels =
    [
        new SummaryModelInfo(
            FileName: "Llama-3.2-1B-Instruct-Q4_K_M.gguf",
            DisplayName: "Llama 3.2 1B Instruct",
            DownloadUrl: "https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf",
            FileSizeGb: 0.81,
            MinRamGb: 4,
            Speed: CoreStrings.Get("ModelSpeedVeryFast"),
            Quality: CoreStrings.Get("ModelQualityGood"),
            UseCase: CoreStrings.Get("ModelUseCaseModestPcs")),
        new SummaryModelInfo(
            FileName: "gemma-4-E2B-it-Q4_K_M.gguf",
            DisplayName: "Gemma 4 E2B Instruct",
            DownloadUrl: "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf",
            FileSizeGb: 3.11,
            MinRamGb: 6,
            Speed: CoreStrings.Get("ModelSpeedFast"),
            Quality: CoreStrings.Get("ModelQualityVeryGood"),
            UseCase: CoreStrings.Get("ModelUseCaseRecommendedDefault")),
        new SummaryModelInfo(
            FileName: "gemma-4-E4B-it-Q4_K_M.gguf",
            DisplayName: "Gemma 4 E4B Instruct",
            DownloadUrl: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-Q4_K_M.gguf",
            FileSizeGb: 4.98,
            MinRamGb: 8,
            Speed: CoreStrings.Get("ModelSpeedMedium"),
            Quality: CoreStrings.Get("ModelQualityExcellent"),
            UseCase: CoreStrings.Get("ModelUseCasePc16GbOrGpu")),
        new SummaryModelInfo(
            FileName: "gemma-4-12b-it-Q4_K_M.gguf",
            DisplayName: "Gemma 4 12B Instruct",
            DownloadUrl: "https://huggingface.co/unsloth/gemma-4-12b-it-GGUF/resolve/main/gemma-4-12b-it-Q4_K_M.gguf",
            FileSizeGb: 7.12,
            MinRamGb: 16,
            Speed: CoreStrings.Get("ModelSpeedSlowWithoutGpu"),
            Quality: CoreStrings.Get("ModelQualityExcellent"),
            UseCase: CoreStrings.Get("ModelUseCaseGpuOnly")),
    ];
}
