using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using MeetingLive.Core.Services;

namespace MeetingLive_App.Dialogs;

public sealed class FolderColorSwatch
{
    public required string Key { get; init; }

    public required Brush Brush { get; init; }
}

public sealed class FolderIconTile
{
    public required string Key { get; init; }

    public required string Glyph { get; init; }
}

public sealed partial class FolderPersonalityPicker : UserControl
{
    public FolderPersonalityPicker(string folderName, string? colorKey, string? iconKey, Guid folderId)
    {
        FolderName = folderName;
        SelectedColorKey = FolderAccent.ResolveKey(colorKey, folderId);
        SelectedIconKey = FolderIcon.ResolveKey(iconKey);
        ColorOptions = [.. FolderAccent.Keys.Select(key => new FolderColorSwatch
        {
            Key = key,
            Brush = BrushFor(key),
        })];
        IconOptions = [.. FolderIcon.Keys.Select(key => new FolderIconTile
        {
            Key = key,
            Glyph = FolderIcon.Glyph(key),
        })];
        InitializeComponent();
        Loaded += OnLoaded;
    }

    public string FolderName { get; }

    public IReadOnlyList<FolderColorSwatch> ColorOptions { get; }

    public IReadOnlyList<FolderIconTile> IconOptions { get; }

    public string SelectedColorKey { get; private set; }

    public string SelectedIconKey { get; private set; }

    private void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        ColorGrid.SelectedItem = ColorOptions.FirstOrDefault(item => item.Key == SelectedColorKey);
        IconGrid.SelectedItem = IconOptions.FirstOrDefault(item => item.Key == SelectedIconKey);
        UpdatePreview();
    }

    private void ColorGrid_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (ColorGrid.SelectedItem is FolderColorSwatch swatch)
        {
            SelectedColorKey = swatch.Key;
            UpdatePreview();
        }
    }

    private void IconGrid_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (IconGrid.SelectedItem is FolderIconTile tile)
        {
            SelectedIconKey = tile.Key;
            UpdatePreview();
        }
    }

    private void UpdatePreview()
    {
        var brush = BrushFor(SelectedColorKey);
        PreviewDot.Background = brush;
        PreviewIcon.Foreground = brush;
        PreviewIcon.Glyph = FolderIcon.Glyph(SelectedIconKey);
    }

    private static Brush BrushFor(string key)
    {
        var resource = FolderAccent.BrushResourceName(key);
        if (Application.Current.Resources.TryGetValue(resource, out var value) && value is SolidColorBrush brush)
            return new SolidColorBrush(brush.Color);

        return new SolidColorBrush(Windows.UI.Color.FromArgb(255, 100, 116, 139));
    }
}
