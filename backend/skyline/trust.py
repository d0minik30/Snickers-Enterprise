"""How much to trust each column of a traced skyline (0-1), and why not.

What goes wrong in practice, and the cue used for each:

- near:  something close to the camera (a rock, the rover's arm, a person) rises into the sky and looks
         like a mountain. Near things are sharp and detailed; far terrain is soft and hazy. A column is
         near when the texture just under the line is well above this skyline's typical texture,
         especially where the line also sticks up above the skyline around it.
- haze:  where the far rim fades into the sky the edge is weak and its position unreliable.
- edge:  the image border and the lens's dark corners (the line there is cut or distorted).
- top:   the line touches the top of the usable image, so the real skyline is not visible there.
- jitter: the line keeps jumping between two levels (a faint ridge behind a nearer one, say), so
         neither is reliable there. Real distant skylines are smooth from column to column.
- glare: blown-out sky right above a weak edge (sun, lens flare) hides where the edge really is.

Weights are per full-resolution column. Near-object columns get weight 0 with a small margin either
side, since the transition onto the object is not trustworthy either.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from .sky import Trace

EDGE_FRACTION = 0.03  # weight ramps from 0 to 1 over this fraction of the width at each border
TOP_CLEARANCE = 0.02  # line closer than this fraction of the height to the usable top: weight 0
HAZE_LOW, HAZE_HIGH = 0.12, 0.35  # contrast against this skyline's typical: weight 0 below LOW, full above HIGH
HAZE_FLOOR = 0.015  # ...and an edge weaker than this colour distance (0-1 scale) is haze regardless
NEAR_TEXTURE = 8.0  # texture above this many times the far skyline's typical texture: near anyway
NEAR_TEXTURE_IF_PROTRUDING = 1.8  # where the line sticks up: near if clearly sharper than the far skyline
PROTRUDE_FRACTION = 0.02  # "sticks up": this fraction of the height above the far skyline line
NEAR_MARGIN = 0.01  # near-object mask grows by this fraction of the width on each side
GLARE_FACTOR = 0.3
JITTER_OK, JITTER_BAD = 1.5, 4.0  # mean |row change| between columns over JITTER_WINDOW, per 1000 px of height
JITTER_WINDOW = 9
TEXTURE_WINDOW = 17  # columns over which the texture under the line is smoothed
MIN_NEAR_RUN = 7  # near-object runs narrower than this many columns are noise

REASONS = ('near', 'haze', 'jitter', 'edge', 'top', 'glare')


@dataclass
class Trust:
    weight: np.ndarray  # 0-1 per column
    reason: list[str | None]  # the main reason a column's weight was cut, or None


def _rolling_percentile(x: np.ndarray, window: int, q: float) -> np.ndarray:
    half = max(1, window // 2)
    out = np.empty_like(x, dtype=float)
    for i in range(len(x)):
        out[i] = np.percentile(x[max(0, i - half): i + half + 1], q)
    return out


def _far_skyline(edge_y: np.ndarray) -> np.ndarray:
    """Robust line through the lower envelope of the trace (image rows grow downwards)."""
    x = np.arange(len(edge_y), dtype=float)
    keep = np.ones(len(edge_y), dtype=bool)
    for _ in range(4):
        a, b = np.polyfit(x[keep], edge_y[keep], 1)
        resid = edge_y - (a * x + b)  # negative = above the line
        spread = 1.4826 * np.median(np.abs(resid[keep] - np.median(resid[keep]))) + 1.0
        keep = resid > -2.5 * spread
        if keep.sum() < 10:
            break
    return a * x + b


def _erode(mask: np.ndarray, r: int) -> np.ndarray:
    return ~_dilate(~mask, r)


def _dilate(mask: np.ndarray, r: int) -> np.ndarray:
    if r <= 0 or not mask.any():
        return mask
    k = np.convolve(mask.astype(float), np.ones(2 * r + 1), mode='same')
    return k > 0


def column_trust(trace: Trace) -> Trust:
    W, H = trace.width, trace.height
    cols = np.arange(W)

    # Edges of the frame, and the lens's dark corners (deep top_valid means vignette in that column).
    dist = np.minimum(cols, W - 1 - cols)
    w_edge = np.clip(dist / (EDGE_FRACTION * W), 0, 1)
    vignetted = trace.top_valid > 0.04 * H
    w_edge = np.where(vignetted, np.minimum(w_edge, 0.5), w_edge)

    clearance = trace.edge_y - trace.top_valid
    w_top = np.clip(clearance / (TOP_CLEARANCE * H) - 0.5, 0, 1)

    contrast = _rolling_percentile(trace.contrast, TEXTURE_WINDOW, 50)  # single columns are noisy
    inner_c = contrast[int(0.05 * W): max(int(0.95 * W), int(0.05 * W) + 1)]
    rel = contrast / max(float(np.median(inner_c)), 1e-9)
    w_haze = np.clip((rel - HAZE_LOW) / (HAZE_HIGH - HAZE_LOW), 0, 1)
    w_haze = np.where(contrast * trace.noise < HAZE_FLOOR, 0.0, w_haze)

    # Near objects stick up above the far skyline AND are sharper than it (far terrain is hazy).
    # The far skyline: a robust straight line through the lower envelope of the trace (a line follows
    # any camera roll; the robust fit is not pulled up by a wide arm or rock).
    baseline = _far_skyline(trace.edge_y)
    protrudes = (baseline - trace.edge_y) > PROTRUDE_FRACTION * H  # rows: smaller = higher
    smooth_tex = _rolling_percentile(trace.texture_below, TEXTURE_WINDOW, 50)
    far = ~protrudes & (w_edge > 0.99)
    typical = max(float(np.median(smooth_tex[far])) if far.any() else float(np.median(smooth_tex)), 1e-6)
    tex = smooth_tex / typical
    near = (protrudes & (tex > NEAR_TEXTURE_IF_PROTRUDING)) | (tex > NEAR_TEXTURE)
    # Drop runs narrower than MIN_NEAR_RUN columns (opening), then grow the rest by the margin.
    r = MIN_NEAR_RUN // 2
    near = _dilate(_erode(near, r), r + int(NEAR_MARGIN * W))
    w_near = np.where(near, 0.0, 1.0)

    # Blown-out sky only hides the edge when the edge is also weak; a dark rim against it is still sharp.
    w_glare = np.where(trace.saturated & (rel < 2 * HAZE_HIGH), GLARE_FACTOR, 1.0)

    steps = np.abs(np.diff(trace.edge_y, prepend=trace.edge_y[0])) * (1000.0 / H)
    rough = np.convolve(steps, np.ones(JITTER_WINDOW) / JITTER_WINDOW, mode='same')
    w_jitter = np.clip((JITTER_BAD - rough) / (JITTER_BAD - JITTER_OK), 0, 1)
    w_jitter = np.where(near, 1.0, w_jitter)  # an object's own outline is already handled as near

    parts = {'near': w_near, 'haze': w_haze, 'jitter': w_jitter, 'edge': w_edge, 'top': w_top, 'glare': w_glare}
    weight = np.ones(W)
    for p in parts.values():
        weight = np.minimum(weight, p)
    reason: list[str | None] = []
    for c in range(W):
        worst = min(REASONS, key=lambda k: parts[k][c])
        reason.append(worst if parts[worst][c] < 0.999 else None)
    return Trust(weight, reason)
