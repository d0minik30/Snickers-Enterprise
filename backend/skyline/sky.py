"""Find the skyline: per column, where the sky ends and the ground begins.

Classic image processing only (numpy). The rule is the one a person uses: going down a column from
the top, the skyline is the FIRST STRONG change in colour that LASTS. The Martian sky is a smooth
gradient, often with a bright glow near the horizon, so inside it the colour changes only a little
from row to row however bright it gets. Global sky-colour models fail on that glow; row-to-row steps
do not.

Cost of putting the line at row b in a column (b = first ground row):
    + number of strong row-to-row steps above b          (the line must be at the FIRST change)
    - how different the rows just below b stay from the sky just above b, capped   (it must LAST)
A best-path search over columns adds a cost proportional to the jump between neighbouring columns,
which cleans the line up while still allowing the sudden steps a rock or rover hardware makes.

Steps: mask the dark vignetted corners (Perseverance Navcam has them), search on a copy at most
WORK_WIDTH wide, then refine each full-resolution column to sub-pixel accuracy.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

WORK_WIDTH = 640
JUMP_COST = 0.08  # per working-scale pixel of jump between neighbouring columns
LASTING_GAIN = 4.0  # weight of "the change lasts" against "strong steps above the line"
STEP_NOISE = 6.0  # a row-to-row step counts as strong above this many sky-noise units...
STEP_MIN = 0.012  # ...and above this colour distance (0-1 scale) in any case
STEP_DEADZONE = 3.0  # steps below this many noise units are just sky
LASTING_NOISE = 10.0  # the lasting difference saturates at this many noise units...
LASTING_MIN = 0.06  # ...or this colour distance, whichever is larger
LASTING_ROWS = 40  # rows below the line averaged by the lasting term: height // LASTING_ROWS (at least 6)
FIRST_STEP = 0.25  # refinement: the first step at least this fraction of the window's strongest
TEXTURE_GAP = 4  # working-scale rows skipped under the line before measuring ground texture
EDGE_GAIN = 1.5  # weight of "the step right at the line is this column's sharpest" 
DARK_FRACTION = 0.12  # vignette core: darker than this fraction of the typical sky brightness
FADE_RISE = 0.004  # below the core, rows still brightening faster than this per row are the fade-out
FADE_MAX = 0.12  # the fade-out is never taken to be deeper than this fraction of the height
VIGNETTE_MARGIN = 0.01  # safety rows (fraction of height) after the fade-out


@dataclass
class Trace:
    """The traced skyline, one value per full-resolution column."""

    edge_y: np.ndarray  # sub-pixel row of the sky/ground edge (pixel-centre coordinates)
    top_valid: np.ndarray  # first row that is not vignette (the sky can only start here)
    contrast: np.ndarray  # colour difference across the edge, in units of the sky's own noise
    texture_below: np.ndarray  # texture just under the edge, relative to the image's typical ground
    saturated: np.ndarray  # True where the sky right above the edge is blown out (sun, glare)
    noise: float  # the sky's noise level (0-1 colour scale)
    width: int
    height: int


# ------------------------------------------------------------------ small image helpers


def _box(img: np.ndarray, r: int) -> np.ndarray:
    """Mean over a (2r+1) x (2r+1) window, edges handled by clamping (works on 2-D or H x W x C)."""
    if r <= 0:
        return img.astype(float)
    pad = [(r, r), (r, r)] + [(0, 0)] * (img.ndim - 2)
    p = np.pad(img.astype(float), pad, mode='edge')
    c = p.cumsum(0).cumsum(1)
    c = np.pad(c, [(1, 0), (1, 0)] + [(0, 0)] * (img.ndim - 2))
    k = 2 * r + 1
    s = c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]
    return s / (k * k)


def _resize(img: np.ndarray, width: int) -> np.ndarray:
    """Area-average downscale by an integer factor (no new dependencies)."""
    f = max(1, int(np.ceil(img.shape[1] / width)))
    if f == 1:
        return img.astype(float)
    h, w = (img.shape[0] // f) * f, (img.shape[1] // f) * f
    cut = img[:h, :w].astype(float)
    return cut.reshape(h // f, f, w // f, f, *img.shape[2:]).mean(axis=(1, 3))


def _gray(rgb: np.ndarray) -> np.ndarray:
    return rgb @ np.array([0.299, 0.587, 0.114])


def _texture(gray: np.ndarray) -> np.ndarray:
    """Local gradient energy: near zero in a smooth sky, high on textured ground."""
    g = _box(gray, 1)
    gy = np.zeros_like(g)
    gx = np.zeros_like(g)
    gy[1:-1] = (g[2:] - g[:-2]) / 2
    gx[:, 1:-1] = (g[:, 2:] - g[:, :-2]) / 2
    return _box(np.hypot(gx, gy), 2)


def _row_steps(rgb: np.ndarray) -> np.ndarray:
    """steps[r, c]: colour change between rows r-1 and r+1 (halved), lightly smoothed across columns."""
    s = _box(rgb, 1)
    steps = np.zeros(rgb.shape[:2])
    steps[1:-1] = np.linalg.norm(s[2:] - s[:-2], axis=2) / 2
    return steps


def _top_valid(gray: np.ndarray) -> np.ndarray:
    """Per column, the first row below any dark vignette at the top, including its fade-out."""
    h, w = gray.shape
    smooth = _box(gray, 2)
    sky_level = np.percentile(gray[: max(4, h // 3)], 90)
    dark = smooth < DARK_FRACTION * sky_level
    rows = np.arange(h)[:, None]
    first_lit = np.where(~dark, rows, h).min(axis=0)
    out = np.zeros(w, dtype=int)
    fade_max = int(np.ceil(FADE_MAX * h))
    margin = int(np.ceil(VIGNETTE_MARGIN * h))
    for c in range(w):
        # A dark band touching the top is the vignette core; a lit top can still be its fade-out.
        r = int(first_lit[c]) if dark[0, c] else 0
        stop = min(h - 2, r + fade_max)
        while r < stop and smooth[r + 1, c] - smooth[r, c] > FADE_RISE:
            r += 1
        out[c] = min(r + margin, h - 1)
    # A lens's dark corners are round: the masked depth only grows towards the left and right edges.
    # This fills single edge columns the darkness test missed.
    mid = w // 2
    out[:mid] = np.maximum.accumulate(out[:mid][::-1])[::-1]
    out[mid:] = np.maximum.accumulate(out[mid:])
    return out


def _sky_noise(steps: np.ndarray, top_valid: np.ndarray) -> float:
    """Typical row-to-row step inside the sky, from a band just below the top of each column."""
    h = steps.shape[0]
    rows = np.arange(h)[:, None]
    band = (rows >= top_valid[None, :] + 2) & (rows < top_valid[None, :] + max(6, h // 12))
    vals = steps[band]
    return float(np.median(vals)) if vals.size else float(np.median(steps))


# ------------------------------------------------------------------ cost and best path


def _cost(rgb: np.ndarray, steps: np.ndarray, noise: float, top_valid: np.ndarray) -> np.ndarray:
    """cost[b, c] for every boundary b in 0..h (b = first ground row)."""
    h, w, _ = rgb.shape
    # Steps at the sky's own noise level cost nothing; only clearly stronger ones count.
    excess = np.maximum(steps - STEP_DEADZONE * noise, 0)
    strong = np.minimum(excess / max(STEP_NOISE * noise, STEP_MIN), 1.0) ** 2
    # Steps strictly above the edge rows: rows top..b-2 (rows b-1, b straddle the edge itself).
    cum = np.vstack([np.zeros((1, w)), np.cumsum(strong, axis=0)])  # cum[k] = sum of rows < k
    b = np.arange(h + 1)
    upto = np.clip(b - 1, 0, h)
    above = cum[upto] - cum[np.minimum(top_valid, h), np.arange(w)][None, :]
    above = np.maximum(above, 0)

    # Lasting difference: mean of the rows below b vs. the sky rows just above b.
    k_dn = max(6, h // LASTING_ROWS)
    k_up = 3
    c3 = np.vstack([np.zeros((1, w, 3)), np.cumsum(rgb, axis=0)])
    lo = np.clip(b - k_up, 0, h)
    hi = np.clip(b + k_dn, 0, h)
    lo = np.maximum(lo[:, None], top_valid[None, :])  # the sky window never reaches into vignette
    cols = np.arange(w)[None, :]
    up_n = np.maximum(b[:, None] - lo, 1)[..., None]
    dn_n = np.maximum(hi - b, 1)[:, None, None]
    up = (c3[b][:, :, :] - c3[lo, cols]) / up_n
    dn = (c3[hi] - c3[b]) / dn_n
    diff = np.linalg.norm(up - dn, axis=2)
    lasting = np.minimum(diff / max(LASTING_NOISE * noise, LASTING_MIN), 1.0)
    no_sky = b[:, None] <= top_valid[None, :]
    lasting = np.where(no_sky | (b[:, None] >= h), 0.0, lasting)

    # Edge: the step right at the line, relative to the column's strongest step. It peaks exactly at
    # the edge, which the window-based lasting term cannot (it stays high a few rows above it too).
    col_max = steps.max(axis=0, keepdims=True) + 1e-9
    at = np.maximum(steps[np.clip(b - 1, 0, h - 1)], steps[np.clip(b, 0, h - 1)]) / col_max
    at = np.where((b[:, None] <= top_valid[None, :]) | (b[:, None] >= h), 0.0, at)

    cost = above - LASTING_GAIN * lasting - EDGE_GAIN * at
    return np.where(b[:, None] < top_valid[None, :], np.inf, cost)


def _best_path(cost: np.ndarray) -> np.ndarray:
    """Row per column minimising sum(cost) + JUMP_COST * |jump|, exactly (L1 distance transform)."""
    n, w = cost.shape
    idx = np.arange(n)
    r = idx.astype(float)
    acc = cost[:, 0].copy()
    back = np.zeros((n, w), dtype=np.int32)
    for c in range(1, w):
        f_vals = acc - JUMP_COST * r
        f_min = np.minimum.accumulate(f_vals)
        f_arg = np.maximum.accumulate(np.where(f_vals <= f_min, idx, 0))
        b_vals = (acc + JUMP_COST * r)[::-1]
        b_min = np.minimum.accumulate(b_vals)
        b_arg = (n - 1 - np.maximum.accumulate(np.where(b_vals <= b_min, idx, 0)))[::-1]
        from_f = f_min + JUMP_COST * r
        from_b = b_min[::-1] - JUMP_COST * r
        use_f = from_f <= from_b
        back[:, c] = np.where(use_f, f_arg, b_arg)
        acc = np.where(use_f, from_f, from_b) + cost[:, c]
    path = np.empty(w, dtype=int)
    path[-1] = int(np.argmin(acc))
    for c in range(w - 1, 0, -1):
        path[c - 1] = back[path[c], c]
    return path


# ------------------------------------------------------------------ main entry


def to_rgb_float(image: np.ndarray) -> np.ndarray:
    img = np.asarray(image).astype(float)
    if img.max() > 1.5:
        img = img / 255.0
    if img.ndim == 2:
        img = np.stack([img] * 3, axis=-1)
    return img[..., :3]


def trace_skyline(image: np.ndarray) -> Trace:
    """image: H x W x 3 (uint8 or float 0-1) or H x W grey. Returns the traced skyline."""
    img = to_rgb_float(image)
    H, W, _ = img.shape

    small = _resize(img, WORK_WIDTH)
    f = W / small.shape[1]
    sh, sw, _ = small.shape
    top_valid_s = _top_valid(_gray(small))
    steps = _row_steps(small)
    noise = max(_sky_noise(steps, top_valid_s), 1e-4)
    b = _best_path(_cost(small, steps, noise, top_valid_s))

    # Back to full resolution: interpolate the line, then refine each column locally.
    cols = np.arange(W)
    centres = (np.arange(sw) + 0.5) * f - 0.5
    coarse = np.interp(cols, centres, b * f)  # first ground row, full-res
    top_valid = np.ceil(np.interp(cols, centres, top_valid_s * f)).astype(int)
    reach = int(np.ceil(f * max(6, sh // LASTING_ROWS)))  # how far above the edge the coarse line can sit
    edge_y = _refine(img, coarse, top_valid, up=int(np.ceil(f)) + 2, down=reach + int(np.ceil(f)) + 2)

    tex = _texture(_gray(small))
    t_ground = float(np.median(tex[int(sh * 0.6):])) + 1e-6
    contrast, texture_below, saturated = _column_measures(img, edge_y, top_valid, noise, t_ground, f)
    return Trace(edge_y, top_valid, contrast, texture_below, saturated, noise, W, H)


def _refine(img: np.ndarray, coarse: np.ndarray, top_valid: np.ndarray, up: int, down: int) -> np.ndarray:
    """Per column: the FIRST strong vertical colour step from `up` rows above the coarse line to `down`
    rows below it, to sub-pixel accuracy. "Strong" is at least FIRST_STEP of the window's strongest
    step: a far horizon is soft and a rock edge below it sharp, so the threshold has to be low (steps
    inside the sky are far smaller still). Taking the first, not the strongest, keeps rocks below
    from pulling the line off the skyline. Isolated slips are then removed (_despike)."""
    H, W, _ = img.shape
    smooth = _box(img, 1)
    diff = np.linalg.norm(smooth[1:] - smooth[:-1], axis=2)  # diff[r] = step between rows r and r+1
    out = np.empty(W)
    for c in range(W):
        b = int(round(coarse[c]))
        lo = max(int(top_valid[c]), b - up - 1, 0)
        hi = min(H - 2, b + down)
        if hi <= lo:
            out[c] = max(coarse[c] - 0.5, float(top_valid[c]) - 0.5)
            continue
        seg = diff[lo:hi + 1, c]
        strong = np.nonzero(seg >= FIRST_STEP * seg.max())[0]
        k = int(strong[0])
        while k + 1 < len(seg) and seg[k + 1] > seg[k]:  # climb to the top of this first step
            k += 1
        y = lo + k + 0.5  # edge between rows (lo+k) and (lo+k+1)
        if 0 < k < len(seg) - 1:
            a, m, z = seg[k - 1], seg[k], seg[k + 1]
            den = a - 2 * m + z
            if den < 0:
                y += 0.5 * (a - z) / den
        out[c] = y
    return _despike(out)


def _despike(y: np.ndarray, radius: int = 3, jump: float = 4.0, agree: float = 2.0) -> np.ndarray:
    """Replace single points far from neighbours that agree with each other (refinement slips)."""
    out = y.copy()
    n = len(y)
    for c in range(n):
        nb = np.concatenate([y[max(0, c - radius):c], y[c + 1:c + 1 + radius]])
        if len(nb) < 2 * radius:
            continue
        med = float(np.median(nb))
        if abs(y[c] - med) > jump and np.ptp(nb) < agree * 2:
            out[c] = med
    return out


def _column_measures(img: np.ndarray, edge_y: np.ndarray, top_valid: np.ndarray, noise: float,
                     t_ground: float, f: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per full-resolution column: contrast across the edge, texture under it, blown-out sky above it."""
    H, W, _ = img.shape
    band = max(3, int(round(3 * f)))
    small_tex = _texture(_gray(_resize(img, WORK_WIDTH)))
    sh, sw = small_tex.shape
    contrast = np.zeros(W)
    texture_below = np.zeros(W)
    saturated = np.zeros(W, dtype=bool)
    for c in range(W):
        y = int(np.floor(edge_y[c] + 0.5))  # first ground row
        a0, a1 = max(int(top_valid[c]), y - band), y
        b0, b1 = min(H, y + 1), min(H, y + 1 + 2 * band)
        if a1 > a0 and b1 > b0:
            above = img[a0:a1, c].mean(0)
            below = img[b0:b1, c].mean(0)
            contrast[c] = np.linalg.norm(above - below) / noise
            saturated[c] = bool((img[a0:a1, c].max(axis=1) > 0.985).mean() >= 0.5)  # mostly blown out
        sc = min(sw - 1, int(c / f))
        # Start below the reach of the texture filter's blur, so the skyline edge itself is not counted.
        sy0 = min(sh - 1, int((y + 1) / f) + TEXTURE_GAP)
        sy1 = min(sh, sy0 + 4)
        if sy1 > sy0:
            texture_below[c] = small_tex[sy0:sy1, sc].mean() / t_ground
    return contrast, texture_below, saturated
