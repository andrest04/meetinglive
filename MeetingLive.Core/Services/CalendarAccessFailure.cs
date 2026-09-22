using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

/// <summary>Maps Windows calendar failures onto the typed empty states. Does not throw.</summary>
public static class CalendarAccessFailure
{
    /// <summary>APPMODEL_ERROR_NO_PACKAGE.</summary>
    public const int AppModelErrorNoPackage = unchecked((int)0x80073D54);

    public static CalendarStoreFailure Classify(Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        return IsNoPackageIdentity(exception)
            ? CalendarStoreFailure.NoPackageIdentity
            : CalendarStoreFailure.AccessDenied;
    }

    public static bool IsNoPackageIdentity(Exception exception)
    {
        ArgumentNullException.ThrowIfNull(exception);
        if (exception.HResult == AppModelErrorNoPackage)
            return true;

        var message = exception.Message;
        return message.Contains("package identity", StringComparison.OrdinalIgnoreCase)
            || message.Contains("no package identity", StringComparison.OrdinalIgnoreCase);
    }
}
