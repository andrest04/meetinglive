using System.Net;
using MeetingLive.Core.Services;
using MeetingLive.Core.Tests.TestHelpers;

namespace MeetingLive.Core.Tests.Services;

public class ResumableFileDownloaderTests : IDisposable
{
    private readonly string _tempDirectory = Path.Combine(Path.GetTempPath(), "MeetingLiveTests_" + Guid.NewGuid());

    [Fact]
    public async Task DownloadAsync_WhileDownloadInProgress_HasCreatedThePartFileButNotTheFinalPath()
    {
        Directory.CreateDirectory(_tempDirectory);
        var finalPath = Path.Combine(_tempDirectory, "runtime.zip");
        var firstChunkRead = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseSecondChunk = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var stream = new PausingStream(firstChunkRead, releaseSecondChunk);
        var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StreamHttpContent(stream),
        });
        var httpClient = new HttpClient(handler);

        var downloadTask = ResumableFileDownloader.DownloadAsync(httpClient, "https://example.com/runtime.zip", finalPath);

        await firstChunkRead.Task;
        Assert.True(File.Exists(finalPath + ".part"));
        Assert.False(File.Exists(finalPath));

        releaseSecondChunk.SetResult();
        await downloadTask;
    }

    [Fact]
    public async Task DownloadAsync_OnCompletion_MovesThePartFileToFinalPathWithTheDownloadedContent()
    {
        Directory.CreateDirectory(_tempDirectory);
        var content = "fake-download-bytes"u8.ToArray();
        var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(content),
        });
        var httpClient = new HttpClient(handler);
        var finalPath = Path.Combine(_tempDirectory, "model.bin");

        await ResumableFileDownloader.DownloadAsync(httpClient, "https://example.com/model.bin", finalPath);

        Assert.False(File.Exists(finalPath + ".part"));
        Assert.Equal(content, await File.ReadAllBytesAsync(finalPath));
    }

    [Fact]
    public async Task DownloadAsync_WhenCancelled_DeletesThePartialPartFileAndThrows()
    {
        Directory.CreateDirectory(_tempDirectory);
        var finalPath = Path.Combine(_tempDirectory, "runtime.zip");
        var handler = new FakeHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StreamHttpContent(new BlockingStream()),
        });
        var httpClient = new HttpClient(handler);
        using var cts = new CancellationTokenSource();

        var downloadTask = ResumableFileDownloader.DownloadAsync(
            httpClient, "https://example.com/runtime.zip", finalPath, cancellationToken: cts.Token);

        await WaitUntilAsync(() => File.Exists(finalPath + ".part"));
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => downloadTask);
        Assert.False(File.Exists(finalPath + ".part"));
        Assert.False(File.Exists(finalPath));
    }

    private static async Task WaitUntilAsync(Func<bool> condition)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (!condition())
        {
            timeout.Token.ThrowIfCancellationRequested();
            await Task.Delay(10, CancellationToken.None);
        }
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDirectory))
            Directory.Delete(_tempDirectory, recursive: true);
    }

    /// <summary>HttpContent that hands out a pre-built stream directly instead of buffering it into a
    /// MemoryStream, so the fake response body can be read incrementally like a real network stream.</summary>
    private sealed class StreamHttpContent(Stream stream) : HttpContent
    {
        protected override Task<Stream> CreateContentReadStreamAsync() => Task.FromResult(stream);

        protected override Task<Stream> CreateContentReadStreamAsync(CancellationToken cancellationToken) =>
            Task.FromResult(stream);

        protected override Task SerializeToStreamAsync(Stream target, System.Net.TransportContext? context) =>
            stream.CopyToAsync(target);

        protected override bool TryComputeLength(out long length)
        {
            length = 0;
            return false;
        }
    }

    /// <summary>Returns one chunk immediately, signals <paramref name="firstChunkRead"/>, then waits for
    /// <paramref name="releaseSecondChunk"/> before returning end-of-stream.</summary>
    private sealed class PausingStream(TaskCompletionSource firstChunkRead, TaskCompletionSource releaseSecondChunk) : Stream
    {
        private int _step;

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken)
        {
            if (_step++ == 0)
            {
                byte[] chunk = "first-chunk-bytes"u8.ToArray();
                chunk.CopyTo(buffer.Span);
                firstChunkRead.TrySetResult();
                return chunk.Length;
            }

            await releaseSecondChunk.Task.WaitAsync(cancellationToken);
            return 0;
        }

        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override void Flush()
        {
        }
    }

    /// <summary>A stream whose reads never complete on their own, so cancellation is the only way out.</summary>
    private sealed class BlockingStream : Stream
    {
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return 0;
        }

        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override void Flush()
        {
        }
    }
}
