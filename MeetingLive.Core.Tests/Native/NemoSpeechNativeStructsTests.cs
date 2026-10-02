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

    [Fact]
    public void EndpointingConfig_MsVcX64Layout_MatchesHeader()
    {
        Assert.Equal(16, Marshal.SizeOf<NemoSpeechAsrEndpointingConfig>());
        Assert.Equal(0, (int)Marshal.OffsetOf<NemoSpeechAsrEndpointingConfig>(nameof(NemoSpeechAsrEndpointingConfig.Size)));
        Assert.Equal(8, (int)Marshal.OffsetOf<NemoSpeechAsrEndpointingConfig>(nameof(NemoSpeechAsrEndpointingConfig.Enable)));
        Assert.Equal(9, (int)Marshal.OffsetOf<NemoSpeechAsrEndpointingConfig>(nameof(NemoSpeechAsrEndpointingConfig.VadBased)));
        Assert.Equal(12, (int)Marshal.OffsetOf<NemoSpeechAsrEndpointingConfig>(nameof(NemoSpeechAsrEndpointingConfig.StopHistoryEouMs)));
    }
}
