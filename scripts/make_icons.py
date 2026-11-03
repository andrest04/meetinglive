"""Draw every file in MeetingLive.App/Assets and docs/brand from the Vocea mark.

The mark is five flat bars hung from one line. Their lengths trace a V, so it
reads as the initial and as a sound level at once. It sits on a 24-unit grid,
which keeps it sharp at taskbar size. Needs Pillow, which the app does not:

    python scripts/make_icons.py
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "MeetingLive.App" / "Assets"
BRAND = ROOT / "docs" / "brand"

INK = "#0a0a0a"
PAPER = "#ffffff"
TILE_RADIUS = 0.225
SUPERSAMPLE = 8


@dataclass(frozen=True)
class Grid:
    """Bar geometry in grid units: the canvas is `units` wide and tall."""

    units: int
    bar: int
    gap: int
    left: int
    top: int
    lengths: tuple[int, int, int]


MASTER = Grid(24, 2, 1, 5, 6, (3, 8, 13))
# Sizes that do not divide 24 get their own whole-pixel geometry.
HINTED = {
    16: Grid(16, 1, 1, 3, 4, (2, 5, 9)),
    32: Grid(32, 2, 2, 7, 7, (4, 11, 18)),
}


def bars(grid: Grid) -> list[tuple[int, int, int, int]]:
    """Return (x, y, width, height) for each bar, in grid units."""
    short, middle, long = grid.lengths
    return [
        (grid.left + i * (grid.bar + grid.gap), grid.top, grid.bar, length)
        for i, length in enumerate((short, middle, long, middle, short))
    ]


def render(size: int, background: str | None, foreground: str) -> Image.Image:
    """Render the mark at `size` pixels, on a tile when `background` is set."""
    grid = HINTED.get(size, MASTER)
    canvas = size * SUPERSAMPLE
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if background:
        draw.rounded_rectangle(
            (0, 0, canvas - 1, canvas - 1),
            radius=round(canvas * TILE_RADIUS),
            fill=background,
        )
    unit = canvas / grid.units
    for x, y, width, height in bars(grid):
        draw.rectangle(
            (
                round(x * unit),
                round(y * unit),
                round((x + width) * unit) - 1,
                round((y + height) * unit) - 1,
            ),
            fill=foreground,
        )
    # Box filtering keeps thin bars free of the halo that Lanczos adds.
    return image.resize((size, size), Image.BOX)


def on_canvas(width: int, height: int, tile: int) -> Image.Image:
    """Center the tile on a transparent canvas, for wide tiles and the splash."""
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    image.alpha_composite(
        render(tile, INK, PAPER), ((width - tile) // 2, (height - tile) // 2)
    )
    return image


def svg(background: str | None, foreground: str) -> str:
    """Return the mark as a 24-unit SVG, on a tile when `background` is set."""
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">']
    if background:
        radius = 24 * TILE_RADIUS
        parts.append(
            f'  <rect width="24" height="24" rx="{radius:g}" fill="{background}"/>'
        )
    parts.extend(
        f'  <rect x="{x}" y="{y}" width="{width}" height="{height}" fill="{foreground}"/>'
        for x, y, width, height in bars(MASTER)
    )
    parts.append("</svg>\n")
    return "\n".join(parts)


def main() -> None:
    tiled = {
        "Square150x150Logo.scale-200.png": 300,
        "Square44x44Logo.scale-200.png": 88,
        "Square44x44Logo.targetsize-24_altform-unplated.png": 24,
        "Square44x44Logo.targetsize-48_altform-lightunplated.png": 48,
        "StoreLogo.png": 50,
    }
    for name, size in tiled.items():
        render(size, INK, PAPER).save(ASSETS / name)

    # Windows tints lock screen badges, so this one carries only the mark.
    render(48, None, PAPER).save(ASSETS / "LockScreenLogo.scale-200.png")
    on_canvas(620, 300, 200).save(ASSETS / "Wide310x150Logo.scale-200.png")
    on_canvas(1240, 600, 300).save(ASSETS / "SplashScreen.scale-200.png")

    sizes = [16, 24, 32, 48, 64, 256]
    frames = [render(size, INK, PAPER) for size in sizes]
    frames[-1].save(
        ASSETS / "AppIcon.ico",
        format="ICO",
        sizes=[(size, size) for size in sizes],
        append_images=frames[:-1],
    )

    BRAND.mkdir(parents=True, exist_ok=True)
    variants = {
        "vocea-tile-dark.svg": (INK, PAPER),
        "vocea-tile-light.svg": (PAPER, INK),
        "vocea-mark-ink.svg": (None, INK),
        "vocea-mark-paper.svg": (None, PAPER),
    }
    for name, (background, foreground) in variants.items():
        (BRAND / name).write_text(svg(background, foreground), encoding="utf-8")


if __name__ == "__main__":
    main()
