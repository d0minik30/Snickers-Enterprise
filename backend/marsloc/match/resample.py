"""A photo's skyline as the matcher sees it: samples put into azimuth bins.

Person 3 delivers samples at any spacing (CONTRACTS.md, section 2). The matcher compares
them with horizons that have one value per azimuth bin, so the samples are averaged into
bins of the same width. Bins without trusted samples are gaps (weight 0).

Photos whose headings relative to the first photo are known turn together: they form one
group with one unknown heading. A photo with an unknown relative heading is its own group.
"""
from dataclasses import dataclass, field

import numpy as np

from ..constants import DEFAULT_EYE_HEIGHT_M


@dataclass
class PhotoObservation:
    """One photo's traced skyline, in the angles of CONTRACTS.md, section 2."""
    az_offset_deg: np.ndarray           # azimuth relative to the optical axis, positive = to the right
    elev_deg: np.ndarray                # elevation above horizontal
    weight: np.ndarray | None = None    # 0..1 per sample; None = all 1
    id: str = "photo"
    eye_height_m: float = DEFAULT_EYE_HEIGHT_M
    angle_sigma_deg: float = 0.1        # expected error of a traced skyline angle
    horizon_uncertainty_deg: float = 0.0  # how far the photo's "horizontal" may be off
    roll_uncertainty_deg: float = 0.0     # how far its roll may be off (tilts the skyline: t * sin(az_offset))
    relative_heading_deg: float | None = None   # heading minus the first photo's; None = unknown
    heading_prior_deg: float | None = None      # heading hint (from the sun), degrees from north
    heading_prior_sigma_deg: float = 3.0

    def __post_init__(self):
        self.az_offset_deg = np.asarray(self.az_offset_deg, dtype=np.float64).reshape(-1)
        self.elev_deg = np.asarray(self.elev_deg, dtype=np.float64).reshape(-1)
        if self.weight is None:
            self.weight = np.ones(self.az_offset_deg.shape)
        self.weight = np.clip(np.asarray(self.weight, dtype=np.float64).reshape(-1), 0.0, 1.0)
        if not (self.az_offset_deg.size == self.elev_deg.size == self.weight.size):
            raise ValueError("photo %r: az_offset_deg, elev_deg and weight differ in length" % self.id)
        if self.az_offset_deg.size == 0:
            raise ValueError("photo %r has no samples" % self.id)
        if not (np.isfinite(self.az_offset_deg).all() and np.isfinite(self.elev_deg).all()):
            raise ValueError("photo %r has samples that are not numbers" % self.id)
        if self.angle_sigma_deg <= 0:
            raise ValueError("photo %r: angle_sigma_deg must be above 0" % self.id)
        order = np.argsort(self.az_offset_deg, kind="stable")
        self.az_offset_deg = self.az_offset_deg[order]
        self.elev_deg = self.elev_deg[order]
        self.weight = self.weight[order]


@dataclass
class Binned:
    """Samples averaged into bins. Bin j is centred at (k0 + j) * step_deg in its frame."""
    k0: int
    step_deg: float
    elev: np.ndarray       # mean elevation per bin (0 where the bin is a gap)
    weight: np.ndarray     # 0..1 per bin; 0 = gap

    @property
    def n(self):
        return self.elev.size

    @property
    def offsets_deg(self):
        return (self.k0 + np.arange(self.n)) * self.step_deg


def bin_samples(az_deg, elev_deg, weight, step_deg, max_gap_deg=1.0):
    """Average samples into bins centred at multiples of step_deg.

    az_deg must be sorted. Samples with weight 0 don't count. A bin's elevation is the
    weighted mean of its samples and its weight their mean weight. A bin that holds no
    sample but lies between two samples less than max_gap_deg apart is filled from the line
    between them (samples may be sparser than the bins); wider holes stay gaps.
    A skyline longer than the full circle is folded onto 360 degrees.
    """
    az = np.asarray(az_deg, dtype=np.float64)
    elev = np.asarray(elev_deg, dtype=np.float64)
    weight = np.asarray(weight, dtype=np.float64)
    n_circle = int(round(360.0 / step_deg))
    index = np.round(az / step_deg).astype(np.int64)
    k0 = int(index.min())
    n = int(index.max()) - k0 + 1
    folded = n > n_circle
    if folded:
        k0, n = 0, n_circle
        slot = np.mod(index, n_circle)
    else:
        slot = index - k0

    w_sum = np.bincount(slot, weights=weight, minlength=n)
    e_sum = np.bincount(slot, weights=weight * elev, minlength=n)
    count = np.bincount(slot, minlength=n)
    with np.errstate(invalid="ignore", divide="ignore"):
        bin_elev = np.where(w_sum > 0, e_sum / w_sum, 0.0)
        bin_weight = np.where(count > 0, w_sum / np.maximum(count, 1), 0.0)

    empty = np.flatnonzero(count == 0)
    if empty.size and not folded and az.size > 1:
        centres = (k0 + empty) * step_deg
        right = np.searchsorted(az, centres)
        inner = (right > 0) & (right < az.size)
        left = np.clip(right - 1, 0, az.size - 1)
        right = np.clip(right, 0, az.size - 1)
        span = az[right] - az[left]
        fill = inner & (span <= max_gap_deg) & (span > 0)
        t = np.where(fill, (centres - az[left]) / np.where(span > 0, span, 1.0), 0.0)
        line_w = np.minimum(weight[left], weight[right])
        bin_elev[empty[fill]] = (elev[left] * (1 - t) + elev[right] * t)[fill]
        bin_weight[empty[fill]] = line_w[fill]

    bin_elev = np.where(bin_weight > 0, bin_elev, 0.0)
    return Binned(k0=k0, step_deg=float(step_deg), elev=bin_elev, weight=bin_weight)


@dataclass
class Group:
    """Photos that share one unknown heading: the heading of the group's first photo."""
    photos: list = field(default_factory=list)     # indices into the request's photos
    relative_deg: list = field(default_factory=list)  # each photo's heading minus the group's

    def priors(self, observations):
        """Heading hints for the group: [(heading_deg, sigma_deg)] from its photos' hints."""
        out = []
        for index, rel in zip(self.photos, self.relative_deg):
            photo = observations[index]
            if photo.heading_prior_deg is not None:
                out.append(((photo.heading_prior_deg - rel) % 360.0, float(photo.heading_prior_sigma_deg)))
        return out


def make_groups(observations):
    """Split the photos into heading groups. The first photo always leads group 0; photos
    with a known relative heading join it; every other photo is a group of its own."""
    if not observations:
        raise ValueError("no photos")
    first = observations[0].relative_heading_deg
    if first is not None and abs(first) > 1e-9:
        raise ValueError("the first photo's relative_heading_deg must be 0 or unknown: the others "
                         "are measured from it")
    groups = [Group(photos=[0], relative_deg=[0.0])]
    for index, photo in enumerate(observations[1:], start=1):
        if photo.relative_heading_deg is None:
            groups.append(Group(photos=[index], relative_deg=[0.0]))
        else:
            groups[0].photos.append(index)
            groups[0].relative_deg.append(float(photo.relative_heading_deg))
    return groups


def bin_group(observations, group, step_deg):
    """Each photo of the group as bins in the group's frame (azimuth minus group heading)."""
    return [bin_samples(observations[i].az_offset_deg + rel, observations[i].elev_deg,
                        observations[i].weight, step_deg)
            for i, rel in zip(group.photos, group.relative_deg)]
