namespace MeetingLive.Core.Models;

/// <summary>
/// A saved chat prompt. Built-ins live in <c>ChatRecipeCatalog</c> and are not written to disk.
/// This type is for user recipes and for the in-memory built-in list.
/// </summary>
public sealed class ChatRecipe
{
    public const string SingleAvailability = "single";
    public const string MultipleAvailability = "multiple";

    public required Guid Id { get; init; }

    public required string Name { get; set; }

    public required string Prompt { get; set; }

    /// <summary><see cref="SingleAvailability"/> or <see cref="MultipleAvailability"/>.</summary>
    public required string Availability { get; set; }

    public required DateTimeOffset CreatedAt { get; init; }
}
