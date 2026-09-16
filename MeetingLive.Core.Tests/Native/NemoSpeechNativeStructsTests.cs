using System.Runtime.InteropServices;
using MeetingLive.Core.Native;

namespace MeetingLive.Core.Tests.Native;

public class NemoSpeechNativeStructsTests
{
    [Fact]
    public void DiarConfig_MsVcX64Layout_Is40Bytes()
    {
        Assert.Equal(40, Marshal.SizeOf<NemoSpeechAsrDiarConfig>());
    }
}
