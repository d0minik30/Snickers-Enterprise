"""The POST /locate body of CONTRACTS.md, section 2, as models that check a request.

A body that breaks the contract raises pydantic.ValidationError, which the server turns into
HTTP 422 with the field's location. Unknown extra fields are ignored, so a newer app can talk
to an older engine as long as the contract_version is one the engine knows.
"""
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from .constants import DEFAULT_EYE_HEIGHT_M, SUPPORTED_CONTRACT_VERSIONS


class Camera(BaseModel):
    hfov_deg: float = Field(gt=0, le=360)
    vfov_deg: float = Field(gt=0, le=180)
    width_px: int = Field(gt=0)
    height_px: int = Field(gt=0)
    lens_model: Literal["rectilinear", "fisheye_equidistant", "cylindrical", "cahvore", "other"]


class Sample(BaseModel):
    az_offset_deg: float = Field(ge=-360, le=360)
    elev_deg: float = Field(ge=-90, le=90)
    weight: float = Field(default=1.0, ge=0, le=1)


class Sun(BaseModel):
    az_offset_deg: float = Field(ge=-360, le=360)
    elev_deg: float | None = Field(default=None, ge=-90, le=90)


class Photo(BaseModel):
    id: str = Field(min_length=1)
    camera: Camera
    eye_height_m: float = Field(default=DEFAULT_EYE_HEIGHT_M, gt=0, le=100)
    horizon_uncertainty_deg: float = Field(default=0.0, ge=0, le=10)
    roll_uncertainty_deg: float = Field(default=0.0, ge=0, le=10)
    relative_heading_deg: float | None = Field(default=None, ge=-360, le=360)
    time_utc: str | None = None
    sun: Sun | None = None
    samples: list[Sample] = Field(min_length=20, max_length=5000)

    @field_validator("time_utc")
    @classmethod
    def _time_is_iso(cls, value):
        if value is not None:
            from .match.sun import parse_time_utc
            try:
                parse_time_utc(value)
            except ValueError:
                raise ValueError("not an ISO 8601 time, e.g. 2026-11-15T10:20:00Z") from None
        return value


class Prior(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-360, le=360)
    radius_m: float = Field(gt=0)


class Options(BaseModel):
    prior: Prior | None = None
    top_k: int = Field(default=5, ge=1, le=20)
    include_likelihood_grid: bool = True
    include_residuals: bool = True


class LocateRequest(BaseModel):
    contract_version: str
    photos: list[Photo] = Field(min_length=1, max_length=8)
    options: Options = Field(default_factory=Options)

    @field_validator("contract_version")
    @classmethod
    def _version_is_known(cls, value):
        if value not in SUPPORTED_CONTRACT_VERSIONS:
            raise ValueError("this engine speaks contract versions %s, not %r"
                             % (", ".join(SUPPORTED_CONTRACT_VERSIONS), value))
        return value

    @field_validator("photos")
    @classmethod
    def _first_photo_leads(cls, photos):
        first = photos[0].relative_heading_deg
        if first is not None and abs(first) > 1e-9:
            raise ValueError("the first photo's relative_heading_deg must be 0 or null: the others are "
                             "measured from it")
        if len({p.id for p in photos}) != len(photos):
            raise ValueError("photo ids must be different")
        return photos
