using System.Buffers.Binary;
using System.Runtime.InteropServices;
using MeetingLive.Core.Models;
using MeetingLive.Core.Native;
using MeetingLive.Core.Services;
using Windows.Win32.System.Com.StructuredStorage;

namespace MeetingLive.Core.Tests.Services;

public class RecordingCaptureSourcesTests
{
    [Fact]
    public void SystemLoopback_WithDeviceId_KeepsMicrophoneAndDoesNotRequireProcessId()
    {
        var sources = RecordingCaptureSources.SystemLoopback(captureMicrophone: true, microphoneDeviceId: "mic-device");

        Assert.True(sources.CaptureMicrophone);
        Assert.Equal("mic-device", sources.MicrophoneDeviceId);
        Assert.Equal(RecordingOutputKind.SystemLoopback, sources.Output);
        Assert.True(sources.UsesSystemLoopback);
        Assert.Equal(0u, sources.ProcessId);
    }

    [Fact]
    public void SystemLoopback_CaptureMicrophoneFalse_IsDistinctFromNullDeviceId()
    {
        var noMicrophone = RecordingCaptureSources.SystemLoopback(captureMicrophone: false, microphoneDeviceId: null);
        var osDefaultMicrophone = RecordingCaptureSources.SystemLoopback(captureMicrophone: true, microphoneDeviceId: null);

        Assert.False(noMicrophone.CaptureMicrophone);
        Assert.Null(noMicrophone.MicrophoneDeviceId);
        Assert.True(osDefaultMicrophone.CaptureMicrophone);
        Assert.Null(osDefaultMicrophone.MicrophoneDeviceId);
        Assert.NotEqual(noMicrophone.CaptureMicrophone, osDefaultMicrophone.CaptureMicrophone);
    }

    [Fact]
    public void ProcessTree_ProcessIdZero_ThrowsArgumentOutOfRangeException()
    {
        var exception = Assert.Throws<ArgumentOutOfRangeException>(() =>
            RecordingCaptureSources.ProcessTree(captureMicrophone: true, microphoneDeviceId: null, processId: 0));

        Assert.Equal("processId", exception.ParamName);
    }

    [Fact]
    public void ProcessTree_NonZeroProcessId_DoesNotUseSystemLoopback()
    {
        var sources = RecordingCaptureSources.ProcessTree(captureMicrophone: false, microphoneDeviceId: null, processId: 4242);

        Assert.False(sources.CaptureMicrophone);
        Assert.Equal(RecordingOutputKind.ProcessTree, sources.Output);
        Assert.False(sources.UsesSystemLoopback);
        Assert.Equal(4242u, sources.ProcessId);
    }

    [Fact]
    public void Create_SystemLoopbackWithProcessId_ThrowsArgumentException()
    {
        var exception = Assert.Throws<ArgumentException>(() =>
            new RecordingCaptureSources(true, "mic-device", RecordingOutputKind.SystemLoopback, 42));

        Assert.Equal("processId", exception.ParamName);
    }

    [Fact]
    public void AudioClientActivationParams_IncludeTree_Is12BytesWithHeaderOffsets()
    {
        var parameters = AudioClientActivationParams.ForIncludeProcessTree(0x01020304);

        Assert.Equal(12, Marshal.SizeOf<AudioClientActivationParams>());
        Assert.Equal(0, Marshal.OffsetOf<AudioClientActivationParams>(nameof(AudioClientActivationParams.ActivationType)).ToInt32());
        Assert.Equal(4, Marshal.OffsetOf<AudioClientActivationParams>(nameof(AudioClientActivationParams.TargetProcessId)).ToInt32());
        Assert.Equal(8, Marshal.OffsetOf<AudioClientActivationParams>(nameof(AudioClientActivationParams.ProcessLoopbackMode)).ToInt32());
        Assert.Equal(1, parameters.ActivationType);
        Assert.Equal(0x01020304u, parameters.TargetProcessId);
        Assert.Equal(0, parameters.ProcessLoopbackMode);

        var bytes = new byte[12];
        MemoryMarshal.Write(bytes, in parameters);
        Assert.Equal(1, BinaryPrimitives.ReadInt32LittleEndian(bytes));
        Assert.Equal(0x01020304u, BinaryPrimitives.ReadUInt32LittleEndian(bytes.AsSpan(4)));
        Assert.Equal(0, BinaryPrimitives.ReadInt32LittleEndian(bytes.AsSpan(8)));
    }

    [Fact]
    public void ShouldSurfaceOutputFailure_ErrorWhileRecording_IsTrue()
    {
        var surfaced = AudioCaptureService.ShouldSurfaceOutputFailure(
            new InvalidOperationException("process exited"),
            userStop: false);

        Assert.True(surfaced);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void ShouldSurfaceOutputFailure_NullError_IsFalse(bool userStop)
    {
        Assert.False(AudioCaptureService.ShouldSurfaceOutputFailure(null, userStop));
    }

    [Fact]
    public void ShouldSurfaceOutputFailure_UserStop_IsFalse()
    {
        var surfaced = AudioCaptureService.ShouldSurfaceOutputFailure(
            new InvalidOperationException("teardown"),
            userStop: true);

        Assert.False(surfaced);
    }

    [Fact]
    public void PropVariant_PinnedBlobCarrier_MatchesNativeSize()
    {
        var box = new PROPVARIANT[1];
        var pin = GCHandle.Alloc(box, GCHandleType.Pinned);
        try
        {
            Assert.NotEqual(IntPtr.Zero, pin.AddrOfPinnedObject());
            Assert.Equal(IntPtr.Size == 8 ? 24 : 16, Marshal.SizeOf<PROPVARIANT>());
        }
        finally
        {
            pin.Free();
        }
    }
}
