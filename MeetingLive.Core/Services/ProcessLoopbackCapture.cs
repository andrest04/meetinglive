using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using MeetingLive.Core.Native;
using NAudio.Wave;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.Media.Audio;
using Windows.Win32.System.Com.StructuredStorage;
using Windows.Win32.System.Variant;

namespace MeetingLive.Core.Services;

/// <summary>
/// WASAPI process-tree loopback as <see cref="IWaveIn"/>, so <see cref="AudioCaptureService"/>
/// can mix it the same way as <see cref="WasapiLoopbackCapture"/>.
/// Activation uses <c>VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK</c> and include-target-process-tree.
/// A failed activation throws. This type never falls back to system loopback.
/// </summary>
internal sealed partial class ProcessLoopbackCapture : IWaveIn
{
    private const uint BufferFlagSilent = 0x2;
    private const int CaptureSampleRate = 48000;
    private const ushort CaptureChannels = 2;
    private const ushort CaptureBitsPerSample = 16;
    private static readonly TimeSpan ActivationTimeout = TimeSpan.FromSeconds(10);

    private readonly uint _processId;
    private readonly Thread _ownerThread;
    private readonly ManualResetEventSlim _ready = new(false);
    private readonly ManualResetEventSlim _startOrStop = new(false);
    private readonly ManualResetEventSlim _started = new(false);
    private readonly EventWaitHandle _bufferEvent = new(false, EventResetMode.AutoReset);

    private WaveFormat? _waveFormat;
    private Exception? _initError;
    private Exception? _startError;
    private Exception? _captureError;
    private IAudioClient? _audioClient;
    private IAudioCaptureClient? _captureClient;
    private byte[] _packet = [];
    private int _stopRequested;
    private int _clientStarted;
    private int _stoppedRaised;
    private int _disposed;

    public ProcessLoopbackCapture(uint processId)
    {
        if (processId == 0)
            throw new ArgumentOutOfRangeException(nameof(processId), processId, "Process id 0 is not a valid capture target.");

        _processId = processId;
        _ownerThread = new Thread(OwnerThreadMain)
        {
            IsBackground = true,
            Name = "ProcessLoopbackCapture",
        };
        _ownerThread.Start();

        try
        {
            if (!_ready.Wait(TimeSpan.FromSeconds(12)))
                throw new TimeoutException("Process loopback activation did not finish within 12 seconds.");

            if (_initError is not null)
                throw _initError;
        }
        catch
        {
            RequestStopAndJoin();
            DisposeWaitHandles();
            throw;
        }
    }

    public WaveFormat WaveFormat
    {
        get => _waveFormat ?? throw new InvalidOperationException("Process loopback capture format is not available.");
        set => throw new InvalidOperationException("Process loopback capture uses a fixed 48 kHz 16-bit stereo format.");
    }

    public event EventHandler<WaveInEventArgs>? DataAvailable;

    public event EventHandler<StoppedEventArgs>? RecordingStopped;

    public void StartRecording()
    {
        ObjectDisposedException.ThrowIf(_disposed != 0, this);
        if (_initError is not null)
            throw _initError;

        _startOrStop.Set();
        if (!_started.Wait(TimeSpan.FromSeconds(5)))
            throw new TimeoutException("Process loopback capture did not start.");

        if (_startError is not null)
            throw _startError;
    }

    public void StopRecording() => RequestStopAndJoin();

    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
            return;

        RequestStopAndJoin();
        DisposeWaitHandles();
    }

    private void DisposeWaitHandles()
    {
        // A timed-out activation thread may still be inside the native call. Do not dispose
        // handles it can still signal; a background-thread ObjectDisposedException would
        // tear the process down. The handles are reclaimed when the process exits.
        if (_ownerThread.IsAlive)
            return;

        _bufferEvent.Dispose();
        _ready.Dispose();
        _startOrStop.Dispose();
        _started.Dispose();
    }

    private static void TrySet(ManualResetEventSlim gate)
    {
        try
        {
            gate.Set();
        }
        catch (ObjectDisposedException)
        {
        }
    }

    private void OwnerThreadMain()
    {
        var comInitialized = false;
        try
        {
            comInitialized = InitializeComApartment();
            try
            {
                ActivateAndInitialize();
            }
            catch (Exception ex)
            {
                _initError = ex;
            }

            _ready.Set();
            if (_initError is not null)
                return;

            try
            {
                _startOrStop.Wait();
            }
            catch (ObjectDisposedException)
            {
                return;
            }

            if (Volatile.Read(ref _stopRequested) != 0)
                return;

            try
            {
                _audioClient!.Start();
                Volatile.Write(ref _clientStarted, 1);
            }
            catch (Exception ex)
            {
                _startError = WrapFailure("Process loopback capture failed to start", ex);
                return;
            }
            finally
            {
                _started.Set();
            }

            CaptureLoop();
        }
        catch (Exception ex)
        {
            // The WAV pump runs on another thread. Never let this thread's exception escape.
            _captureError ??= ex;
        }
        finally
        {
            StopAndReleaseCom();
            if (comInitialized)
            {
                try
                {
                    NativeMethods.CoUninitialize();
                }
                catch (Exception)
                {
                    // Apartment teardown must not escape this background thread.
                }
            }

            TrySet(_ready);
            TrySet(_started);
            RaiseStopped(_captureError);
        }
    }

    private void ActivateAndInitialize()
    {
        _audioClient = ActivateClient(_processId);
        unsafe
        {
            // The process-loopback IAudioClient returns E_NOTIMPL from GetMixFormat, so the
            // format is fixed here. AUTOCONVERTPCM makes the engine convert to it. The struct
            // lives on the stack for the duration of Initialize; nothing to free.
            _waveFormat = new WaveFormat(CaptureSampleRate, CaptureBitsPerSample, CaptureChannels);
            var format = new WAVEFORMATEX
            {
                wFormatTag = 1, // WAVE_FORMAT_PCM
                nChannels = CaptureChannels,
                nSamplesPerSec = (uint)CaptureSampleRate,
                nAvgBytesPerSec = (uint)_waveFormat.AverageBytesPerSecond,
                nBlockAlign = (ushort)_waveFormat.BlockAlign,
                wBitsPerSample = CaptureBitsPerSample,
                cbSize = 0,
            };

            try
            {
                var flags = PInvoke.AUDCLNT_STREAMFLAGS_LOOPBACK
                    | PInvoke.AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                    | PInvoke.AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM;
                _audioClient.Initialize(
                    AUDCLNT_SHAREMODE.AUDCLNT_SHAREMODE_SHARED,
                    flags,
                    hnsBufferDuration: 0,
                    hnsPeriodicity: 0,
                    &format,
                    AudioSessionGuid: null);
            }
            catch (COMException ex)
            {
                throw WrapFailure("Process loopback initialization failed", ex);
            }

            var captureId = typeof(IAudioCaptureClient).GUID;
            _audioClient.GetService(&captureId, out var service);
            if (service is not IAudioCaptureClient captureClient)
            {
                ReleaseCom(service);
                throw new InvalidOperationException("Process loopback GetService did not return IAudioCaptureClient.");
            }

            _captureClient = captureClient;
            var added = false;
            _bufferEvent.SafeWaitHandle.DangerousAddRef(ref added);
            try
            {
                _audioClient.SetEventHandle((HANDLE)_bufferEvent.SafeWaitHandle.DangerousGetHandle());
            }
            finally
            {
                if (added)
                    _bufferEvent.SafeWaitHandle.DangerousRelease();
            }
        }
    }

    private void CaptureLoop()
    {
        while (Volatile.Read(ref _stopRequested) == 0)
        {
            try
            {
                _bufferEvent.WaitOne(200);
            }
            catch (ObjectDisposedException)
            {
                break;
            }

            if (!DrainPackets())
                break;
        }
    }

    private bool DrainPackets()
    {
        var capture = _captureClient;
        if (capture is null)
            return false;

        while (Volatile.Read(ref _stopRequested) == 0)
        {
            uint frames = 0;
            var released = false;
            try
            {
                capture.GetNextPacketSize(out var packetFrames);
                if (packetFrames == 0)
                    return true;

                unsafe
                {
                    byte* data = null;
                    capture.GetBuffer(&data, out frames, out var flags, null, null);
                    var byteCount = checked((int)frames * WaveFormat.BlockAlign);
                    CopyPacket(data, byteCount, flags);
                    capture.ReleaseBuffer(frames);
                    released = true;
                    RaiseDataAvailable(byteCount);
                }
            }
            catch (Exception ex) when (ex is not OutOfMemoryException)
            {
                _captureError ??= ex;
                return false;
            }
            finally
            {
                if (!released && frames > 0)
                {
                    try
                    {
                        capture.ReleaseBuffer(frames);
                    }
                    catch (Exception)
                    {
                        // The packet must be released before this method returns. A second failure
                        // still must not escape the capture thread.
                    }
                }
            }
        }

        return Volatile.Read(ref _stopRequested) == 0;
    }

    private unsafe void CopyPacket(byte* data, int byteCount, uint flags)
    {
        if (byteCount <= 0)
            return;

        if (_packet.Length < byteCount)
            _packet = new byte[byteCount];

        // SILENT packets are uninitialized native memory. Never copy them into the mixer.
        if ((flags & BufferFlagSilent) != 0 || data is null)
            Array.Clear(_packet, 0, byteCount);
        else
            Marshal.Copy((IntPtr)data, _packet, 0, byteCount);
    }

    private void RaiseDataAvailable(int byteCount)
    {
        if (byteCount <= 0 || Volatile.Read(ref _stopRequested) != 0)
            return;

        try
        {
            DataAvailable?.Invoke(this, new WaveInEventArgs(_packet, byteCount));
        }
        catch (Exception)
        {
            // The subscriber copies during the event. A throw here must not kill the WAV pump.
        }
    }

    private void StopAndReleaseCom()
    {
        if (Volatile.Read(ref _clientStarted) != 0 && _audioClient is not null)
        {
            try
            {
                _audioClient.Stop();
            }
            catch (Exception)
            {
                // Device already gone (process exited) or already stopped.
            }
        }

        // COM interface pointers, not kernel handles. ReleaseComObject, never CloseHandle.
        // This owner thread releases both: it created the capture client and it is the last user.
        var capture = Interlocked.Exchange(ref _captureClient, null);
        var client = Interlocked.Exchange(ref _audioClient, null);
        ReleaseCom(capture);
        ReleaseCom(client);
    }

    private void RequestStopAndJoin()
    {
        Volatile.Write(ref _stopRequested, 1);
        TrySet(_startOrStop);
        try
        {
            _bufferEvent.Set();
        }
        catch (ObjectDisposedException)
        {
        }

        if (_ownerThread.IsAlive && _ownerThread != Thread.CurrentThread)
            _ownerThread.Join(TimeSpan.FromSeconds(5));

        RaiseStopped(null);
    }

    private void RaiseStopped(Exception? error)
    {
        if (Interlocked.Exchange(ref _stoppedRaised, 1) != 0)
            return;

        try
        {
            RecordingStopped?.Invoke(this, error is null ? new StoppedEventArgs() : new StoppedEventArgs(error));
        }
        catch (Exception)
        {
        }
    }

    private static bool InitializeComApartment()
    {
        var hr = NativeMethods.CoInitializeEx(IntPtr.Zero, NativeMethods.CoInitMultithreaded);
        if (hr < 0 && hr != NativeMethods.RpcEChangedMode)
            Marshal.ThrowExceptionForHR(hr);

        return hr != NativeMethods.RpcEChangedMode;
    }

    /// <summary>
    /// CsWin32 supplies the COM interfaces. The activation call itself is a pointer-based
    /// stdcall import so the <c>PROPVARIANT</c> and its blob stay pinned until
    /// <c>ActivateCompleted</c> returns. The generated overload copies the variant into a
    /// temporary that dies when the call returns.
    /// </summary>
    private static unsafe IAudioClient ActivateClient(uint processId)
    {
        var parameters = new AudioClientActivationParams[1];
        parameters[0] = AudioClientActivationParams.ForIncludeProcessTree(processId);
        var blobPin = GCHandle.Alloc(parameters, GCHandleType.Pinned);

        var variant = new PROPVARIANT();
        variant.vt = VARENUM.VT_BLOB;
        ref var blob = ref variant.blob;
        blob.cbSize = (uint)Marshal.SizeOf<AudioClientActivationParams>();
        blob.pBlobData = (byte*)blobPin.AddrOfPinnedObject();

        var variantBox = new PROPVARIANT[1];
        variantBox[0] = variant;
        var variantPin = GCHandle.Alloc(variantBox, GCHandleType.Pinned);

        var handler = new ActivationHandler(blobPin, variantPin);
        handler.RootUntilCallback();
        IActivateAudioInterfaceAsyncOperation? operation = null;
        try
        {
            var iid = typeof(IAudioClient).GUID;
            int hr;
            try
            {
                hr = NativeMethods.ActivateAudioInterfaceAsync(
                    PInvoke.VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
                    in iid,
                    variantPin.AddrOfPinnedObject(),
                    handler,
                    out operation);
            }
            catch
            {
                handler.ReleasePinsIfCallbackHasNotEntered();
                throw;
            }

            if (hr < 0)
            {
                handler.ReleasePinsIfCallbackHasNotEntered();
                throw ActivationFailed(hr, null);
            }

            if (!handler.Wait(ActivationTimeout))
            {
                // The callback may still arrive. It owns the pins and must release any
                // IAudioClient it receives, because this waiter will not take it.
                handler.Abandon();
                throw new TimeoutException("Process loopback activation timed out after 10 seconds.");
            }

            return handler.TakeClientOrThrow();
        }
        finally
        {
            ReleaseCom(operation);
            GC.KeepAlive(handler);
        }
    }

    private static InvalidOperationException ActivationFailed(int hr, string? detail)
    {
        var message = Marshal.GetExceptionForHR(hr)?.Message;
        var text = string.IsNullOrWhiteSpace(detail) ? message : detail;
        return new InvalidOperationException($"Process loopback activation failed: 0x{hr:X8}. {text}");
    }

    private static InvalidOperationException WrapFailure(string action, Exception ex)
    {
        var hr = ex.HResult;
        return new InvalidOperationException($"{action}: 0x{hr:X8}. {ex.Message}", ex);
    }

    private static void ReleaseCom(object? comObject)
    {
        if (comObject is null || !Marshal.IsComObject(comObject))
            return;

        try
        {
            Marshal.ReleaseComObject(comObject);
        }
        catch (Exception)
        {
        }
    }

    /// <summary>
    /// Completion arrives on an MTA thread, not the UI thread. The handler owns the pins
    /// until <see cref="ActivateCompleted"/> returns, including when the waiter has already
    /// timed out. Native holds a CCW reference; <see cref="Pending"/> is the extra root.
    /// </summary>
    private sealed class ActivationHandler : IActivateAudioInterfaceCompletionHandler
    {
        private static readonly object PendingGate = new();
        private static readonly HashSet<ActivationHandler> Pending = [];

        private readonly object _gate = new();
        private readonly ManualResetEventSlim _completed = new(false);
        private GCHandle _blobPin;
        private GCHandle _variantPin;
        private int _callbackEntered;
        private int _abandoned;
        private int _hr;
        private string? _detail;
        private IAudioClient? _client;

        public ActivationHandler(GCHandle blobPin, GCHandle variantPin)
        {
            _blobPin = blobPin;
            _variantPin = variantPin;
        }

        public void RootUntilCallback()
        {
            lock (PendingGate)
                Pending.Add(this);
        }

        public bool Wait(TimeSpan timeout) => _completed.Wait(timeout);

        public void Abandon() => Volatile.Write(ref _abandoned, 1);

        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation)
        {
            MarkEntered();
            try
            {
                activateOperation.GetActivateResult(out var activateResult, out var activated);
                _hr = activateResult.Value;
                if (activateResult.Failed)
                {
                    _detail = activateResult.ToString();
                    ReleaseCom(activated);
                    return;
                }

                if (activated is IAudioClient client)
                {
                    _client = client;
                    return;
                }

                _hr = unchecked((int)0x80004002);
                _detail = "Activation did not return IAudioClient.";
                ReleaseCom(activated);
            }
            catch (Exception ex)
            {
                _hr = ex.HResult;
                _detail = ex.Message;
            }
            finally
            {
                if (Volatile.Read(ref _abandoned) != 0)
                {
                    ReleaseCom(_client);
                    _client = null;
                }

                FreePins();
                lock (PendingGate)
                    Pending.Remove(this);

                _completed.Set();
            }
        }

        public IAudioClient TakeClientOrThrow()
        {
            if (_hr < 0 || _client is null)
                throw ActivationFailed(_hr, _detail);

            return _client;
        }

        public void ReleasePinsIfCallbackHasNotEntered()
        {
            lock (_gate)
            {
                if (Volatile.Read(ref _callbackEntered) != 0)
                    return;

                FreePins();
                lock (PendingGate)
                    Pending.Remove(this);
            }
        }

        private void MarkEntered()
        {
            lock (_gate)
                Volatile.Write(ref _callbackEntered, 1);
        }

        private void FreePins()
        {
            lock (_gate)
            {
                if (_blobPin.IsAllocated)
                    _blobPin.Free();

                if (_variantPin.IsAllocated)
                    _variantPin.Free();
            }
        }
    }

    /// <summary>
    /// x86 is a supported app platform, so this WINAPI import is explicit stdcall.
    /// <c>mmdevapi.dll</c> is loaded from System32. The activation-params pointer is raw
    /// so the caller can keep it pinned until the completion callback returns.
    /// </summary>
    private static partial class NativeMethods
    {
        internal const uint CoInitMultithreaded = 0;
        internal const int RpcEChangedMode = unchecked((int)0x80010106);

        [LibraryImport("ole32.dll")]
        [UnmanagedCallConv(CallConvs = [typeof(CallConvStdcall)])]
        internal static partial int CoInitializeEx(IntPtr pvReserved, uint dwCoInit);

        [LibraryImport("ole32.dll")]
        [UnmanagedCallConv(CallConvs = [typeof(CallConvStdcall)])]
        internal static partial void CoUninitialize();

        [DllImport("mmdevapi.dll", ExactSpelling = true, CallingConvention = CallingConvention.StdCall, EntryPoint = "ActivateAudioInterfaceAsync")]
        [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
        internal static extern int ActivateAudioInterfaceAsync(
            [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
            in Guid riid,
            IntPtr activationParams,
            IActivateAudioInterfaceCompletionHandler completionHandler,
            out IActivateAudioInterfaceAsyncOperation activationOperation);
    }
}
