using System.Runtime.InteropServices;

namespace MeetingLive.Core.Native;

/// <summary>
/// Blob passed to <c>ActivateAudioInterfaceAsync</c> for process loopback.
/// Matches <c>AUDIOCLIENT_ACTIVATION_PARAMS</c>: 12 bytes, no padding.
/// Activation type at offset 0, process id at offset 4, mode at offset 8.
/// This layout is what activation receives. Do not substitute a generated struct
/// whose <see cref="Marshal.SizeOf{T}"/> is not 12.
/// </summary>
[StructLayout(LayoutKind.Explicit, Size = 12)]
internal struct AudioClientActivationParams
{
    internal const int ProcessLoopbackActivationType = 1;

    /// <summary><c>PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE</c>.</summary>
    internal const int IncludeTargetProcessTree = 0;

    [FieldOffset(0)]
    internal int ActivationType;

    [FieldOffset(4)]
    internal uint TargetProcessId;

    [FieldOffset(8)]
    internal int ProcessLoopbackMode;

    internal static AudioClientActivationParams ForIncludeProcessTree(uint processId)
    {
        if (processId == 0)
            throw new ArgumentOutOfRangeException(nameof(processId), processId, "Process id 0 is not a valid capture target.");

        return new AudioClientActivationParams
        {
            ActivationType = ProcessLoopbackActivationType,
            TargetProcessId = processId,
            ProcessLoopbackMode = IncludeTargetProcessTree,
        };
    }
}
