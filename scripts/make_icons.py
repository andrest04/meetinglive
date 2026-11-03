"""Draw every file in MeetingLive.App/Assets from the Vocea mark.

The mark is a sound waveform on a light squircle: dark short bar, yellow band
running the full height of the icon, dark tall bar, dark short bar. It shares
its palette, squircle and flat bars with the markitdown-desktop icon, on the
same 20 by 20 grid. Needs Pillow, which the app itself does not:

    python scripts/make_icons.py
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw

PAGE = "#EEF0F5"
STROKE = "#F5DC4A"
LINE = "#1A1F2B"
GRID = 20
CORNER_RADIUS = 4
MASTER = 1024
SUPERSAMPLE = 4
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

ASSETS = Path(__file__).resolve().parent.parent / "MeetingLive.App" / "Assets"

SQUARE_ASSETS = {
    "LockScreenLogo.scale-200.png": 48,
    "Square150x150Logo.scale-200.png": 300,
    "Square44x44Logo.scale-200.png": 88,
    "Square44x44Logo.targetsize-24_altform-unplated.png": 24,
    "Square44x44Logo.targetsize-48_altform-lightunplated.png": 48,
    "StoreLogo.png": 50,
}
# Canvas size and the size of the squircle centered on it.
WIDE_ASSETS = {
    "SplashScreen.scale-200.png": ((1240, 600), 320),
    "Wide310x150Logo.scale-200.png": ((620, 300), 200),
}


@dataclass(frozen=True)
class Layout:
    """Bar geometry, in any unit, for a canvas `size` of those units."""

    size: float
    dark: float
    gap: float
    band: float
    short: float
    tall: float
    nudge: float = 0


# The mark in grid units. It sits a little left of geometric center because the
# two dark bars on the right outweigh the single one on the left.
MASTER_LAYOUT = Layout(GRID, dark=1.5, gap=1.5, band=4, short=6, tall=12, nudge=-0.125)

# Below this size resampling blurs the thin bars, so each size gets whole-pixel
# geometry instead. Same four bars, same order.
HINTED_LAYOUTS = {
    16: Layout(16, dark=2, gap=1, band=3, short=4, tall=10),
    24: Layout(24, dark=2, gap=2, band=4, short=6, tall=14),
    32: Layout(32, dark=3, gap=2, band=7, short=8, tall=20),
    48: Layout(48, dark=4, gap=4, band=8, short=12, tall=28),
    50: Layout(50, dark=4, gap=4, band=8, short=12, tall=30),
}


def draw_mark(pixels: int, layout: Layout) -> Image.Image:
    unit = pixels / layout.size

    def box(x: float, y: float, width: float, height: float) -> list[float]:
        return [x * unit, y * unit, (x + width) * unit - 1, (y + height) * unit - 1]

    image = Image.new("RGBA", (pixels, pixels), PAGE)
    draw = ImageDraw.Draw(image)
    total = layout.dark * 3 + layout.gap * 3 + layout.band
    x = (layout.size - total) / 2 + layout.nudge
    bars = [
        (layout.dark, layout.short, LINE),
        (layout.band, layout.size, STROKE),
        (layout.dark, layout.tall, LINE),
        (layout.dark, layout.short, LINE),
    ]
    for width, height, color in bars:
        draw.rectangle(box(x, (layout.size - height) / 2, width, height), fill=color)
        x += width + layout.gap

    # The squircle clips everything, including the band's ends.
    mask_scale = 1 if pixels >= MASTER else SUPERSAMPLE
    mask = Image.new("L", (pixels * mask_scale, pixels * mask_scale), 0)
    radius = CORNER_RADIUS / GRID * pixels * mask_scale
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, pixels * mask_scale - 1, pixels * mask_scale - 1], radius=radius, fill=255
    )
    image.putalpha(mask.resize((pixels, pixels), Image.Resampling.LANCZOS))
    return image


def draw_master() -> Image.Image:
    full = draw_mark(MASTER * SUPERSAMPLE, MASTER_LAYOUT)
    return full.resize((MASTER, MASTER), Image.Resampling.LANCZOS)


def render(size: int, master: Image.Image) -> Image.Image:
    if size in HINTED_LAYOUTS:
        return draw_mark(size, HINTED_LAYOUTS[size])
    return master.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    master = draw_master()
    for name, size in SQUARE_ASSETS.items():
        render(size, master).save(ASSETS / name, optimize=True)
    for name, (canvas_size, mark_size) in WIDE_ASSETS.items():
        canvas = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
        offset = ((canvas_size[0] - mark_size) // 2, (canvas_size[1] - mark_size) // 2)
        canvas.paste(render(mark_size, master), offset)
        canvas.save(ASSETS / name, optimize=True)
    frames = [render(size, master) for size in ICO_SIZES]
    frames[-1].save(
        ASSETS / "AppIcon.ico",
        sizes=[(size, size) for size in ICO_SIZES],
        append_images=frames[:-1],
    )


if __name__ == "__main__":
    main()
