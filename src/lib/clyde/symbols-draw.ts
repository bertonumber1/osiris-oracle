/* Draws the shared symbol set into a MapLibre map as raster images, once.
   Everything is rendered at twice the css size so it stays crisp on HiDPI and
   when MapLibre scales it up at close zoom.

   Image names:
     ac:<shape>:<colour key>    colour key = an ALT_BANDS key, gnd, unk, or c-<category>
     ship:<kind>:m | ship:<kind>:s    moving dart / stationary disc
*/
import type { Map as MlMap } from 'maplibre-gl';
import { AC_SHAPES } from './ac-shapes';
import { ALT_BANDS, ALT_GROUND, ALT_UNKNOWN, SHAPE_SIZE, SHIP_KINDS } from './symbols';

const PR = 2;

function put(map: MlMap, id: string, c: HTMLCanvasElement) {
  const ctx = c.getContext('2d')!;
  const img = { width: c.width, height: c.height, data: new Uint8Array(ctx.getImageData(0, 0, c.width, c.height).data) };
  // Same id, same size: update in place, so layers already using it never see it missing.
  if (map.hasImage(id)) map.updateImage(id, img);
  else map.addImage(id, img, { pixelRatio: PR });
}

function drawAircraft(shape: string, color: string): HTMLCanvasElement {
  const s = AC_SHAPES[shape] || AC_SHAPES.unknown;
  const css = SHAPE_SIZE[shape] || 16;
  const px = css * PR;
  const c = document.createElement('canvas');
  c.width = px; c.height = px;
  const ctx = c.getContext('2d')!;
  const [vx, vy, vw, vh] = s.vb;
  const k = px / Math.max(vw, vh);
  ctx.translate((px - vw * k) / 2, (px - vh * k) / 2);
  ctx.scale(k, k);
  ctx.translate(-vx, -vy);
  const p = new Path2D(s.path);
  // A soft dark outline first, so pale colours hold up over imagery and snow.
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.62)';
  ctx.lineWidth = 1.1 * s.stroke * 1.6;
  ctx.stroke(p);
  ctx.fillStyle = color;
  ctx.fill(p);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.1 * s.stroke * 0.7;
  ctx.stroke(p);
  return c;
}

function drawShip(color: string, moving: boolean): HTMLCanvasElement {
  const css = moving ? 20 : 12;
  const px = css * PR;
  const c = document.createElement('canvas');
  c.width = px; c.height = px;
  const ctx = c.getContext('2d')!;
  ctx.scale(PR, PR);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (moving) {
    // AIS-catcher's dart: a long point forward, a notched stern.
    ctx.moveTo(10, 1.5);
    ctx.lineTo(16, 18);
    ctx.lineTo(10, 14.6);
    ctx.lineTo(4, 18);
    ctx.closePath();
  } else {
    ctx.arc(6, 6, 4.6, 0, Math.PI * 2);
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // A faint inner highlight so the symbol reads as solid, not flat.
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 0.6;
  ctx.stroke();
  return c;
}

/** Registers every aircraft and ship image. Safe to call again (e.g. after a theme change). */
export function registerSymbols(map: MlMap, categoryColors: Record<string, string>) {
  const colors: Record<string, string> = { gnd: ALT_GROUND, unk: ALT_UNKNOWN };
  for (const b of ALT_BANDS) colors[b.key] = b.color;
  for (const [k, v] of Object.entries(categoryColors)) colors['c-' + k] = v;
  for (const shape of Object.keys(AC_SHAPES)) {
    for (const [ck, col] of Object.entries(colors)) put(map, `ac:${shape}:${ck}`, drawAircraft(shape, col));
  }
  for (const k of SHIP_KINDS) {
    put(map, `ship:${k.key}:m`, drawShip(k.color, true));
    put(map, `ship:${k.key}:s`, drawShip(k.color, false));
  }
}

/** Aircraft are a fixed screen size, as on tar1090 / globe.adsbexchange.com: they do not
    shrink as you zoom in. Only the whole-globe view draws them a little smaller. */
export const ICON_SIZE_BY_ZOOM: any = ['interpolate', ['linear'], ['zoom'], 1, 0.8, 3.5, 1.05, 5, 1.2];
export const SHIP_SIZE_BY_ZOOM: any = ['interpolate', ['linear'], ['zoom'], 1, 0.7, 5, 0.95, 8, 1.1, 11, 1.25];
