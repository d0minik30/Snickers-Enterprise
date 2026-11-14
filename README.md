# Mars Map – Interplanetary Survival Guide

Navigation for a Mars traverse, built by team Snickers Enterprise for the
**NASA Space Apps Challenge 2026** – challenge *"Interplanetary Survival Guide: Martian Map"*.

The app has two screens that stay in sync across two browser windows, with the
**11 min 20 s Earth–Mars signal delay** built in:

- **Field** – phone-sized HUD for the astronaut or rover.
- **Control** – laptop-sized view for the planners on Earth.

A third screen, **Jezero** (`/map/`), is an interactive map of Mars that zooms into Jezero Crater
and the Perseverance landing site, with slope and sand overlays made from NASA and USGS data.

## Try it

You need Node.js 20 or newer.

```bash
git clone https://github.com/d0minik30/Snickers-Enterprise.git
```

```bash
cd Snickers-Enterprise/frontend
```

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000, then open **Control** in a wide window and **Field** in a narrow one
(or **Jezero** for the map).
The step-by-step demo script is in [`frontend/README.md`](frontend/README.md).

## Folders

| Folder | What is there |
|---|---|
| `frontend/` | The app (Next.js). See [`frontend/README.md`](frontend/README.md): how to run, test, host and present it. |
| `data/` | Map layer config, terrain and hazard data, and the scripts that make them. See [`data/README.md`](data/README.md). |
| `backend/` | Empty for now. |

## Hosting

The app is a static site: build it in `frontend/` with `npm run build` and host the `out/` folder
(Vercel or Netlify, with `frontend` as the project folder).

The old GitHub Pages link (https://d0minik30.github.io/Snickers-Enterprise/) showed the first
plain-HTML version and does not show the new app.

## Credits

Imagery and terrain: NASA / JPL-Caltech, via [NASA Mars Trek](https://trek.nasa.gov/mars/) (Viking MDIM 2.1,
MRO CTX and HiRISE, CTX Jezero DEM). Sand: Sun & Stack (2020), USGS SIM 3464, https://doi.org/10.3133/sim3464.
Map libraries: [OpenLayers](https://openlayers.org/) (Field, Control) and [Leaflet](https://leafletjs.com/) (Jezero).
