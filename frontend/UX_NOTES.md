# UX clean-up notes

Running log of the "make it easy to understand" pass. Newest at the bottom.

## Goals (from the team)

1. Landing page: easy to understand, two big choices: **Explore the map** and **Run a mission**.
2. Mission planner (Control) and mission viewer (Field) on **one screen**, both live.
3. Time runs too slow: add speed-ups up to **1000×**.
4. Show a clear message when a mission is finished.
5. Remove information that doesn't help; plain words everywhere.

## Log

- **Speed-ups.** Speeds are now 1×, 10×, 30×, 100×, 300×, 1000× (was up to 60×). Default is 100×, so the
  11:20 signal delay takes about 7 s and a 6 km walk about 1 min. File: `lib/mission/types.ts`.
- **New landing page** (`app/page.tsx`). One sentence about the app, then two big choices: **Run a mission**
  (recommended) and **Explore the map**. Then four short steps ("Plan, Send, Go, Done") and a small "More" list
  for Locate, Validate, and the separate Control/Field pages. Removed the long "how to present" guide and the
  data list (credits stay in the footer).
- **New Mission screen** at `/mission/` (`components/mission/MissionScreen.tsx`). Earth (Control) on the left,
  Mars (Field, the crew's view) on the right, both live in one window. The top line always says what to do next
  (1 pick a route → 2 route flying, with a countdown → 3 press Start → 4 walking), plus speed, pause and
  "Start over". Below 1100 px wide the two halves stack.
  - How it works: both screens already shared one mission store per window, so they just render side by side.
    `components/shared/embedded.ts` tells a screen it is inside Mission, so it hides things that would be
    doubled (menus, speed buttons, "open in a new window" links).
  - `/control/` and `/field/` still work on their own for two-window or phone demos.
- **Mission complete message** (`components/mission/MissionComplete.tsx`). A box with distance, trip time and
  photo fixes, and buttons: Start a new mission / Keep looking / Home. Shows on Mission and Field when the crew
  arrives, and on Control alone when the news reaches Earth (11:20 later). Closing it lasts until the next mission.
- **Less on screen, plainer words.**
  - Control top bar: removed the Earth UTC and Mars sol clocks. "Signal delay" → "Radio delay". Tabs: Plan / Watch.
  - Control plan: removed the "Position fixes" block. "Why we suggest route A" moved to the top. "Traveller" →
    "Who goes", "Candidate routes" → "Pick a route", "Send route to field" → "Send route to Mars".
  - Control watch: removed the coordinates block; 4 numbers instead of 8. "Field data is 11:20 old" →
    "What you see here is 11:20 old". Buttons: "Mark a danger on the map", "Plan a new route from here".
    Comms say Mars / crew instead of field.
  - Field: 4 numbers instead of 8 (Distance left, Time left, Speed, Position accuracy); dropped elevation,
    last fix, slope and climb bars. "Start traverse" → "Start", "Message Control" → "Message Earth".
- **Checks.** Typecheck and all 194 unit tests pass. `npm run smoke` passes except "nothing overflows at
  1120/1366/1920 px" on Control, which fails the same way on the code before this change.

## Change of focus: "Where am I?" on the map is the main feature

The team said the main idea is: upload a photo of Mars on the map, and get located.

- **Map page** (`/map/`): big pink **WHERE AM I?** button on top. It opens a panel:
  Upload photos / Use example photos → thumbnails → **Find my position** → "FOUND YOU" with position,
  accuracy, which way the first photo faces, and (for the examples) how far it is from NASA's real rover position.
  On the map: pink "YOU ARE HERE" pin, accuracy circle, what each photo saw, the real position. The map flies there.
  Files: `components/jezero/FindMe.tsx`, `findMe.module.css`, `JezeroScreen.tsx`.
- **Example photos**: 6 real Perseverance Navcam photos (sols 17–18, site 3 drive 578) in `public/demo-photos/`,
  downloaded from NASA's raw-image site. Set up in `lib/locate/demo.ts`.
- **Where the answer comes from — be honest about this in the demo:**
  - Example photos (recognised by file content, SHA-256, or by NASA image id in the file name): the screen shows the
    engine's **saved, real answer** for exactly these 6 photos (`lib/locate/fixtures/engine-sol17-18.json`, run
    14 Nov). It lands 74 m from the real position, ±21 m. The panel says "Saved answer from our engine".
  - Any other photo: sent to the live engine (`/skyline`, then `/locate`). Today there is **no `/locate` server**
    (see GOOD_MORNING.md), so other photos show "The live engine isn't running, so only the example photos work
    right now." When the engine server exists, other photos will just work, with no change to the page.
  - On real photos the engine is still weak: one photo alone is often kilometres off (validation median 5.3 km).
    Several photos in different directions do much better, like the 6 examples. So in the demo, upload all 6.
- **Map clean-up**: overlays panel moved to bottom-right and off by default; "Slope/Sand" → "Steep ground/Sand"
  with plain legend words; site labels shorter.
- **Landing page**: main choice is now **Where am I?** (→ map); **Run a mission** is second. Steps explain the photo search.
- **Checks**: typecheck, 196 unit tests pass (2 new for the example-photo matching). `npm run smoke` has a new
  "Where am I?" section that passes; the same 3 old overflow failures remain.

## Ideas not done yet

- Locate/Validate pages were not simplified in this pass.
- A live `/locate` server (engine team) so any uploaded photo works, not only the examples.
- On the Mission screen the Earth map is narrow on a 1366 px laptop; could hide Control's right column there.

## Fix: example photos were missing after the merge

The root `.gitignore` skips every `.png`, so `public/demo-photos/` was never committed and "Use example photos"
failed with "Could not load /demo-photos/…". NASA's server sends no CORS header, so the page cannot fetch the
photos from NASA directly. Added a `.gitignore` exception for `frontend/public/demo-photos/*.png` only (6 files,
6.8 MB) and committed them.

## Plan screen: everything in one column

- Plan mode has **no right column** any more; the map gets that room. Everything is in the left column, top to
  bottom: Who goes → Pick a route (cards) → "Why A?" in one line → Change the trip (Move start / Move end) → Send.
- Removed: the waypoint table (seven rows of "884 m"), the start/end coordinates, the "Radio delay" box in the top
  bar (the Send button already says "Reaches Mars in 11:20"), and the "MARS MAP / CONTROL" title inside the Mission
  screen (the Mission screen has its own). `PlanDetailRail.tsx` deleted.
- Crew view: before a route arrives it shows only "Waiting for a route from Earth", not empty boxes full of "--".

## Landing page redesign (v3)

- Full-screen hero on **live NASA imagery of Jezero** (MRO CTX tiles from Mars Trek, warmed to Mars colours
  with a CSS filter, since the tiles are greyscale), with a pulsing "YOU ARE HERE" pin on the landing site.
- Headline "Lost on Mars? Take a photo." One sentence on how it works. Buttons: **Find me from a photo**
  (→ map) and **Run a mission**. A small proof line: 74 m from NASA's real rover position on 6 Perseverance photos.
- "How it works" in 3 steps with pictures: a real Navcam photo, a skyline illustration, a map tile with a pin.
- "Also: run a mission" with 3 numbers (11:20 delay, 3 routes, up to 1000×). Small footer with the other pages.
- No images added to the repo: the hero and step 3 load from NASA; step 1 reuses an example photo.

## New name: Marsfinder, and a 3D landing page

- Site renamed **Marsfinder** (page titles, logos, top bars). The landing logo is MARS + pink FINDER.
- Landing hero is now a **live 3D flyover of Jezero Crater** (`components/landing/TerrainHero.tsx`, three.js):
  - Heights: the data team's 40 m elevation grid (`public/data/elevation_grid.bin`, from the MRO CTX DEM),
    2.6× vertical exaggeration so the relief reads.
  - Surface: NASA Mars Trek CTX tiles (zoom 11, 36 tiles; NASA allows this with CORS), warmed to Mars colours.
  - The **pink skyline line is traced from the render itself**: a small black/white render of land vs sky is read
    back every few frames and the top edge drawn as a glowing line. It draws itself left to right at the start.
  - A "YOU ARE HERE" pin follows the Perseverance landing site on screen.
  - Pauses when scrolled out of view; still image for people who turn off motion; falls back to a sky gradient
    if WebGL fails.
- `three` added to dependencies. `npm run build` passes.

## Landing page fixes after the example photos changed

- The example photos were swapped (now 3 photos of pose 3/770), which broke the step 1 picture and made the
  "74 m, 6 photos" line wrong. The landing page now reads the photo, the photo count and the distance from
  `lib/locate/demo.ts` and its saved answer, so it stays right when they change again.
- The 3D terrain no longer waits for all 36 NASA tiles: it shows at once as plain Mars-coloured relief and the
  imagery paints in tile by tile. If NASA is slow or blocked, the scene still works. A failure is logged to the
  browser console as "Marsfinder 3D terrain failed".
