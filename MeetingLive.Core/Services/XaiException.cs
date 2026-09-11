namespace MeetingLive.Core.Services;

public enum XaiFailureKind
{
    NotSignedIn,
    SubscriptionOrQuota,
    AccessDenied,
    ExpiredToken,
    EmptyOutput,
    RequestFailed,
}

/// <summary>Friendly English failure from the xAI OAuth or chat API. Messages never include tokens.</summary>
public sealed class XaiException : Exception
{
    public XaiFailureKind Kind { get; }

    public XaiException(XaiFailureKind kind, string message)
        : base(message)
    {
        Kind = kind;
    }
}
