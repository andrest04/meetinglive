namespace MeetingLive.Core.Services;

public enum TypeSafeFailureKind
{
    Unauthorized,
    RateLimited,
    Overloaded,
    RequestFailed,
    EmptyOutput,
}

/// <summary>Friendly English failure from the TypeSafe HTTP API. Messages never include keys or response bodies.</summary>
public sealed class TypeSafeException : Exception
{
    public TypeSafeFailureKind Kind { get; }

    public TypeSafeException(TypeSafeFailureKind kind, string message)
        : base(message)
    {
        Kind = kind;
    }
}
