'use client';

// The engine's terrain as a point cloud: every point is one height sample of the same blended terrain
// (HiRISE 1 m, CTX 20 m, MOLA-HRSC 200 m) the locate engine renders horizons from. The data is written by
// backend/scripts/export_pointcloud.py into public/pointcloud/ (int16 height grids, see pointcloud.json).

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import css from './pointcloud.module.css';

const KM = 1 / 1000; // scene units are kilometres
const R_MARS = 3_396_190;

type ViewId = 'crater' | 'landing';
type ViewMeta = {
  title: string; file: string; rows: number; cols: number; x0_m: number; y0_m: number; step_m: number;
  scale_m: number; nodata: number; min_m: number; max_m: number; points: number;
};
type Index = { landing_height_m: number; landing: { lat: number; lon: number }; views: Record<ViewId, ViewMeta> };
type Place = { name: string; lat: number; lon: number; base: boolean };
type Label = { el: HTMLDivElement; pos: THREE.Vector3 };

const RAMP: [number, number, number, number][] = [
  [0.0, 40, 22, 30], [0.3, 120, 52, 34], [0.55, 196, 110, 60], [0.8, 230, 176, 120], [1.0, 250, 235, 210],
];

function ramp(t: number, out: Float32Array, k: number) {
  const v = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < RAMP.length - 2 && v > RAMP[i + 1][0]) i++;
  const [a, b] = [RAMP[i], RAMP[i + 1]];
  const f = (v - a[0]) / (b[0] - a[0]);
  for (let c = 0; c < 3; c++) out[k + c] = (a[c + 1] + (b[c + 1] - a[c + 1]) * f) / 255;
}

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'crater', label: 'Whole crater' },
  { id: 'landing', label: 'Landing site' },
];
const EXAGGERATIONS = [1, 2, 4];

export default function PointCloudScreen() {
  const host = useRef<HTMLDivElement>(null);
  const labels = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewId>('crater');
  const [exag, setExag] = useState(2);
  const [showCandidates, setShowCandidates] = useState(false);
  const [index, setIndex] = useState<Index | null>(null);
  const [status, setStatus] = useState('Loading the point cloud…');
  const api = useRef<{ setExag: (e: number) => void; setCandidates: (on: boolean) => void } | null>(null);

  useEffect(() => {
    fetch('/pointcloud/pointcloud.json')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(setIndex)
      .catch(e => setStatus(`Could not load the point cloud (${e.message}).`));
  }, []);

  useEffect(() => {
    const mount = host.current, labelHost = labels.current;
    if (!index || !mount || !labelHost) return;
    const meta = index.views[view];
    let disposed = false;
    let frame = 0;
    setStatus(`Loading ${meta.points.toLocaleString('en')} points…`);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
    } catch {
      setStatus('This browser has no WebGL, so the point cloud cannot be shown.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor('#0a0a0b');
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.4;
    controls.maxPolarAngle = Math.PI * 0.49;
    const stopSpin = () => { controls.autoRotate = false; };
    renderer.domElement.addEventListener('pointerdown', stopSpin);
    renderer.domElement.addEventListener('wheel', stopSpin, { passive: true });

    const size = () => {
      const w = mount.clientWidth, h = mount.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    const resize = new ResizeObserver(size);
    resize.observe(mount);
    size();

    let heights: Int16Array | null = null;
    let points: THREE.Points | null = null;
    let candidates: THREE.Points | null = null;
    let candidateGround: Float32Array | null = null;
    let currentExag = exag;
    const labelEls: Label[] = [];

    const heightAt = (x_m: number, y_m: number) => {
      if (!heights) return 0;
      const c = Math.round((x_m - meta.x0_m) / meta.step_m);
      const r = Math.round((meta.y0_m - y_m) / meta.step_m);
      if (r < 0 || c < 0 || r >= meta.rows || c >= meta.cols) return NaN;
      const v = heights[r * meta.cols + c];
      return v === meta.nodata ? NaN : v * meta.scale_m;
    };
    const local = (lat: number, lon: number) => ({
      x: (lon - index.landing.lon) * (Math.PI / 180) * R_MARS * Math.cos(index.landing.lat * Math.PI / 180),
      y: (lat - index.landing.lat) * (Math.PI / 180) * R_MARS,
    });

    const applyExag = (e: number) => {
      currentExag = e;
      if (points && heights) {
        const pos = points.geometry.getAttribute('position') as THREE.BufferAttribute;
        const arr = pos.array as Float32Array;
        for (let k = 0, i = 0; i < heights.length; i++) {
          if (heights[i] === meta.nodata) continue;
          arr[k * 3 + 1] = heights[i] * meta.scale_m * KM * e;
          k++;
        }
        pos.needsUpdate = true;
        points.geometry.computeBoundingSphere();
      }
      if (candidates && candidateGround) {
        const pos = candidates.geometry.getAttribute('position') as THREE.BufferAttribute;
        const arr = pos.array as Float32Array;
        for (let i = 0; i < candidateGround.length; i++) arr[i * 3 + 1] = (candidateGround[i] * e + 25) * KM;
        pos.needsUpdate = true;
      }
      for (const l of labelEls) l.pos.y = (Number(l.el.dataset.h) * e + 15) * KM;
    };

    api.current = {
      setExag: applyExag,
      setCandidates: on => { if (candidates) candidates.visible = on; },
    };

    (async () => {
      const [buf, places] = await Promise.all([
        fetch(`/pointcloud/${meta.file}`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }),
        fetch('/data/places.geojson').then(r => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (disposed) return;
      heights = new Int16Array(buf, 0, meta.rows * meta.cols);

      // ---- the terrain points
      const pos = new Float32Array(meta.points * 3);
      const col = new Float32Array(meta.points * 3);
      const span = meta.max_m - meta.min_m || 1;
      let k = 0;
      for (let r = 0; r < meta.rows; r++) {
        for (let c = 0; c < meta.cols; c++) {
          const v = heights[r * meta.cols + c];
          if (v === meta.nodata) continue;
          const h = v * meta.scale_m;
          pos[k * 3] = (meta.x0_m + c * meta.step_m) * KM;
          pos[k * 3 + 1] = h * KM * currentExag;
          pos[k * 3 + 2] = -(meta.y0_m - r * meta.step_m) * KM;
          ramp((h - meta.min_m) / span, col, k * 3);
          k++;
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      points = new THREE.Points(geo, new THREE.PointsMaterial({
        size: meta.step_m * KM * 0.75, vertexColors: true, sizeAttenuation: true,
      }));
      scene.add(points);

      // ---- the engine's 22,801 candidate spots (200 m grid over the CTX extent), crater view only
      if (view === 'crater') {
        const n = 151; // 151 × 151 = 22,801
        const xW = meta.x0_m, xE = meta.x0_m + (meta.cols - 1) * meta.step_m;
        const yN = meta.y0_m, yS = meta.y0_m - (meta.rows - 1) * meta.step_m;
        const cp: number[] = [];
        const ground: number[] = [];
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            const x = xW + (j / (n - 1)) * (xE - xW), y = yN - (i / (n - 1)) * (yN - yS);
            const h = heightAt(x, y);
            if (Number.isNaN(h)) continue;
            cp.push(x * KM, (h * currentExag + 25) * KM, -y * KM);
            ground.push(h);
          }
        }
        candidateGround = new Float32Array(ground);
        const cg = new THREE.BufferGeometry();
        cg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cp), 3));
        candidates = new THREE.Points(cg, new THREE.PointsMaterial({
          size: 2.5, sizeAttenuation: false, color: '#5be3ff', transparent: true, opacity: 0.45, depthWrite: false,
        }));
        candidates.visible = showCandidates;
        scene.add(candidates);
      }

      // ---- the landing site and mission sites, as labels pinned to the ground
      const list: Place[] = (places?.features ?? []).map((f: { properties: { name: string; type: string }; geometry: { coordinates: [number, number] } }) => ({
        name: f.properties.name, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], base: f.properties.type === 'base',
      }));
      if (!list.some(p => p.base)) list.push({ name: 'Perseverance landing site', lat: index.landing.lat, lon: index.landing.lon, base: true });
      for (const p of list) {
        const { x, y } = local(p.lat, p.lon);
        const h = heightAt(x, y);
        if (Number.isNaN(h)) continue;
        const el = document.createElement('div');
        el.className = p.base ? `${css.label} ${css.base}` : css.label;
        el.textContent = p.base ? 'LANDING SITE' : p.name.toUpperCase();
        el.dataset.h = String(h);
        labelHost.appendChild(el);
        labelEls.push({ el, pos: new THREE.Vector3(x * KM, (h * currentExag + 15) * KM, -y * KM) });
      }

      // ---- frame the view: looking north-west across the cloud from the south-east
      const w = meta.cols * meta.step_m * KM, d = meta.rows * meta.step_m * KM;
      const cx = (meta.x0_m * KM) + w / 2, cz = -(meta.y0_m * KM) + d / 2;
      const reach = Math.max(w, d);
      controls.target.set(cx, 0, cz);
      camera.position.set(cx + reach * 0.45, reach * 0.55, cz + reach * 0.75);
      camera.near = reach / 2000;
      camera.far = reach * 10;
      camera.updateProjectionMatrix();
      controls.update();
      setStatus('');
    })().catch(e => { if (!disposed) setStatus(`Could not load the point cloud (${e.message}).`); });

    const v = new THREE.Vector3();
    const tick = () => {
      frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
      const w = mount.clientWidth, h = mount.clientHeight;
      for (const l of labelEls) {
        v.copy(l.pos).project(camera);
        const hidden = v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1;
        l.el.style.display = hidden ? 'none' : '';
        if (!hidden) l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
      }
    };
    tick();

    return () => {
      disposed = true;
      api.current = null;
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      scene.traverse(o => {
        if (o instanceof THREE.Points) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      });
      renderer.dispose();
      renderer.domElement.remove();
      labelEls.forEach(l => l.el.remove());
    };
    // exag and showCandidates are applied live through `api`, not by rebuilding the scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, view]);

  useEffect(() => { api.current?.setExag(exag); }, [exag]);
  useEffect(() => { api.current?.setCandidates(showCandidates); }, [showCandidates]);

  const meta = index?.views[view];

  return (
    <main className={css.page}>
      <div ref={host} className={css.gl} data-testid="pointcloud-canvas" />
      <div ref={labels} className={css.labels} aria-hidden="true" />

      <header className={css.bar}>
        <Link href="/" className={css.logo}>MARS<span>FINDER</span></Link>
        <span className={css.links}>
          <Link href="/map/">Map</Link>
          <Link href="/mission/">Mission</Link>
        </span>
      </header>

      <aside className={css.panel} aria-label="Point cloud">
        <p className={css.kicker}>ENGINE TERRAIN · POINT CLOUD</p>
        <h1 className={css.title}>Jezero in 3D points</h1>
        <p className={css.text}>
          Every dot is one height sample of the terrain our engine uses to render horizons and find you.
        </p>

        <div className={css.group} role="group" aria-label="View">
          {VIEWS.map(o => (
            <button key={o.id} type="button" aria-pressed={view === o.id} onClick={() => setView(o.id)}>{o.label}</button>
          ))}
        </div>
        <div className={css.group} role="group" aria-label="Height exaggeration">
          {EXAGGERATIONS.map(e => (
            <button key={e} type="button" aria-pressed={exag === e} onClick={() => setExag(e)}>{e}× height</button>
          ))}
        </div>
        {view === 'crater' && (
          <label className={css.check}>
            <input type="checkbox" checked={showCandidates} onChange={e => setShowCandidates(e.target.checked)} />
            <span><i className={css.dot} /> 22,801 spots the engine checks</span>
          </label>
        )}

        {meta && (
          <dl className={css.stats}>
            <div><dt>Points</dt><dd>{meta.points.toLocaleString('en')}</dd></div>
            <div><dt>Spacing</dt><dd>{meta.step_m} m</dd></div>
            <div><dt>Height range</dt><dd>{Math.round(meta.max_m - meta.min_m).toLocaleString('en')} m</dd></div>
          </dl>
        )}
        {meta && <p className={css.source}>{meta.title}. Heights are real; drag to rotate, scroll to zoom.</p>}
        {status && <p className={css.status} role="status">{status}</p>}
      </aside>
    </main>
  );
}
