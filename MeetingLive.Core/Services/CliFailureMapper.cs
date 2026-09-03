using System.ComponentModel;
using System.Globalization;
using System.Text.RegularExpressions;

namespace MeetingLive.Core.Services;

/// <summary>
/// Classifies Claude Code / Codex CLI failures from exit code, stdout, stderr, or the
/// exception thrown while starting/waiting for the process. Pure — no process I/O of its own
/// except the convenience <see cref="RunRequiredStdoutAsync"/> wrapper used by the four CLI callers.
/// </summary>
public static class CliFailureMapper
{
    public const string ClaudeCodeDisplayName = "Claude Code";
    public const string CodexDisplayName = "Codex";

    private const int SnippetMaxChars = 120;

    private static readonly Regex SecretPattern = new(
        @"Bearer\s+\S+|(?:api[_-]?key|secret|password|token)\s*[:=]\s*\S+|\bsk-[A-Za-z0-9_-]{8,}|\beyJ[A-Za-z0-9_-]{20,}",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static CliFailureKind Classify(int exitCode, string? stdout, string? stderr, bool isOnPath = true)
    {
        if (!isOnPath)
            return CliFailureKind.NotInstalled;

        if (exitCode == 0 && string.IsNullOrWhiteSpace(stdout))
            return CliFailureKind.EmptyOutput;

        var text = $"{stdout} {stderr}";
        if (LooksLikeNotInstalled(text))
            return CliFailureKind.NotInstalled;
        if (LooksLikeSubscriptionInactive(text))
            return CliFailureKind.SubscriptionInactive;
        if (LooksLikeNotSignedIn(text))
            return CliFailureKind.NotSignedIn;
        if (LooksLikeTimedOut(text))
            return CliFailureKind.TimedOut;

        return CliFailureKind.Unknown;
    }

    public static CliFailureKind Classify(Exception exception)
    {
        if (exception is CliToolException cli)
            return cli.Kind;
        if (exception is TimeoutException)
            return CliFailureKind.TimedOut;
        if (exception is FileNotFoundException)
            return CliFailureKind.NotInstalled;
        if (exception is Win32Exception win32 && (win32.NativeErrorCode is 2 or 3 || LooksLikeNotInstalled(win32.Message)))
            return CliFailureKind.NotInstalled;

        return Classify(exitCode: 1, stdout: null, stderr: exception.Message);
    }

    public static CliToolException Create(
        string providerDisplayName,
        int exitCode,
        string? stdout,
        string? stderr,
        bool isOnPath = true)
    {
        var kind = Classify(exitCode, stdout, stderr, isOnPath);
        return Create(providerDisplayName, kind, stderr, stdout);
    }

    public static CliToolException Create(string providerDisplayName, CliFailureKind kind, string? stderr = null, string? stdout = null)
    {
        var detail = kind == CliFailureKind.Unknown
            ? SanitizeSnippet(FirstNonEmpty(stderr, stdout))
            : null;
        return new CliToolException(kind, providerDisplayName, BuildMessage(kind, providerDisplayName), detail);
    }

    public static CliToolException Wrap(string providerDisplayName, Exception exception)
    {
        if (exception is CliToolException cli)
            return cli;

        var kind = Classify(exception);
        var detail = kind == CliFailureKind.Unknown
            ? SanitizeSnippet(exception.Message)
            : null;
        return new CliToolException(kind, providerDisplayName, BuildMessage(kind, providerDisplayName), detail, exception);
    }

    public static string BuildMessage(CliFailureKind kind, string providerDisplayName) => kind switch
    {
        CliFailureKind.NotInstalled => string.Format(
            CultureInfo.InvariantCulture,
            "{0} is not installed. Install it, or pick another summary engine in Settings.",
            providerDisplayName),
        CliFailureKind.NotSignedIn => string.Format(
            CultureInfo.InvariantCulture,
            "Your {0} session expired. Sign in again on this PC, then generate the summary from the session.",
            providerDisplayName),
        CliFailureKind.SubscriptionInactive => string.Format(
            CultureInfo.InvariantCulture,
            "{0} could not run this request. The subscription on this account may have ended. Renew it, or switch summary engine in Settings.",
            providerDisplayName),
        CliFailureKind.TimedOut => string.Format(
            CultureInfo.InvariantCulture,
            "{0} took too long and was stopped. Try again, or switch engine in Settings.",
            providerDisplayName),
        CliFailureKind.EmptyOutput => string.Format(
            CultureInfo.InvariantCulture,
            "{0} returned nothing. Try again, or switch engine in Settings.",
            providerDisplayName),
        _ => string.Format(
            CultureInfo.InvariantCulture,
            "{0} could not finish the summary.",
            providerDisplayName),
    };

    public static string? SanitizeSnippet(string? text, int maxLength = SnippetMaxChars)
    {
        if (string.IsNullOrWhiteSpace(text))
            return null;

        var sanitized = SecretPattern.Replace(text.Trim(), "[redacted]");
        sanitized = Regex.Replace(sanitized, @"\s+", " ");
        if (sanitized.Length <= maxLength)
            return sanitized;

        return sanitized[..maxLength].TrimEnd() + "…";
    }

    /// <summary>
    /// Runs the CLI and returns trimmed stdout, or throws <see cref="CliToolException"/>.
    /// Does not wrap <see cref="OperationCanceledException"/>.
    /// </summary>
    public static async Task<string> RunRequiredStdoutAsync(
        ICliProcessRunner processRunner,
        string executableName,
        string arguments,
        string stdin,
        TimeSpan timeout,
        string providerDisplayName,
        CancellationToken cancellationToken)
    {
        if (!processRunner.IsOnPath(executableName))
            throw Create(providerDisplayName, CliFailureKind.NotInstalled);

        CliProcessResult result;
        try
        {
            result = await processRunner.RunAsync(executableName, arguments, stdin, timeout, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            throw Wrap(providerDisplayName, ex);
        }

        if (result.ExitCode != 0)
            throw Create(providerDisplayName, result.ExitCode, result.StandardOutput, result.StandardError);

        var raw = result.StandardOutput.Trim();
        if (raw.Length == 0)
            throw Create(providerDisplayName, CliFailureKind.EmptyOutput);

        return raw;
    }

    private static bool LooksLikeNotInstalled(string text) =>
        ContainsPhrase(text, "not found") ||
        ContainsPhrase(text, "cannot find") ||
        ContainsWord(text, "ENOENT");

    private static bool LooksLikeSubscriptionInactive(string text) =>
        ContainsPhrase(text, "payment required") ||
        ContainsPhrase(text, "plan expired") ||
        ContainsWord(text, "402") ||
        ContainsWord(text, "subscription") ||
        ContainsWord(text, "billing") ||
        ContainsWord(text, "payment") ||
        ContainsWord(text, "quota") ||
        ContainsWord(text, "credit");

    private static bool LooksLikeNotSignedIn(string text) =>
        ContainsPhrase(text, "not logged in") ||
        ContainsPhrase(text, "sign in") ||
        ContainsPhrase(text, "sign-in") ||
        ContainsPhrase(text, "unauthorized") ||
        ContainsPhrase(text, "session expired") ||
        ContainsPhrase(text, "token expired") ||
        ContainsPhrase(text, "authentication") ||
        ContainsWord(text, "login") ||
        ContainsWord(text, "oauth") ||
        ContainsWord(text, "auth") ||
        ContainsWord(text, "401") ||
        Regex.IsMatch(text, @"please run.{0,80}login", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static bool LooksLikeTimedOut(string text) =>
        ContainsPhrase(text, "timed out") ||
        ContainsPhrase(text, "time out") ||
        ContainsPhrase(text, "time-out") ||
        ContainsWord(text, "timeout");

    private static bool ContainsPhrase(string text, string phrase) =>
        text.Contains(phrase, StringComparison.OrdinalIgnoreCase);

    private static bool ContainsWord(string text, string word) =>
        Regex.IsMatch(text, $@"\b{Regex.Escape(word)}\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private static string? FirstNonEmpty(string? first, string? second)
    {
        if (!string.IsNullOrWhiteSpace(first))
            return first;
        if (!string.IsNullOrWhiteSpace(second))
            return second;
        return null;
    }
}
