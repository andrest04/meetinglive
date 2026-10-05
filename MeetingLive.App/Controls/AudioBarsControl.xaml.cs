using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Shapes;
using Windows.UI.ViewManagement;

namespace MeetingLive_App.Controls;

/// <summary>
/// Five rounded bars driven by <see cref="Level"/> (0..100). While <see cref="IsRunning"/> a ~33 ms timer
/// applies a fast attack, a slower decay and a per-bar phase so the bars read as audio, not as a single
/// meter. When <see cref="IsPaused"/> they settle to flat dots. With animations turned off in Windows the
/// bars simply track the level with no timer. The timer only runs while <see cref="IsRunning"/> is true.
/// </summary>
public sealed partial class AudioBarsControl : UserControl
{
    private const int BarCount = 5;
    private const double BarWidth = 3;
    private const double MaxBarHeight = 24;
    private const double AttackFactor = 0.55;
    private const double DecayFactor = 0.14;

    // Center-heavy profile so the middle bar leads, like a voice meter.
    private static readonly double[] Profile = [0.55, 0.8, 1.0, 0.8, 0.55];
    private static readonly double[] PhaseStep = [0.0, 1.3, 2.6, 3.9, 5.2];
    private static readonly double[] PhaseSpeed = [7.0, 9.5, 8.0, 10.5, 7.5];

    public static readonly DependencyProperty LevelProperty = DependencyProperty.Register(
        nameof(Level), typeof(double), typeof(AudioBarsControl),
        new PropertyMetadata(0.0, (d, _) => ((AudioBarsControl)d).OnInputsChanged()));

    public static readonly DependencyProperty IsPausedProperty = DependencyProperty.Register(
        nameof(IsPaused), typeof(bool), typeof(AudioBarsControl),
        new PropertyMetadata(false, (d, _) => ((AudioBarsControl)d).OnInputsChanged()));

    public static readonly DependencyProperty IsRunningProperty = DependencyProperty.Register(
        nameof(IsRunning), typeof(bool), typeof(AudioBarsControl),
        new PropertyMetadata(false, (d, _) => ((AudioBarsControl)d).OnRunningChanged()));

    private readonly Rectangle[] _bars = new Rectangle[BarCount];
    private readonly double[] _heights = new double[BarCount];
    private readonly UISettings _uiSettings = new();
    private readonly DispatcherQueueTimer? _timer;
    private DateTime _startedAt = DateTime.UtcNow;

    public AudioBarsControl()
    {
        InitializeComponent();

        Rectangle[] bars = [Bar0, Bar1, Bar2, Bar3, Bar4];
        for (var i = 0; i < BarCount; i++)
        {
            _bars[i] = bars[i];
            _heights[i] = BarWidth;
        }

        _timer = DispatcherQueue.GetForCurrentThread()?.CreateTimer();
        if (_timer is not null)
        {
            _timer.Interval = TimeSpan.FromMilliseconds(33);
            _timer.IsRepeating = true;
            _timer.Tick += (_, _) => Step();
        }

        Unloaded += (_, _) => _timer?.Stop();
    }

    /// <summary>Input level, 0..100 (the view model's <c>MicLevel</c>).</summary>
    public double Level
    {
        get => (double)GetValue(LevelProperty);
        set => SetValue(LevelProperty, value);
    }

    /// <summary>True while recording is paused: the bars settle to flat dots.</summary>
    public bool IsPaused
    {
        get => (bool)GetValue(IsPausedProperty);
        set => SetValue(IsPausedProperty, value);
    }

    /// <summary>True while the control is on screen. The animation timer only runs then.</summary>
    public bool IsRunning
    {
        get => (bool)GetValue(IsRunningProperty);
        set => SetValue(IsRunningProperty, value);
    }

    private bool Animated => _uiSettings.AnimationsEnabled;

    private void OnRunningChanged()
    {
        if (IsRunning && Animated)
        {
            _startedAt = DateTime.UtcNow;
            _timer?.Start();
        }
        else
        {
            _timer?.Stop();
        }

        // Reduced motion (or hidden): show the current level directly, without easing.
        if (!IsRunning || !Animated)
            SnapToTarget();
    }

    private void OnInputsChanged()
    {
        // With the timer running, Step() picks the new input up on its next tick.
        if (_timer is { IsRunning: true })
            return;

        SnapToTarget();
    }

    private double LevelFraction => IsPaused ? 0 : Math.Clamp(double.IsFinite(Level) ? Level / 100.0 : 0, 0, 1);

    private void SnapToTarget()
    {
        for (var i = 0; i < BarCount; i++)
            Apply(i, TargetHeight(i, phase: 1.0));
    }

    private void Step()
    {
        var t = (DateTime.UtcNow - _startedAt).TotalSeconds;
        for (var i = 0; i < BarCount; i++)
        {
            var phase = 0.75 + 0.25 * Math.Sin(PhaseStep[i] + t * PhaseSpeed[i]);
            var target = TargetHeight(i, phase);
            var factor = target > _heights[i] ? AttackFactor : DecayFactor;
            Apply(i, _heights[i] + (target - _heights[i]) * factor);
        }
    }

    private double TargetHeight(int index, double phase)
    {
        var fraction = LevelFraction * Profile[index] * phase;
        return BarWidth + (MaxBarHeight - BarWidth) * Math.Clamp(fraction, 0, 1);
    }

    private void Apply(int index, double height)
    {
        _heights[index] = height;
        _bars[index].Height = Math.Round(height, 1);
    }
}
