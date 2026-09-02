using CommunityToolkit.Mvvm.ComponentModel;
using MeetingLive.Core.Models;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Display wrapper around a <see cref="SummaryModelInfo"/> catalog entry —
/// precomputes labels so the ListView templates (wizard + Settings model
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

    public string DisplayName => IsDownloaded
        ? AppStrings.Format("Model_Downloaded", Info.DisplayName)
        : Info.DisplayName;

    public string SpeedQualityLabel =>
        AppStrings.Format("Model_SpeedQuality", Info.Speed, Info.Quality, Info.FileSizeGb);

    public string RatingLabel => Rating switch
    {
        FitRating.Recommended => AppStrings.Get("Fit_Recommended"),
        FitRating.MayBeSlow => AppStrings.Get("Fit_MayBeSlow"),
        FitRating.NotRecommended => AppStrings.Get("Fit_NotRecommended"),
        _ => string.Empty,
    };

    partial void OnIsDownloadedChanged(bool value) => OnPropertyChanged(nameof(DisplayName));
}
