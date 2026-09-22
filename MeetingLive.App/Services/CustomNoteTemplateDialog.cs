using MeetingLive.Core.Models;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;

namespace MeetingLive_App.Services;

/// <summary>Name and instructions for the one custom note template. Cancel returns null.</summary>
internal static class CustomNoteTemplateDialog
{
    public static async Task<CustomNoteTemplate?> ShowAsync(XamlRoot xamlRoot, CustomNoteTemplate? existing)
    {
        var name = new TextBox
        {
            Header = AppStrings.Get("CustomTemplate_Name.Header"),
            PlaceholderText = AppStrings.Get("CustomTemplate_Name.PlaceholderText"),
            Text = existing?.Name ?? string.Empty,
        };
        AutomationProperties.SetName(name, AppStrings.Get("CustomTemplate_Name.AutomationProperties.Name"));

        var instructions = new TextBox
        {
            Header = AppStrings.Get("CustomTemplate_Instructions.Header"),
            PlaceholderText = AppStrings.Get("CustomTemplate_Instructions.PlaceholderText"),
            Text = existing?.Instructions ?? string.Empty,
            AcceptsReturn = true,
            TextWrapping = TextWrapping.Wrap,
            MinHeight = 120,
        };
        AutomationProperties.SetName(instructions, AppStrings.Get("CustomTemplate_Instructions.AutomationProperties.Name"));

        var panel = new StackPanel { Spacing = 12 };
        panel.Children.Add(name);
        panel.Children.Add(instructions);

        var dialog = AppDialogFactory.CreateConfirm(
            xamlRoot,
            AppStrings.Get("CustomTemplate_Title"),
            panel,
            AppStrings.Get("CustomTemplate_Save"),
            AppStrings.Get("CustomTemplate_Cancel"),
            ContentDialogButton.Primary);
        dialog.Closing += (_, args) =>
        {
            if (args.Result == ContentDialogResult.Primary &&
                (string.IsNullOrWhiteSpace(name.Text) || string.IsNullOrWhiteSpace(instructions.Text)))
            {
                args.Cancel = true;
            }
        };

        if (await dialog.ShowAsync() != ContentDialogResult.Primary)
            return null;

        return new CustomNoteTemplate
        {
            Name = name.Text.Trim(),
            Instructions = instructions.Text.Trim(),
        };
    }
}
