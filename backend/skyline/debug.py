"""The debug image: the traced skyline drawn on the photo, coloured by trust."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image, ImageDraw

MAX_WIDTH = 1280
TRUSTED = (80, 230, 120)  # green
DOUBTFUL = (255, 176, 0)  # amber
UNTRUSTED = (255, 92, 225)  # magenta, the app's route colour, reads on the Martian sky and ground
SUN = (255, 255, 255)


def _colour(w: float) -> tuple[int, int, int]:
    if w <= 0:
        return UNTRUSTED
    a, b = np.array(DOUBTFUL, float), np.array(TRUSTED, float)
    return tuple(int(x) for x in a + (b - a) * w)  # type: ignore[return-value]


def debug_jpeg(image: np.ndarray, u: np.ndarray, v: np.ndarray, weight: np.ndarray,
              sun_px: tuple[float, float] | None = None) -> bytes:
    """JPEG of the photo (at most MAX_WIDTH wide) with the line; u, v in the photo's own pixels.

    JPEG, not PNG: a tenth of the size for a phone on a slow link, and the coloured line stays clear."""
    im = Image.fromarray(np.asarray(image, dtype=np.uint8)).convert('RGB')
    s = min(1.0, MAX_WIDTH / im.width)
    if s < 1:
        im = im.resize((round(im.width * s), round(im.height * s)), Image.BILINEAR)
    d = ImageDraw.Draw(im)
    line_w = max(2, round(im.width / 400))
    xs, ys = (np.asarray(u) + 0.5) * s - 0.5, (np.asarray(v) + 0.5) * s - 0.5
    for i in range(len(xs) - 1):
        d.line([(xs[i], ys[i]), (xs[i + 1], ys[i + 1])], fill=_colour(float(min(weight[i], weight[i + 1]))), width=line_w)
    if sun_px is not None:
        x, y = (sun_px[0] + 0.5) * s - 0.5, (sun_px[1] + 0.5) * s - 0.5
        r = 4 * line_w
        d.ellipse([x - r, y - r, x + r, y + r], outline=SUN, width=line_w)
    buf = io.BytesIO()
    im.save(buf, format='JPEG', quality=85)
    return buf.getvalue()
