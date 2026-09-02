using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>
/// Pinned Nemotron 3.5 ASR streaming artifacts. Runtime zips are NeMo-Speech.cpp v0.1.0
/// (ABI-stable); "latest" for the user means re-downloading these known files, not floating nightlies.
/// </summary>
public static class NemotronAsrCatalog
{
    public const string FileName = "nemotron-3.5-asr-streaming-0.6b.q8_0.gguf";

    public const string DisplayName = "Nemotron 3.5 ASR Streaming 0.6B";

    public const string DownloadUrl =
        "https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b/resolve/main/nemotron-3.5-asr-streaming-0.6b.q8_0.gguf";

    public const double FileSizeGb = 0.74;

    public const string RuntimeVersion = "v0.1.0";

    public const string NativeLibraryFileName = "nemo_speech_asr_c.dll";

    public const string CpuZipUrl =
        "https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.1.0/nemo-speech-0.1.0-windows-x86_64-cpu.zip";

    public const string CpuZipSha256 = "5e4ea81046012edcd77fd8848de8eefb5a4ba38cc26f52eb544ab184695a75d6";

    public const string CudaZipUrl =
        "https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v0.1.0/nemo-speech-0.1.0-windows-x86_64-cuda.zip";

    public const string CudaZipSha256 = "ba024204e76ca2fa4eefa8787506c3c49e418147f627f60cf9206a582b60089c";

    public static string ZipUrl(NemoSpeechBackend backend) =>
        backend == NemoSpeechBackend.Cuda ? CudaZipUrl : CpuZipUrl;

    public static string ZipSha256(NemoSpeechBackend backend) =>
        backend == NemoSpeechBackend.Cuda ? CudaZipSha256 : CpuZipSha256;

    public static string BackendFolderName(NemoSpeechBackend backend) =>
        backend == NemoSpeechBackend.Cuda ? "cuda" : "cpu";
}
