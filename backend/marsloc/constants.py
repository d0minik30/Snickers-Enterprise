"""Constants shared by the whole engine. See CONTRACTS.md, section 0."""

# Mars 2000 sphere (IAU 2000). The same radius as data/scripts and MARS_RADIUS_M in
# frontend/lib/nav/geo.ts.
MARS_RADIUS_M = 3396190.0

# Perseverance landing site: the origin of the local east/north frame.
LANDING_SITE_LAT = 18.4447
LANDING_SITE_LON = 77.4508

DEFAULT_EYE_HEIGHT_M = 1.7

CONTRACT_VERSION = "0.2"
# 0.2 changed the terrain input only, so requests in either version are accepted.
SUPPORTED_CONTRACT_VERSIONS = ("0.1", "0.2")
