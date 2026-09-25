using System.Net;
using MeetingLive.Core.Models;
using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class MeetingJevServiceTests
{
    private const string CannedAnswers = """
        {
          "model": "jev-1.13.0",
          "answers": {
            "meeting_type": { "type": "choice", "choice": "standup", "confidence": 0.85 },
            "spoken_language": { "type": "choice", "choice": "en", "confidence": 0.99 },
            "urgency": { "type": "score", "score": 1.0, "confidence": 0.9 },
            "contains_decisions": { "type": "noul", "noul": 0.8 },
            "contains_commitments": { "type": "noul", "noul": 0.2 },
            "pii_present": { "type": "noul", "noul": 0.01 },
            "summary_faithful": { "type": "noul", "noul": 0.7 },
            "item_0_relation": { "type": "choice", "choice": "supports", "confidence": 0.88 }
          }
        }
        """;

    [Fact]
    public async Task TryAnalyzeAsync_WhenDisabled_DoesNotCallHttp()
    {
        var handler = new FakeHttpMessageHandler(_ => throw new InvalidOperationException("HTTP should not run"));
        var store = new InMemoryTypeSafeCredentialStore();
        store.Save(new TypeSafeCredentials("secret-key"));
        var service = CreateService(handler, store);
        var record = CreateRecord();

        var analysis = await service.TryAnalyzeAsync(record, [], "Inbox", enabled: false);

        Assert.Null(analysis);
        Assert.Null(record.JevAnalysis);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task TryAnalyzeAsync_WhenNoKey_DoesNotCallHttp()
    {
        var handler = new FakeHttpMessageHandler(_ => throw new InvalidOperationException("HTTP should not run"));
        var service = CreateService(handler, new InMemoryTypeSafeCredentialStore());
        var record = CreateRecord();

        var analysis = await service.TryAnalyzeAsync(record, [], "Inbox", enabled: true);

        Assert.Null(analysis);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task TryAnalyzeAsync_WhenTranscriptEmpty_DoesNotCallHttp()
    {
        var handler = new FakeHttpMessageHandler(_ => throw new InvalidOperationException("HTTP should not run"));
        var store = new InMemoryTypeSafeCredentialStore();
        store.Save(new TypeSafeCredentials("secret-key"));
        var service = CreateService(handler, store);
        var record = CreateRecord();
        record.Transcript = "   ";

        var analysis = await service.TryAnalyzeAsync(record, [], "Inbox", enabled: true);

        Assert.Null(analysis);
        Assert.Empty(handler.Requests);
    }

    [Fact]
    public async Task TryAnalyzeAsync_WhenTypeSafeFails_ReturnsNullWithoutThrowing()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(
            HttpStatusCode.Unauthorized,
            """{"error":"nope"}"""));
        var store = new InMemoryTypeSafeCredentialStore();
        store.Save(new TypeSafeCredentials("secret-key"));
        var service = CreateService(handler, store);
        var record = CreateRecord();

        var analysis = await service.TryAnalyzeAsync(record, [], "Inbox", enabled: true);

        Assert.Null(analysis);
        Assert.Null(record.JevAnalysis);
        Assert.NotEmpty(handler.Requests);
    }

    [Fact]
    public async Task TryAnalyzeAsync_WhenSuccessful_SetsRecordAnalysis()
    {
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, CannedAnswers));
        var store = new InMemoryTypeSafeCredentialStore();
        store.Save(new TypeSafeCredentials("secret-key"));
        var service = CreateService(handler, store);
        var record = CreateRecord();
        var folders = new[]
        {
            new FolderRecord { Id = Guid.NewGuid(), Name = "Engineering", CreatedAt = DateTimeOffset.UtcNow },
        };

        var analysis = await service.TryAnalyzeAsync(record, folders, "Inbox", enabled: true);

        Assert.NotNull(analysis);
        Assert.Same(analysis, record.JevAnalysis);
        Assert.Equal("standup", analysis.MeetingType);
        Assert.Single(handler.Requests);
    }

    [Fact]
    public async Task TryAnalyzeAsync_WhenActionItemContradicted_RemovesItSilently()
    {
        const string answers = """
            {
              "model": "jev-1.13.0",
              "answers": {
                "meeting_type": { "type": "choice", "choice": "standup", "confidence": 0.85 },
                "spoken_language": { "type": "choice", "choice": "en", "confidence": 0.99 },
                "urgency": { "type": "score", "score": 1.0, "confidence": 0.9 },
                "contains_decisions": { "type": "noul", "noul": 0.8 },
                "contains_commitments": { "type": "noul", "noul": 0.2 },
                "pii_present": { "type": "noul", "noul": 0.01 },
                "summary_faithful": { "type": "noul", "noul": 0.7 },
                "item_0_relation": { "type": "choice", "choice": "contradicts", "confidence": 0.9 }
              }
            }
            """;
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, answers));
        var store = new InMemoryTypeSafeCredentialStore();
        store.Save(new TypeSafeCredentials("secret-key"));
        var service = CreateService(handler, store);
        var record = CreateRecord();

        await service.TryAnalyzeAsync(record, [], "Inbox", enabled: true);

        Assert.Empty(record.ActionItems);
    }

    [Fact]
    public async Task TryAnalyzeAsync_WhenFolderSuggestedWithHighConfidence_FilesRecordSilently()
    {
        var folderId = Guid.NewGuid();
        var answers = $$"""
            {
              "model": "jev-1.13.0",
              "answers": {
                "meeting_type": { "type": "choice", "choice": "standup", "confidence": 0.85 },
                "spoken_language": { "type": "choice", "choice": "en", "confidence": 0.99 },
                "urgency": { "type": "score", "score": 1.0, "confidence": 0.9 },
                "contains_decisions": { "type": "noul", "noul": 0.8 },
                "contains_commitments": { "type": "noul", "noul": 0.2 },
                "pii_present": { "type": "noul", "noul": 0.01 },
                "summary_faithful": { "type": "noul", "noul": 0.7 },
                "folder": { "type": "choice", "choice": "{{folderId:D}}", "confidence": 0.9 },
                "item_0_relation": { "type": "choice", "choice": "supports", "confidence": 0.88 }
              }
            }
            """;
        var handler = new FakeHttpMessageHandler(_ => FakeHttpMessageHandler.JsonResponse(HttpStatusCode.OK, answers));
        var store = new InMemoryTypeSafeCredentialStore();
        store.Save(new TypeSafeCredentials("secret-key"));
        var service = CreateService(handler, store);
        var record = CreateRecord();
        var folders = new[]
        {
            new FolderRecord { Id = folderId, Name = "Engineering", CreatedAt = DateTimeOffset.UtcNow },
        };

        await service.TryAnalyzeAsync(record, folders, "Inbox", enabled: true);

        Assert.Equal(folderId, record.FolderId);
    }

    private static MeetingJevService CreateService(FakeHttpMessageHandler handler, ITypeSafeCredentialStore store) =>
        new(new TypeSafeApiClient(new HttpClient(handler)), store);

    private static MeetingRecord CreateRecord() => new()
    {
        Id = Guid.NewGuid(),
        Title = "Monday standup",
        RecordedAt = DateTimeOffset.UtcNow,
        AudioFilePath = "meeting.wav",
        Transcript = "We decided to ship the patch today. Ana will file the bug.",
        Summary = "Ship the patch. Ana files the bug.",
        ActionItems = [new ActionItem { Text = "Ana files the bug" }],
    };
}
