/* =========================================================
   Mars Map – app.js
   A "Google Maps for Mars" for NASA Space Apps Challenge 2026.

   IMPORTANT: no map images or datasets are stored in this repo.
   Everything (map tiles + Perseverance route) is loaded live
   from NASA servers in the user's browser.

   The file is split into numbered sections. Read top to bottom.
   ========================================================= */

/* ---------------------------------------------------------
   1. SETTINGS – change these to tweak the app
   --------------------------------------------------------- */

// Mars mean radius in metres. Used for distances (scale bar, astronaut walk).
const MARS_RADIUS_M = 3389500;

// NASA Mars Trek tile address. {layer} and {ext} are filled in below,
// {z}/{y}/{x} are filled in by Leaflet for every tile (zoom / row / column).
const TREK_TILE_URL =
  'https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{z}/{y}/{x}.{ext}';

// Base maps. We checked each layer's WMTSCapabilities.xml:
// JPEG tiles, 256x256 px, zoom levels 0–7, 2x1 tiles at zoom 0 (whole planet).
const BASE_LAYERS = {
  color:     { id: 'Mars_Viking_MDIM21_ClrMosaic_global_232m', maxNativeZoom: 7 },
  elevation: { id: 'Mars_MGS_MOLA_ClrShade_merge_global_463m', maxNativeZoom: 7 },
};

// Extra-sharp close-up maps of Jezero Crater (where Perseverance drives).
// They only cover a small area, so we tell Leaflet the exact bounds.
// Grey-scale PNG tiles with see-through edges, also from NASA Mars Trek.
const JEZERO_DETAIL_LAYERS = [
  { // CTX camera, ~6 m per pixel
    id: 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0',
    minZoom: 9, maxNativeZoom: 13,
    bounds: [[18.2110274, 77.1604655], [18.7211945, 77.6991776]],
  },
  { // HiRISE camera, ~25 cm per pixel (you can see single rocks!)
    id: 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd',
    minZoom: 11, maxNativeZoom: 17,
    bounds: [[18.3067994, 77.2229331], [18.669315, 77.583964]],
  },
];

// Perseverance's real driving route (GeoJSON) from NASA's MMGIS server.
// NASA allows browsers to load it from other sites (CORS), so we load it live.
const ROUTE_URL = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json';

// How close the map can zoom in. The global maps get blurry after zoom 7,
// but the Jezero close-up stays sharp up to here.
const MAX_ZOOM = 16;

// The simulated astronaut walks along Perseverance's route.
// Real walking speed is about 1.4 m/s; the demo runs 10x faster.
const WALK_SPEED_M_PER_S = 14;
const WALK_UPDATE_MS = 250;   // how often the dot moves (milliseconds)

// Credits shown in the bottom corner of the map
const ATTRIBUTION =
  'Imagery: <a href="https://trek.nasa.gov/mars/" target="_blank" rel="noopener">NASA Mars Trek</a> ' +
  '(NASA/JPL/USGS) · Route: NASA/JPL-Caltech';


/* ---------------------------------------------------------
   2. PLACES AND LANDING SITES (hardcoded lists)
   Coordinates: latitude (+ = north), longitude (+ = east, −180…180).
   Source: IAU Gazetteer of Planetary Nomenclature / NASA mission pages.
   --------------------------------------------------------- */

const PLACES = [
  { name: 'Olympus Mons',      lat: 18.65,  lon: -133.80, zoom: 6, desc: 'The tallest volcano in the Solar System, about 22 km high.' },
  { name: 'Valles Marineris',  lat: -13.90, lon: -59.20,  zoom: 4, desc: 'A canyon system over 4,000 km long and up to 7 km deep.' },
  { name: 'Jezero Crater',     lat: 18.38,  lon: 77.58,   zoom: 8, desc: 'Ancient lake with a river delta. Perseverance explores here.' },
  { name: 'Gale Crater',       lat: -5.40,  lon: 137.80,  zoom: 7, desc: 'Home of Curiosity and Mount Sharp (Aeolis Mons).' },
  { name: 'Hellas Planitia',   lat: -42.40, lon: 70.50,   zoom: 4, desc: 'Giant impact basin and the lowest place on Mars (about −8 km).' },
  { name: 'Tharsis Montes',    lat: 1.50,   lon: -113.00, zoom: 4, desc: 'A line of three huge volcanoes on the Tharsis bulge.' },
  { name: 'Elysium Mons',      lat: 25.02,  lon: 147.21,  zoom: 6, desc: 'The main volcano of the Elysium volcanic region.' },
  { name: 'Utopia Planitia',   lat: 49.70,  lon: 118.00,  zoom: 4, desc: 'The largest impact basin on Mars; Viking 2 and Zhurong landed here.' },
  { name: 'Meridiani Planum',  lat: 0.20,   lon: -2.50,   zoom: 5, desc: 'Flat plain rich in hematite, explored by Opportunity.' },
  { name: 'Gusev Crater',      lat: -14.50, lon: 175.40,  zoom: 7, desc: 'Possible old lake bed, explored by the Spirit rover.' },
  { name: 'Arsia Mons',        lat: -8.26,  lon: -120.09, zoom: 6, desc: 'Southernmost of the three Tharsis volcanoes.' },
  { name: 'Pavonis Mons',      lat: 1.48,   lon: -112.96, zoom: 6, desc: 'The middle Tharsis volcano, sitting right on the equator.' },
  { name: 'Ascraeus Mons',     lat: 11.92,  lon: -104.08, zoom: 6, desc: 'Northernmost and tallest of the three Tharsis volcanoes.' },
  { name: 'North Polar Cap',   lat: 88.00,  lon: 15.00,   zoom: 3, desc: 'Planum Boreum: layered water ice, about 3 km thick.', aliases: ['planum boreum', 'north pole'] },
  { name: 'South Polar Cap',   lat: -83.90, lon: 160.00,  zoom: 3, desc: 'Planum Australe: water ice topped with frozen carbon dioxide.', aliases: ['planum australe', 'south pole'] },
];

const LANDING_SITES = [
  { name: 'Perseverance', year: 2021, lat: 18.4446,  lon: 77.4509,  desc: 'NASA rover collecting rock samples in Jezero Crater.', aliases: ['mars 2020', 'ingenuity'] },
  { name: 'Curiosity',    year: 2012, lat: -4.5895,  lon: 137.4417, desc: 'NASA rover climbing Mount Sharp inside Gale Crater.', aliases: ['msl'] },
  { name: 'Opportunity',  year: 2004, lat: -1.9462,  lon: -5.5266,  desc: 'NASA rover that drove over 45 km in almost 15 years.', aliases: ['mer-b'] },
  { name: 'Spirit',       year: 2004, lat: -14.5684, lon: 175.4726, desc: 'NASA rover that found signs of ancient hot springs.', aliases: ['mer-a'] },
  { name: 'Viking 1',     year: 1976, lat: 22.27,    lon: -47.95,   desc: 'First successful US lander, in Chryse Planitia.' },
  { name: 'Viking 2',     year: 1976, lat: 47.64,    lon: 134.29,   desc: 'Second Viking lander; saw frost on the ground in winter.' },
  { name: 'Zhurong',      year: 2021, lat: 25.066,   lon: 109.925,  desc: "China's first Mars rover, from the Tianwen-1 mission.", aliases: ['tianwen'] },
  { name: 'InSight',      year: 2018, lat: 4.502,    lon: 135.623,  desc: 'NASA lander that listened for marsquakes.' },
];


/* ---------------------------------------------------------
   3. SMALL HELPERS
   --------------------------------------------------------- */

// Show a friendly message at the top of the screen.
// "id" stops the same message from appearing twice.
// "onRetry" (optional) adds a Retry button.
function showMessage(id, text, { type = 'error', onRetry } = {}) {
  if (document.getElementById('msg-' + id)) return;
  const box = document.createElement('div');
  box.className = 'message ' + type;
  box.id = 'msg-' + id;
  box.innerHTML = '<span class="msg-text"></span>';
  box.querySelector('.msg-text').textContent = text;

  if (onRetry) {
    const retry = document.createElement('button');
    retry.textContent = 'Retry';
    retry.onclick = () => { hideMessage(id); onRetry(); };
    box.appendChild(retry);
  }
  const close = document.createElement('button');
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Close message');
  close.onclick = () => hideMessage(id);
  box.appendChild(close);

  document.getElementById('messages').appendChild(box);
}

function hideMessage(id) {
  const box = document.getElementById('msg-' + id);
  if (box) box.remove();
}

// Make any longitude fit between −180 and 180.
function wrapLon(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

// 18.65 -> "18.650° N"
function formatLat(lat) {
  return Math.abs(lat).toFixed(3) + '° ' + (lat >= 0 ? 'N' : 'S');
}

// NASA usually writes Mars longitude as 0–360° East.
// We show that, plus the −180…180 value in brackets.
// −133.8 -> "226.200° E (−133.800°)"
function formatLon(lon) {
  lon = wrapLon(lon);
  const east = (lon + 360) % 360;
  return east.toFixed(3) + '° E <span class="coords-extra">(' + lon.toFixed(3) + '°)</span>';
}

// Turn text into safe HTML (so place names can't break the page).
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Distance between two [lat, lon] points on Mars, in metres (haversine formula).
function marsDistance(a, b) {
  const toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad;
  const dLon = (b[1] - a[1]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 +
            Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.sqrt(h));
}


/* ---------------------------------------------------------
   4. START THE APP
   If the Leaflet library could not load from the CDN,
   show a message instead of a broken page.
   --------------------------------------------------------- */

if (typeof L === 'undefined') {
  document.body.insertAdjacentHTML('beforeend',
    '<div class="fatal">Could not load the map library.<br>' +
    'Please check your internet connection and reload the page.</div>');
} else {
  startApp();
}

function startApp() {

  /* -------------------------------------------------------
     4a. MARS COORDINATE SYSTEM (CRS)
     Google Maps uses "Web Mercator". NASA Mars Trek tiles use a
     simple latitude/longitude grid instead (equirectangular):
     at zoom 0 the whole planet is 2 tiles wide and 1 tile tall,
     starting at the top-left corner (−180°, +90°).
     Leaflet's built-in EPSG:4326 system works exactly like that.
     We copy it and only change the planet radius to Mars,
     so the scale bar shows correct distances.
     ------------------------------------------------------- */
  const MarsCRS = L.extend({}, L.CRS.EPSG4326, { R: MARS_RADIUS_M });

  const WORLD_BOUNDS = L.latLngBounds([[-90, -180], [90, 180]]);

  /* -------------------------------------------------------
     4b. CREATE THE MAP
     ------------------------------------------------------- */
  const map = L.map('map', {
    crs: MarsCRS,
    minZoom: 0,
    maxZoom: MAX_ZOOM,
    maxBounds: WORLD_BOUNDS,     // don't let people drag off the planet
    maxBoundsViscosity: 1.0,
    zoomControl: false,          // we add it ourselves in the bottom-right
    worldCopyJump: false,
  });

  // Start by showing the whole planet
  map.fitBounds(WORLD_BOUNDS);

  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false }).addTo(map);

  // Move our HTML panels (from index.html) into the map corners.
  // Leaflet "controls" stay put while the map moves.
  function addPanel(elementId, position) {
    const element = document.getElementById(elementId);
    const Panel = L.Control.extend({ onAdd: () => element });
    new Panel({ position }).addTo(map);
    // Stop clicks/scrolls on the panel from moving the map underneath
    L.DomEvent.disableClickPropagation(element);
    L.DomEvent.disableScrollPropagation(element);
  }
  addPanel('main-panel', 'topleft');
  addPanel('coords-panel', 'bottomleft');
  addPanel('me-panel', 'bottomright');   // added after zoom, so it sits above it

  /* -------------------------------------------------------
     4c. BASE MAPS (color photo / elevation) + error handling
     ------------------------------------------------------- */
  function makeTrekLayer(layerId, ext, options) {
    const url = TREK_TILE_URL.replace('{layer}', layerId).replace('{ext}', ext);
    return L.tileLayer(url, {
      tileSize: 256,
      noWrap: true,               // the planet is not repeated left/right
      maxZoom: MAX_ZOOM,          // zoom past 7 = Leaflet enlarges the zoom-7 tiles
      attribution: ATTRIBUTION,
      ...options,
    });
  }

  const baseLayers = {
    color:     makeTrekLayer(BASE_LAYERS.color.id, 'jpg',
                 { maxNativeZoom: BASE_LAYERS.color.maxNativeZoom, bounds: WORLD_BOUNDS }),
    elevation: makeTrekLayer(BASE_LAYERS.elevation.id, 'jpg',
                 { maxNativeZoom: BASE_LAYERS.elevation.maxNativeZoom, bounds: WORLD_BOUNDS }),
  };

  // Close-up layers for Jezero (shown on top of the color map only)
  const detailLayers = JEZERO_DETAIL_LAYERS.map(d =>
    makeTrekLayer(d.id, 'png', {
      minZoom: d.minZoom,
      maxNativeZoom: d.maxNativeZoom,
      bounds: d.bounds,
      attribution: '',
    })
  );

  // Count good and failed tiles. If tiles keep failing, tell the user
  // instead of leaving them with an empty black map.
  Object.values(baseLayers).forEach(layer => {
    let loaded = 0;
    let failed = 0;
    layer.on('tileload', () => {
      loaded++;
      hideMessage('tiles');
    });
    layer.on('tileerror', () => {
      failed++;
      if (failed >= 3 && failed > loaded) {
        showMessage('tiles',
          "Can't load the Mars map from NASA right now. Check your internet connection, " +
          'or NASA’s server may be busy. Try again in a minute.',
          { onRetry: () => { loaded = 0; failed = 0; layer.redraw(); } });
      }
    });
  });

  // Switch between "color" and "elevation"
  let currentBase = null;
  function setBaseLayer(name) {
    if (currentBase) map.removeLayer(currentBase);
    currentBase = baseLayers[name];
    currentBase.addTo(map);
    currentBase.bringToBack();

    // The grey-scale Jezero close-up would hide the elevation colors,
    // so we only show it on the color photo map.
    detailLayers.forEach(layer => {
      if (name === 'color') layer.addTo(map);
      else map.removeLayer(layer);
    });

    // Update the buttons and the legend
    document.querySelectorAll('.layer-switch button').forEach(btn => {
      const active = btn.dataset.layer === name;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', active);
    });
    document.getElementById('elevation-legend').hidden = (name !== 'elevation');
  }

  document.querySelectorAll('.layer-switch button').forEach(btn => {
    btn.addEventListener('click', () => setBaseLayer(btn.dataset.layer));
  });
  setBaseLayer('color');

  /* -------------------------------------------------------
     4d. COORDINATES BOX
     Shows where the mouse is. On phones (no mouse) it shows
     the point you tapped, or the centre of the map.
     ------------------------------------------------------- */
  const coordsTitle = document.getElementById('coords-title');
  const coordsLat = document.getElementById('coords-lat');
  const coordsLon = document.getElementById('coords-lon');

  function showCoords(latlng, title) {
    // Ignore points off the planet (the starry background around the map)
    if (Math.abs(latlng.lat) > 90 || Math.abs(latlng.lng) > 180) {
      coordsTitle.textContent = 'Off the map';
      coordsLat.textContent = '–';
      coordsLon.textContent = '–';
      return;
    }
    coordsTitle.textContent = title;
    coordsLat.textContent = formatLat(latlng.lat);
    coordsLon.innerHTML = formatLon(latlng.lng);
  }

  let pointerUsed = false;   // becomes true once the user moves the mouse or taps
  map.on('mousemove', e => { pointerUsed = true; showCoords(e.latlng, 'Cursor'); });
  map.on('click', e => { pointerUsed = true; showCoords(e.latlng, 'Tapped point'); });
  map.on('moveend', () => {
    // Until the mouse is used (or on touch screens), show the map centre
    const hasMouse = window.matchMedia('(hover: hover)').matches;
    if (!pointerUsed || !hasMouse) showCoords(map.getCenter(), 'Map centre');
  });
  showCoords(map.getCenter(), 'Map centre');

  /* -------------------------------------------------------
     4e. LANDING SITE MARKERS
     ------------------------------------------------------- */
  const siteIcon = L.divIcon({ className: '', html: '<div class="site-icon"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });
  const siteMarkers = {};   // name -> marker, so search can open the popup

  LANDING_SITES.forEach(site => {
    const marker = L.marker([site.lat, site.lon], { icon: siteIcon, title: site.name, riseOnHover: true })
      .bindPopup(
        '<h3>' + escapeHtml(site.name) + '</h3>' +
        '<div class="meta">Landed ' + site.year + '</div>' +
        '<p>' + escapeHtml(site.desc) + '</p>' +
        '<div class="muted">' + formatLat(site.lat) + ', ' + formatLon(site.lon) + '</div>'
      )
      .bindTooltip(site.name, { direction: 'top', offset: [0, -8] })
      .addTo(map);
    siteMarkers[site.name] = marker;
  });

  /* -------------------------------------------------------
     4f. SEARCH BOX
     Type a name -> pick a result -> the map flies there.
     ------------------------------------------------------- */
  const input = document.getElementById('search-input');
  const resultsList = document.getElementById('search-results');

  // One list with everything you can search for
  const searchItems = [
    ...PLACES.map(p => ({ ...p, type: 'Place' })),
    ...LANDING_SITES.map(s => ({ ...s, type: 'Landing site', zoom: s.name === 'Perseverance' ? 12 : 9 })),
  ];

  // "Olympus Mons" -> "olympusmons" (so spaces and capitals don't matter)
  const simplify = text => text.toLowerCase().replace(/[^a-z0-9]/g, '');

  let currentResults = [];
  let activeIndex = -1;

  function findMatches(query) {
    const q = simplify(query);
    if (!q) return searchItems;                     // empty box: show everything
    const scored = [];
    searchItems.forEach(item => {
      const names = [item.name, ...(item.aliases || [])].map(simplify);
      if (names.some(n => n.startsWith(q))) scored.push({ item, score: 0 });   // best: starts with
      else if (names.some(n => n.includes(q))) scored.push({ item, score: 1 }); // ok: contains
    });
    return scored.sort((a, b) => a.score - b.score).map(s => s.item);
  }

  function renderResults() {
    resultsList.innerHTML = '';
    if (currentResults.length === 0) {
      resultsList.innerHTML = '<li class="no-result">No place found. Try “crater” or “mons”.</li>';
    }
    currentResults.forEach((item, i) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.id = 'result-' + i;
      li.className = (i === activeIndex) ? 'active' : '';
      li.innerHTML = '<span>' + escapeHtml(item.name) + '</span><span class="result-type">' + item.type + '</span>';
      // "mousedown" fires before the input loses focus
      li.addEventListener('mousedown', e => { e.preventDefault(); selectResult(item); });
      resultsList.appendChild(li);
    });
    resultsList.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    if (activeIndex >= 0) {
      input.setAttribute('aria-activedescendant', 'result-' + activeIndex);
      document.getElementById('result-' + activeIndex).scrollIntoView({ block: 'nearest' });
    } else {
      input.removeAttribute('aria-activedescendant');
    }
  }

  function closeResults() {
    resultsList.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    activeIndex = -1;
  }

  function updateResults() {
    currentResults = findMatches(input.value);
    activeIndex = input.value.trim() && currentResults.length ? 0 : -1;
    renderResults();
  }

  input.addEventListener('input', updateResults);
  input.addEventListener('focus', updateResults);
  input.addEventListener('blur', closeResults);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (resultsList.hidden) updateResults();
      if (!currentResults.length) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      activeIndex = (activeIndex + step + currentResults.length) % currentResults.length;
      renderResults();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = currentResults[activeIndex >= 0 ? activeIndex : 0];
      if (item) selectResult(item);
    } else if (e.key === 'Escape') {
      closeResults();
      input.blur();
    }
  });

  // A pulsing ring that marks the place you searched for
  const placeIcon = L.divIcon({ className: '', html: '<div class="place-icon" style="width:22px;height:22px"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
  let placeMarker = null;

  function selectResult(item) {
    input.value = item.name;
    closeResults();
    input.blur();               // hides the phone keyboard
    stopFollowing();

    map.flyTo([item.lat, item.lon], item.zoom, { duration: 2 });

    // When the flight ends, open a popup for the place
    map.once('moveend', () => {
      if (placeMarker) map.removeLayer(placeMarker);
      if (item.type === 'Landing site') {
        siteMarkers[item.name].openPopup();
      } else {
        placeMarker = L.marker([item.lat, item.lon], { icon: placeIcon, keyboard: false })
          .bindPopup('<h3>' + escapeHtml(item.name) + '</h3><p>' + escapeHtml(item.desc) + '</p>' +
                     '<div class="muted">' + formatLat(item.lat) + ', ' + formatLon(item.lon) + '</div>')
          .addTo(map)
          .openPopup();
      }
    });
  }

  /* -------------------------------------------------------
     4g. SIMULATED ASTRONAUT ("You are here")
     A blue dot that walks along Perseverance's real route.
     The position is FAKE – it's only for the demo.
     ------------------------------------------------------- */
  const meIcon = L.divIcon({
    className: '',
    html: '<div class="me-marker" style="width:26px;height:26px"><div class="halo"></div><div class="dot"></div></div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });

  // Start at Perseverance's landing site until the route has loaded
  const startPoint = [LANDING_SITES[0].lat, LANDING_SITES[0].lon];
  const meMarker = L.marker(startPoint, { icon: meIcon, zIndexOffset: 1000, title: 'You are here (simulated)' })
    .bindTooltip('You are here <small>(simulated)</small>', {
      permanent: true, direction: 'right', offset: [14, 0], className: 'me-label',
    })
    .bindPopup(() =>
      '<h3>You are here</h3>' +
      '<div class="meta">Simulated position – demo only</div>' +
      '<p>This astronaut is walking along Perseverance’s real route in Jezero Crater ' +
      '(10× walking speed).</p>' +
      '<div class="muted">' + formatLat(meMarker.getLatLng().lat) + ', ' + formatLon(meMarker.getLatLng().lng) +
      (walk.path.length ? '<br>Walked ' + (walk.distance / 1000).toFixed(2) + ' km of ' +
        (walk.total / 1000).toFixed(1) + ' km · near Perseverance’s sol ' + walk.sols[walk.index] + ' drive' : '') +
      '</div>'
    )
    .addTo(map);

  // Everything the walk needs to remember
  const walk = {
    path: [],       // list of [lat, lon] points
    cumDist: [],    // distance from the start to each point (metres)
    sols: [],       // Mars day (sol) of the drive each point belongs to
    total: 0,       // total length of the route (metres)
    distance: 0,    // how far the astronaut has walked so far
    index: 0,       // which path segment we are on
    timer: null,
  };

  // Build one long path from the GeoJSON route
  function buildWalkPath(geojson) {
    let last = null;
    geojson.features.forEach(feature => {
      const g = feature.geometry;
      if (!g) return;
      const lines = g.type === 'LineString' ? [g.coordinates]
                  : g.type === 'MultiLineString' ? g.coordinates : [];
      lines.forEach(line => line.forEach(coord => {
        const point = [coord[1], coord[0]];   // GeoJSON is [lon, lat] – Leaflet wants [lat, lon]
        if (last && point[0] === last[0] && point[1] === last[1]) return; // skip duplicates
        const d = last ? marsDistance(last, point) : 0;
        walk.total += d;
        walk.path.push(point);
        walk.cumDist.push(walk.total);
        walk.sols.push(feature.properties ? feature.properties.sol : '?');
        last = point;
      }));
    });
  }

  // Move the dot a little bit along the path
  let lastTick = Date.now();
  function walkStep() {
    const now = Date.now();
    const seconds = Math.min((now - lastTick) / 1000, 1);   // max 1 s (if the tab was hidden)
    lastTick = now;

    walk.distance += WALK_SPEED_M_PER_S * seconds;
    if (walk.distance >= walk.total) {                      // end of route: start again
      walk.distance = 0;
      walk.index = 0;
    }
    // Find the segment we are on (the path only goes forward)
    while (walk.index < walk.path.length - 2 && walk.cumDist[walk.index + 1] < walk.distance) {
      walk.index++;
    }
    // Position between point A and point B of that segment
    const a = walk.path[walk.index];
    const b = walk.path[walk.index + 1];
    const segLength = walk.cumDist[walk.index + 1] - walk.cumDist[walk.index];
    const t = segLength > 0 ? (walk.distance - walk.cumDist[walk.index]) / segLength : 0;
    const position = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

    meMarker.setLatLng(position);
    if (following && !flying) map.panTo(position, { animate: false });
  }

  function startWalking() {
    if (walk.path.length < 2) return;
    lastTick = Date.now();
    walk.timer = setInterval(walkStep, WALK_UPDATE_MS);
  }

  /* -------------------------------------------------------
     4h. "CENTER ON ME" BUTTON
     Click: fly to the astronaut and keep following it.
     Dragging the map stops following.
     ------------------------------------------------------- */
  const centerBtn = document.getElementById('center-me');
  let following = false;
  let flying = false;

  function stopFollowing() {
    following = false;
    centerBtn.setAttribute('aria-pressed', 'false');
  }

  centerBtn.addEventListener('click', () => {
    following = true;
    centerBtn.setAttribute('aria-pressed', 'true');
    flying = true;
    map.flyTo(meMarker.getLatLng(), Math.max(map.getZoom(), 14), { duration: 2.5 });
    map.once('moveend', () => { flying = false; });
  });
  map.on('dragstart', stopFollowing);

  /* -------------------------------------------------------
     4i. LOAD PERSEVERANCE'S ROUTE (live from NASA)
     ------------------------------------------------------- */
  let routeLayer = null;

  function loadRoute() {
    // Give up after 30 seconds so the user isn't left waiting forever
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    fetch(ROUTE_URL, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.json();
      })
      .then(geojson => {
        clearTimeout(timeout);
        hideMessage('route');

        // Draw the route as an orange line. Click a part to see its sol.
        routeLayer = L.geoJSON(geojson, {
          style: { color: '#ffb347', weight: 3, opacity: 0.95 },
        }).bindPopup(layer => {
          const p = layer.feature.properties || {};
          return '<h3>Perseverance drive</h3>' +
                 '<div class="meta">Sol ' + p.sol + '</div>' +
                 '<p>Length: ' + (p.length != null ? Number(p.length).toFixed(1) + ' m' : 'unknown') + '</p>' +
                 '<div class="muted">A sol is one Mars day (24 h 39 min).</div>';
        }).addTo(map);

        // Let the astronaut walk along it
        buildWalkPath(geojson);
        startWalking();
      })
      .catch(error => {
        clearTimeout(timeout);
        console.warn('Route failed to load:', error);
        showMessage('route',
          'Couldn’t load Perseverance’s route from NASA. The rest of the map still works; ' +
          'the astronaut will stay at the landing site.',
          { onRetry: loadRoute });
      });
  }
  loadRoute();

  // Handy for debugging in the browser console: type "marsMap"
  window.marsMap = map;
}
