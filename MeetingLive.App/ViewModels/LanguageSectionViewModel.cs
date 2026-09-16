using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive_App.ViewModels;

/// <summary>
/// Settings section: the meeting (transcription) language and the summary language.
/// </summary>
public sealed partial class LanguageSectionViewModel : SettingsSectionViewModelBase
{
    [ObservableProperty]
    private TranscriptionLanguageOption _selectedLanguage = TranscriptionLanguageCatalog.Languages[0];

    [ObservableProperty]
    private TranscriptionLanguageOption _selectedSummaryLanguage = SummaryLanguageCatalog.Languages[0];

    public IReadOnlyList<TranscriptionLanguageOption> Languages { get; } = TranscriptionLanguageCatalog.Languages;

    public IReadOnlyList<TranscriptionLanguageOption> SummaryLanguages { get; } = SummaryLanguageCatalog.Languages;

    public void ApplyLoadedSettings(AppSettings settings)
    {
        var languageCode = settings.ResolveTranscriptionLanguage();
        SelectedLanguage = TranscriptionLanguageCatalog.Languages.FirstOrDefault(l => l.Code == languageCode)
            ?? TranscriptionLanguageCatalog.Languages[0];

        var summaryLanguageCode = settings.ResolveSummaryLanguage();
        SelectedSummaryLanguage = SummaryLanguageCatalog.Languages.FirstOrDefault(l => l.Code == summaryLanguageCode)
            ?? SummaryLanguageCatalog.Languages[0];
    }

    [RelayCommand]
    private async Task SelectLanguageAsync(TranscriptionLanguageOption option)
    {
        if (option.Code == SelectedLanguage.Code)
            return;

        SelectedLanguage = option;
        await SaveSettingsAsync(settings => settings.TranscriptionLanguage = option.Code);
    }

    [RelayCommand]
    private async Task SelectSummaryLanguageAsync(TranscriptionLanguageOption option)
    {
        if (option.Code == SelectedSummaryLanguage.Code)
            return;

        SelectedSummaryLanguage = option;
        await SaveSettingsAsync(settings => settings.SummaryLanguage = option.Code);
    }
}
