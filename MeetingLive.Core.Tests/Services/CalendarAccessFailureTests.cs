using MeetingLive.Core.Models;
using MeetingLive.Core.Services;

namespace MeetingLive.Core.Tests.Services;

public class CalendarAccessFailureTests
{
    [Fact]
    public void Classify_UnauthorizedAccess_ReturnsAccessDenied()
    {
        var failure = CalendarAccessFailure.Classify(new UnauthorizedAccessException("denied"));

        Assert.Equal(CalendarStoreFailure.AccessDenied, failure);
    }

    [Fact]
    public void Classify_NoPackageHresult_ReturnsNoPackageIdentity()
    {
        var failure = CalendarAccessFailure.Classify(new InvalidOperationException("store unavailable")
        {
            HResult = CalendarAccessFailure.AppModelErrorNoPackage,
        });

        Assert.Equal(CalendarStoreFailure.NoPackageIdentity, failure);
    }

    [Fact]
    public void Classify_PackageIdentityMessage_ReturnsNoPackageIdentity()
    {
        var failure = CalendarAccessFailure.Classify(new InvalidOperationException("The process has no package identity."));

        Assert.Equal(CalendarStoreFailure.NoPackageIdentity, failure);
    }
}
