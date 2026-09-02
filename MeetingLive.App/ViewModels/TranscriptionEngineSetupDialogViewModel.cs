using CommunityToolkit.Mvvm.ComponentModel;
using MeetingLive.Core.Services;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>Downloads the Nemotron ASR GGUF and NVIDIA NeMo-Speech.cpp runtime with progress.</summary>
public partial class TranscriptionEngineSetupDialogViewModel : ObservableObject
{
    private readonly CancellationTokenSource _cts = new();

    [ObservableProperty]
    private double _downloadProgressPercent;

    [ObservableProperty]
    private string _statusText = "Preparing download...";

    [ObservableProperty]
    private string _errorText = string.Empty;

    [ObservableProperty]
    private bool _hasError;

    public bool IsReady { get; private set; }

    public event EventHandler? Completed;

    public void Cancel() => _cts.Cancel();

    public async Task StartDownloadAsync()
    {
        HasError = false;
        ErrorText = string.Empty;
        try
        {
            var hardware = AppServices.HardwareDetection.DetectHardware();
            var progress = new Progress<TranscriptionEngineInstallProgress>(update =>
            {
                App.DispatcherQueue.TryEnqueue(() =>
                {
                    DownloadProgressPercent = update.Percent;
                    StatusText = $"{update.StatusText}  {update.Percent:0}%";
                });
            });

            await TranscriptionEngineInstaller.EnsureAsync(
                AppServices.NemotronModels,
                AppServices.NemoSpeechRuntime,
                hardware,
                progress,
                _cts.Token);

            IsReady = TranscriptionEngineInstaller.IsReady(AppServices.NemotronModels, AppServices.NemoSpeechRuntime);
            if (IsReady)
                Completed?.Invoke(this, EventArgs.Empty);
            else
            {
                HasError = true;
                ErrorText = "Download finished but the transcription engine is still not ready.";
            }
        }
        catch (OperationCanceledException)
        {
            // Caller closed the dialog.
        }
        catch (Exception ex)
        {
            HasError = true;
            ErrorText = ex.Message;
            StatusText = "Download failed.";
        }
    }
}
