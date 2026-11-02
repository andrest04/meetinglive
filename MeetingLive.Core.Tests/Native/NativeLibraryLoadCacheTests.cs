using MeetingLive.Core.Native;

namespace MeetingLive.Core.Tests.Native;

public class NativeLibraryLoadCacheTests
{
    [Fact]
    public void GetOrLoad_WhenLoadFails_RetriesOnTheNextCall()
    {
        var cache = new NativeLibraryLoadCache<object>();
        var attempts = 0;
        var loaded = new object();

        object Load(string _) =>
            ++attempts == 1 ? throw new DllNotFoundException("missing dependency") : loaded;

        Assert.Throws<DllNotFoundException>(() => cache.GetOrLoad(@"C:\runtime\bin", Load));

        Assert.Same(loaded, cache.GetOrLoad(@"C:\runtime\bin", Load));
        Assert.Equal(2, attempts);
    }

    [Fact]
    public void GetOrLoad_WhenLoadSucceeds_KeepsTheLibraryForTheProcess()
    {
        var cache = new NativeLibraryLoadCache<object>();
        var attempts = 0;

        object Load(string _)
        {
            attempts++;
            return new object();
        }

        var first = cache.GetOrLoad(@"C:\runtime\bin", Load);
        var second = cache.GetOrLoad(@"c:\RUNTIME\BIN", Load);

        Assert.Same(first, second);
        Assert.Equal(1, attempts);
    }

    [Fact]
    public async Task GetOrLoad_WhenCalledConcurrently_LoadsOnce()
    {
        var cache = new NativeLibraryLoadCache<object>();
        var attempts = 0;
        using var start = new Barrier(8);

        object Load(string _)
        {
            Interlocked.Increment(ref attempts);
            Thread.Sleep(50);
            return new object();
        }

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Factory.StartNew(
            () =>
            {
                start.SignalAndWait();
                return cache.GetOrLoad(@"C:\runtime\bin", Load);
            },
            TaskCreationOptions.LongRunning)));

        Assert.Equal(1, attempts);
        Assert.All(results, result => Assert.Same(results[0], result));
    }

    [Fact]
    public async Task GetOrLoad_ForDifferentDirectories_NeverOverlaps()
    {
        // The load changes the process-wide DLL search path, so two backends must not race.
        var cache = new NativeLibraryLoadCache<object>();
        var running = 0;
        var maxRunning = 0;
        using var start = new Barrier(2);

        object Load(string _)
        {
            var now = Interlocked.Increment(ref running);
            InterlockedMax(ref maxRunning, now);
            Thread.Sleep(100);
            Interlocked.Decrement(ref running);
            return new object();
        }

        await Task.WhenAll(new[] { @"C:\runtime\cpu", @"C:\runtime\cuda" }.Select(directory => Task.Factory.StartNew(
            () =>
            {
                start.SignalAndWait();
                return cache.GetOrLoad(directory, Load);
            },
            TaskCreationOptions.LongRunning)));

        Assert.Equal(1, maxRunning);
    }

    [Fact]
    public async Task GetOrLoad_WhenAConcurrentLoadFails_TheWaitingCallerStillTries()
    {
        var cache = new NativeLibraryLoadCache<object>();
        var attempts = 0;
        using var start = new Barrier(2);

        object Load(string _)
        {
            Thread.Sleep(50);
            return Interlocked.Increment(ref attempts) == 1 ? throw new DllNotFoundException() : new object();
        }

        var outcomes = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => Task.Factory.StartNew(
            () =>
            {
                start.SignalAndWait();
                try
                {
                    cache.GetOrLoad(@"C:\runtime\bin", Load);
                    return true;
                }
                catch (DllNotFoundException)
                {
                    return false;
                }
            },
            TaskCreationOptions.LongRunning)));

        Assert.Equal(2, attempts);
        Assert.Single(outcomes, outcome => outcome);
    }

    private static void InterlockedMax(ref int target, int value)
    {
        int current;
        while (value > (current = Volatile.Read(ref target)))
        {
            if (Interlocked.CompareExchange(ref target, value, current) == current)
                return;
        }
    }
}
