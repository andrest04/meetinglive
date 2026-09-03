using CommunityToolkit.Mvvm.ComponentModel;
using MeetingLive_App.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>Downloads the Whisper GGML with progress. Cancel means Whisper is not ready.</summary>
public partial class WhisperSetupDialogViewModel : ObservableObject
{
    private readonly CancellationTokenSource _cts = new();

    [ObservableProperty]
    private double _downloadProgressPercent;

    [ObservableProperty]
    private string _statusText = AppStrings.Get("Status_PreparingDownload");

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
            if (AppServices.WhisperModels.IsModelDownloaded())
            {
                IsReady = true;
                Completed?.Invoke(this, EventArgs.Empty);
                return;
            }

            var progress = new Progress<double>(percent =>
            {
                App.DispatcherQueue.TryEnqueue(() =>
                {
                    DownloadProgressPercent = percent;
                    StatusText = $"{AppStrings.Get("Status_DownloadingWhisper")}  {percent:0}%";
                });
            });

            await AppServices.WhisperModels.DownloadModelAsync(progress, _cts.Token);

            IsReady = AppServices.WhisperModels.IsModelDownloaded();
            if (IsReady)
                Completed?.Invoke(this, EventArgs.Empty);
            else
            {
                HasError = true;
                ErrorText = AppStrings.Get("Error_WhisperNotInstalled");
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
            StatusText = AppStrings.Get("Status_DownloadFailed");
        }
    }
}
