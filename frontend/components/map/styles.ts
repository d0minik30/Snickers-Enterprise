import { asArray, type Color } from 'ol/color';
import type { Coordinate } from 'ol/coordinate';
import { Point, Polygon } from 'ol/geom';
import type { State } from 'ol/render';
import { Circle as CircleStyle, Fill, RegularShape, Stroke, Style, Text } from 'ol/style';
import type { MapOverlay } from '@/components/map/overlays';
import { MARS_RADIUS_M, destination } from '@/lib/nav/geo';
import type { LatLon } from '@/lib/planner/types';

/** Colours and the font, read once from the CSS tokens on the page. */
export type MapTheme = {
  surface: string;
  text: string;
  route: string;
  caution: string;
  fontFamily: string;
  hatch: CanvasPattern | string;
};

/** What a style function needs besides the overlay: view resolution (degrees per pixel) and rotation (radians). */
export type StyleContext = { theme: MapTheme; resolution: number; rotation: number };

type Overlay<K extends MapOverlay['kind']> = Extract<MapOverlay, { kind: K }>;

const CIRCLE_SEGMENTS = 48;
const M_PER_DEG = (MARS_RADIUS_M * Math.PI) / 180;
const MIN_ERROR_RING_PX = 14;
const RING_LABEL_SCREEN_BEARING = 300; // up and to the left of the ring centre, whatever the map rotation
const HATCH_TILE_PX = 8;
const CHIP_PADDING = [3, 6, 2, 6]; // top, right, bottom, left

export const toCoord = (p: LatLon): Coordinate => [p.lon, p.lat];

/** A closed ring of real ground radius around a centre, so it stays round in metres at any latitude. */
export function groundCircle(center: LatLon, radiusM: number): Coordinate[] {
  const ring = Array.from({ length: CIRCLE_SEGMENTS }, (_, i) =>
    toCoord(destination(center, (360 * i) / CIRCLE_SEGMENTS, radiusM)));
  return [...ring, ring[0]];
}

function readToken(css: CSSStyleDeclaration, name: string): string {
  return css.getPropertyValue(name).trim();
}

/** 45 degree amber hatch, drawn at device resolution so the lines stay crisp. */
function createHatch(color: string, pixelRatio: number): CanvasPattern | string {
  const size = HATCH_TILE_PX * pixelRatio;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'transparent';
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 1.6 * pixelRatio;
  ctx.beginPath();
  for (const offset of [-size, 0, size]) {
    ctx.moveTo(offset, size);
    ctx.lineTo(offset + size, 0);
  }
  ctx.stroke();
  return ctx.createPattern(canvas, 'repeat') ?? 'transparent';
}

export function readTheme(root: HTMLElement, pixelRatio: number): MapTheme {
  const css = getComputedStyle(root);
  const caution = readToken(css, '--caution');
  return {
    surface: readToken(css, '--surface'),
    text: readToken(css, '--text'),
    route: readToken(css, '--route'),
    caution,
    fontFamily: readToken(css, '--font-barlow') || "'Barlow Condensed', sans-serif",
    hatch: createHatch(caution, pixelRatio),
  };
}

/** Any CSS colour (the build may shorten `#FFFFFF` to `#fff`) with a new alpha. */
function withAlpha(color: string, alpha: number): Color {
  const [r, g, b] = asArray(color);
  return [r, g, b, alpha];
}

function line(color: string | Color, width: number, lineDash?: number[]): Stroke {
  return new Stroke({ color, width, lineDash, lineCap: 'butt', lineJoin: 'miter' });
}

type ChipTone = Overlay<'label'>['tone'];

/** Hard-edged upright text chip: uppercase Barlow Condensed on a solid block. */
function chip(text: string, tone: ChipTone, theme: MapTheme, place: Partial<{ offsetX: number; offsetY: number; geometry: Point }> = {}): Style {
  const inverse = tone === 'inverse';
  const ink = { plain: theme.text, route: theme.route, caution: theme.caution, inverse: theme.surface }[tone];
  return new Style({
    geometry: place.geometry,
    text: new Text({
      text: text.toUpperCase(),
      font: `${inverse ? 700 : 600} 12px ${theme.fontFamily}`,
      fill: new Fill({ color: ink }),
      backgroundFill: new Fill({ color: inverse ? theme.caution : theme.surface }),
      padding: CHIP_PADDING,
      textAlign: place.offsetX ? 'left' : 'center',
      textBaseline: 'middle',
      offsetX: place.offsetX ?? 0,
      offsetY: place.offsetY ?? 0,
    }),
  });
}

export function routeStyle(o: Overlay<'route'>, { theme }: StyleContext): Style[] {
  const white = theme.text;
  switch (o.variant) {
    case 'active':
      return [new Style({ stroke: line('rgba(0, 0, 0, 0.55)', 7) }), new Style({ stroke: line(theme.route, 3) })];
    case 'walked':
      return [new Style({ stroke: line(white, 2, [4, 4]) })];
    case 'alternative':
      return [new Style({ stroke: line('rgba(0, 0, 0, 0.5)', 4.5) }), new Style({ stroke: line(white, 1.8, [6, 5]) })];
    case 'alternative-dotted':
      return [new Style({ stroke: line('rgba(0, 0, 0, 0.5)', 4.5) }), new Style({ stroke: line(white, 1.8, [2, 5]) })];
    case 'pending':
      return [new Style({ stroke: line('rgba(0, 0, 0, 0.5)', 5.5) }), new Style({ stroke: line(theme.route, 2.4, [7, 5]) })];
  }
}

export function hazardStyle(o: Overlay<'hazard'>, { theme }: StyleContext): Style[] {
  return [new Style({
    fill: new Fill({ color: theme.hatch }),
    stroke: o.pending ? line(theme.caution, 2, [5, 3]) : line(theme.caution, 1.5),
  })];
}

export function waypointStyle(o: Overlay<'waypoint'>, { theme }: StyleContext): Style[] {
  const diamond = new RegularShape({
    points: 4,
    radius: 9,
    angle: 0,
    fill: new Fill({ color: theme.surface }),
    stroke: line(theme.route, 2),
  });
  return [new Style({ image: diamond }), chip(o.label, 'route', theme, { offsetX: 15 })];
}

export function endpointStyle(o: Overlay<'endpoint'>, { theme }: StyleContext): Style[] {
  const start = o.variant === 'start';
  const square = new RegularShape({
    points: 4,
    radius: 8 * Math.SQRT2, // 16 px side
    angle: Math.PI / 4,
    fill: new Fill({ color: start ? theme.text : theme.surface }),
    stroke: start ? line(theme.surface, 1.5) : line(theme.text, 2.5),
  });
  return [new Style({ image: square })];
}

/**
 * Narrow triangle pointing along the heading, drawn in screen pixels so it stays sharp at any pixel ratio.
 * The vector layer draws into a north-up canvas and OpenLayers rotates that whole canvas with the view
 * (ol/renderer/canvas/VectorLayer `sourceRotates() ? rotation : 0`), so the heading alone is the right
 * angle here: adding `state.rotation` would turn the arrow a second time and leave it pointing at north.
 */
function travellerArrow(headingDeg: number, ghost: boolean, theme: MapTheme) {
  return (pixel: Coordinate | Coordinate[] | Coordinate[][] | Coordinate[][][], state: State) => {
    const [x, y] = pixel as Coordinate;
    const { context: ctx, pixelRatio: pr } = state;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((headingDeg * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(0, -14 * pr); // tip
    ctx.lineTo(7.5 * pr, 9 * pr);
    ctx.lineTo(-7.5 * pr, 9 * pr);
    ctx.closePath();
    if (!ghost) {
      ctx.fillStyle = theme.surface;
      ctx.fill();
    }
    ctx.strokeStyle = theme.text;
    ctx.lineWidth = (ghost ? 1.6 : 2) * pr;
    ctx.lineJoin = 'miter';
    ctx.setLineDash(ghost ? [3 * pr, 2.5 * pr] : []);
    ctx.stroke();
    ctx.restore();
  };
}

export function travellerStyle(o: Overlay<'traveller'>, { theme, resolution }: StyleContext): Style[] {
  const ghost = o.variant === 'ghost';
  const ringStroke = ghost ? line(theme.text, 1, [2, 4]) : line(theme.text, 1.2);
  const ringPx = o.errorM / (resolution * M_PER_DEG);
  const ring = ringPx < MIN_ERROR_RING_PX
    ? new Style({ image: new CircleStyle({ radius: MIN_ERROR_RING_PX, stroke: ringStroke }) })
    : new Style({ geometry: new Polygon([groundCircle(o.pos, o.errorM)]), stroke: ringStroke });
  return [ring, new Style({ renderer: travellerArrow(o.headingDeg, ghost, theme) })];
}

export function ringStyle(o: Overlay<'ring'>, { theme, rotation }: StyleContext): Style[] {
  const bearing = RING_LABEL_SCREEN_BEARING - (rotation * 180) / Math.PI;
  const labelAt = new Point(toCoord(destination(o.center, bearing, o.radiusM)));
  return [
    new Style({ stroke: line(withAlpha(theme.text, 0.8), 1.2, [1.2, 4.8]) }),
    chip(o.label, 'plain', theme, { geometry: labelAt }),
  ];
}

export function labelStyle(o: Overlay<'label'>, { theme }: StyleContext): Style[] {
  return [chip(o.text, o.tone, theme, { offsetY: o.offsetY })];
}

export function overlayStyle(o: MapOverlay, ctx: StyleContext): Style[] {
  switch (o.kind) {
    case 'route': return routeStyle(o, ctx);
    case 'hazard': return hazardStyle(o, ctx);
    case 'waypoint': return waypointStyle(o, ctx);
    case 'endpoint': return endpointStyle(o, ctx);
    case 'traveller': return travellerStyle(o, ctx);
    case 'ring': return ringStyle(o, ctx);
    case 'label': return labelStyle(o, ctx);
  }
}
