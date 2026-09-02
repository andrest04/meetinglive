using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class NemoSpeechRuntimeManagerTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid());

    [Fact]
    public void SelectBackend_WhenNvidiaGpu_ReturnsCuda()
    {
        var hardware = new HardwareProfile(32, "NVIDIA GeForce RTX 4070", 12);

        Assert.Equal(NemoSpeechBackend.Cuda, NemoSpeechRuntimeManager.SelectBackend(hardware));
        Assert.Equal(NemotronAsrCatalog.CudaZipUrl, NemotronAsrCatalog.ZipUrl(NemoSpeechBackend.Cuda));
    }

    [Fact]
    public void SelectBackend_WhenNoNvidiaGpu_ReturnsCpu()
    {
        var hardware = new HardwareProfile(16, "AMD Radeon RX 7900 XTX", 24);

        Assert.Equal(NemoSpeechBackend.Cpu, NemoSpeechRuntimeManager.SelectBackend(hardware));
        Assert.Equal(NemotronAsrCatalog.CpuZipUrl, NemotronAsrCatalog.ZipUrl(NemoSpeechBackend.Cpu));
    }

    [Fact]
    public void IsReady_WhenDummyDllMissing_ReturnsFalse()
    {
        var manager = new NemoSpeechRuntimeManager(new HttpClient(), _tempDirectory);

        Assert.False(manager.IsReady(NemoSpeechBackend.Cpu));
        Assert.False(manager.IsReady(NemoSpeechBackend.Cuda));
    }

    [Fact]
    public void IsReady_WhenDummyDllExists_ReturnsTrue()
    {
        var bin = Path.Combine(_tempDirectory, "cpu", "bin");
        Directory.CreateDirectory(bin);
        File.WriteAllBytes(Path.Combine(bin, NemotronAsrCatalog.NativeLibraryFileName), [0]);
        var manager = new NemoSpeechRuntimeManager(new HttpClient(), _tempDirectory);

        Assert.True(manager.IsReady(NemoSpeechBackend.Cpu));
        Assert.Equal(bin, manager.GetBinDirectory(NemoSpeechBackend.Cpu));
    }

    [Fact]
    public void DeleteRuntime_RemovesExtractedFiles()
    {
        var bin = Path.Combine(_tempDirectory, "cpu", "bin");
        Directory.CreateDirectory(bin);
        File.WriteAllBytes(Path.Combine(bin, NemotronAsrCatalog.NativeLibraryFileName), [0]);
        var manager = new NemoSpeechRuntimeManager(new HttpClient(), _tempDirectory);

        manager.DeleteRuntime();

        Assert.False(manager.IsReady(NemoSpeechBackend.Cpu));
        Assert.False(Directory.Exists(_tempDirectory));
    }

    [Fact]
    public void DeleteRuntime_WhenMissing_DoesNotThrow()
    {
        var manager = new NemoSpeechRuntimeManager(new HttpClient(), _tempDirectory);

        var exception = Record.Exception(() => manager.DeleteRuntime());

        Assert.Null(exception);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
            Directory.Delete(_tempDirectory, recursive: true);
    }
}
