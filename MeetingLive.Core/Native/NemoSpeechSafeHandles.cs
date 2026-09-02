using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace MeetingLive.Core.Native;

/// <summary>Owns a <see cref="NativeLibrary.Load"/> handle and frees it with <see cref="NativeLibrary.Free"/>.</summary>
internal sealed class NativeLibraryHandle : SafeHandleZeroOrMinusOneIsInvalid
{
    private NativeLibraryHandle() : base(ownsHandle: true)
    {
    }

    public static NativeLibraryHandle Attach(IntPtr loaded)
    {
        var handle = new NativeLibraryHandle();
        handle.SetHandle(loaded);
        return handle;
    }

    protected override bool ReleaseHandle()
    {
        NativeLibrary.Free(handle);
        return true;
    }
}

/// <summary>
/// Owns a NeMo C ABI object (recognizer, stream, or result). <see cref="DangerousAddRef"/> on
/// <paramref name="library"/> keeps the DLL loaded until this handle is released.
/// </summary>
internal sealed class NemoOwnedHandle : SafeHandleZeroOrMinusOneIsInvalid
{
    private readonly NativeLibraryHandle _library;
    private readonly Action<IntPtr> _release;
    private readonly bool _libraryRefAdded;

    public NemoOwnedHandle(IntPtr native, NativeLibraryHandle library, Action<IntPtr> release)
        : base(ownsHandle: true)
    {
        ArgumentNullException.ThrowIfNull(library);
        ArgumentNullException.ThrowIfNull(release);
        if (native == IntPtr.Zero)
            throw new ArgumentOutOfRangeException(nameof(native));

        _library = library;
        _release = release;
        var success = false;
        library.DangerousAddRef(ref success);
        _libraryRefAdded = success;
        SetHandle(native);
    }

    protected override bool ReleaseHandle()
    {
        try
        {
            _release(handle);
            return true;
        }
        catch
        {
            return false;
        }
        finally
        {
            if (_libraryRefAdded)
                _library.DangerousRelease();
        }
    }
}

/// <summary>Pins a <see cref="SafeHandle"/> for the duration of one native call.</summary>
internal readonly struct DangerousHandleScope : IDisposable
{
    private readonly SafeHandle _handle;
    private readonly bool _added;

    public IntPtr Pointer { get; }

    public DangerousHandleScope(SafeHandle handle)
    {
        ArgumentNullException.ThrowIfNull(handle);
        ObjectDisposedException.ThrowIf(handle.IsClosed || handle.IsInvalid, handle);

        _handle = handle;
        var success = false;
        handle.DangerousAddRef(ref success);
        _added = success;
        Pointer = handle.DangerousGetHandle();
    }

    public void Dispose()
    {
        if (_added)
            _handle.DangerousRelease();
    }
}
