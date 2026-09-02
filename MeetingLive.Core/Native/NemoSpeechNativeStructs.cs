using System.Runtime.InteropServices;

namespace MeetingLive.Core.Native;

/// <summary>POD mirror of <c>nemo_speech_asr_backend_config</c> (x64 MSVC layout).</summary>
[StructLayout(LayoutKind.Explicit, Size = 16)]
internal struct NemoSpeechAsrBackendConfig
{
    [FieldOffset(0)] public nuint Size;
    [FieldOffset(8)] public int Gpu;
}

/// <summary>POD mirror of <c>nemo_speech_asr_model_config</c>.</summary>
[StructLayout(LayoutKind.Explicit, Size = 24)]
internal struct NemoSpeechAsrModelConfig
{
    [FieldOffset(0)] public nuint Size;
    [FieldOffset(8)] public IntPtr Path;
    [FieldOffset(16)] public IntPtr Name;
}

/// <summary>POD mirror of <c>nemo_speech_asr_streaming_config</c>.</summary>
[StructLayout(LayoutKind.Explicit, Size = 24)]
internal struct NemoSpeechAsrStreamingConfig
{
    [FieldOffset(0)] public nuint Size;
    [FieldOffset(8)] public float ChunkSize;
    [FieldOffset(12)] public float CtcLeftPadding;
    [FieldOffset(16)] public float CtcRightPadding;
    [FieldOffset(20)] public int RnntRightContext;
}

/// <summary>POD mirror of <c>nemo_speech_asr_recognizer_config</c>. Unused subsystem pointers stay NULL.</summary>
[StructLayout(LayoutKind.Explicit, Size = 80)]
internal struct NemoSpeechAsrRecognizerConfig
{
    [FieldOffset(0)] public nuint Size;
    [FieldOffset(8)] public IntPtr Backend;
    [FieldOffset(16)] public IntPtr Model;
    [FieldOffset(24)] public IntPtr Streaming;
    [FieldOffset(32)] public IntPtr Decoder;
    [FieldOffset(40)] public IntPtr Vad;
    [FieldOffset(48)] public IntPtr Endpointing;
    [FieldOffset(56)] public IntPtr Postproc;
    [FieldOffset(64)] public IntPtr Diar;
    [FieldOffset(72)] public IntPtr Batching;
}

/// <summary>
/// POD mirror of <c>nemo_speech_asr_recognition_options</c>. C <c>bool</c> is 1 byte —
/// stored as <see cref="byte"/> so C# bool (4 bytes) cannot shift the tail fields.
/// </summary>
[StructLayout(LayoutKind.Explicit, Size = 72)]
internal struct NemoSpeechAsrRecognitionOptions
{
    [FieldOffset(0)] public nuint Size;
    [FieldOffset(8)] public IntPtr RequestId;
    [FieldOffset(16)] public IntPtr LanguageCode;
    [FieldOffset(24)] public byte InterimResults;
    [FieldOffset(25)] public byte EnableWordTimeOffsets;
    [FieldOffset(26)] public byte EnableAutomaticPunctuation;
    [FieldOffset(27)] public byte VerbatimTranscripts;
    [FieldOffset(28)] public byte ProfanityFilter;
    [FieldOffset(32)] public int StopHistoryEouMs;
    [FieldOffset(40)] public IntPtr SpeechContexts;
    [FieldOffset(48)] public nuint SpeechContextCount;
    [FieldOffset(56)] public int MaxAlternatives;
    [FieldOffset(60)] public byte EnableSpeakerDiarization;
    [FieldOffset(64)] public int MaxSpeakerCount;
}
