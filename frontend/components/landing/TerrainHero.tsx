'use client';

// The landing page's 3D flyover of Jezero Crater: real heights (the data team's 40 m elevation grid from the
// MRO CTX DEM) under real imagery (NASA Mars Trek CTX tiles), with the skyline traced live from the render
// and a "you are here" pin on the Perseverance landing site.

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import css from './terrainHero.module.css';

const R_MARS = 3_396_190; // m, Mars 2000 sphere
const LAND = { lat: 18.4447, lon: 77.4508 }; // Perseverance landing site
const EXAGGERATE = 2.6; // vertical exaggeration, so the relief reads from far away
const KM = 1 / 1000; // scene units are kilometres

// NASA Mars Trek CTX mosaic, zoom 11: a 6 × 6 block of 256 px tiles that covers the elevation grid.
const TILE_URL = 'https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0//default/default028mm/11';
const TILE_DEG = 180 / 2 ** 11;
const TX0 = 2926, TY0 = 811, TN = 6;
const TEX = { lonW: TX0 * TILE_DEG - 180, lonE: (TX0 + TN) * TILE_DEG - 180, latN: 90 - TY0 * TILE_DEG, latS: 90 - (TY0 + TN) * TILE_DEG };

type Grid = { rows: number; cols: number; bounds: [[number, number], [number, number]]; scale: number; nodata: number; data: Int16Array };

async function loadGrid(): Promise<Grid> {
  const get = async (url: string) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res;
  };
  const meta = await (await get('/data/elevation_grid.json')).json();
  const buf = await (await get(`/data/${meta.data_file}`)).arrayBuffer();
  const n = meta.rows * meta.cols;
  return { rows: meta.rows, cols: meta.cols, bounds: meta.bounds, scale: meta.scale, nodata: meta.nodata, data: new Int16Array(buf, 0, n) };
}

/**
 * The surface image: starts as plain Mars-coloured ground so the terrain shows at once, then each NASA CTX
 * tile is painted in (and warmed to Mars colours, the tiles are greyscale) as it arrives. A slow or blocked
 * NASA server only means less detail, never an empty page.
 */
function startTexture(onTile: () => void): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TN * 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#a8623c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < TN * TN; i++) {
    const x = i % TN, y = Math.floor(i / TN);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(img, x * 256, y * 256);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = '#e8925c';
      ctx.fillRect(x * 256, y * 256, 256, 256);
      ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = '#ffb37a';
      ctx.fillRect(x * 256, y * 256, 256, 256);
      onTile();
    };
    img.src = `${TILE_URL}/${TY0 + y}/${TX0 + x}.png`;
  }
  return canvas;
}

const toLocal = (lat: number, lon: number) => ({
  x: (lon - LAND.lon) * (Math.PI / 180) * R_MARS * Math.cos(LAND.lat * Math.PI / 180) * KM,
  z: -(lat - LAND.lat) * (Math.PI / 180) * R_MARS * KM,
});

function buildTerrain(grid: Grid, step: number) {
  const [[latS, lonW], [latN, lonE]] = grid.bounds;
  const rows = Math.floor((grid.rows - 1) / step) + 1;
  const cols = Math.floor((grid.cols - 1) / step) + 1;
  const pos = new Float32Array(rows * cols * 3);
  const uv = new Float32Array(rows * cols * 2);
  const at = (r: number, c: number) => grid.data[r * grid.cols + c];
  // Heights relative to the landing site, so the scene's ground sits near y = 0.
  const lr = Math.round(((latN - LAND.lat) / (latN - latS)) * (grid.rows - 1));
  const lc = Math.round(((LAND.lon - lonW) / (lonE - lonW)) * (grid.cols - 1));
  const base = at(lr, lc) * grid.scale;
  const heights = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const gr = r * step, gc = c * step;
      const lat = latN - (gr / (grid.rows - 1)) * (latN - latS);
      const lon = lonW + (gc / (grid.cols - 1)) * (lonE - lonW);
      const raw = at(gr, gc);
      const h = raw === grid.nodata ? 0 : (raw * grid.scale - base) * KM * EXAGGERATE;
      const p = toLocal(lat, lon);
      const k = r * cols + c;
      pos.set([p.x, h, p.z], k * 3);
      heights[k] = h;
      uv.set([(lon - TEX.lonW) / (TEX.lonE - TEX.lonW), (lat - TEX.latS) / (TEX.latN - TEX.latS)], k * 2);
    }
  }
  const index: number[] = [];
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
      index.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const sw = toLocal(latS, lonW), ne = toLocal(latN, lonE);
  /** Ground height under a point, for keeping the camera above the land. */
  const heightAt = (x: number, z: number) => {
    const c = Math.round(((x - sw.x) / (ne.x - sw.x)) * (cols - 1));
    const r = Math.round(((z - ne.z) / (sw.z - ne.z)) * (rows - 1));
    if (r < 0 || c < 0 || r >= rows || c >= cols) return 0;
    return heights[r * cols + c];
  };
  return { geo, heightAt, landY: 0 };
}

export default function TerrainHero() {
  const mount = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const pin = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = mount.current, sky = overlay.current, pinEl = pin.current;
    if (!host || !sky || !pinEl) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
      setFailed(true);
      return;
    }
    let disposed = false;
    let frame = 0;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const fogColor = new THREE.Color('#b9744f');
    scene.fog = new THREE.Fog(fogColor, 6, 34);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 80);
    scene.add(new THREE.HemisphereLight('#ffd9b8', '#3a1d12', 1.1));
    const sun = new THREE.DirectionalLight('#ffe2c4', 2.2);
    sun.position.set(-8, 4, -3); // low western sun: long, dramatic relief
    scene.add(sun);

    // Skyline tracing: a tiny render of land (white) against sky (black), read back every few frames.
    const TW = 240, TH = 135;
    const target = new THREE.WebGLRenderTarget(TW, TH);
    const white = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    const pixels = new Uint8Array(TW * TH * 4);
    let skyline: Float32Array | null = null; // per traced column: height from the top, 0..1, or -1

    const ctx2d = sky.getContext('2d')!;
    let width = 1, height = 1;
    const resize = () => {
      width = host.clientWidth; height = host.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      const dpr = Math.min(window.devicePixelRatio, 2);
      sky.width = width * dpr; sky.height = height * dpr;
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    let visible = true;
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; });
    io.observe(host);

    (async () => {
      const grid = await loadGrid();
      if (disposed) return;
      const { geo, heightAt } = buildTerrain(grid, 2);
      // eslint-disable-next-line prefer-const
      let tex: THREE.CanvasTexture;
      const texCanvas = startTexture(() => { if (tex) tex.needsUpdate = true; });
      tex = new THREE.CanvasTexture(texCanvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      const terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
      scene.add(terrain);

      const landPos = new THREE.Vector3(0, heightAt(0, 0) + 0.02, 0);
      const focus = toLocal(18.47, 77.40); // the delta front, west of the landing site
      const look = new THREE.Vector3();
      const v = new THREE.Vector3();
      const start = performance.now();

      const traceSkyline = () => {
        scene.overrideMaterial = white;
        const fog = scene.fog;
        scene.fog = null;
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 1);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, TW, TH, pixels);
        renderer.setRenderTarget(null);
        renderer.setClearColor(0x000000, 0);
        scene.overrideMaterial = null;
        scene.fog = fog;
        const next = new Float32Array(TW).fill(-1);
        for (let x = 0; x < TW; x++) {
          for (let row = TH - 1; row >= 0; row--) { // pixel rows start at the bottom: scan from the top down
            if (pixels[(row * TW + x) * 4] > 128) { next[x] = (TH - 1 - row) / (TH - 1); break; }
          }
        }
        // Ease towards the new line so it glides instead of jumping.
        if (!skyline) skyline = next;
        else for (let x = 0; x < TW; x++) skyline[x] = next[x] < 0 ? -1 : skyline[x] < 0 ? next[x] : skyline[x] + (next[x] - skyline[x]) * 0.5;
      };

      const drawSkyline = (t: number) => {
        ctx2d.clearRect(0, 0, width, height);
        if (!skyline) return;
        // The line draws itself left to right once, then stays and breathes.
        const reveal = reduce ? 1 : Math.min(1, Math.max(0, (t - 1.2) / 2.2));
        const last = Math.floor(reveal * (TW - 1));
        ctx2d.save();
        ctx2d.lineJoin = 'round';
        ctx2d.lineCap = 'round';
        for (const [w, a] of [[10, 0.12], [4, 0.35], [2, 1]] as const) {
          ctx2d.beginPath();
          let on = false;
          for (let x = 0; x <= last; x++) {
            const s = skyline[x];
            if (s < 0 || s > 0.98) { on = false; continue; }
            const px = (x / (TW - 1)) * width, py = s * height;
            if (on) ctx2d.lineTo(px, py); else { ctx2d.moveTo(px, py); on = true; }
          }
          ctx2d.strokeStyle = `rgba(255, 92, 225, ${a * (0.85 + 0.15 * Math.sin(t * 2))})`;
          ctx2d.lineWidth = w;
          ctx2d.stroke();
        }
        if (reveal < 1 && last > 0 && skyline[last] >= 0) { // the scan head
          const px = (last / (TW - 1)) * width;
          ctx2d.fillStyle = 'rgba(255, 92, 225, 0.25)';
          ctx2d.fillRect(px - 1, 0, 2, height);
        }
        ctx2d.restore();
      };

      const tick = () => {
        if (disposed) return;
        frame = requestAnimationFrame(tick);
        if (!visible) return;
        const t = reduce ? 8 : (performance.now() - start) / 1000;
        // A slow arc around the delta front, low over the crater floor, looking across it to the far horizon.
        const ang = 0.9 + t * 0.018;
        const radius = 7.5;
        v.set(focus.x + Math.cos(ang) * radius, 0, focus.z + Math.sin(ang) * radius);
        v.y = Math.max(heightAt(v.x, v.z) + 0.9, 0.9);
        camera.position.copy(v);
        look.set(focus.x - Math.cos(ang) * 6, 0.35, focus.z - Math.sin(ang) * 6);
        camera.lookAt(look);

        renderer.render(scene, camera);
        if (Math.round(t * 60) % 4 === 0 || !skyline) traceSkyline();
        drawSkyline(t);

        // The pin follows the landing site on screen.
        v.copy(landPos).project(camera);
        const inView = v.z < 1 && Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95;
        pinEl.style.opacity = inView && t > 3.6 ? '1' : '0';
        pinEl.style.transform = `translate(${(v.x * 0.5 + 0.5) * width}px, ${(-v.y * 0.5 + 0.5) * height}px)`;
      };
      setReady(true);
      tick();
    })().catch(e => { console.error('Marsfinder 3D terrain failed:', e); if (!disposed) setFailed(true); });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      io.disconnect();
      target.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return (
    <div className={css.root} data-ready={ready} data-failed={failed} aria-hidden="true">
      <div ref={mount} className={css.gl} />
      <canvas ref={overlay} className={css.skyline} />
      <div ref={pin} className={css.pin}>
        <span className={css.ring} />
        <span className={css.ring} />
        <span className={css.dot} />
        <span className={css.label}>YOU ARE HERE<small>18.4447° N · 77.4508° E</small></span>
      </div>
      <span className={css.tag}>SKYLINE TRACED LIVE</span>
    </div>
  );
}
