using MeetingLive.Core.Models;
using MeetingLive.Core.Native;

namespace MeetingLive.Core.Services;

/// <summary>
/// Real NeMo-Speech.cpp engine: loads <c>nemo_speech_asr_c.dll</c> from the extracted runtime
/// <c>bin</c> folder and P/Invokes the C ABI. Never constructed by unit tests.
/// Native recognizer/stream/result objects are <see cref="NemoOwnedHandle"/> — never raw IntPtr.
/// </summary>
public sealed class NativeNemoSpeechAsrEngine : INemoSpeechAsrEngine
{
    public INemoSpeechRecognizer CreateRecognizer(
        string modelPath,
        string runtimeBinDirectory,
        int gpu,
        string? diarizationModelPath = null,
        SortformerGeometry geometry = SortformerGeometry.Streaming)
    {
        var library = NemoSpeechNativeLibrary.Load(runtimeBinDirectory);
        try
        {
            var recognizer = library.CreateRecognizer(modelPath, gpu, diarizationModelPath, geometry);
            return new NativeNemoSpeechRecognizer(
                library,
                recognizer,
                enableSpeakerDiarization: !string.IsNullOrWhiteSpace(diarizationModelPath));
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
        private readonly NemoOwnedHandle _recognizer;
        private readonly bool _enableSpeakerDiarization;
        private bool _disposed;

        public NativeNemoSpeechRecognizer(
            NemoSpeechNativeLibrary library,
            NemoOwnedHandle recognizer,
            bool enableSpeakerDiarization)
        {
            _library = library;
            _recognizer = recognizer;
            _enableSpeakerDiarization = enableSpeakerDiarization;
        }

        public INemoSpeechStream StartStream(string languageCode)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            var stream = _library.StartStream(_recognizer, languageCode, _enableSpeakerDiarization);
            return new NativeNemoSpeechStream(_library, stream);
        }

        public NemoSpeechAsrResult Recognize(float[] samples, int sampleRate, string languageCode)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            var result = _library.RecognizeF32(
                _recognizer,
                samples,
                sampleRate,
                languageCode,
                _enableSpeakerDiarization);
            return ReadResult(_library, result);
        }

        public void Dispose()
        {
            if (_disposed)
                return;

            _recognizer.Dispose();
            // Do not unload the native library — CUDA runtimes abort on FreeLibrary.
            _disposed = true;
        }
    }

    private sealed class NativeNemoSpeechStream : INemoSpeechStream
    {
        private readonly NemoSpeechNativeLibrary _library;
        private readonly NemoOwnedHandle _stream;
        private bool _disposed;

        public NativeNemoSpeechStream(NemoSpeechNativeLibrary library, NemoOwnedHandle stream)
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

            _stream.Dispose();
            _disposed = true;
        }

        private static List<NemoSpeechAsrResult> Drain(NemoSpeechNativeLibrary library, NemoOwnedHandle stream)
        {
            var results = new List<NemoSpeechAsrResult>();
            while (true)
            {
                var handle = library.StreamNext(stream);
                if (handle is null)
                    break;
                results.Add(ReadResult(library, handle));
            }

            return results;
        }
    }

    private static NemoSpeechAsrResult ReadResult(NemoSpeechNativeLibrary library, NemoOwnedHandle result)
    {
        using (result)
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
                var speakerTag = library.ResultWordSpeakerTag(result, i);
                var wordText = library.ResultWordText(result, i);
                words[i] = new NemoSpeechWordTiming(
                    TimeSpan.FromMilliseconds(startMs),
                    TimeSpan.FromMilliseconds(endMs),
                    speakerTag,
                    wordText);
            }

            return new NemoSpeechAsrResult(isFinal, transcript, audioProcessed, words);
        }
    }
}
