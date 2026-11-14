"""Horizons computed from terrain: what the skyline looks like from a given position.

Named "horizon" so it isn't confused with Person 3's backend/skyline/, which turns a photo
into a skyline. A horizon here is always rendered from elevation data.
"""
from .render import Horizon, RenderConfig, render_horizon

__all__ = ["Horizon", "RenderConfig", "render_horizon"]
