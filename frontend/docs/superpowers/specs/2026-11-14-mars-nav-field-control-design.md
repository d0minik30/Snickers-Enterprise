# Mars Map: Field HUD and Control view — design

Date: 2026-11-14 · Team Snickers Enterprise · NASA Space Apps Challenge 2026

## Intent

Mars Map is "Google Maps for Mars". A route between two coordinates is planned at a control
centre, and an astronaut or rover follows it on the surface. Between satellite passes the
traveller's position is estimated from the images it takes of its surroundings, so the
position slowly becomes less certain; each satellite pass gives an exact fix.

This work builds the **user interface only**, as a demo for the hackathon. It replaces the
current plain HTML + Leaflet app in `frontend/`. Everything behind the UI (terrain, routes,
positions, satellite passes) is simulated in the browser. Connecting real datasets is another
team member's job.

The team wants a design that does not look generated from a template, and they will keep
working on it by hand afterwards. Code and styles must be easy for people to read and change.

## Goals

- Two views of one mission, each with its own address:
  - **Field** (`/field`): the live HUD the astronaut or rover sees. Phone-sized, portrait.
  - **Control** (`/control`): where the route is planned and the traverse is watched. Laptop-sized.
- The two views run in **two browser windows on the same laptop** and react to each other with
  no server.
- The Earth-Mars **signal delay is shown**, not hidden, and sped up so an audience can watch it.
- Control can: plan between two points, compare candidate routes, send a route, flag a hazard
  (which reroutes the traveller), and send messages.
- The traveller can be an **astronaut or a rover**; the readouts change to match.
- A demo runs start to finish in about two minutes on real NASA imagery of Jezero Crater.

## Non-goals

- Real dataset integration, real route-finding on real terrain, real positioning.
- A backend, accounts, or syncing between two separate devices. (Each view has its own
  address so this can be added later without redesigning the screens.)
- A separate "first mapping run" screen. The growing position uncertainty and the satellite-fix
  countdown stand in for it.
- Off-route detection, voice guidance, offline maps, languages other than English.
- A polished Control layout on phones. It must not break below laptop width, but it is
  designed for 1120 px and wider.

## Anti-goals

- Looking like a generic dashboard: no glass blur, no rounded cards, no soft shadows, no
  gradient buttons, no component kit.
- Hiding the delay. Control must never show field data as if it were current.
- UI code tangled with mock data, so that the data team has to rewrite screens to plug in
  real data.

## Constraints

- **Only `frontend/` is edited.** What that leaves for the team is listed at the end.
- The repo's `.gitignore` blocks `*.png`, `*.jpg`, `*.jpeg`, `*.tif`, `*.geojson` and `*.zip`.
  No raster images or `.geojson` files are added: icons are inline SVG, and mock data lives
  in TypeScript files.
- No map imagery is stored in the repo. Tiles load live from NASA Mars Trek, as today.
- Must run as a static site (no server code), so it can be hosted anywhere (the team will
  use Vercel or Netlify).

## Approaches considered

**Map engine.** Leaflet (used today) cannot rotate the map, and the HUD needs the map turned
to face the direction of travel. MapLibre is the smoothest but only supports Web Mercator, so
NASA's equirectangular Mars tiles would not line up. **Chosen: OpenLayers**, which reads
NASA's tile grid directly, rotates natively, and lets every marker be drawn by our own code.

**App framework.** Vite + React would be slightly simpler. **Chosen: Next.js** (App Router,
TypeScript, static export), because the team named it and the two views map onto two routes.

**Mock mission.** A scripted scenario with fixed routes is quicker but dead outside the
script. **Chosen: a small real route-finder running on made-up terrain**, so start, end and
hazards can be placed anywhere and the routes respond.

**Sync.** One window could own the simulation and the other mirror it, but then neither
works alone. **Chosen: a shared event log**; both windows work out the same state from it.

**Styling.** **Chosen: hand-written CSS** (CSS Modules plus design tokens as CSS custom
properties). No Tailwind, no component library.

These were the builder's calls: the team said to use whatever gives the most design freedom.

## Decided with the team

### Visual language: "Instrument"

Chosen from three mocked directions. It should read as equipment, like a cockpit display.

- Solid near-black surfaces with hard edges and 1 px rules. Square corners. No blur, no shadows.
- Information sits in labelled cells: a small grey uppercase label above a larger value.
- Colour carries meaning only:

  | Token | Value | Used for |
  |---|---|---|
  | surface | `#0A0A0B` | panels and bands |
  | rule | `#34343A` | dividing lines |
  | text | `#FFFFFF` | values |
  | muted | `#8D8D96` | labels |
  | route | `#FF5CE1` | the active route and its waypoints (magenta, as on airliner navigation displays) |
  | caution | `#FFB000` | hazards, anything in transit, ageing data |
  | nominal | `#5BE37D` | healthy / delivered / low risk |
  | danger | `#FF5A4F` | high risk |

- **Typeface: Barlow Condensed** for everything (the team preferred it over B612). Weights
  500, 600, 700. Numbers that change on screen must not make the layout jiggle.
- Map imagery is NASA's grey HiRISE mosaic, tinted warm (Mars-coloured) and slightly darkened
  so overlays stay readable.
- Reference mockups, approved by the team, are kept outside the repo in
  `nasa hackathon/.superpowers/brainstorm/2023-1794664748/content/`
  (`field-look-v2.html`, option B, and `control-layout-v2.html`). They are layout and style
  references, set in the earlier typeface; label positions in them are rough.

### Field view (`/field`)

Phone portrait, three zones stacked: a top band, the map, a bottom band.

```
┌──────────────────────────────┐
│  ↰  140 m            │ HDG 312° │   top band: next move
│     BEAR LEFT · WP 4 │ WP 4 / 7 │
├──────────────────────────────┤
│ CTRL ▸ HOLD AT WP 4    −11:20 │   amber strip: latest message from Control
├──────────────────────────────┤
│                               │
│     map, turned to face the   │   route ahead (magenta), path walked (white dashes),
│     direction of travel       │   position marker + uncertainty ring, hazards (amber
│                               │   hatching), next waypoint, 100 m range ring, north pointer
├──────────────────────────────┤
│ DISTANCE │ ETA      │ PACE     │   bottom band: readouts
│ POS ERR  │ LAST FIX │ NEXT PASS│
│ O₂ ▓▓▓▓░ 74%  │ POWER ▓▓▓▓░ 81%│
└──────────────────────────────┘
```

- **Next move:** arrow, distance to it, instruction ("bear left", "turn right", "continue",
  "arrive"), and the waypoint it leads to. Worked out from the route's shape.
- **Position uncertainty:** a ring around the marker and a "pos error ±N m" readout. The error
  grows with distance travelled since the last satellite fix and drops back at each pass.
  "Last fix" turns amber as it ages. A brief "fix acquired" cue marks each pass.
- **Messages from Control** appear in the amber strip with how long ago they were sent.
  Tapping the strip acknowledges the message.
- **Hold / Proceed** orders really stop and restart the traveller when they arrive.
- **Route changes** from Control replace the route when they arrive, with a clear
  "route changed by Control" cue.
- **Astronaut readouts:** oxygen, suit power, walking pace. **Rover readouts:** battery,
  tilt angle, drive speed. Which one is shown follows the mission set up in Control.
- **States:** waiting for a route → route received, with a Start button → moving → holding →
  arrived.

### Control view (`/control`)

Laptop landscape, with two modes switched from the top bar: **Plan** and **Live**.

```
┌──────────┬─────┬─────┬──────────────────┬───────────┬──────────┬─────────────┐
│ MARS MAP │PLAN │LIVE │ traverse name     │ EARTH UTC │ MARS SOL │ SIGNAL DELAY │
├──────────┴─┬───┴─────┴──────────────────┴───────────┴─┬────────┴─────────────┤
│ left rail  │            map (north up)                │ right rail            │
│            │                                          │                       │
│            ├──────────────────────────────────────────┤                       │
│            │ bottom strip                             │                       │
└────────────┴──────────────────────────────────────────┴───────────────────────┘
```

**Plan mode**
- Left rail: astronaut / rover switch; start and end coordinates, set by clicking the map;
  three candidate routes (**safest, shortest, flattest**), each with length, time, steepest
  slope and risk; a "send route to field" button showing when it will arrive.
- Map: all three routes, the selected one in magenta with numbered waypoints, the others as
  thin white dashed lines; hazard zones hatched in amber.
- Bottom strip: height profile of the selected route with waypoints marked.
- Right rail: waypoint table; satellite passes expected during the traverse with the longest
  gap and worst expected drift; a one-line reason for the recommended route.

**Live mode**
- Left rail: an amber bar that always states how old the field data is; traveller readouts;
  progress along the route; last received coordinates with send and receive times; buttons
  "flag hazard on map" and "replan from current position".
- Map: two markers. **Last received position** (solid) and **estimated position now**
  (dashed outline, projected forward along the route at the last known pace). A hazard
  flagged by Control is labelled "not yet at field" and its new route is drawn dashed until
  the signal arrives.
- Right rail: message log. Each message is **in transit** (with a progress bar and
  countdown), **delivered**, or **acknowledged**. Quick orders (Hold, Proceed) and a
  free-text box, with a note of when the message will arrive.
- Bottom strip: **signal timeline**. Two horizontal lanes, Earth and Mars, with every signal
  drawn as a sloped line between them, a "now" line, and satellite passes marked on the Mars
  lane. This is the one place the delay can be understood at a glance.
- **Flagging a hazard:** press the button, click the map; a hazard zone of fixed size is
  placed, a new route around it is worked out and sent. Field keeps following the old route
  until the signal arrives.
- **Replan from current position** works out a fresh route to the same end point with the
  hazards known so far, and sends it the same way.
- Any new route sent during a traverse starts from **where the traveller is expected to be
  when the signal arrives**, not from where they were last seen.
- Acknowledgements and everything else from Field take the same delay to reach Control.

The estimated-now marker, the signal timeline and the "why this route" note were proposed by
the designer and accepted when the team approved the mockup.

### Signal delay and demo speed

- One-way delay is a single constant, **11 min 20 s** (the real range is about 4 to 22 min).
- The whole mission runs on a **mission clock** that can be sped up (pause, 1×, 10×, 30×, 60×;
  default 30×). At 30× the delay takes about 23 seconds and a 4 km walk about two minutes.
  All times shown on screen are mission times, so the numbers stay realistic.
- Control has discreet demo controls: speed, pause, and reset mission.

## How it works underneath (builder's calls)

**Shared event log.** Everything either side does is an event stamped with the mission time
it was sent: mission set up, route sent, traverse started, hazard flagged with its new route,
message, acknowledgement, hold, proceed, clock changes, reset. The log is stored in
`localStorage` and announced over `BroadcastChannel`, so both windows hold the same log and
either can be reloaded.

**State is worked out, not stored.** Pure functions turn (log, mission time) into what each
side should see:
- Field sees its own events at once, and Control's events once `sent + delay` has passed.
- Control sees its own events at once, and Field's state as it was at `now − delay`, plus an
  estimate of now.
- Traveller position is the distance covered along the active route, adding up pace over the
  periods it was moving. Because it is a pure function of the log, both windows always agree.
- Clock changes (speed, pause, reset) are demo controls and apply to both windows at once.

**Mock mission, behind a small interface.** The UI asks for routes and terrain through a few
functions (plan routes between two points given hazards; replan from a point; height at a
point; satellite pass times). Behind them today:
- made-up but deterministic terrain heights over a box of roughly 5 × 6 km around
  Perseverance's landing site, plus a few preset hazard zones (dune fields). The box is this
  large because of the delay: in the 22 min 40 s it takes Control to see something and get a
  new route back, an astronaut walks about 1.5 km, and a reroute can only change what lies
  beyond that. Default demo routes are therefore about 4 km long (about two minutes at 30×);
- a grid route-finder (A*) run three times with different cost weightings to give the
  safest, shortest and flattest routes;
- a fixed list of satellite pass times at irregular gaps;
- position error modelled as a small base value plus a percentage of distance since the
  last pass.

The data team replaces what is behind the interface; the screens do not change.

**Map.** OpenLayers with NASA Mars Trek tiles in their native latitude/longitude grid (two
tiles wide and one tall at zoom 0, origin top-left), carried over from the current app's
layer list: global Viking colour for context, CTX and HiRISE over Jezero. The view is limited
to the demo box. Distances use the Mars radius (3,389.5 km). Field rotates the map to the
heading; Control stays north-up. If tiles fail to load, a plain message strip says so and the
route still draws on a flat background.

**Layout of the code** (inside `frontend/`):

```
app/            layout, landing page, field/ and control/ routes, global styles and tokens
components/     map/  field/  control/  shared/
lib/mission/    event types, log + sync, state functions, mission clock
lib/planner/    mock terrain, route-finder, satellite passes   (the swappable part)
lib/nav/        turn instructions, distances, bearings, formatting
lib/mars/       tile layers and coordinate setup
docs/           this document and the plan
```

**Other calls**
- The landing page `/` explains the two-window setup and links to both views.
- The map components load in the browser only (the map library needs a real page).
- Logic with right and wrong answers gets unit tests (Vitest): state functions including the
  delay, route-finder, turn instructions, position error, formatting. Screens are checked by
  running the demo.
- Motion is restrained and respects the "reduce motion" system setting.
- `frontend/README.md` documents how to run and present the demo.

## Left to the builder

- Exact component breakdown, file names and CSS details within the visual language above.
- Type sizes and spacing, re-tuned for Barlow Condensed (it is narrower than the mockups' font).
- How to stop changing numbers from jiggling, if the font's own fixed-width digits are not enough.
- Terrain formula, grid size, cost weightings, hazard size, pace values (astronaut about
  3.9 km/h; rover chosen so a demo traverse stays under about two minutes at default speed).
- Waypoint naming, exact wording of instructions and cues.
- Package versions (current stable Next.js, React, OpenLayers, Vitest at install time).
- The starting values of the Earth and Mars clocks shown in Control (made up, but plausible).
- Whether the position marker visibly snaps to its corrected place at a fix.
- How Control behaves between 700 and 1120 px wide.

## Decided by the team after the write-up

- **Hosting: Vercel or Netlify**, set up by the team with `frontend/` as the project folder.
  No GitHub Actions workflow is added. The app stays a static export so it works on either
  host with no server. The old GitHub Pages link will stop showing a working app once the
  old files are replaced; the root `index.html` redirect and the Pages setting are the
  team's to retire.
- **Git: stay on `main`, no commits.** The builder only changes files inside `frontend/`;
  the team handles branches and commits.

## Open item for the team

- **Root README.** It describes the old app (files, features, how to run, the GitHub Pages
  link) and will be out of date. It is outside `frontend/`, so it is left alone.
