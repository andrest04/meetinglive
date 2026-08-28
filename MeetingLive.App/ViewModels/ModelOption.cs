using CommunityToolkit.Mvvm.ComponentModel;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using MeetingLive.Core.Models;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Display wrapper around a <see cref="SummaryModelInfo"/> catalog entry —
/// precomputes label/brush so the ListView templates (wizard + Settings model
/// management list) stay simple, and tracks live download progress.
/// </summary>
public sealed partial class ModelOption : ObservableObject
{
    public SummaryModelInfo Info { get; }

    public FitRating Rating { get; }

    [ObservableProperty]
    private bool _isDownloaded;

    [ObservableProperty]
    private bool _isDownloading;

    [ObservableProperty]
    private double _downloadProgressPercent;

    /// <summary>Whether this is the model currently selected as active in Settings. Not used by the wizard.</summary>
    [ObservableProperty]
    private bool _isActive;

    public ModelOption(SummaryModelInfo info, FitRating rating, bool isDownloaded)
    {
        Info = info;
        Rating = rating;
        _isDownloaded = isDownloaded;
    }

    public string DisplayName => IsDownloaded ? $"{Info.DisplayName} (downloaded)" : Info.DisplayName;

    public string SpeedQualityLabel => $"{Info.Speed} · Quality {Info.Quality} · {Info.FileSizeGb:0.#} GB download";

    public string RatingLabel => Rating switch
    {
        FitRating.Recommended => "Recommended",
        FitRating.MayBeSlow => "May be slow",
        FitRating.NotRecommended => "Not recommended",
        _ => string.Empty,
    };

    public Brush RatingBrush => Rating switch
    {
        FitRating.Recommended => (Brush)Application.Current.Resources["SystemFillColorSuccessBrush"],
        FitRating.MayBeSlow => (Brush)Application.Current.Resources["SystemFillColorCautionBrush"],
        _ => (Brush)Application.Current.Resources["SystemFillColorCriticalBrush"],
    };

    partial void OnIsDownloadedChanged(bool value) => OnPropertyChanged(nameof(DisplayName));
}
