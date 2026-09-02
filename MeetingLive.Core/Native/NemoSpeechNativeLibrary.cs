using System.Runtime.InteropServices;

namespace MeetingLive.Core.Native;

/// <summary>
/// Loads <c>nemo_speech_asr_c.dll</c> from an extracted NeMo-Speech.cpp <c>bin</c> folder
/// and binds the stable C ABI. Isolated from the rest of Core so tests never touch it.
/// </summary>
internal sealed class NemoSpeechNativeLibrary : IDisposable
{
    private const int NemoSpeechAsrOk = 0;

    private readonly IntPtr _handle;
    private readonly CreateDelegate _create;
    private readonly DestroyDelegate _destroy;
    private readonly RecognizeF32Delegate _recognizeF32;
    private readonly StreamingRecognizeDelegate _streamingRecognize;
    private readonly StreamPushF32Delegate _streamPushF32;
    private readonly StreamFinishDelegate _streamFinish;
    private readonly StreamNextDelegate _streamNext;
    private readonly StreamCloseDelegate _streamClose;
    private readonly ResultIsFinalDelegate _resultIsFinal;
    private readonly ResultAudioProcessedDelegate _resultAudioProcessed;
    private readonly ResultTranscriptDelegate _resultTranscript;
    private readonly ResultWordCountDelegate _resultWordCount;
    private readonly ResultWordStartTimeDelegate _resultWordStartTime;
    private readonly ResultWordEndTimeDelegate _resultWordEndTime;
    private readonly ResultDestroyDelegate _resultDestroy;
    private readonly LastErrorDelegate _lastError;

    private NemoSpeechNativeLibrary(IntPtr handle)
    {
        _handle = handle;
        _create = GetExport<CreateDelegate>(handle, "nemo_speech_asr_create");
        _destroy = GetExport<DestroyDelegate>(handle, "nemo_speech_asr_destroy");
        _recognizeF32 = GetExport<RecognizeF32Delegate>(handle, "nemo_speech_asr_recognize_f32");
        _streamingRecognize = GetExport<StreamingRecognizeDelegate>(handle, "nemo_speech_asr_streaming_recognize");
        _streamPushF32 = GetExport<StreamPushF32Delegate>(handle, "nemo_speech_asr_stream_push_f32");
        _streamFinish = GetExport<StreamFinishDelegate>(handle, "nemo_speech_asr_stream_finish");
        _streamNext = GetExport<StreamNextDelegate>(handle, "nemo_speech_asr_stream_next");
        _streamClose = GetExport<StreamCloseDelegate>(handle, "nemo_speech_asr_stream_close");
        _resultIsFinal = GetExport<ResultIsFinalDelegate>(handle, "nemo_speech_asr_result_is_final");
        _resultAudioProcessed = GetExport<ResultAudioProcessedDelegate>(handle, "nemo_speech_asr_result_audio_processed");
        _resultTranscript = GetExport<ResultTranscriptDelegate>(handle, "nemo_speech_asr_result_transcript");
        _resultWordCount = GetExport<ResultWordCountDelegate>(handle, "nemo_speech_asr_result_word_count");
        _resultWordStartTime = GetExport<ResultWordStartTimeDelegate>(handle, "nemo_speech_asr_result_word_start_time");
        _resultWordEndTime = GetExport<ResultWordEndTimeDelegate>(handle, "nemo_speech_asr_result_word_end_time");
        _resultDestroy = GetExport<ResultDestroyDelegate>(handle, "nemo_speech_asr_result_destroy");
        _lastError = GetExport<LastErrorDelegate>(handle, "nemo_speech_asr_last_error");
    }

    public static NemoSpeechNativeLibrary Load(string runtimeBinDirectory)
    {
        SetDllDirectory(runtimeBinDirectory);
        try
        {
            AddDllDirectory(runtimeBinDirectory);
        }
        catch (EntryPointNotFoundException)
        {
            // AddDllDirectory is unavailable on very old Windows; SetDllDirectory is enough.
        }

        var dllPath = Path.Combine(runtimeBinDirectory, "nemo_speech_asr_c.dll");
        var handle = NativeLibrary.Load(dllPath);
        return new NemoSpeechNativeLibrary(handle);
    }

    public IntPtr CreateRecognizer(string modelPath, int gpu)
    {
        var modelPathPtr = Marshal.StringToCoTaskMemUTF8(modelPath);
        var backendPtr = IntPtr.Zero;
        var modelPtr = IntPtr.Zero;
        var streamingPtr = IntPtr.Zero;
        var cfgPtr = IntPtr.Zero;
        try
        {
            var backend = new NemoSpeechAsrBackendConfig
            {
                Size = (nuint)Marshal.SizeOf<NemoSpeechAsrBackendConfig>(),
                Gpu = gpu,
            };
            backendPtr = Alloc(backend);

            var model = new NemoSpeechAsrModelConfig
            {
                Size = (nuint)Marshal.SizeOf<NemoSpeechAsrModelConfig>(),
                Path = modelPathPtr,
                Name = IntPtr.Zero,
            };
            modelPtr = Alloc(model);

            var streaming = new NemoSpeechAsrStreamingConfig
            {
                Size = (nuint)Marshal.SizeOf<NemoSpeechAsrStreamingConfig>(),
                ChunkSize = 0.16f,
                CtcLeftPadding = 1.92f,
                CtcRightPadding = 1.92f,
                RnntRightContext = 1,
            };
            streamingPtr = Alloc(streaming);

            var cfg = new NemoSpeechAsrRecognizerConfig
            {
                Size = (nuint)Marshal.SizeOf<NemoSpeechAsrRecognizerConfig>(),
                Backend = backendPtr,
                Model = modelPtr,
                Streaming = streamingPtr,
            };
            cfgPtr = Alloc(cfg);

            var status = _create(cfgPtr, out var recognizer);
            if (status != NemoSpeechAsrOk || recognizer == IntPtr.Zero)
                throw new InvalidOperationException($"nemo_speech_asr_create failed: {LastError()}");

            return recognizer;
        }
        finally
        {
            Free(cfgPtr);
            Free(streamingPtr);
            Free(modelPtr);
            Free(backendPtr);
            Marshal.FreeCoTaskMem(modelPathPtr);
        }
    }

    public void DestroyRecognizer(IntPtr recognizer)
    {
        if (recognizer != IntPtr.Zero)
            _destroy(recognizer);
    }

    public IntPtr RecognizeF32(IntPtr recognizer, float[] samples, int sampleRate, string languageCode)
    {
        var optionsPtr = IntPtr.Zero;
        var languagePtr = Marshal.StringToCoTaskMemUTF8(languageCode);
        var samplesHandle = GCHandle.Alloc(samples, GCHandleType.Pinned);
        try
        {
            optionsPtr = AllocRecognitionOptions(languagePtr, interimResults: false);
            var status = _recognizeF32(
                recognizer,
                optionsPtr,
                samplesHandle.AddrOfPinnedObject(),
                (nuint)samples.Length,
                sampleRate,
                out var result);
            if (status != NemoSpeechAsrOk || result == IntPtr.Zero)
                throw new InvalidOperationException($"nemo_speech_asr_recognize_f32 failed: {LastError()}");
            return result;
        }
        finally
        {
            samplesHandle.Free();
            Free(optionsPtr);
            Marshal.FreeCoTaskMem(languagePtr);
        }
    }

    public IntPtr StartStream(IntPtr recognizer, string languageCode)
    {
        var optionsPtr = IntPtr.Zero;
        var languagePtr = Marshal.StringToCoTaskMemUTF8(languageCode);
        try
        {
            optionsPtr = AllocRecognitionOptions(languagePtr, interimResults: true);
            var status = _streamingRecognize(recognizer, optionsPtr, out var stream);
            if (status != NemoSpeechAsrOk || stream == IntPtr.Zero)
                throw new InvalidOperationException($"nemo_speech_asr_streaming_recognize failed: {LastError()}");
            return stream;
        }
        finally
        {
            Free(optionsPtr);
            Marshal.FreeCoTaskMem(languagePtr);
        }
    }

    public void StreamPushF32(IntPtr stream, float[] samples, int sampleRate)
    {
        if (samples.Length == 0)
            return;

        var handle = GCHandle.Alloc(samples, GCHandleType.Pinned);
        try
        {
            var status = _streamPushF32(stream, handle.AddrOfPinnedObject(), (nuint)samples.Length, sampleRate);
            if (status != NemoSpeechAsrOk)
                throw new InvalidOperationException($"nemo_speech_asr_stream_push_f32 failed: {LastError()}");
        }
        finally
        {
            handle.Free();
        }
    }

    public void StreamFinish(IntPtr stream)
    {
        var status = _streamFinish(stream);
        if (status != NemoSpeechAsrOk)
            throw new InvalidOperationException($"nemo_speech_asr_stream_finish failed: {LastError()}");
    }

    public IntPtr StreamNext(IntPtr stream)
    {
        var status = _streamNext(stream, out var result);
        if (status != NemoSpeechAsrOk)
            throw new InvalidOperationException($"nemo_speech_asr_stream_next failed: {LastError()}");
        return result;
    }

    public void StreamClose(IntPtr stream)
    {
        if (stream != IntPtr.Zero)
            _streamClose(stream);
    }

    public bool ResultIsFinal(IntPtr result) => _resultIsFinal(result) != 0;

    public float ResultAudioProcessed(IntPtr result) => _resultAudioProcessed(result);

    public string ResultTranscript(IntPtr result)
    {
        var ptr = _resultTranscript(result, 0);
        return ptr == IntPtr.Zero ? string.Empty : Marshal.PtrToStringUTF8(ptr) ?? string.Empty;
    }

    public nuint ResultWordCount(IntPtr result) => _resultWordCount(result, 0);

    public int ResultWordStartTimeMs(IntPtr result, nuint index) => _resultWordStartTime(result, 0, index);

    public int ResultWordEndTimeMs(IntPtr result, nuint index) => _resultWordEndTime(result, 0, index);

    public void ResultDestroy(IntPtr result)
    {
        if (result != IntPtr.Zero)
            _resultDestroy(result);
    }

    public string LastError()
    {
        var ptr = _lastError();
        return ptr == IntPtr.Zero ? "unknown error" : Marshal.PtrToStringUTF8(ptr) ?? "unknown error";
    }

    public void Dispose()
    {
        if (_handle != IntPtr.Zero)
            NativeLibrary.Free(_handle);
    }

    private IntPtr AllocRecognitionOptions(IntPtr languagePtr, bool interimResults)
    {
        var options = new NemoSpeechAsrRecognitionOptions
        {
            Size = (nuint)Marshal.SizeOf<NemoSpeechAsrRecognitionOptions>(),
            RequestId = IntPtr.Zero,
            LanguageCode = languagePtr,
            InterimResults = (byte)(interimResults ? 1 : 0),
            EnableWordTimeOffsets = 1,
            EnableAutomaticPunctuation = 1,
            VerbatimTranscripts = 0,
            ProfanityFilter = 0,
            StopHistoryEouMs = 0,
            SpeechContexts = IntPtr.Zero,
            SpeechContextCount = 0,
            MaxAlternatives = 1,
            EnableSpeakerDiarization = 0,
            MaxSpeakerCount = 0,
        };
        return Alloc(options);
    }

    private static IntPtr Alloc<T>(T value) where T : struct
    {
        var ptr = Marshal.AllocHGlobal(Marshal.SizeOf<T>());
        Marshal.StructureToPtr(value, ptr, fDeleteOld: false);
        return ptr;
    }

    private static void Free(IntPtr ptr)
    {
        if (ptr != IntPtr.Zero)
            Marshal.FreeHGlobal(ptr);
    }

    private static T GetExport<T>(IntPtr handle, string name) where T : Delegate =>
        Marshal.GetDelegateForFunctionPointer<T>(NativeLibrary.GetExport(handle, name));

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetDllDirectory(string lpPathName);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr AddDllDirectory(string newDirectory);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int CreateDelegate(IntPtr cfg, out IntPtr recognizer);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void DestroyDelegate(IntPtr recognizer);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int RecognizeF32Delegate(
        IntPtr recognizer, IntPtr options, IntPtr samples, nuint nSamples, int sampleRate, out IntPtr result);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int StreamingRecognizeDelegate(IntPtr recognizer, IntPtr options, out IntPtr stream);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int StreamPushF32Delegate(IntPtr stream, IntPtr samples, nuint nSamples, int sampleRate);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int StreamFinishDelegate(IntPtr stream);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int StreamNextDelegate(IntPtr stream, out IntPtr result);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void StreamCloseDelegate(IntPtr stream);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate byte ResultIsFinalDelegate(IntPtr result);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate float ResultAudioProcessedDelegate(IntPtr result);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate IntPtr ResultTranscriptDelegate(IntPtr result, nuint alt);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate nuint ResultWordCountDelegate(IntPtr result, nuint alt);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int ResultWordStartTimeDelegate(IntPtr result, nuint alt, nuint index);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int ResultWordEndTimeDelegate(IntPtr result, nuint alt, nuint index);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate void ResultDestroyDelegate(IntPtr result);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate IntPtr LastErrorDelegate();
}
