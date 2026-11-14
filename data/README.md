# Data

Data files and scripts that prepare data go here.

Note: big map images and datasets are blocked by `.gitignore` on purpose —
the map loads them live from NASA. Only add small files you really need.

## `map_layers.json` – base map config

The frontend loads this file to set up the base map: the start view and the
NASA tile layers to draw. It holds no images; the tiles load live from NASA JPL
Mars Trek.

- `center`, `zoom`: the start view, the Perseverance landing site in Jezero Crater.
- `layers`: the tile layers in drawing order, **bottom to top**:

  | # | `name` | What it shows | `maxNativeZoom` |
  |---|---|---|---|
  | 1 (bottom) | Mars global base | Viking MDIM 2.1 colour mosaic, 232 m/pixel (Viking orbiters) | 7 |
  | 2 | CTX Jezero mosaic | CTX camera mosaic, 6 m/pixel (Mars Reconnaissance Orbiter) | 13 |
  | 3 (top) | HiRISE Jezero mosaic | HiRISE camera mosaic, 25 cm/pixel (Mars Reconnaissance Orbiter) | 17 |

- `attribution`: the credit text to show on the map.

Each layer has:

- `url`: a Leaflet tile URL (`{z}/{y}/{x}`). The double slash after `1.0.0` is
  how Mars Trek publishes it, so keep it.
- `maxNativeZoom`: the deepest zoom NASA has tiles for; past it, let Leaflet
  enlarge the last tiles. Measured on 2026-11-14 by requesting the landing-site
  tile at zooms 0–20.
- `bounds` (optional): the area the layer covers, copied from the layer's
  `WMTSCapabilities.xml`. The global base has none because it covers the
  whole planet.

**Coordinates** are always `[lat, lon]` in degrees, with east-positive longitude.
Bounds are `[[lat_min, lon_min], [lat_max, lon_max]]`. Leaflet takes both as they are.

**Note for the frontend:** the tiles are equirectangular (zoom 0 = 2 columns ×
1 row), so create the map with `L.CRS.EPSG4326`, and give it the Mars radius
(3389500 m) so distances come out right:
`L.extend({}, L.CRS.EPSG4326, { R: 3389500 })`. Do not set the `tms` option.

**Credit:** tiles by NASA/JPL-Caltech Mars Trek (https://trek.nasa.gov/mars/).
The global base is Viking orbiter data (MDIM 2.1); the Jezero mosaics are Mars
Reconnaissance Orbiter (MRO) data from its CTX and HiRISE cameras.
