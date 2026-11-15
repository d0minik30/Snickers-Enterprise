"""Slide-ready workflow diagram of the Mars Map pipeline (see WORKFLOW_ARCHITECTURE.md).

Writes to the repo root:
  architecture_workflow.png              white background, for light slides
  architecture_workflow_transparent.png  transparent background (tiles stay white)
  architecture_workflow.svg              vector, scales without blur in PowerPoint

Run from anywhere: backend/.venv/Scripts/python backend/scripts/generate_workflow_diagram.py
"""
import os
from pathlib import Path

os.environ.setdefault("MPLCONFIGDIR", os.environ.get("TEMP", "/tmp"))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import FancyBboxPatch

ROOT = Path(__file__).resolve().parents[2]

FONT = next((f for f in ("Segoe UI", "Helvetica Neue", "Arial", "DejaVu Sans")
             if any(e.name == f for e in font_manager.fontManager.ttflist)), "sans-serif")

W, H = 21.0, 10.5          # tile size, in layout units
INK = "#0F172A"
LINE = "#64748B"

# (fill, border) per kind of stage
INPUT = ("#F1F5F9", "#94A3B8")
VISION = ("#ECFDF5", "#34D399")
TERRAIN = ("#F5F3FF", "#A78BFA")
ENGINE = ("#FFF1F2", "#FB7185")
RESULT = ("#FFFBEB", "#F59E0B")
OUTPUT = ("#EFF6FF", "#60A5FA")

COL = [14, 40, 66, 92, 118, 144]
MAIN_Y, LOW_Y = 50, 23

TILES = {
    "photo":   (COL[0], MAIN_Y, "Surface\nPhoto", INPUT),
    "skyline": (COL[1], MAIN_Y, "Skyline\nExtraction", VISION),
    "coarse":  (COL[2], MAIN_Y, "Coarse\nSearch", ENGINE),
    "fine":    (COL[3], MAIN_Y, "Fine\nSearch", ENGINE),
    "fix":     (COL[4], MAIN_Y, "Position Fix &\nUncertainty", RESULT),
    "map":     (COL[5], MAIN_Y + 8.5, "Locate Screen\n& Map", OUTPUT),
    "hud":     (COL[5], MAIN_Y - 8.5, "Field HUD\n& Control", OUTPUT),
    "terrain": (COL[1], LOW_Y, "Orbital\nTerrain", TERRAIN),
    "horizon": (COL[2], LOW_Y, "Precomputed\nHorizons", TERRAIN),
}


def tile(ax, x, y, text, colors):
    fill, border = colors
    ax.add_patch(FancyBboxPatch((x - W / 2, y - H / 2), W, H,
                                boxstyle="round,pad=0,rounding_size=1.6",
                                facecolor=fill, edgecolor=border, linewidth=2.4, zorder=3))
    ax.text(x, y, text, ha="center", va="center", fontsize=17, fontweight="bold", color=INK,
            fontfamily=FONT, linespacing=1.15, zorder=4)


def arrow(ax, points, dashed=False):
    """A line through points, with an arrow head at the last one."""
    style = (0, (4, 3)) if dashed else "solid"
    xs, ys = zip(*points)
    if len(points) > 2:
        ax.plot(xs[:-1], ys[:-1], color=LINE, lw=2.2, linestyle=style, zorder=2,
                solid_capstyle="butt", solid_joinstyle="miter")
    ax.annotate("", xy=points[-1], xytext=points[-2],
                arrowprops=dict(arrowstyle="-|>,head_width=0.45,head_length=0.9", color=LINE, lw=2.2,
                                linestyle=style, shrinkA=0, shrinkB=0), zorder=2)


def edge(name, side):
    x, y = TILES[name][:2]
    return {"l": (x - W / 2, y), "r": (x + W / 2, y), "t": (x, y + H / 2), "b": (x, y - H / 2)}[side]


def draw():
    fig = plt.figure(figsize=(15.6, 5.8))
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(1, 157)
    ax.set_ylim(7, 65)
    ax.set_aspect("equal")
    ax.axis("off")

    # the offline part, prepared once before any photo arrives
    ax.add_patch(FancyBboxPatch((COL[1] - W / 2 - 3, 10), COL[2] - COL[1] + W + 6, LOW_Y + H / 2 + 6 - 10,
                                boxstyle="round,pad=0,rounding_size=2", facecolor="none",
                                edgecolor="#C4B5FD", linewidth=1.6, linestyle=(0, (5, 4)), zorder=1))
    ax.text(COL[1] - W / 2 - 1, LOW_Y + H / 2 + 4.6, "PREPARED ONCE", ha="left", va="top", fontsize=11,
            fontweight="bold", color="#7C3AED", fontfamily=FONT, zorder=4)

    for x, y, text, colors in TILES.values():
        tile(ax, x, y, text, colors)

    gap = 0.4
    for a, b in (("photo", "skyline"), ("skyline", "coarse"), ("coarse", "fine"), ("fine", "fix"),
                 ("terrain", "horizon")):
        (x0, y0), (x1, y1) = edge(a, "r"), edge(b, "l")
        arrow(ax, [(x0 + gap, y0), (x1 - gap, y1)])
    arrow(ax, [(edge("horizon", "t")[0], edge("horizon", "t")[1] + gap),
               (edge("coarse", "b")[0], edge("coarse", "b")[1] - gap)])
    # the fine search renders horizons live from the terrain
    tx, ty = edge("terrain", "b")
    fx, fy = edge("fine", "b")
    arrow(ax, [(tx, ty - gap), (tx, 13.5), (fx, 13.5), (fx, fy - gap)], dashed=True)
    # one fix, two kinds of screen
    x0, y0 = edge("fix", "r")
    mid = (x0 + edge("map", "l")[0]) / 2
    for out in ("map", "hud"):
        x1, y1 = edge(out, "l")
        arrow(ax, [(x0 + gap, y0), (mid, y0), (mid, y1), (x1 - gap, y1)])
    return fig


def main():
    fig = draw()
    common = dict(bbox_inches="tight", pad_inches=0.25)
    fig.savefig(ROOT / "architecture_workflow.png", dpi=200, facecolor="white", **common)
    fig.savefig(ROOT / "architecture_workflow_transparent.png", dpi=200, transparent=True, **common)
    fig.savefig(ROOT / "architecture_workflow.svg", transparent=True, **common)
    print("Saved architecture_workflow.png, _transparent.png and .svg to", ROOT)


if __name__ == "__main__":
    main()
