using MeetingLive.Core.Models;

namespace MeetingLive.Core.Services;

public interface IHardwareDetectionService
{
    HardwareProfile DetectHardware();
}
