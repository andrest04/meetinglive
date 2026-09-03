using MeetingLive.Core.Services;

namespace MeetingLive_App.Services;

/// <summary>Maps <see cref="CliToolException.Kind"/> to resw copy for Record / Summary status.</summary>
internal static class CliFailureUserMessage
{
    public static string Format(Exception exception)
    {
        if (exception is not CliToolException cli)
            return exception.Message;

        var text = cli.Kind switch
        {
            CliFailureKind.NotInstalled => AppStrings.Format("Error_CliNotInstalled", cli.ProviderDisplayName),
            CliFailureKind.NotSignedIn => AppStrings.Format("Error_CliNotSignedIn", cli.ProviderDisplayName),
            CliFailureKind.SubscriptionInactive => AppStrings.Format("Error_CliSubscriptionInactive", cli.ProviderDisplayName),
            CliFailureKind.TimedOut => AppStrings.Format("Error_CliTimedOut", cli.ProviderDisplayName),
            CliFailureKind.EmptyOutput => AppStrings.Format("Error_CliEmptyOutput", cli.ProviderDisplayName),
            _ => AppStrings.Format("Error_CliUnknown", cli.ProviderDisplayName),
        };

        if (cli.Kind == CliFailureKind.Unknown && !string.IsNullOrWhiteSpace(cli.Detail))
            return $"{text} {cli.Detail}";

        return text;
    }
}
