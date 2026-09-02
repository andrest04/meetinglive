using Microsoft.UI.Input;
using Microsoft.UI.Xaml.Controls;

namespace MeetingLive_App;

/// <summary>Drag handle on the NavigationView pane edge. Sets a west-east resize cursor.</summary>
public sealed class PaneResizeGrip : Grid
{
    public PaneResizeGrip()
    {
        ProtectedCursor = InputSystemCursor.Create(InputSystemCursorShape.SizeWestEast);
    }
}
