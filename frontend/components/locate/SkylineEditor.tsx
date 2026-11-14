'use client';

import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { columnAt, markRange, movePoint, restoreRange, runs, trustedShare, type Tool } from '@/lib/locate/edit';
import { levelLine, pinhole } from '@/lib/locate/level';
import type { Reason, Trace } from '@/lib/locate/types';
import css from './locate.module.css';

type Props = {
  url: string;
  name: string;
  trace: Trace | null;
  original: Trace | null;
  /** Where level is, for a pinhole camera: drawn as a guide while the user levels by hand. */
  guide: { hfovDeg: number; pitchDeg: number; rollDeg: number } | null;
  canUndo: boolean;
  onEdit: (t: Trace) => void;
  onUndo: () => void;
  onReset: () => void;
};

const TOOLS: { id: Tool; label: string; hint: string }[] = [
  { id: 'move', label: 'MOVE', hint: 'Drag the line to where the sky really ends.' },
  { id: 'erase', label: 'ERASE', hint: 'Drag across a stretch the engine should ignore.' },
  { id: 'rock', label: 'ROCK', hint: 'Drag across a nearby rock or object that only looks like a hill.' },
  { id: 'restore', label: 'RESTORE', hint: 'Drag across a stretch to put it back as first traced.' },
];

export const REASON_TEXT: Record<Reason, string> = {
  near: 'Near object: looks like a hill but is close to the camera',
  haze: 'Faint: the far terrain fades into the sky here',
  jitter: 'Unsteady: the line jumps between two levels',
  edge: 'Photo border or dark lens corner',
  top: 'Touches the top: the real skyline is not in the photo',
  glare: 'Glare: blown-out sky hides the edge',
  erased: 'Erased by you',
  rock: 'Marked by you as a nearby rock',
};

const MOVE_RADIUS = 0.015; // fraction of the columns that follow a drag

type Drag = { tool: Tool; from: number; to: number; preview: Trace | null } | null;

/** The photo with its traced skyline on top: green trusted, amber doubtful, magenta not used. */
export function SkylineEditor({ url, name, trace, original, guide, canUndo, onEdit, onUndo, onReset }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tool, setTool] = useState<Tool>('move');
  const [drag, setDrag] = useState<Drag>(null);
  const [hover, setHover] = useState<number | null>(null);

  const shown = drag?.preview ?? trace;

  const toPhoto = (e: PointerEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!trace || e.button > 0) return;
    const p = toPhoto(e);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const i = columnAt(trace, p.x);
    const radius = MOVE_RADIUS * trace.x.length;
    setDrag({ tool, from: i, to: i, preview: tool === 'move' ? movePoint(trace, i, p.y, radius) : null });
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!trace) return;
    const p = toPhoto(e);
    if (!p) return;
    const i = columnAt(trace, p.x);
    setHover(i);
    if (!drag) return;
    if (drag.tool === 'move') {
      // Each move step reshapes from the trace as it was when the drag began, around the current column.
      const base = drag.preview ?? trace;
      setDrag({ ...drag, to: i, preview: movePoint(base, i, p.y, MOVE_RADIUS * trace.x.length) });
    } else {
      setDrag({ ...drag, to: i });
    }
  };

  const onUp = () => {
    if (!drag || !trace || !original) return setDrag(null);
    const { tool: t, from, to, preview } = drag;
    setDrag(null);
    if (t === 'move' && preview) onEdit(preview);
    if (t === 'erase') onEdit(markRange(trace, from, to, 'erased'));
    if (t === 'rock') onEdit(markRange(trace, from, to, 'rock'));
    if (t === 'restore') onEdit(restoreRange(trace, original, from, to));
  };

  const segments = useMemo(() => {
    if (!shown) return [];
    const tone = (w: number) => (w >= 0.5 ? 'trusted' : w > 0 ? 'doubtful' : 'unused');
    const out: { tone: string; points: string }[] = [];
    for (const t of ['trusted', 'doubtful', 'unused']) {
      for (const [a, b] of runs(shown, k => tone(shown.weight[k]) === t)) {
        // Include the neighbour on each side so runs join up.
        const from = Math.max(0, a - 1);
        const to = Math.min(shown.x.length - 1, b + 1);
        const pts: string[] = [];
        for (let k = from; k <= to; k++) pts.push(`${shown.x[k].toFixed(1)},${shown.y[k].toFixed(1)}`);
        out.push({ tone: t, points: pts.join(' ') });
      }
    }
    return out;
  }, [shown]);

  const guidePts = useMemo(() => {
    if (!guide || !trace) return null;
    const pts = levelLine(pinhole(trace.width, trace.height, guide.hfovDeg), guide.pitchDeg, guide.rollDeg);
    return pts.length > 1 ? pts.map(([u, v]) => `${u.toFixed(1)},${v.toFixed(1)}`).join(' ') : null;
  }, [guide, trace]);

  const band = drag && drag.tool !== 'move' && trace
    ? { x0: trace.x[Math.min(drag.from, drag.to)], x1: trace.x[Math.max(drag.from, drag.to)] }
    : null;
  const stroke = trace ? Math.max(2, trace.width / 320) : 2;
  const hoverReason = hover !== null && shown ? shown.reason[hover] : null;

  return (
    <section className={css.editor} aria-label="Skyline editor">
      <div className={css.tools} role="toolbar" aria-label="Edit tools">
        {TOOLS.map(t => (
          <button key={t.id} type="button" className={css.tool} aria-pressed={tool === t.id} title={t.hint}
            data-testid={`tool-${t.id}`} onClick={() => setTool(t.id)} disabled={!trace}>
            {t.label}
          </button>
        ))}
        <span className={css.toolGap} />
        <button type="button" className={css.tool} onClick={onUndo} disabled={!canUndo} data-testid="tool-undo">UNDO</button>
        <button type="button" className={css.tool} onClick={onReset} disabled={!trace} data-testid="tool-reset">RESET</button>
      </div>
      <p className={css.toolHint}>{TOOLS.find(t => t.id === tool)?.hint}</p>

      <div className={css.photoFrame}>
        <div className={css.photoBox} style={trace ? ({ '--ar': trace.width / trace.height } as CSSProperties) : undefined}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL; nothing to optimise */}
          <img src={url} alt={name} className={css.photo} draggable={false} />
          {trace && (
            <svg
              ref={svgRef}
              className={css.overlay}
              viewBox={`0 0 ${trace.width} ${trace.height}`}
              preserveAspectRatio="none"
              data-testid="skyline-overlay"
              data-tool={tool}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={() => setDrag(null)}
              onPointerLeave={() => setHover(null)}
            >
              {guidePts && (
                <polyline points={guidePts} className={css.guide} strokeWidth={stroke * 0.6} />
              )}
              {band && <rect x={band.x0} y={0} width={Math.max(1, band.x1 - band.x0)} height={trace.height} className={css[`band-${drag!.tool}`]} />}
              {segments.map((s, k) => (
                <polyline key={k} points={s.points} className={css[`line-${s.tone}`]} strokeWidth={stroke} />
              ))}
              {trace.sun_px && <circle cx={trace.sun_px[0]} cy={trace.sun_px[1]} r={stroke * 5} className={css.sun} strokeWidth={stroke} />}
            </svg>
          )}
        </div>
      </div>

      <div className={css.legend} aria-live="polite">
        <span><i className={css.swTrusted} /> USED</span>
        <span><i className={css.swDoubtful} /> DOUBTFUL</span>
        <span><i className={css.swUnused} /> NOT USED</span>
        {guidePts && <span><i className={css.swGuide} /> LEVEL</span>}
        <span className={css.legendNote}>
          {hoverReason ? REASON_TEXT[hoverReason] : shown ? `${Math.round(trustedShare(shown) * 100)} % of the line used` : ''}
        </span>
      </div>
    </section>
  );
}
