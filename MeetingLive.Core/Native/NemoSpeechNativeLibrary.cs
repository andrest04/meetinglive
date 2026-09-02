using System.Collections.Concurrent;
using System.Runtime.InteropServices;

namespace MeetingLive.Core.Native;

/// <summary>
/// Loads <c>nemo_speech_asr_c.dll</c> from an extracted NeMo-Speech.cpp <c>bin</c> folder
/// and binds the stable C ABI. Isolated from the rest of Core so tests never touch it.
/// Native objects are returned as <see cref="NemoOwnedHandle"/> — never raw <see cref="IntPtr"/>.
/// </summary>
internal sealed class NemoSpeechNativeLibrary : IDisposable
{
    private const int NemoSpeechAsrOk = 0;

    /// <summary>
    /// CUDA/ONNX worker threads abort the process if <c>nemo_speech_asr_c.dll</c> is
    /// unloaded while they are still running. Keep one load per runtime bin for the
    /// process lifetime — never <see cref="NativeLibrary.Free"/>.
    /// </summary>
    private static readonly ConcurrentDictionary<string, Lazy<NemoSpeechNativeLibrary>> Loaded = new(StringComparer.OrdinalIgnoreCase);

    private readonly NativeLibraryHandle _libraryHandle;
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

    private NemoSpeechNativeLibrary(NativeLibraryHandle libraryHandle)
    {
        _libraryHandle = libraryHandle;
        using var scope = new DangerousHandleScope(libraryHandle);
        var handle = scope.Pointer;
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
        var key = Path.GetFullPath(runtimeBinDirectory);
        return Loaded.GetOrAdd(
            key,
            dir => new Lazy<NemoSpeechNativeLibrary>(
                () => LoadNew(dir),
                LazyThreadSafetyMode.ExecutionAndPublication)).Value;
    }

    private static NemoSpeechNativeLibrary LoadNew(string runtimeBinDirectory)
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
        var loaded = NativeLibrary.Load(dllPath);
        var libraryHandle = NativeLibraryHandle.Attach(loaded);
        try
        {
            return new NemoSpeechNativeLibrary(libraryHandle);
        }
        catch
        {
            libraryHandle.Dispose();
            throw;
        }
    }

    public NemoOwnedHandle CreateRecognizer(string modelPath, int gpu)
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

            // NVIDIA Nemotron 3.5 ASR: rnnt_right_context is encoder frames at 80ms.
            // 1 = 160ms, 3 = 320ms, 6 = 560ms, 13 = 1.12s. Larger = lower WER.
            // Meetings use 320ms (not the 80/160ms voice-agent points).
            var streaming = new NemoSpeechAsrStreamingConfig
            {
                Size = (nuint)Marshal.SizeOf<NemoSpeechAsrStreamingConfig>(),
                ChunkSize = 0.16f,
                CtcLeftPadding = 1.92f,
                CtcRightPadding = 1.92f,
                RnntRightContext = 3,
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

            return Own(recognizer, ptr => _destroy(ptr));
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

    public NemoOwnedHandle RecognizeF32(NemoOwnedHandle recognizer, float[] samples, int sampleRate, string languageCode)
    {
        var optionsPtr = IntPtr.Zero;
        var languagePtr = Marshal.StringToCoTaskMemUTF8(languageCode);
        var samplesHandle = GCHandle.Alloc(samples, GCHandleType.Pinned);
        try
        {
            using var recognizerScope = new DangerousHandleScope(recognizer);
            optionsPtr = AllocRecognitionOptions(languagePtr, interimResults: false);
            var status = _recognizeF32(
                recognizerScope.Pointer,
                optionsPtr,
                samplesHandle.AddrOfPinnedObject(),
                (nuint)samples.Length,
                sampleRate,
                out var result);
            if (status != NemoSpeechAsrOk || result == IntPtr.Zero)
                throw new InvalidOperationException($"nemo_speech_asr_recognize_f32 failed: {LastError()}");
            return Own(result, ptr => _resultDestroy(ptr));
        }
        finally
        {
            samplesHandle.Free();
            Free(optionsPtr);
            Marshal.FreeCoTaskMem(languagePtr);
        }
    }

    public NemoOwnedHandle StartStream(NemoOwnedHandle recognizer, string languageCode)
    {
        var optionsPtr = IntPtr.Zero;
        var languagePtr = Marshal.StringToCoTaskMemUTF8(languageCode);
        try
        {
            using var recognizerScope = new DangerousHandleScope(recognizer);
            optionsPtr = AllocRecognitionOptions(languagePtr, interimResults: true);
            var status = _streamingRecognize(recognizerScope.Pointer, optionsPtr, out var stream);
            if (status != NemoSpeechAsrOk || stream == IntPtr.Zero)
                throw new InvalidOperationException($"nemo_speech_asr_streaming_recognize failed: {LastError()}");
            return Own(stream, ptr => _streamClose(ptr));
        }
        finally
        {
            Free(optionsPtr);
            Marshal.FreeCoTaskMem(languagePtr);
        }
    }

    public void StreamPushF32(NemoOwnedHandle stream, float[] samples, int sampleRate)
    {
        if (samples.Length == 0)
            return;

        var handle = GCHandle.Alloc(samples, GCHandleType.Pinned);
        try
        {
            using var streamScope = new DangerousHandleScope(stream);
            var status = _streamPushF32(streamScope.Pointer, handle.AddrOfPinnedObject(), (nuint)samples.Length, sampleRate);
            if (status != NemoSpeechAsrOk)
                throw new InvalidOperationException($"nemo_speech_asr_stream_push_f32 failed: {LastError()}");
        }
        finally
        {
            handle.Free();
        }
    }

    public void StreamFinish(NemoOwnedHandle stream)
    {
        using var streamScope = new DangerousHandleScope(stream);
        var status = _streamFinish(streamScope.Pointer);
        if (status != NemoSpeechAsrOk)
            throw new InvalidOperationException($"nemo_speech_asr_stream_finish failed: {LastError()}");
    }

    public NemoOwnedHandle? StreamNext(NemoOwnedHandle stream)
    {
        using var streamScope = new DangerousHandleScope(stream);
        var status = _streamNext(streamScope.Pointer, out var result);
        if (status != NemoSpeechAsrOk)
            throw new InvalidOperationException($"nemo_speech_asr_stream_next failed: {LastError()}");
        return result == IntPtr.Zero ? null : Own(result, ptr => _resultDestroy(ptr));
    }

    public bool ResultIsFinal(NemoOwnedHandle result)
    {
        using var scope = new DangerousHandleScope(result);
        return _resultIsFinal(scope.Pointer) != 0;
    }

    public float ResultAudioProcessed(NemoOwnedHandle result)
    {
        using var scope = new DangerousHandleScope(result);
        return _resultAudioProcessed(scope.Pointer);
    }

    public string ResultTranscript(NemoOwnedHandle result)
    {
        using var scope = new DangerousHandleScope(result);
        var ptr = _resultTranscript(scope.Pointer, 0);
        return ptr == IntPtr.Zero ? string.Empty : Marshal.PtrToStringUTF8(ptr) ?? string.Empty;
    }

    public nuint ResultWordCount(NemoOwnedHandle result)
    {
        using var scope = new DangerousHandleScope(result);
        return _resultWordCount(scope.Pointer, 0);
    }

    public int ResultWordStartTimeMs(NemoOwnedHandle result, nuint index)
    {
        using var scope = new DangerousHandleScope(result);
        return _resultWordStartTime(scope.Pointer, 0, index);
    }

    public int ResultWordEndTimeMs(NemoOwnedHandle result, nuint index)
    {
        using var scope = new DangerousHandleScope(result);
        return _resultWordEndTime(scope.Pointer, 0, index);
    }

    public string LastError()
    {
        var ptr = _lastError();
        return ptr == IntPtr.Zero ? "unknown error" : Marshal.PtrToStringUTF8(ptr) ?? "unknown error";
    }

    public void Dispose()
    {
        // Intentionally a no-op. Unloading the CUDA ASR DLL is a process-killing abort
        // (ucrtbase 0xC0000409 / FAST_FAIL_FATAL_APP_EXIT) when ONNX worker threads
        // outlive FreeLibrary. The process-lifetime cache in Load() owns the handle.
    }

    private NemoOwnedHandle Own(IntPtr native, Action<IntPtr> release) =>
        new(native, _libraryHandle, release);

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
