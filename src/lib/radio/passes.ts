/* Satellite passes over our station, ground tracks and footprints, from TLEs
   with satellite.js (already used by Osiris for its satellite layer). */
import { twoline2satrec, propagate, gstime, eciToGeodetic, eciToEcf, ecfToLookAngles, degreesLat, degreesLong, type SatRec } from './sgp4';

/** Greenock: the same point as the AIS aerial and the APRS filter. */
export const QTH = { lat: 55.9587, lon: -4.7656, altKm: 0.03, name: 'GREENOCK' };
const D2R = Math.PI / 180, R2D = 180 / Math.PI, RE = 6371;

export interface SatDef { name: string; l1: string; l2: string; kind: 'wx' | 'iss' | 'ham' | 'gnss' | 'starlink' | 'iridium' | 'geo' | 'inmarsat'; down?: string }
export interface Pass {
  key: string; name: string; kind: SatDef['kind']; down?: string;
  aos: number; los: number; tca: number; maxEl: number; aosAz: number; losAz: number;
  sky: [number, number][];           // [azimuth, elevation] through the pass, degrees
  track: [number, number][];         // sub-satellite points [lon, lat] through the pass
}

export function makeRec(s: SatDef): SatRec | null {
  try { const r = twoline2satrec(s.l1, s.l2); return r && !r.error ? r : null; } catch { return null; }
}

const OBS = { longitude: QTH.lon * D2R, latitude: QTH.lat * D2R, height: QTH.altKm };

function state(rec: SatRec, d: Date) {
  const pv = propagate(rec, d);
  const p = pv && typeof pv.position === 'object' ? pv.position : null;
  if (!p) return null;
  const gmst = gstime(d);
  return { eci: p, gmst };
}

export function subPoint(rec: SatRec, d: Date): { lat: number; lon: number; altKm: number } | null {
  const s = state(rec, d);
  if (!s) return null;
  const g = eciToGeodetic(s.eci, s.gmst);
  return { lat: degreesLat(g.latitude), lon: degreesLong(g.longitude), altKm: g.height };
}

export function lookAt(rec: SatRec, d: Date): { az: number; el: number } | null {
  const s = state(rec, d);
  if (!s) return null;
  const la = ecfToLookAngles(OBS, eciToEcf(s.eci, s.gmst));
  return { az: (la.azimuth * R2D + 360) % 360, el: la.elevation * R2D };
}

/** Passes in the next `hours`, coarse step then refined to a second or so. */
export function predict(def: SatDef, rec: SatRec, from: number, hours: number, stepS: number, minEl: number): Pass[] {
  const out: Pass[] = [];
  const end = from + hours * 3600e3;
  const elAt = (t: number) => lookAt(rec, new Date(t))?.el ?? -90;
  let t = from, prev = elAt(t);
  // Already up: start the pass at "now".
  let aos: number | null = prev > 0 ? from : null;
  while (t < end) {
    const t2 = t + stepS * 1000;
    const e2 = elAt(t2);
    if (prev <= 0 && e2 > 0) { let a = t, b = t2; for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (elAt(m) > 0) b = m; else a = m; } aos = b; }
    if (prev > 0 && e2 <= 0 && aos != null) {
      let a = t, b = t2; for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if (elAt(m) > 0) a = m; else b = m; }
      const los = a;
      const sky: [number, number][] = [], track: [number, number][] = [];
      let maxEl = -90, tca = aos;
      const n = Math.max(8, Math.min(90, Math.round((los - aos) / 15000)));
      for (let i = 0; i <= n; i++) {
        const tt = aos + ((los - aos) * i) / n, d = new Date(tt);
        const l = lookAt(rec, d), sp = subPoint(rec, d);
        if (l) { sky.push([l.az, Math.max(0, l.el)]); if (l.el > maxEl) { maxEl = l.el; tca = tt; } }
        if (sp) track.push([sp.lon, sp.lat]);
      }
      if (maxEl >= minEl && sky.length) out.push({ key: `${def.name}|${Math.round(aos / 1000)}`, name: def.name, kind: def.kind, down: def.down, aos, los, tca, maxEl, aosAz: sky[0][0], losAz: sky[sky.length - 1][0], sky, track: unwrap(track) });
      aos = null;
    }
    t = t2; prev = e2;
  }
  return out;
}

/** Keeps a line continuous across the antimeridian (MapLibre draws past ±180). */
export function unwrap(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  let off = 0;
  for (let i = 0; i < pts.length; i++) {
    if (i) { const d = pts[i][0] + off - out[i - 1][0]; if (d > 180) off -= 360; else if (d < -180) off += 360; }
    out.push([pts[i][0] + off, pts[i][1]]);
  }
  return out;
}

export function groundTrack(rec: SatRec, from: number, minutes: number, stepS = 30): [number, number][] {
  const pts: [number, number][] = [];
  for (let t = from; t <= from + minutes * 60e3; t += stepS * 1000) {
    const p = subPoint(rec, new Date(t));
    if (p) pts.push([p.lon, p.lat]);
  }
  return unwrap(pts);
}

/** The ground the satellite can see down to the horizon, as a ring. */
export function footprint(lat: number, lon: number, altKm: number): [number, number][] {
  const ang = Math.acos(RE / (RE + altKm));
  const la0 = lat * D2R, lo0 = lon * D2R;
  const ring: [number, number][] = [];
  for (let b = 0; b <= 360; b += 5) {
    const br = b * D2R;
    const la = Math.asin(Math.sin(la0) * Math.cos(ang) + Math.cos(la0) * Math.sin(ang) * Math.cos(br));
    const lo = lo0 + Math.atan2(Math.sin(br) * Math.sin(ang) * Math.cos(la0), Math.cos(ang) - Math.sin(la0) * Math.sin(la));
    ring.push([lo * R2D, la * R2D]);
  }
  return unwrap(ring);
}

export function compass(az: number): string {
  return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(az / 22.5) % 16];
}
