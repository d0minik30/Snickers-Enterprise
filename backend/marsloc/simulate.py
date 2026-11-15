"""Make-believe photos for testing the matcher: the skyline a camera would trace at a known
position on the real terrain, with the kinds of trouble real photos have.

The terrain is always real elevation data; only the photo is simulated. The skyline is
rendered at the photo's own sample azimuths with the live renderer's default settings, which
are finer than what the matcher uses, so matcher and "photo" don't share their rounding.
"""
import numpy as np

from .constants import DEFAULT_EYE_HEIGHT_M
from .horizon.render import RenderConfig, render_horizon
from .match.resample import PhotoObservation


def smooth_noise(rng, n, width):
    """n random values with standard deviation 1 that vary smoothly over about `width` samples
    (independent when width is below 1)."""
    if width < 1.0:
        return rng.normal(0.0, 1.0, n)
    kernel = np.exp(-0.5 * (np.arange(-3 * width, 3 * width + 1) / width) ** 2)
    raw = np.convolve(rng.normal(0.0, 1.0, n + kernel.size - 1), kernel, mode="valid")
    return raw / np.sqrt((kernel ** 2).sum())


def simulate_photo(terrain, lat, lon, heading_deg, hfov_deg=60.0, sample_step_deg=0.1,
                   eye_height_m=DEFAULT_EYE_HEIGHT_M, noise_sigma_deg=0.0, noise_corr_deg=0.5,
                   pitch_error_deg=0.0, roughness_m=0.0, roughness_corr_deg=1.0,
                   rocks=0, rock_height_deg=(3.0, 9.0), rock_width_deg=(1.0, 3.0), flag_rocks=False,
                   gaps=0, gap_width_deg=(3.0, 8.0), drop_gaps=False, rng=None, photo_id="photo",
                   config=RenderConfig(), **observation_fields):
    """The skyline a photo taken at (lat, lon) facing heading_deg would show.

    noise_sigma_deg: random error of every traced angle. It varies smoothly over
        noise_corr_deg of azimuth, as the error of a traced line does (0 = independent per
        sample, which averages away in the matcher's bins and flatters the result).
    pitch_error_deg: the whole skyline shifted up by this (a wrong "horizontal").
    roughness_m: real ground differs from the elevation data by about this much (rocks,
        ripples, ledges smaller than a pixel, and the data's own error). Each skyline point is
        moved by that height seen from its distance, so near terrain changes a lot and the far
        rim hardly at all. The error varies smoothly over roughness_corr_deg of azimuth.
    rocks: how many nearby rocks stick up through the skyline, each rock_width_deg wide and
        rock_height_deg high (ranges). flag_rocks: give them weight 0, as Person 3 would if
        they spotted them; otherwise they keep weight 1 and the matcher has to cope.
    gaps: how many stretches of gap_width_deg can't be traced (haze). They get weight 0, or
        with drop_gaps their samples are left out.
    observation_fields: passed on to PhotoObservation (e.g. relative_heading_deg).
    """
    rng = rng if rng is not None else np.random.default_rng()
    half = hfov_deg / 2.0
    offsets = np.arange(-half, half + 1e-9, sample_step_deg)
    horizon = render_horizon(terrain, lat, lon, eye_height_m, config,
                             azimuths_deg=np.mod(heading_deg + offsets, 360.0))
    elev = horizon.elev_deg + pitch_error_deg
    if noise_sigma_deg > 0:
        elev = elev + noise_sigma_deg * smooth_noise(rng, offsets.size, noise_corr_deg / sample_step_deg)
    if roughness_m > 0:
        height_error = roughness_m * smooth_noise(rng, offsets.size, roughness_corr_deg / sample_step_deg)
        elev = elev + np.degrees(height_error / np.maximum(horizon.dist_m, 1.0))
    weight = np.ones(offsets.size)
    keep = np.isfinite(elev)

    for _ in range(rocks):
        centre = rng.uniform(-half, half)
        width = rng.uniform(*rock_width_deg)
        height = rng.uniform(*rock_height_deg)
        shape = 1.0 - ((offsets - centre) / (width / 2.0)) ** 2      # a rounded bump
        on_rock = shape > 0
        elev = np.where(on_rock, np.maximum(elev, height * np.sqrt(np.maximum(shape, 0.0))), elev)
        if flag_rocks:
            weight[on_rock] = 0.0

    for _ in range(gaps):
        width = rng.uniform(*gap_width_deg)
        start = rng.uniform(-half, half - width)
        in_gap = (offsets >= start) & (offsets <= start + width)
        if drop_gaps:
            keep &= ~in_gap
        else:
            weight[in_gap] = 0.0
            elev = np.where(in_gap, 0.0, elev)       # whatever was traced there must not matter

    return PhotoObservation(az_offset_deg=offsets[keep], elev_deg=elev[keep], weight=weight[keep],
                            id=photo_id, eye_height_m=eye_height_m, **observation_fields)
