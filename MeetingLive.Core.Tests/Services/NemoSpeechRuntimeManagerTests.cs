using System.Runtime.InteropServices;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class NemoSpeechRuntimeManagerTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid());
    private readonly string _modelsDirectory = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid());

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

    [Fact]
    public void IsReady_WhenAnInstallWasInterrupted_ReturnsFalse()
    {
        WriteRuntime("cpu");
        File.WriteAllBytes(Path.Combine(_tempDirectory, "cpu" + NemoSpeechRuntimeManager.IncompleteMarkerSuffix), []);
        var manager = NewManager();

        Assert.False(manager.IsReady(NemoSpeechBackend.Cpu));
        Assert.Throws<InvalidOperationException>(() => manager.GetBinDirectory(NemoSpeechBackend.Cpu));
    }

    [Fact]
    public void IsReady_WhenAnotherBackendWasInterrupted_StaysTrue()
    {
        WriteRuntime("cpu");
        File.WriteAllBytes(Path.Combine(_tempDirectory, "cuda" + NemoSpeechRuntimeManager.IncompleteMarkerSuffix), []);

        Assert.True(NewManager().IsReady(NemoSpeechBackend.Cpu));
    }

    [Fact]
    public async Task InstallExtracted_WhenTheCopyFallbackFailsMidway_DoesNotReportReady()
    {
        // The exclusive lock makes both the move and the copy fail for real. "zz" sorts after
        // the native library, so the copy has already placed it, as in the audited scenario.
        var source = Path.Combine(_tempDirectory, "cpu.extracting");
        var sourceBin = Path.Combine(source, "bin");
        WriteDll(sourceBin);
        using var locked = new FileStream(Path.Combine(sourceBin, "zz-dependency.dll"), FileMode.Create, FileAccess.ReadWrite, FileShare.None);
        var manager = NewManager();

        await Assert.ThrowsAnyAsync<IOException>(
            () => manager.InstallExtractedAsync(NemoSpeechBackend.Cpu, source, CancellationToken.None));

        Assert.False(manager.IsReady(NemoSpeechBackend.Cpu));
    }

    [Fact]
    public async Task InstallExtracted_WhenTheCopyFallbackSucceeds_ReportsReady()
    {
        // A shared read lock blocks the directory move but lets the copy read every file.
        var source = Path.Combine(_tempDirectory, "cpu.extracting");
        var sourceBin = Path.Combine(source, "bin");
        WriteDll(sourceBin);
        var dependency = Path.Combine(sourceBin, "zz-dependency.dll");
        File.WriteAllBytes(dependency, [0]);
        var manager = NewManager();

        using (new FileStream(dependency, FileMode.Open, FileAccess.Read, FileShare.Read))
            await manager.InstallExtractedAsync(NemoSpeechBackend.Cpu, source, CancellationToken.None);

        Assert.True(manager.IsReady(NemoSpeechBackend.Cpu));
        Assert.True(File.Exists(Path.Combine(_tempDirectory, "cpu", "bin", "zz-dependency.dll")));
    }

    [Fact]
    public async Task InstallExtracted_OverAnInterruptedInstall_ReportsReady()
    {
        WriteRuntime("cpu");
        File.WriteAllBytes(Path.Combine(_tempDirectory, "cpu" + NemoSpeechRuntimeManager.IncompleteMarkerSuffix), []);
        var source = Path.Combine(_tempDirectory, "cpu.extracting");
        var sourceBin = Path.Combine(source, "bin");
        WriteDll(sourceBin);
        var manager = NewManager();

        await manager.InstallExtractedAsync(NemoSpeechBackend.Cpu, source, CancellationToken.None);

        Assert.True(manager.IsReady(NemoSpeechBackend.Cpu));
    }

    [Fact]
    public async Task InstallExtracted_WhenTheFolderHasNoNativeLibrary_ThrowsAndDoesNotReportReady()
    {
        var source = Path.Combine(_tempDirectory, "cpu.extracting");
        Directory.CreateDirectory(source);
        File.WriteAllBytes(Path.Combine(source, "readme.txt"), [0]);
        var manager = NewManager();

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => manager.InstallExtractedAsync(NemoSpeechBackend.Cpu, source, CancellationToken.None));

        Assert.False(manager.IsReady(NemoSpeechBackend.Cpu));
    }

    [Fact]
    public void DeleteRuntime_WhenAFileIsHeldOpen_ThrowsAndRemovesNothing()
    {
        var bin = WriteRuntime("cpu");
        var dependency = Path.Combine(bin, "aa-dependency.dll");
        var manager = NewManager();

        using (new FileStream(dependency, FileMode.Create, FileAccess.ReadWrite, FileShare.None))
            Assert.Throws<NemoSpeechRuntimeInUseException>(() => manager.DeleteRuntime());

        Assert.True(File.Exists(Path.Combine(bin, NemotronAsrCatalog.NativeLibraryFileName)));
        Assert.True(File.Exists(dependency));
        Assert.True(manager.IsReady(NemoSpeechBackend.Cpu));
    }

    [Fact]
    public void DeleteRuntime_WhenTheLibraryIsReallyLoaded_ThrowsAndRemovesNothing()
    {
        // A real system DLL under the runtime's name: proves the probe sees the lock Windows
        // holds on a loaded image, which is what stays after a transcription.
        var bin = WriteRuntime("cpu");
        var dll = Path.Combine(bin, NemotronAsrCatalog.NativeLibraryFileName);
        File.Copy(Path.Combine(Environment.SystemDirectory, "version.dll"), dll, overwrite: true);
        var sibling = Path.Combine(bin, "aa-dependency.dll");
        File.WriteAllBytes(sibling, [0]);
        var manager = NewManager();

        var handle = NativeLibrary.Load(dll);
        try
        {
            Assert.Throws<NemoSpeechRuntimeInUseException>(() => manager.DeleteRuntime());
            Assert.True(File.Exists(sibling));
            Assert.True(manager.IsReady(NemoSpeechBackend.Cpu));
        }
        finally
        {
            NativeLibrary.Free(handle);
        }

        manager.DeleteRuntime();
        Assert.False(Directory.Exists(_tempDirectory));
    }

    [Fact]
    public void DeleteRuntime_WhenDeletionFailsPartway_DoesNotReportReady()
    {
        WriteRuntime("cpu");
        var manager = new NemoSpeechRuntimeManager(new HttpClient(), _tempDirectory)
        {
            DirectoryDeleter = _ => throw new IOException("locked by a scanner"),
        };

        Assert.Throws<IOException>(() => manager.DeleteRuntime());

        Assert.False(manager.IsReady(NemoSpeechBackend.Cpu));
    }

    [Fact]
    public void DeleteRuntime_AfterAPartialDeletion_FinishesAndLeavesNoMarker()
    {
        WriteRuntime("cpu");
        var failing = new NemoSpeechRuntimeManager(new HttpClient(), _tempDirectory)
        {
            DirectoryDeleter = _ => throw new IOException("locked by a scanner"),
        };
        Assert.Throws<IOException>(() => failing.DeleteRuntime());

        NewManager().DeleteRuntime();

        Assert.False(Directory.Exists(_tempDirectory));
    }

    [Fact]
    public void DeleteEngine_WhenTheRuntimeIsFree_RemovesBoth()
    {
        WriteRuntime("cpu");
        var models = NewModels();

        var outcome = NemoSpeechRuntimeManager.DeleteEngine(models, NewManager());

        Assert.Equal(TranscriptionEngineDeletion.Deleted, outcome);
        Assert.False(models.IsModelDownloaded());
        Assert.False(NewManager().IsReady(NemoSpeechBackend.Cpu));
    }

    [Fact]
    public void DeleteEngine_WhenTheRuntimeIsInUse_KeepsTheModel()
    {
        var bin = WriteRuntime("cpu");
        var models = NewModels();
        var manager = NewManager();

        TranscriptionEngineDeletion outcome;
        using (new FileStream(Path.Combine(bin, NemotronAsrCatalog.NativeLibraryFileName), FileMode.Open, FileAccess.Read, FileShare.Read))
            outcome = NemoSpeechRuntimeManager.DeleteEngine(models, manager);

        Assert.Equal(TranscriptionEngineDeletion.RuntimeInUse, outcome);
        Assert.True(models.IsModelDownloaded());
        Assert.True(manager.IsReady(NemoSpeechBackend.Cpu));
    }

    [Fact]
    public void DeleteEngine_WhenTheRuntimeFailsPartway_KeepsTheModel()
    {
        WriteRuntime("cpu");
        var models = NewModels();
        var manager = new NemoSpeechRuntimeManager(new HttpClient(), _tempDirectory)
        {
            DirectoryDeleter = _ => throw new UnauthorizedAccessException("denied"),
        };

        var outcome = NemoSpeechRuntimeManager.DeleteEngine(models, manager);

        Assert.Equal(TranscriptionEngineDeletion.Incomplete, outcome);
        Assert.True(models.IsModelDownloaded());
        Assert.False(manager.IsReady(NemoSpeechBackend.Cpu));
    }

    [Fact]
    public void DeleteEngine_WhenTheModelIsLocked_ReportsIncomplete()
    {
        WriteRuntime("cpu");
        var models = NewModels();

        TranscriptionEngineDeletion outcome;
        using (new FileStream(models.GetModelPath(), FileMode.Open, FileAccess.Read, FileShare.None))
            outcome = NemoSpeechRuntimeManager.DeleteEngine(models, NewManager());

        Assert.Equal(TranscriptionEngineDeletion.Incomplete, outcome);
        Assert.False(TranscriptionEngineInstaller.IsReady(models, NewManager()));
    }

    private NemoSpeechRuntimeManager NewManager() => new(new HttpClient(), _tempDirectory);

    private NemotronModelManager NewModels()
    {
        var models = new NemotronModelManager(new HttpClient(), _modelsDirectory);
        Directory.CreateDirectory(_modelsDirectory);
        File.WriteAllBytes(models.GetModelPath(), [0]);
        return models;
    }

    private string WriteRuntime(string folder)
    {
        var bin = Path.Combine(_tempDirectory, folder, "bin");
        WriteDll(bin);
        return bin;
    }

    private static void WriteDll(string directory)
    {
        Directory.CreateDirectory(directory);
        File.WriteAllBytes(Path.Combine(directory, NemotronAsrCatalog.NativeLibraryFileName), [0]);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
            Directory.Delete(_tempDirectory, recursive: true);
        if (Directory.Exists(_modelsDirectory))
            Directory.Delete(_modelsDirectory, recursive: true);
    }
}
