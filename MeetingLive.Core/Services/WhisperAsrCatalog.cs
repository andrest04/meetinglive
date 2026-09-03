namespace MeetingLive.Core.Services;

/// <summary>
/// Single curated Whisper GGML for offline transcription after Stop.
/// large-v3-turbo is multilingual; live preview stays on Nemotron.
/// </summary>
public static class WhisperAsrCatalog
{
    public const string FileName = "ggml-large-v3-turbo.bin";

    public const string DisplayName = "Whisper large-v3-turbo";

    public const string DownloadUrl =
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin";

    public const double FileSizeGb = 1.6;
}
