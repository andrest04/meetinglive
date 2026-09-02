using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using MeetingLive.Core.Models;

namespace MeetingLive_App;

/// <summary>Maps a model fit rating to theme brushes. Kept out of ViewModels so they stay UI-type free.</summary>
public static class FitRatingPresentation
{
    public static Brush Brush(FitRating rating) => rating switch
    {
        FitRating.Recommended => (Brush)Application.Current.Resources["SystemFillColorSuccessBrush"],
        FitRating.MayBeSlow => (Brush)Application.Current.Resources["SystemFillColorCautionBrush"],
        _ => (Brush)Application.Current.Resources["SystemFillColorCriticalBrush"],
    };
}
