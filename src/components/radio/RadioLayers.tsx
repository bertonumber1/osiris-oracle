'use client';
/* Radio layers on the Osiris map:
   - PSK Reporter: the entered callsign's spots as great-circle arcs coloured
     by band, optionally everything within a chosen radius of IO75OW, plus
     worldwide transmitting activity per grid square.
   - Satellites: weather birds, the ISS and the amateur fleet, live, with
     ground tracks, footprints and a pass predictor for Greenock. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MlMap, GeoJSONSource, Popup as MlPopup } from 'maplibre-gl';
import * as maplibregl from 'maplibre-gl';
import type { SatRec } from '@/lib/radio/sgp4';
import { BAND_COLOR, BANDS, distanceKm } from '@/lib/radio/maidenhead';
import { footprint, groundTrack, lookAt, makeRec, predict, subPoint, unwrap, type Pass, type SatDef } from '@/lib/radio/passes';
import { registerSatIcons } from '@/lib/radio/sat-icons';
import PskBar from './PskBar';
import PassPanel from './PassPanel';

type Active = Record<string, boolean | undefined>;
interface Props { mapRef: React.RefObject<MlMap | null>; mapReady: boolean; active: Active }

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const KIND_COLOR: Record<string, string> = {
  wx: '#38bdf8', iss: '#fbbf24', ham: '#a3e635', gnss: '#f472b6', starlink: '#e2e8f0',
  iridium: '#c084fc', geo: '#fb923c', inmarsat: '#f43f5e',
};
/** The panel switch for each kind. */
const KIND_SWITCH: Record<string, string> = {
  wx: 'wx_sats', iss: 'ham_sats', ham: 'ham_sats', gnss: 'sat_gnss', starlink: 'sat_starlink',
  iridium: 'sat_iridium', geo: 'sat_geo', inmarsat: 'sat_inmarsat',
};
/** Kinds that never pass overhead: shown while above our horizon instead. */
const HIGH_KINDS = new Set(['gnss', 'geo', 'inmarsat']);
const MIN_EL = 5;
/** UK & Ireland box (Channel Islands to Shetland, Kerry to the Norfolk coast), widened by m degrees. */
const inUk = (lat: number, lon: number, m: number) => lat >= 49 - m && lat <= 61.2 + m && lon >= -11.5 - m && lon <= 2.5 + m;
const PSK_MINUTES = 15;

export interface PskData {
  connected: boolean; rate: number; call: string; radiusKm: number;
  home: { grid: string; lat: number; lon: number };
  stats: { call: string; sent: number; heard: number; farKm: number; farCall: string; bands: string[] };
  paths: any[]; activity: any[]; bandCount: Record<string, number>;
}

/** A circle of radius km round lat/lon, as a closed [lon, lat] ring. */
function circle(lat: number, lon: number, km: number): [number, number][] {
  const r = Math.PI / 180, ang = km / 6371, la0 = lat * r, lo0 = lon * r;
  const ring: [number, number][] = [];
  for (let b = 0; b <= 360; b += 4) {
    const br = b * r;
    const la = Math.asin(Math.sin(la0) * Math.cos(ang) + Math.cos(la0) * Math.sin(ang) * Math.cos(br));
    const lo = lo0 + Math.atan2(Math.sin(br) * Math.sin(ang) * Math.cos(la0), Math.cos(ang) - Math.sin(la0) * Math.sin(la));
    ring.push([lo / r, la / r]);
  }
  return ring;
}

function store<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}

/** Points along the great circle from a to b ([lat, lon] in, [lon, lat] out). */
function arc(a: [number, number], b: [number, number], n = 24): [number, number][] {
  const r = Math.PI / 180;
  const [la1, lo1, la2, lo2] = [a[0] * r, a[1] * r, b[0] * r, b[1] * r];
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
  if (!d) return [[a[1], a[0]], [b[1], b[0]]];
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n, A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    pts.push([Math.atan2(y, x) / r, Math.atan2(z, Math.sqrt(x * x + y * y)) / r]);
  }
  return unwrap(pts);
}

export default function RadioLayers({ mapRef, mapReady, active }: Props) {
  const pskOn = !!active.psk;
  const satsOn = Object.values(KIND_SWITCH).some(k => !!active[k]);

  /* ── PSK state ── */
  const [call, setCall] = useState<string>(() => store('osiris.psk.call', 'MM7BVP'));
  const [bandsOff, setBandsOff] = useState<string[]>(() => store('osiris.psk.bandsOff', []));
  // Radius (km) round IO75OW whose spots are drawn as well as the callsign's; 0 = callsign only.
  const [radius, setRadius] = useState<number>(() => store('osiris.psk.radius', 0));
  const [psk, setPsk] = useState<PskData | null>(null);
  useEffect(() => { try { localStorage.setItem('osiris.psk.call', JSON.stringify(call)); localStorage.setItem('osiris.psk.bandsOff', JSON.stringify(bandsOff)); localStorage.setItem('osiris.psk.radius', JSON.stringify(radius)); } catch { /* storage blocked */ } }, [call, bandsOff, radius]);

  /* ── Satellite state ── */
  const [defs, setDefs] = useState<SatDef[]>([]);
  const recs = useRef(new Map<string, SatRec>());
  const [passes, setPasses] = useState<Pass[]>([]);
  const [selPass, setSelPass] = useState<Pass | null>(null);

  const setData = useCallback((id: string, d: GeoJSON.FeatureCollection) => {
    (mapRef.current?.getSource(id) as GeoJSONSource | undefined)?.setData(d);
  }, [mapRef]);

  /* ── Sources and layers ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || map.getSource('psk-arcs')) return;
    for (const id of ['psk-world', 'psk-ring', 'psk-arcs', 'psk-ends', 'rs-foot', 'rs-track', 'rs-pass', 'rs-sat']) map.addSource(id, { type: 'geojson', data: EMPTY });
    (map.getSource('psk-arcs') as any).setAttribution?.('Spots: <a href="https://pskreporter.info" target="_blank">PSK Reporter</a>');
    // Put them under the Clyde Watch layers when those are present, so aircraft and ships stay on top.
    const before = map.getLayer('clyde-wtr-links') ? 'clyde-wtr-links' : undefined;
    const add = (l: any) => map.addLayer(l, before);
    const T = { 'text-font': ['Open Sans Regular'], 'text-allow-overlap': false } as any;
    const HALO = { 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.3 };

    add({ id: 'psk-world', type: 'circle', source: 'psk-world', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, ['*', ['get', 'r'], 0.7], 6, ['*', ['get', 'r'], 1.6]],
      'circle-color': ['get', 'c'], 'circle-opacity': 0.5, 'circle-blur': 0.45 } });
    add({ id: 'psk-ring', type: 'line', source: 'psk-ring', paint: { 'line-color': '#2ee6a6', 'line-opacity': 0.55, 'line-width': 1.2, 'line-dasharray': [3, 3] } });
    add({ id: 'psk-ring-label', type: 'symbol', source: 'psk-ring', layout: { ...T, 'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-size': 9.5, 'text-letter-spacing': 0.15 },
      paint: { 'text-color': '#2ee6a6', ...HALO } });
    add({ id: 'psk-arc-glow', type: 'line', source: 'psk-arcs', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
      'line-color': ['get', 'c'], 'line-width': ['case', ['==', ['get', 'me'], 1], 7, 4], 'line-blur': 4, 'line-opacity': ['*', ['get', 'op'], 0.22] } });
    add({ id: 'psk-arc', type: 'line', source: 'psk-arcs', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
      'line-color': ['get', 'c'], 'line-width': ['case', ['==', ['get', 'me'], 1], 2.2, 1.05], 'line-opacity': ['get', 'op'] } });
    add({ id: 'psk-ends', type: 'circle', source: 'psk-ends', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 1.6, 8, 3.5], 'circle-color': ['get', 'c'], 'circle-opacity': ['get', 'op'],
      'circle-stroke-color': 'rgba(0,0,0,0.6)', 'circle-stroke-width': 0.5 } });

    add({ id: 'rs-foot', type: 'fill', source: 'rs-foot', paint: { 'fill-color': ['get', 'c'], 'fill-opacity': 0.06 } });
    add({ id: 'rs-foot-line', type: 'line', source: 'rs-foot', paint: { 'line-color': ['get', 'c'], 'line-opacity': 0.4, 'line-width': 1, 'line-dasharray': [2, 2] } });
    add({ id: 'rs-track', type: 'line', source: 'rs-track', layout: { 'line-cap': 'round' }, paint: {
      'line-color': ['get', 'c'], 'line-opacity': 0.55, 'line-width': 1.4, 'line-dasharray': [1, 2.2] } });
    add({ id: 'rs-pass', type: 'line', source: 'rs-pass', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-opacity': 0.9, 'line-blur': 0.5 } });
    add({ id: 'rs-sat-glow', type: 'circle', source: 'rs-sat', paint: { 'circle-radius': ['case', ['==', ['get', 'big'], 1], 18, 10], 'circle-color': ['get', 'c'], 'circle-opacity': 0.16, 'circle-blur': 0.8 } });
    registerSatIcons(map, KIND_COLOR);
    add({ id: 'rs-sat', type: 'symbol', source: 'rs-sat', layout: {
      'icon-image': ['concat', 'rsat:', ['get', 'k']],
      // A little smaller than the aircraft (airliners draw ~40 px): satellites ~30 px across.
      'icon-size': ['interpolate', ['linear'], ['zoom'], 1, 0.75, 4, 0.9, 6, 1],
      'icon-allow-overlap': true, 'icon-ignore-placement': true } });
    add({ id: 'rs-sat-label', type: 'symbol', source: 'rs-sat', filter: ['any', ['==', ['get', 'big'], 1], ['all', ['>=', ['zoom'], 6], ['!=', ['get', 'k'], 'starlink']], ['>=', ['zoom'], 8]], layout: {
      ...T, 'text-field': ['get', 'name'], 'text-size': ['case', ['==', ['get', 'big'], 1], 10.5, 9], 'text-offset': [0, 1.4], 'text-anchor': 'top' },
      paint: { 'text-color': ['get', 'c'], ...HALO } });
  }, [mapReady, mapRef]);

  /* ── Visibility ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map?.getLayer('psk-arc')) return;
    const vis = (ids: string[], v: boolean) => ids.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none'));
    vis(['psk-arc', 'psk-arc-glow', 'psk-ends', 'psk-ring', 'psk-ring-label'], pskOn);
    vis(['psk-world'], pskOn && !!active.psk_world);
    vis(['rs-sat', 'rs-sat-glow', 'rs-sat-label', 'rs-pass'], satsOn);
    vis(['rs-track', 'rs-foot', 'rs-foot-line'], satsOn && active.sat_tracks !== false);
  });

  /* ── PSK: poll our own server, which holds the MQTT feed ── */
  const bandsOffKey = bandsOff.join(',');
  useEffect(() => {
    if (!mapReady || !pskOn) { setData('psk-arcs', EMPTY); setData('psk-ends', EMPTY); setData('psk-world', EMPTY); setData('psk-ring', EMPTY); return; }
    const ac = new AbortController();
    const load = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(`/api/psk?minutes=${PSK_MINUTES}&call=${encodeURIComponent(call)}&radius=${radius}`, { signal: ac.signal, cache: 'no-store' });
        if (r.ok) setPsk(await r.json());
      } catch { /* retry next tick */ }
    };
    load();
    // The first poll opens the feed; ask again soon so the map fills quickly, then every 20 s.
    const quick = setTimeout(load, 4000);
    const iv = setInterval(load, 20000);
    return () => { ac.abort(); clearTimeout(quick); clearInterval(iv); };
  }, [mapReady, pskOn, call, radius, setData]);

  useEffect(() => {
    if (!mapReady || !pskOn || !psk) return;
    const off = new Set(bandsOff);
    const arcs: GeoJSON.Feature[] = [], ends: GeoJSON.Feature[] = [];
    for (const p of psk.paths) {
      const [sla, slo, rla, rlo, band, snr, age, sc, rc, f, md, mine] = p;
      if (off.has(band)) continue;
      const c = BAND_COLOR[band] || '#94a3b8';
      const op = +(Math.max(0.18, 1 - age / (PSK_MINUTES * 60)) * (mine ? 1 : 0.85)).toFixed(2);
      arcs.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: arc([sla, slo], [rla, rlo]) },
        properties: { c, op, me: mine, sc, rc, band, snr, age, f, md, km: Math.round(distanceKm([sla, slo], [rla, rlo])) } });
      ends.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [rlo, rla] }, properties: { c, op } });
    }
    // Draw ours last so they sit on top.
    arcs.sort((a, b) => (a.properties as any).me - (b.properties as any).me);
    setData('psk-arcs', fc(arcs));
    setData('psk-ring', psk.radiusKm ? fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: circle(psk.home.lat, psk.home.lon, psk.radiusKm) },
      properties: { label: `${psk.home.grid} · ${psk.radiusKm} km` } }]) : EMPTY);
    setData('psk-ends', fc(ends));
    const max = Math.max(1, ...psk.activity.map(a => a[3] as number));
    setData('psk-world', fc(psk.activity.filter(a => !off.has(a[2])).map(([la, lo, b, n, calls]) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [lo, la] },
      properties: { c: BAND_COLOR[b] || '#94a3b8', r: 2 + 7 * Math.sqrt((n as number) / max), b, n, calls } }))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, pskOn, psk, bandsOffKey, call, setData]);

  /* PSK hover: who heard whom, how far, how strong. */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    let pop: MlPopup | null = null;
    const show = (e: any, html: string) => {
      pop?.remove();
      const el = document.createElement('div');
      el.innerHTML = html;
      el.style.cssText = 'font:500 10px/1.45 "JetBrains Mono",monospace;color:#e6edf3;letter-spacing:.03em';
      pop = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'clyde-hover' }).setLngLat(e.lngLat).setDOMContent(el).addTo(map);
    };
    const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
    const onArc = (e: any) => {
      const p = e.features?.[0]?.properties; if (!p) return;
      map.getCanvas().style.cursor = 'pointer';
      const mins = Math.round(p.age / 60);
      show(e, `<b style="color:${esc(p.c)}">${esc(p.sc)}</b> &rarr; <b>${esc(p.rc)}</b><br/>${esc(p.band)} ${esc(p.md)} &middot; ${(p.f / 1e6).toFixed(4)} MHz<br/>`
        + `${p.snr != null && p.snr !== 'null' ? esc(p.snr) + ' dB &middot; ' : ''}${Number(p.km).toLocaleString()} km &middot; ${mins ? mins + ' min ago' : 'just now'}`);
    };
    const onWorld = (e: any) => {
      const p = e.features?.[0]?.properties; if (!p) return;
      map.getCanvas().style.cursor = 'pointer';
      show(e, `<b style="color:${esc(p.c)}">${esc(p.b)}</b> &middot; ${esc(p.n)} spots<br/><span style="opacity:.7">${esc(p.calls)}</span>`);
    };
    const leave = () => { map.getCanvas().style.cursor = ''; pop?.remove(); pop = null; };
    map.on('mousemove', 'psk-arc', onArc); map.on('mouseleave', 'psk-arc', leave);
    map.on('mousemove', 'psk-world', onWorld); map.on('mouseleave', 'psk-world', leave);
    return () => { map.off('mousemove', 'psk-arc', onArc); map.off('mouseleave', 'psk-arc', leave); map.off('mousemove', 'psk-world', onWorld); map.off('mouseleave', 'psk-world', leave); pop?.remove(); };
  }, [mapReady, mapRef]);

  /* ── Satellites: elements once (server caches 6 h) ── */
  useEffect(() => {
    if (!mapReady || !satsOn || defs.length) return;
    const ac = new AbortController();
    fetch('/api/radio/sats', { signal: ac.signal }).then(r => r.json()).then(d => {
      const list: SatDef[] = d.sats || [];
      for (const s of list) { const r = makeRec(s); if (r) recs.current.set(s.name, r); }
      setDefs(list.filter(s => recs.current.has(s.name)));
    }).catch(() => {});
    return () => ac.abort();
  }, [mapReady, satsOn, defs.length]);

  const shown = useMemo(() => defs.filter(s => !!active[KIND_SWITCH[s.kind]] || (s.kind === 'iss' && !!active.wx_sats)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [defs, ...Object.values(KIND_SWITCH).map(k => active[k]), active.wx_sats]);
  // The pass predictor covers the weather birds, the ISS and the amateur fleet only.
  const passSats = useMemo(() => shown.filter(s => s.kind === 'wx' || s.kind === 'iss' || s.kind === 'ham'), [shown]);

  // Passes: weather and ISS over 24 h at a 30 s step, the amateur fleet over 12 h at 60 s. Worked out in slices so the map never stutters.
  useEffect(() => {
    if (!satsOn || !passSats.length) { setPasses([]); return; }
    let cancelled = false;
    const run = () => {
      const now = Date.now();
      const all: Pass[] = [];
      let i = 0;
      const step = () => {
        if (cancelled) return;
        const t0 = performance.now();
        while (i < passSats.length && performance.now() - t0 < 12) {
          const s = passSats[i++], rec = recs.current.get(s.name);
          if (!rec) continue;
          all.push(...(s.kind === 'ham' ? predict(s, rec, now, 12, 60, 15) : predict(s, rec, now, 24, 30, 8)));
        }
        if (i < passSats.length) setTimeout(step, 0);
        else setPasses(all.sort((a, b) => a.aos - b.aos));
      };
      step();
    };
    run();
    const iv = setInterval(run, 10 * 60 * 1000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [satsOn, passSats]);

  /* Only what is over the UK:
     - low orbits (weather, ISS, amateur, Starlink, Iridium) while their sub-point
       is inside the UK & Ireland box;
     - GPS / Galileo / geostationary / Inmarsat, which never pass overhead, while
       they are above the horizon at Greenock (in our sky), drawn at their
       sub-point with bearing and elevation in the label.
     Every 30 s a sliced sweep of the whole catalogue (~11k) picks candidates in a
     wider box; every 2 s only those are moved. */
  const cands = useRef<SatDef[]>([]);
  useEffect(() => {
    if (!mapReady || !satsOn || !shown.length) { cands.current = []; setData('rs-sat', EMPTY); setData('rs-track', EMPTY); setData('rs-foot', EMPTY); return; }
    let cancelled = false;
    const big = (s: SatDef) => s.kind === 'wx' || s.kind === 'iss' || s.name === selPass?.name;
    const label = (s: SatDef) => s.name.replace(/\s*\(.*\)$/, '');
    const pos = () => {
      if (document.hidden) return;
      const d = new Date();
      const feats: GeoJSON.Feature[] = [];
      const list = selPass && !cands.current.some(s => s.name === selPass.name) ? [...cands.current, ...shown.filter(s => s.name === selPass.name)] : cands.current;
      for (const s of list) {
        const rec = recs.current.get(s.name)!;
        const p = subPoint(rec, d);
        if (!p) continue;
        let name = label(s);
        if (HIGH_KINDS.has(s.kind)) {
          const la = lookAt(rec, d);
          if (!la || la.el < MIN_EL) continue;
          name += ` ${Math.round(la.az)}°/${Math.round(la.el)}°`;
        } else if (!inUk(p.lat, p.lon, 0) && s.name !== selPass?.name) continue;
        feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: { name, c: KIND_COLOR[s.kind], k: s.kind, big: big(s) ? 1 : 0 } });
      }
      setData('rs-sat', fc(feats));
    };
    const sweep = () => {
      const d = new Date();
      const out: SatDef[] = [];
      let i = 0;
      const step = () => {
        if (cancelled) return;
        const t0 = performance.now();
        while (i < shown.length && performance.now() - t0 < 10) {
          const s = shown[i++], rec = recs.current.get(s.name);
          if (!rec) continue;
          if (HIGH_KINDS.has(s.kind)) { const la = lookAt(rec, d); if (la && la.el >= MIN_EL - 2) out.push(s); }
          else { const p = subPoint(rec, d); if (p && inUk(p.lat, p.lon, 6)) out.push(s); }
        }
        if (i < shown.length) setTimeout(step, 0);
        else { cands.current = out; pos(); slow(); }
      };
      step();
    };
    const slow = () => {
      if (document.hidden) return;
      const now = Date.now();
      const tracks: GeoJSON.Feature[] = [], foots: GeoJSON.Feature[] = [];
      for (const s of cands.current) {
        if (!big(s)) continue;
        const rec = recs.current.get(s.name)!;
        const p = subPoint(rec, new Date(now));
        if (!p || !inUk(p.lat, p.lon, 0)) continue;
        tracks.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: groundTrack(rec, now, s.kind === 'iss' ? 92 : 100) }, properties: { c: KIND_COLOR[s.kind] } });
        foots.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [footprint(p.lat, p.lon, p.altKm)] }, properties: { c: KIND_COLOR[s.kind] } });
      }
      setData('rs-track', fc(tracks));
      setData('rs-foot', fc(foots));
    };
    sweep();
    const a = setInterval(pos, 2000), b = setInterval(() => { if (!document.hidden) sweep(); }, 30000);
    return () => { cancelled = true; clearInterval(a); clearInterval(b); };
  }, [mapReady, satsOn, shown, selPass, setData]);

  useEffect(() => {
    if (!mapReady) return;
    setData('rs-pass', selPass ? fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: selPass.track }, properties: {} }]) : EMPTY);
  }, [mapReady, selPass, setData]);

  const onPick = useCallback((p: Pass | null) => {
    setSelPass(p);
    const map = mapRef.current;
    if (p && map && p.track.length) {
      const lons = p.track.map(x => x[0]), lats = p.track.map(x => x[1]);
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 120, duration: 1400, maxZoom: 5 });
    }
  }, [mapRef]);

  return (
    <>
      {pskOn && (
        <PskBar data={psk} call={call} onCall={setCall} radius={radius} onRadius={setRadius} bandsOff={bandsOff}
          onToggleBand={b => setBandsOff(o => (o.includes(b) ? o.filter(x => x !== b) : [...o, b]))}
          onSolo={b => setBandsOff(BANDS.map(x => x.key).filter(k => k !== b))} onAll={() => setBandsOff([])} />
      )}
      {satsOn && <PassPanel passes={passes} loading={!defs.length} selected={selPass} onPick={onPick} recs={recs.current} />}
    </>
  );
}
