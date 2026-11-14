"""Where the sun is in the Martian sky at a given time: a heading hint for the matcher.

There is no compass on Mars. But if the sun is in a photo and the photo's time is known, the
sun's true azimuth minus its az_offset in the image is the direction the camera faced.

The formulas are the Mars24 algorithm: Allison & McEwen (2000), "A post-Pathfinder
evaluation of areocentric solar coordinates", Planetary and Space Science 48, 215-235, with
the updated constants published by NASA GISS (Mars24 "Algorithm and Worked Examples").
Longitudes here are east-positive, as everywhere in the engine.
"""
import datetime
import math

# (first day the value applies, TAI - UTC in seconds). TT - UTC = that + 32.184 s.
_LEAP_SECONDS = (
    (datetime.date(2017, 1, 1), 37), (datetime.date(2015, 7, 1), 36), (datetime.date(2012, 7, 1), 35),
    (datetime.date(2009, 1, 1), 34), (datetime.date(2006, 1, 1), 33), (datetime.date(1999, 1, 1), 32),
)

# Perturbations by the other planets: (amplitude deg, period in years, phase deg)
_PERTURBERS = ((0.0071, 2.2353, 49.409), (0.0057, 2.7543, 168.173), (0.0039, 1.1177, 191.837),
               (0.0037, 15.7866, 21.736), (0.0021, 2.1354, 15.704), (0.0020, 2.4694, 95.528),
               (0.0018, 32.8493, 49.095))


def parse_time_utc(text):
    """An ISO 8601 time such as 2026-11-15T10:20:00Z as an aware UTC datetime."""
    if isinstance(text, datetime.datetime):
        moment = text
    else:
        moment = datetime.datetime.fromisoformat(str(text).strip().replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=datetime.timezone.utc)
    return moment.astimezone(datetime.timezone.utc)


def _days_since_j2000_tt(moment):
    """Days of Terrestrial Time since J2000 (2000-01-01 12:00 TT)."""
    moment = parse_time_utc(moment)
    tai_minus_utc = 32
    for start, seconds in _LEAP_SECONDS:
        if moment.date() >= start:
            tai_minus_utc = seconds
            break
    unix_s = moment.timestamp()
    jd_utc = 2440587.5 + unix_s / 86400.0
    return jd_utc + (tai_minus_utc + 32.184) / 86400.0 - 2451545.0


def mars_solar_state(time_utc):
    """Sun-related angles and clocks of Mars at a moment.

    Returns a dict: ls_deg (areocentric solar longitude, the season), eot_deg (equation of
    time), mtc_hours (Coordinated Mars Time at longitude 0), declination_deg (the sun's
    latitude) and subsolar_lon_east_deg (the longitude where the sun is overhead).
    """
    dt = _days_since_j2000_tt(time_utc)
    mean_anomaly = math.radians(19.3871 + 0.52402073 * dt)
    fictitious_mean_sun = 270.3871 + 0.524038496 * dt
    perturbation = sum(a * math.cos(math.radians(0.985626 * dt / tau + phi))
                       for a, tau, phi in _PERTURBERS)
    centre = ((10.691 + 3.0e-7 * dt) * math.sin(mean_anomaly) + 0.623 * math.sin(2 * mean_anomaly)
              + 0.050 * math.sin(3 * mean_anomaly) + 0.005 * math.sin(4 * mean_anomaly)
              + 0.0005 * math.sin(5 * mean_anomaly) + perturbation)
    ls = (fictitious_mean_sun + centre) % 360.0
    ls_rad = math.radians(ls)
    eot = (2.861 * math.sin(2 * ls_rad) - 0.071 * math.sin(4 * ls_rad)
           + 0.002 * math.sin(6 * ls_rad) - centre)
    mtc = (24.0 * ((dt - 4.5) / 1.0274912517 + 44796.0 - 0.0009626)) % 24.0
    subsolar_west = (mtc * 15.0 + eot + 180.0) % 360.0
    declination = (math.degrees(math.asin(0.42565 * math.sin(ls_rad))) + 0.25 * math.sin(ls_rad))
    return {"ls_deg": ls, "eot_deg": eot, "mtc_hours": mtc, "declination_deg": declination,
            "subsolar_lon_east_deg": (-subsolar_west) % 360.0}


def local_mean_solar_time_hours(time_utc, lon_east_deg):
    """Local Mean Solar Time (hours, 0..24) at an east longitude."""
    return (mars_solar_state(time_utc)["mtc_hours"] + lon_east_deg / 15.0) % 24.0


def sun_position(time_utc, lat_deg, lon_east_deg):
    """(azimuth_deg, elevation_deg) of the sun seen from a place on Mars: azimuth clockwise
    from north, elevation above the horizontal (no refraction; Mars's air is thin)."""
    state = mars_solar_state(time_utc)
    # Hour angle: positive after local noon, when the sun has moved to the west.
    hour = math.radians((lon_east_deg - state["subsolar_lon_east_deg"] + 180.0) % 360.0 - 180.0)
    dec = math.radians(state["declination_deg"])
    lat = math.radians(lat_deg)
    east = -math.cos(dec) * math.sin(hour)
    north = math.cos(lat) * math.sin(dec) - math.sin(lat) * math.cos(dec) * math.cos(hour)
    up = math.sin(lat) * math.sin(dec) + math.cos(lat) * math.cos(dec) * math.cos(hour)
    return math.degrees(math.atan2(east, north)) % 360.0, math.degrees(math.asin(max(-1.0, min(1.0, up))))


def heading_from_sun(time_utc, sun_az_offset_deg, lat_deg, lon_east_deg):
    """Direction the camera faced, from where the sun sits in the image.

    sun_az_offset_deg: the sun's azimuth relative to the optical axis, positive to the right
    (the convention of the skyline samples). Returns (heading_deg, sun_elevation_deg); the
    elevation lets the caller check it against the sun's height in the image.
    """
    azimuth, elevation = sun_position(time_utc, lat_deg, lon_east_deg)
    return (azimuth - sun_az_offset_deg) % 360.0, elevation
