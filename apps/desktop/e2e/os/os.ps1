# OS-level helpers: real composed screen pixels + real mouse input. Usage: os.ps1 <action> args...
param([string]$Action, [Parameter(ValueFromRemainingArguments=$true)][string[]]$A)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class W {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, uint d, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint f, UIntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
}
'@
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
[void][W]::SetProcessDPIAware()
switch ($Action) {
  'shot' { # out x y w h  (physical px; w=0 => full screen)
    $b = [Windows.Forms.SystemInformation]::VirtualScreen
    $x=[int]$A[1]; $y=[int]$A[2]; $w=[int]$A[3]; $h=[int]$A[4]
    if ($w -eq 0) { $x=$b.X; $y=$b.Y; $w=$b.Width; $h=$b.Height }
    $bmp = New-Object Drawing.Bitmap $w,$h
    $g = [Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($x,$y,0,0,$bmp.Size); $g.Dispose()
    $bmp.Save($A[0], [Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose() }
  'px' { # x y [x y ...] -> rgb per point
    $bmp = New-Object Drawing.Bitmap 1,1
    $g = [Drawing.Graphics]::FromImage($bmp)
    $out = @()
    for ($i=0; $i -lt $A.Count; $i+=2) {
      $g.CopyFromScreen([int]$A[$i],[int]$A[$i+1],0,0,$bmp.Size); $c=$bmp.GetPixel(0,0)
      $out += "$($c.R),$($c.G),$($c.B)" }
    $out -join ';' }
  'drag' { # x1 y1 x2 y2
    $x1=[int]$A[0]; $y1=[int]$A[1]; $x2=[int]$A[2]; $y2=[int]$A[3]
    [W]::SetCursorPos($x1,$y1) | Out-Null; Start-Sleep -m 150
    [W]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -m 150
    $n=10; for ($i=1;$i -le $n;$i++){ [W]::SetCursorPos([int]($x1+($x2-$x1)*$i/$n),[int]($y1+($y2-$y1)*$i/$n)) | Out-Null; Start-Sleep -m 40 }
    Start-Sleep -m 150; [W]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
  'drag2' { # x1 y1 x2 y2: like drag, but in steps of at most ~15 px, so a long drag is a smooth one
    $x1=[int]$A[0]; $y1=[int]$A[1]; $x2=[int]$A[2]; $y2=[int]$A[3]
    [W]::SetCursorPos($x1,$y1) | Out-Null; Start-Sleep -m 150
    [W]::mouse_event(2,0,0,0,[UIntPtr]::Zero); Start-Sleep -m 150
    $dist = [math]::Sqrt(($x2-$x1)*($x2-$x1)+($y2-$y1)*($y2-$y1))
    $n = [math]::Max(10, [int][math]::Ceiling($dist / 15))
    for ($i=1;$i -le $n;$i++){ [W]::SetCursorPos([int]($x1+($x2-$x1)*$i/$n),[int]($y1+($y2-$y1)*$i/$n)) | Out-Null; Start-Sleep -m 12 }
    Start-Sleep -m 250; [W]::mouse_event(4,0,0,0,[UIntPtr]::Zero) }
  'click' { # x y [right]
    [W]::SetCursorPos([int]$A[0],[int]$A[1]); Start-Sleep -m 200
    if ($A[2] -eq 'right') { [W]::mouse_event(8,0,0,0,[UIntPtr]::Zero); [W]::mouse_event(16,0,0,0,[UIntPtr]::Zero) }
    else { [W]::mouse_event(2,0,0,0,[UIntPtr]::Zero); [W]::mouse_event(4,0,0,0,[UIntPtr]::Zero) } }
  'rect' { # hwnd (decimal) -> "x,y,w,h" in physical px, straight from Win32 (no DIP conversion)
    $r = New-Object W+RECT; [void][W]::GetWindowRect([IntPtr][int64]$A[0], [ref]$r)
    "$($r.L),$($r.T),$($r.R-$r.L),$($r.B-$r.T)" }
  'find' { # r g b x y w h -> centroid "x,y" of pixels within 6 of the colour, or "none"
    $r=[int]$A[0];$g=[int]$A[1];$b=[int]$A[2];$x=[int]$A[3];$y=[int]$A[4];$w=[int]$A[5];$h=[int]$A[6]
    $bmp = New-Object Drawing.Bitmap $w,$h
    $gr = [Drawing.Graphics]::FromImage($bmp); $gr.CopyFromScreen($x,$y,0,0,$bmp.Size); $gr.Dispose()
    $sx=0;$sy=0;$n=0
    for ($j=0;$j -lt $h;$j++){ for ($i=0;$i -lt $w;$i++){ $c=$bmp.GetPixel($i,$j)
      if ([math]::Abs($c.R-$r) -lt 6 -and [math]::Abs($c.G-$g) -lt 6 -and [math]::Abs($c.B-$b) -lt 6) { $sx+=$i;$sy+=$j;$n++ } } }
    if ($n -gt 20) { "$([int]($x+$sx/$n)),$([int]($y+$sy/$n))" } else { 'none' } }
  'win' { # Win+<vk> chord (vk decimal), e.g. 78 = N (notification centre)
    [W]::keybd_event(0x5B,0,0,[UIntPtr]::Zero); [W]::keybd_event([byte][int]$A[0],0,0,[UIntPtr]::Zero)
    [W]::keybd_event([byte][int]$A[0],0,2,[UIntPtr]::Zero); [W]::keybd_event(0x5B,0,2,[UIntPtr]::Zero) }
  'fg' { $s = New-Object Text.StringBuilder 256; [void][W]::GetWindowText([W]::GetForegroundWindow(),$s,256); $s.ToString() }
}
