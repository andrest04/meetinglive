using MeetingLive.Core.Models;
using MeetingLive.Core.Native;

namespace MeetingLive.Core.Services;

/// <summary>
/// Real NeMo-Speech.cpp engine: loads <c>nemo_speech_asr_c.dll</c> from the extracted runtime
/// <c>bin</c> folder and P/Invokes the C ABI. Never constructed by unit tests.
/// </summary>
public sealed class NativeNemoSpeechAsrEngine : INemoSpeechAsrEngine
{
    public INemoSpeechRecognizer CreateRecognizer(string modelPath, string runtimeBinDirectory, int gpu)
    {
        var library = NemoSpeechNativeLibrary.Load(runtimeBinDirectory);
        try
        {
            var recognizer = library.CreateRecognizer(modelPath, gpu);
            return new NativeNemoSpeechRecognizer(library, recognizer);
        }
        catch
        {
            library.Dispose();
            throw;
        }
    }

    private sealed class NativeNemoSpeechRecognizer : INemoSpeechRecognizer
    {
        private readonly NemoSpeechNativeLibrary _library;
        private IntPtr _recognizer;
        private bool _disposed;

        public NativeNemoSpeechRecognizer(NemoSpeechNativeLibrary library, IntPtr recognizer)
        {
            _library = library;
            _recognizer = recognizer;
        }

        public INemoSpeechStream StartStream(string languageCode)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            var stream = _library.StartStream(_recognizer, languageCode);
            return new NativeNemoSpeechStream(_library, stream);
        }

        public NemoSpeechAsrResult Recognize(float[] samples, int sampleRate, string languageCode)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            var result = _library.RecognizeF32(_recognizer, samples, sampleRate, languageCode);
            return ReadResult(_library, result);
        }

        public void Dispose()
        {
            if (_disposed)
                return;

            _library.DestroyRecognizer(_recognizer);
            _recognizer = IntPtr.Zero;
            _library.Dispose();
            _disposed = true;
        }
    }

    private sealed class NativeNemoSpeechStream : INemoSpeechStream
    {
        private readonly NemoSpeechNativeLibrary _library;
        private IntPtr _stream;
        private bool _disposed;

        public NativeNemoSpeechStream(NemoSpeechNativeLibrary library, IntPtr stream)
        {
            _library = library;
            _stream = stream;
        }

        public void Push(float[] samples, int sampleRate)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            _library.StreamPushF32(_stream, samples, sampleRate);
        }

        public IReadOnlyList<NemoSpeechAsrResult> PullAvailable()
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            return Drain(_library, _stream);
        }

        public IReadOnlyList<NemoSpeechAsrResult> FinishAndDrain()
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            _library.StreamFinish(_stream);
            return Drain(_library, _stream);
        }

        public void Dispose()
        {
            if (_disposed)
                return;

            _library.StreamClose(_stream);
            _stream = IntPtr.Zero;
            _disposed = true;
        }

        private static List<NemoSpeechAsrResult> Drain(NemoSpeechNativeLibrary library, IntPtr stream)
        {
            var results = new List<NemoSpeechAsrResult>();
            while (true)
            {
                var handle = library.StreamNext(stream);
                if (handle == IntPtr.Zero)
                    break;
                results.Add(ReadResult(library, handle));
            }

            return results;
        }
    }

    private static NemoSpeechAsrResult ReadResult(NemoSpeechNativeLibrary library, IntPtr result)
    {
        try
        {
            var isFinal = library.ResultIsFinal(result);
            var transcript = library.ResultTranscript(result);
            var audioProcessed = library.ResultAudioProcessed(result);
            var wordCount = library.ResultWordCount(result);
            var words = new NemoSpeechWordTiming[(int)wordCount];
            for (nuint i = 0; i < wordCount; i++)
            {
                var startMs = library.ResultWordStartTimeMs(result, i);
                var endMs = library.ResultWordEndTimeMs(result, i);
                words[i] = new NemoSpeechWordTiming(
                    TimeSpan.FromMilliseconds(startMs),
                    TimeSpan.FromMilliseconds(endMs));
            }

            return new NemoSpeechAsrResult(isFinal, transcript, audioProcessed, words);
        }
        finally
        {
            library.ResultDestroy(result);
        }
    }
}
