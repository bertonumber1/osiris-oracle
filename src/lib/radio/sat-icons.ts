/* Satellite icons for the RADIO + SPACE layer, drawn once on a canvas and
   registered with the map as 'rsat:<kind>':
   - wx / ham: a spacecraft with two solar panels and an antenna
   - iss: the station's long truss with four panel wings and the modules
   - starlink: the flat bus with its single long panel
   - geo / inmarsat: a big bus with wide wings and a large dish */
import type { Map as MlMap } from 'maplibre-gl';

const S = 2;           // drawn at 2x for sharp edges on HiDPI
const OUTLINE = 'rgba(2,4,10,0.9)';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w * S; c.height = h * S;
  const ctx = c.getContext('2d')!;
  ctx.scale(S, S);
  return { c, ctx };
}

/** Panel with cell lines. */
function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, cells: number) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(4,8,20,0.75)';
  ctx.lineWidth = 0.7;
  for (let i = 1; i < cells; i++) { const cx = x + (w * i) / cells; ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, y + h); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); ctx.stroke();
}

function craft(color: string) {
  const W = 34, H = 22;
  const { c, ctx } = canvas(W, H);
  const cy = H / 2 + 1;
  // Outline pass: the same shapes, a little fatter, in near-black.
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(0.5, cy - 5.5, 12, 11); ctx.fillRect(W - 12.5, cy - 5.5, 12, 11);
  ctx.fillRect(11, cy - 1.8, W - 22, 3.6);
  ctx.fillRect(W / 2 - 5.5, cy - 7.5, 11, 15);
  // Panels, boom, bus.
  panel(ctx, 1.5, cy - 4.5, 10, 9, color, 3);
  panel(ctx, W - 11.5, cy - 4.5, 10, 9, color, 3);
  ctx.fillStyle = '#c9d1d9';
  ctx.fillRect(11.5, cy - 0.8, W - 23, 1.6);
  ctx.fillStyle = '#f2f4f8';
  ctx.fillRect(W / 2 - 4.5, cy - 6.5, 9, 13);
  ctx.fillStyle = color;
  ctx.fillRect(W / 2 - 4.5, cy + 2.5, 9, 1.4);
  // Antenna dish on top.
  ctx.strokeStyle = '#f2f4f8'; ctx.lineWidth = 1.1;
  ctx.beginPath(); ctx.moveTo(W / 2, cy - 6.5); ctx.lineTo(W / 2, cy - 9.5); ctx.stroke();
  ctx.beginPath(); ctx.arc(W / 2, cy - 9.2, 2.4, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
  return c;
}

function starlink(color: string) {
  const W = 36, H = 20;
  const { c, ctx } = canvas(W, H);
  const cy = H / 2;
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(0.5, cy - 6, 12, 12);           // flat bus
  ctx.fillRect(11, cy - 1.8, 4, 3.6);          // arm
  ctx.fillRect(14, cy - 7, W - 14.5, 14);      // the one long panel
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(1.5, cy - 5, 10, 10);
  ctx.fillStyle = '#9ca3af';
  ctx.fillRect(11.5, cy - 0.8, 3, 1.6);
  panel(ctx, 15, cy - 6, W - 16.5, 12, color, 5);
  return c;
}

function geo(color: string) {
  const W = 40, H = 26;
  const { c, ctx } = canvas(W, H);
  const cy = H / 2 + 2;
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(0.5, cy - 5, 13, 10); ctx.fillRect(W - 13.5, cy - 5, 13, 10);
  ctx.fillRect(12, cy - 1.8, W - 24, 3.6);
  ctx.fillRect(W / 2 - 6.5, cy - 7, 13, 14);
  panel(ctx, 1.5, cy - 4, 11, 8, color, 3);
  panel(ctx, W - 12.5, cy - 4, 11, 8, color, 3);
  ctx.fillStyle = '#c9d1d9';
  ctx.fillRect(12.5, cy - 0.8, W - 25, 1.6);
  ctx.fillStyle = '#f2f4f8';
  ctx.fillRect(W / 2 - 5.5, cy - 6, 11, 12);
  ctx.fillStyle = color;
  ctx.fillRect(W / 2 - 5.5, cy + 2, 11, 1.6);
  // Big reflector on top.
  ctx.fillStyle = OUTLINE;
  ctx.beginPath(); ctx.ellipse(W / 2, cy - 9.5, 7.5, 3.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2f4f8';
  ctx.beginPath(); ctx.ellipse(W / 2, cy - 9.5, 6.4, 2.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(W / 2, cy - 9.5, 1.1, 0, Math.PI * 2); ctx.fill();
  return c;
}

function iss(color: string) {
  const W = 46, H = 30;
  const { c, ctx } = canvas(W, H);
  const cy = H / 2;
  ctx.fillStyle = OUTLINE;
  ctx.fillRect(1, cy - 1.8, W - 2, 3.6);                       // truss
  for (const x of [3, 12, W - 21, W - 12]) { ctx.fillRect(x - 0.5, cy - 13, 7, 9.5); ctx.fillRect(x - 0.5, cy + 3.5, 7, 9.5); }
  ctx.fillRect(W / 2 - 3.5, cy - 9, 7, 18);                    // modules
  ctx.fillStyle = '#d0d7de';
  ctx.fillRect(1.5, cy - 1, W - 3, 2);
  for (const x of [3, 12, W - 21, W - 12]) { panel(ctx, x, cy - 12.5, 6, 8.5, color, 2); panel(ctx, x, cy + 4, 6, 8.5, color, 2); }
  ctx.fillStyle = '#f2f4f8';
  ctx.fillRect(W / 2 - 2.5, cy - 8, 5, 16);
  ctx.fillRect(W / 2 - 6, cy - 2.5, 12, 5);
  return c;
}

export function registerSatIcons(map: MlMap, colors: Record<string, string>) {
  const put = (id: string, cv: HTMLCanvasElement) => {
    const img = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height);
    if (map.hasImage(id)) map.removeImage(id);
    map.addImage(id, img, { pixelRatio: S });
  };
  put('rsat:wx', craft(colors.wx));
  put('rsat:ham', craft(colors.ham));
  put('rsat:gnss', craft(colors.gnss));
  put('rsat:iridium', craft(colors.iridium));
  put('rsat:starlink', starlink(colors.starlink));
  put('rsat:geo', geo(colors.geo));
  put('rsat:inmarsat', geo(colors.inmarsat));
  put('rsat:iss', iss(colors.iss));
}
