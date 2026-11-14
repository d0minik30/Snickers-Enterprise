# Mars Map – Interplanetary Survival Guide

A **"Google Maps for Mars"** that a future astronaut could use to find their way on Mars.
Built by team Snickers Enterprise for the **NASA Space Apps Challenge 2026** – challenge
*"Interplanetary Survival Guide: Martian Map"*.

**Live site:** https://d0minik30.github.io/Snickers-Enterprise/

## Features

- Full-screen map of Mars with a switch between a **color photo** map and an **elevation** map (with legend).
- **Latitude / longitude** of the mouse shown in the bottom-left corner (on phones: the point you tap, or the map centre).
- **Search box:** type a place name (Olympus Mons, Jezero Crater, Hellas Planitia…) or a rover name and the map flies there.
- **Landing site markers** for Perseverance, Curiosity, Opportunity, Spirit, Viking 1, Viking 2, Zhurong and InSight. Click one to see the name, year and a short description.
- **Perseverance's real route**, drawn as an orange line. Click it to see which sol (Mars day) that drive happened.
- **Sharp close-up of Jezero Crater:** zoom in near Perseverance and the map switches to high-resolution CTX (6 m/pixel) and HiRISE (25 cm/pixel) images.
- **"You are here" astronaut** (blue dot) that walks along Perseverance's route, with a **Center on me** button that follows it.
  ⚠️ This position is **simulated** for the demo. It is not a real astronaut or GPS.
- Friendly messages (with a Retry button) if NASA's servers can't be reached.
- Dark, space-themed design that works on laptops and phones.

## Where the data comes from

**No map images or datasets are stored in this repo.** Everything loads live from NASA in your browser.

| Data | Source |
|---|---|
| Color photo map: `Mars_Viking_MDIM21_ClrMosaic_global_232m` | [NASA Mars Trek](https://trek.nasa.gov/mars/) WMTS tiles |
| Elevation map: `Mars_MGS_MOLA_ClrShade_merge_global_463m` | [NASA Mars Trek](https://trek.nasa.gov/mars/) WMTS tiles |
| Jezero close-up: `JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0` and `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd` | [NASA Mars Trek](https://trek.nasa.gov/mars/) WMTS tiles |
| Perseverance route (GeoJSON) | [NASA MMGIS – M20_traverse.json](https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json) |
| Map library | [Leaflet 1.9.4](https://leafletjs.com/) from the unpkg CDN |

- Mars Trek layer list and docs: https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars
- Each layer's tile grid is described in its `WMTSCapabilities.xml`, for example:
  https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/WMTSCapabilities.xml
- Place coordinates: [IAU Gazetteer of Planetary Nomenclature](https://planetarynames.wr.usgs.gov/) and NASA mission pages.

**About the route file:** NASA's server allows other websites to load `M20_traverse.json`
(it sends the `Access-Control-Allow-Origin: *` header), so we load it live and **no copy is
saved in the repo**. If NASA ever blocks it, you could save that one small file in the repo and
change `ROUTE_URL` in `frontend/app.js` to point to it.

### How the map lines up (for the curious)

Google Maps uses the "Web Mercator" projection. NASA Mars Trek tiles use a simple
latitude/longitude grid (equirectangular): at zoom 0 the whole planet is **2 tiles wide and
1 tile tall**, starting at the top-left corner (−180°, +90°). Leaflet's built-in `EPSG:4326`
system works the same way, so `frontend/app.js` uses a copy of it with the Mars radius (3,389.5 km)
for correct distances. The global maps go up to zoom 7; past that Leaflet just enlarges the
zoom-7 images (except around Jezero, where the close-up layers stay sharp).

Longitudes are shown as **0–360° East** (NASA's usual style) with the −180…180 value in brackets.
Example: Olympus Mons is at **18.65° N, 226.2° E (−133.8°)**.

## Run it on your computer

The page loads data from the internet, so open it through a small local web server
(double-clicking `index.html` may not work in every browser).

1. Download or clone this repo:

   ```bash
   git clone https://github.com/d0minik30/Snickers-Enterprise.git
   ```

2. Go into the folder and start a server. If you have Python:

   ```bash
   cd Snickers-Enterprise/frontend
   python -m http.server 8000
   ```

   (On some computers the command is `python3` instead of `python`.)
   Or, in VS Code, install the **Live Server** extension and click **Go Live**.

3. Open http://localhost:8000 in your browser.

## Put it online with GitHub Pages

1. On GitHub, open the repo and go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Select branch **main** and folder **/ (root)**, then click **Save**.
4. Wait 1–2 minutes. The site will be at https://d0minik30.github.io/Snickers-Enterprise/

## Folders

| Folder | What goes there |
|---|---|
| `frontend/` | The website (everything built so far) |
| `backend/` | Server-side code (empty for now) |
| `data/` | Data files and data scripts (empty for now) |

The `index.html` in the root only redirects to `frontend/`, so the GitHub Pages link keeps working.

## Files in `frontend/`

| File | What it does |
|---|---|
| `index.html` | Page layout: the map, search box, layer switch, coordinates box, "Center on me" button |
| `style.css` | Dark space theme, phone layout, marker styles |
| `app.js` | All the logic: map setup, NASA layers, search, markers, route, simulated astronaut |
| `../.gitignore` | Stops big files (images, datasets) from being added by mistake |

## Ideas for the team

- **Add a place:** add a line to the `PLACES` list near the top of `frontend/app.js` (name, lat, lon, zoom, description).
- **Add a landing site:** add a line to `LANDING_SITES` in `frontend/app.js`.
- **Change the walking speed:** change `WALK_SPEED_M_PER_S` in `frontend/app.js`.
- **Change colors:** edit the variables at the top of `frontend/style.css`.

## Credits

Imagery and route data: NASA / JPL-Caltech / USGS, via NASA Mars Trek and MMGIS.
Map library: Leaflet (BSD-2-Clause).
