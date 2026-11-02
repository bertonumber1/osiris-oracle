'use client';
/* Clyde Watch on the Osiris map: our own ADS-B, AIS, APRS, SFRS pager
   incidents and stations, the Ofcom WTR register and aero navaids.

   Everything comes from Clyde Watch through /api/clyde (read-only). Aircraft
   are polled every 8 s and dead-reckoned in between so they glide rather than
   jump; ships, APRS and incidents arrive live over Clyde Watch's event stream.
   All drawing is MapLibre GPU layers using the shared symbol set. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MlMap, MapMouseEvent, GeoJSONSource, Popup as MlPopup } from 'maplibre-gl';
import * as maplibregl from 'maplibre-gl';
import { aircraftShape, altKey, ALT_BANDS, ALT_GROUND, ALT_UNKNOWN, shipKind, shipMoving } from '@/lib/clyde/symbols';
import { ICON_SIZE_BY_ZOOM, SHIP_SIZE_BY_ZOOM } from '@/lib/clyde/symbols-draw';
import { AC_SHAPES } from '@/lib/clyde/ac-shapes';
import { flightCategory, type FlightCategory } from '@/lib/flight-category';

/** Which AVIATION switch governs each category. */
const CAT_SWITCH: Record<FlightCategory, string> = { commercial: 'flights', private: 'private', jet: 'jets', military: 'military' };
import { WTR_CATS } from '@/lib/clyde/layer-ids';
import ClydeCard, { type ClydeSelection } from './ClydeCard';
import ClydeStatus, { type ClydeStats, type SearchHit } from './ClydeStatus';

const API = '/api/clyde';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const OSIRIS_FLIGHT_LAYERS = ['fl-commercial', 'fl-private', 'fl-jets', 'fl-military'];
const ALT_COLOR: Record<string, string> = { gnd: ALT_GROUND, unk: ALT_UNKNOWN, ...Object.fromEntries(ALT_BANDS.map(b => [b.key, b.color])) };
const WTR_MIN_ZOOM = 8;
const INCIDENT_WINDOW_S = 30 * 86400;
const TRAIL_POINTS = 60;

type Active = Record<string, boolean | undefined>;
interface Props { mapRef: React.RefObject<MlMap | null>; mapReady: boolean; active: Active }

interface Ac { hex: string; lat: number; lon: number; trk: number; gs: number; alt: number | 'ground' | null; t0: number; raw: any }

async function getJson(path: string, signal?: AbortSignal): Promise<any> {
  const r = await fetch(`${API}/${path}`, { signal, cache: 'no-store' });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const pt = (lon: number, lat: number, properties: any): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties });

export default function ClydeLayers({ mapRef, mapReady, active }: Props) {
  const [sel, setSel] = useState<ClydeSelection | null>(null);
  const [stats, setStats] = useState<ClydeStats>({});
  const selRef = useRef<ClydeSelection | null>(null);
  selRef.current = sel;
  const activeRef = useRef(active);
  activeRef.current = active;

  const cfg = useRef<any>(null);
  const net = useRef<any>(null);
  const aircraft = useRef(new Map<string, Ac>());
  const trails = useRef(new Map<string, [number, number, string][]>());
  const vessels = useRef(new Map<number, any>());
  // AISHub's worldwide snapshot outside our box (Clyde Watch /api/ais/world), mmsi -> vessel.
  const world = useRef(new Map<number, any>());
  const aprs = useRef(new Map<string, any>());
  const incidents = useRef(new Map<number, any>());
  const dirty = useRef({ ships: false, aprs: false, inc: false });

  const [following, setFollowing] = useState(false);
  const followRef = useRef(false);
  followRef.current = following;

  const on = (k: string) => !!active[k];

  /** Keeps the camera on the selected aircraft or ship while Follow is on. */
  function follow(f?: GeoJSON.Feature) {
    const map = mapRef.current;
    if (!followRef.current || !map || !f) return;
    map.easeTo({ center: (f.geometry as any).coordinates, duration: 950, easing: t => t });
  }

  /** Range rings round the Greenock receivers (AIS aerial, ADS-B Pi). */
  function setRings() {
    const lat0 = (55.9587 * Math.PI) / 180, lon0 = (-4.7656 * Math.PI) / 180;
    const feats = [25, 50, 100, 150, 200].map(nm => {
      const d = nm / 3440.065;
      const ring: number[][] = [];
      for (let b = 0; b <= 360; b += 3) {
        const br = (b * Math.PI) / 180;
        const la = Math.asin(Math.sin(lat0) * Math.cos(d) + Math.cos(lat0) * Math.sin(d) * Math.cos(br));
        const lo = lon0 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat0), Math.cos(d) - Math.sin(lat0) * Math.sin(la));
        ring.push([(lo * 180) / Math.PI, (la * 180) / Math.PI]);
      }
      return { type: 'Feature', geometry: { type: 'LineString', coordinates: ring }, properties: { label: `${nm} NM · GREENOCK` } } as GeoJSON.Feature;
    });
    setData('clyde-rings', fc(feats));
  }
  const anyLive = on('clyde_ais') || on('clyde_aprs') || on('clyde_incidents');

  const setData = useCallback((id: string, data: GeoJSON.FeatureCollection) => {
    (mapRef.current?.getSource(id) as GeoJSONSource | undefined)?.setData(data);
  }, [mapRef]);

  /* ── Sources and layers, once ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || map.getSource('clyde-ac')) return;
    map.addSource('clyde-rings', { type: 'geojson', data: EMPTY });
    for (const id of ['clyde-lx', 'clyde-wtr', 'clyde-wtr-links', 'clyde-nav', 'clyde-heat', 'clyde-stn', 'clyde-inc', 'clyde-aprs',
      'clyde-ship-world', 'clyde-ship-track', 'clyde-ship', 'clyde-ac-trail', 'clyde-ac', 'clyde-sel']) {
      map.addSource(id, { type: 'geojson', data: EMPTY, ...(id === 'clyde-ship' || id === 'clyde-ship-world' ? { attribution: 'Data: <a href="https://www.aishub.net" target="_blank">AISHub contributors</a>' } : {}) });
    }
    const T = (field: any, size = 10) => ({ 'text-field': field, 'text-size': size, 'text-font': ['Open Sans Regular'], 'text-allow-overlap': false } as any);
    const HALO = { 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.4 };
    const catColor: any = ['match', ['get', 'c'], ...WTR_CATS.flatMap(c => [c.key, c.color]), '#94a3b8'];

    // Range rings around our receivers at Greenock.
    map.addLayer({ id: 'clyde-rings', type: 'line', source: 'clyde-rings', paint: {
      'line-color': '#00e5ff', 'line-opacity': 0.28, 'line-width': 1, 'line-dasharray': [4, 3] } });
    map.addLayer({ id: 'clyde-rings-label', type: 'symbol', source: 'clyde-rings', layout: {
      'symbol-placement': 'line', 'text-field': ['get', 'label'], 'text-size': 9, 'text-font': ['Open Sans Regular'], 'symbol-spacing': 420 },
      paint: { 'text-color': '#67e8f9', 'text-opacity': 0.75, ...HALO } });
    setRings();

    // Lightning: newest strikes white-hot, cooling to red over the hour.
    map.addLayer({ id: 'clyde-lx-glow', type: 'circle', source: 'clyde-lx', filter: ['<', ['get', 'age'], 300], paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 6, 9, 14], 'circle-color': '#fff7c2', 'circle-opacity': 0.25, 'circle-blur': 1 } });
    map.addLayer({ id: 'clyde-lx', type: 'circle', source: 'clyde-lx', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 1.8, 9, 4],
      'circle-color': ['interpolate', ['linear'], ['get', 'age'], 0, '#ffffff', 120, '#fff176', 600, '#ffb300', 1800, '#ff5722', 3600, '#b71c1c'],
      'circle-opacity': ['interpolate', ['linear'], ['get', 'age'], 0, 1, 3600, 0.45] } });

    // WTR: fixed-link paths under the sites they join.
    map.addLayer({ id: 'clyde-wtr-links', type: 'line', source: 'clyde-wtr-links', paint: {
      'line-color': '#f59e0b', 'line-opacity': 0.45, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 13, 1.6], 'line-dasharray': [3, 2] } });
    map.addLayer({ id: 'clyde-wtr', type: 'circle', source: 'clyde-wtr', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.6, 12, 4.5, 15, 6.5], 'circle-color': catColor, 'circle-opacity': 0.88,
      'circle-stroke-color': 'rgba(0,0,0,0.7)', 'circle-stroke-width': 0.8 } });
    map.addLayer({ id: 'clyde-wtr-label', type: 'symbol', source: 'clyde-wtr', minzoom: 13, layout: { ...T(['get', 'label'], 9), 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-max-width': 14 },
      paint: { 'text-color': catColor, ...HALO } });

    // Aero navaids: beacons as rings, aerodromes as filled squares-ish dots.
    map.addLayer({ id: 'clyde-nav-beacon', type: 'circle', source: 'clyde-nav', filter: ['==', ['get', 'k'], 'beacon'], paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 10, 6], 'circle-color': 'rgba(56,189,248,0.15)', 'circle-stroke-color': '#38bdf8', 'circle-stroke-width': 1.6 } });
    map.addLayer({ id: 'clyde-nav-field', type: 'circle', source: 'clyde-nav', filter: ['==', ['get', 'k'], 'aerodrome'], paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 10, 5], 'circle-color': '#fbbf24', 'circle-opacity': 0.85, 'circle-stroke-color': '#000', 'circle-stroke-width': 0.8 } });
    map.addLayer({ id: 'clyde-nav-label', type: 'symbol', source: 'clyde-nav', minzoom: 7, layout: { ...T(['get', 'id'], 9), 'text-offset': [0, 1], 'text-anchor': 'top' },
      paint: { 'text-color': ['match', ['get', 'k'], 'beacon', '#7dd3fc', '#fcd34d'], ...HALO } });

    // SFRS: incident heat, stations, incidents (newest pulse).
    map.addLayer({ id: 'clyde-heat', type: 'heatmap', source: 'clyde-heat', maxzoom: 13, paint: {
      'heatmap-weight': ['coalesce', ['get', 'w'], 1], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 12, 2.2],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 5, 8, 9, 18, 12, 30],
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.15, 'rgba(120,20,10,0.45)', 0.4, 'rgba(220,60,20,0.7)', 0.7, 'rgba(255,150,30,0.85)', 1, 'rgba(255,240,170,0.95)'],
      'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.85, 13, 0.25] } });
    map.addLayer({ id: 'clyde-stn', type: 'circle', source: 'clyde-stn', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 10, 6, 14, 8], 'circle-color': ['get', 'col'],
      'circle-stroke-color': '#fff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 6, 0.8, 12, 1.6], 'circle-opacity': 0.95 } });
    map.addLayer({ id: 'clyde-stn-label', type: 'symbol', source: 'clyde-stn', minzoom: 8.5, layout: { ...T(['get', 'label'], 10), 'text-offset': [0, 1.15], 'text-anchor': 'top' },
      paint: { 'text-color': '#ffd7d2', ...HALO } });
    map.addLayer({ id: 'clyde-inc-pulse', type: 'circle', source: 'clyde-inc', filter: ['==', ['get', 'fresh'], 1], paint: {
      'circle-radius': 10, 'circle-color': 'rgba(255,59,48,0)', 'circle-stroke-color': '#ff3b30', 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.8 } });
    map.addLayer({ id: 'clyde-inc', type: 'circle', source: 'clyde-inc', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, ['*', ['get', 'r'], 0.6], 12, ['get', 'r']],
      'circle-color': ['get', 'col'], 'circle-opacity': ['get', 'op'], 'circle-stroke-color': 'rgba(0,0,0,0.75)', 'circle-stroke-width': 1,
      'circle-blur': 0.1 } });
    map.addLayer({ id: 'clyde-inc-label', type: 'symbol', source: 'clyde-inc', minzoom: 11.5, layout: { ...T(['get', 'label'], 9), 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-max-width': 16 },
      paint: { 'text-color': ['get', 'col'], ...HALO } });

    // APRS.
    map.addLayer({ id: 'clyde-aprs', type: 'circle', source: 'clyde-aprs', paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 3, 11, 5.5], 'circle-color': '#c084fc', 'circle-opacity': ['get', 'op'],
      'circle-stroke-color': '#2e1065', 'circle-stroke-width': 1.2 } });
    map.addLayer({ id: 'clyde-aprs-label', type: 'symbol', source: 'clyde-aprs', minzoom: 8, layout: { ...T(['get', 'name'], 9), 'text-offset': [0, 1], 'text-anchor': 'top' },
      paint: { 'text-color': '#e9d5ff', ...HALO } });

    // Ships: track of the selected one, watched-vessel rings, the dart/disc, names.
    map.addLayer({ id: 'clyde-ship-track', type: 'line', source: 'clyde-ship-track', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
      'line-color': '#22d3ee', 'line-width': 2, 'line-opacity': 0.75 } });
    map.addLayer({ id: 'clyde-ship-ring', type: 'circle', source: 'clyde-ship', filter: ['has', 'ring'], paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 7, 11, 13], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'ring'], 'circle-stroke-width': 2 } });
    // AISHub worldwide (outside our box): below our own ships, a touch fainter, refreshed once a minute.
    map.addLayer({ id: 'clyde-ship-world', type: 'symbol', source: 'clyde-ship-world', layout: {
      'icon-image': ['get', 'icon'], 'icon-size': SHIP_SIZE_BY_ZOOM, 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': 0.6 } });
    map.addLayer({ id: 'clyde-ship', type: 'symbol', source: 'clyde-ship', layout: {
      'icon-image': ['get', 'icon'], 'icon-size': SHIP_SIZE_BY_ZOOM, 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true, 'icon-ignore-placement': true }, paint: { 'icon-opacity': ['get', 'op'] } });
    map.addLayer({ id: 'clyde-ship-label', type: 'symbol', source: 'clyde-ship', filter: ['==', ['get', 'lbl'], 1], layout: {
      ...T(['get', 'name'], 9), 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-font': ['Open Sans Bold'] },
      paint: { 'text-color': '#e6edf3', ...HALO } });

    // Aircraft: altitude-coloured trails, the silhouettes, callsigns.
    map.addLayer({ id: 'clyde-ac-trail', type: 'line', source: 'clyde-ac-trail', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
      'line-color': ['get', 'col'], 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.2, 10, 2.4], 'line-opacity': ['get', 'op'] } });
    map.addLayer({ id: 'clyde-ac-ring', type: 'circle', source: 'clyde-ac', filter: ['has', 'ring'], paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 9, 10, 17], 'circle-color': 'rgba(0,0,0,0)',
      'circle-stroke-color': ['get', 'ring'], 'circle-stroke-width': ['case', ['has', 'emg'], 2.5, 1.4], 'circle-stroke-opacity': 0.9 } });
    map.addLayer({ id: 'clyde-ac', type: 'symbol', source: 'clyde-ac', layout: {
      'icon-image': ['get', 'icon'], 'icon-size': ICON_SIZE_BY_ZOOM, 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['get', 'sort'] } });
    map.addLayer({ id: 'clyde-ac-label', type: 'symbol', source: 'clyde-ac', filter: ['==', ['get', 'lbl'], 1], layout: {
      ...T(['get', 'cs'], 9.5), 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-font': ['Open Sans Bold'] },
      paint: { 'text-color': '#f1f5f9', ...HALO } });

    // The selection ring rides on top of everything.
    map.addLayer({ id: 'clyde-sel', type: 'circle', source: 'clyde-sel', paint: {
      'circle-radius': 17, 'circle-color': 'rgba(0,229,255,0.08)', 'circle-stroke-color': '#00e5ff', 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.95 } });
  }, [mapReady, mapRef]);

  /* ── Visibility ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !map.getLayer('clyde-ac')) return;
    const vis = (ids: string[], v: boolean) => ids.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none'));
    vis(['clyde-ac', 'clyde-ac-label', 'clyde-ac-ring'], on('clyde_adsb'));
    vis(['clyde-ac-trail'], on('clyde_adsb'));
    vis(['clyde-ship', 'clyde-ship-ring', 'clyde-ship-label', 'clyde-ship-track'], on('clyde_ais'));
    vis(['clyde-ship-world'], on('clyde_ais') && on('clyde_ais_world'));
    vis(['clyde-aprs', 'clyde-aprs-label'], on('clyde_aprs'));
    vis(['clyde-inc', 'clyde-inc-pulse', 'clyde-inc-label'], on('clyde_incidents'));
    vis(['clyde-heat'], on('clyde_incidents') && on('clyde_incident_heat'));
    vis(['clyde-stn', 'clyde-stn-label'], on('clyde_stations'));
    vis(['clyde-wtr', 'clyde-wtr-label', 'clyde-wtr-links'], on('clyde_wtr'));
    vis(['clyde-nav-beacon', 'clyde-nav-field', 'clyde-nav-label'], on('clyde_navaids'));
    vis(['clyde-lx', 'clyde-lx-glow'], on('clyde_lightning'));
    vis(['clyde-rings', 'clyde-rings-label'], on('clyde_rings'));
    // Ships we already have (by MMSI) are drawn once, as ours.
    if (!on('clyde_ais')) ['ship-dots', 'ship-label'].forEach(id => map.getLayer(id) && map.setFilter(id, null));
    // Our ADS-B is the better picture over Scotland: drop Osiris's copies of the same airframes.
    if (!on('clyde_adsb')) OSIRIS_FLIGHT_LAYERS.forEach(id => map.getLayer(id) && map.setFilter(id, null));
  });

  /* ── Config + SFRS network, once ── */
  useEffect(() => {
    if (!mapReady) return;
    const ac = new AbortController();
    getJson('_cfg', ac.signal).then(c => { cfg.current = c; drawStations(); drawShips(); }).catch(() => {});
    getJson('sfrs-network', ac.signal).then(n => { net.current = n; drawStations(); setStats(s => ({ ...s, sfrsSilentH: n?.coverage?.silent_for_h })); }).catch(() => {});
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  /* ── ADS-B: poll, dead-reckon, trail ── */
  const drawAircraft = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const now = Date.now();
    const a = activeRef.current;
    const labels = !!a.clyde_adsb_labels;
    const selHex = selRef.current?.kind === 'ac' ? selRef.current.id : null;
    const catFilter = Object.values(CAT_SWITCH).some(k => !!a[k]);
    const feats: GeoJSON.Feature[] = [];
    for (const p of aircraft.current.values()) {
      let { lat, lon } = p;
      const airborne = p.alt !== 'ground' && p.gs > 30;
      if (airborne) {
        const dt = Math.min(now - p.t0, 45000) / 1000;
        const nm = (p.gs / 3600) * dt;
        const r = (p.trk * Math.PI) / 180;
        lat += (nm / 60) * Math.cos(r);
        lon += ((nm / 60) * Math.sin(r)) / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
      }
      // Osiris's AVIATION switches (Commercial / Private / Private Jets / Military) filter our aircraft
      // too, but only once at least one is on: Osiris starts with all four off, which must not hide ours.
      const cat = flightCategory(p.raw);
      if (catFilter && !a[CAT_SWITCH[cat]]) continue;
      const { shape } = aircraftShape({ category: p.raw.category, type: p.raw.t });
      const ck = a.ac_colour_category ? `c-${cat}` : altKey(p.alt as any);
      const sq = String(p.raw.squawk || '');
      const emergency = sq === '7500' || sq === '7600' || sq === '7700' || (p.raw.emergency && p.raw.emergency !== 'none');
      const military = ((p.raw.dbFlags || 0) & 1) === 1;
      feats.push(pt(lon, lat, {
        ...(emergency ? { ring: '#ff3b30', emg: 1 } : military ? { ring: '#a78bfa' } : {}),
        hex: p.hex, icon: `ac:${shape}:${ck}`, rot: AC_SHAPES[shape]?.noRotate ? 0 : p.trk,
        cs: (p.raw.flight || '').trim() || p.raw.r || p.hex, lbl: labels || p.hex === selHex ? 1 : 0,
        sort: typeof p.alt === 'number' ? p.alt : 0,
      }));
      if (p.hex === selHex) { setData('clyde-sel', fc([pt(lon, lat, {})])); follow(feats[feats.length - 1]); }
    }
    setData('clyde-ac', fc(feats));
  }, [mapRef, setData]);

  const drawTrails = useCallback(() => {
    const showAll = !!activeRef.current.clyde_adsb_trails;
    const selHex = selRef.current?.kind === 'ac' ? selRef.current.id : null;
    const feats: GeoJSON.Feature[] = [];
    for (const [hex, tr] of trails.current) {
      if (!showAll && hex !== selHex) continue;
      for (let i = 1; i < tr.length; i++) {
        feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[tr[i - 1][0], tr[i - 1][1]], [tr[i][0], tr[i][1]]] },
          properties: { col: ALT_COLOR[tr[i][2]] || ALT_UNKNOWN, op: hex === selHex ? 0.95 : 0.25 + 0.5 * (i / tr.length) } });
      }
    }
    setData('clyde-ac-trail', fc(feats));
  }, [setData]);

  useEffect(() => {
    if (!mapReady || !on('clyde_adsb')) { setData('clyde-ac', EMPTY); setData('clyde-ac-trail', EMPTY); return; }
    let stop = false;
    let ac: AbortController | null = null;
    const poll = async () => {
      if (document.hidden) return;
      ac = new AbortController();
      try {
        const d = await getJson('adsb/aircraft', ac.signal);
        const now = Date.now();
        const seen = new Set<string>();
        for (const r of d.ac || []) {
          if (r.lat == null || r.lon == null) continue;
          const hex = String(r.hex || '').toLowerCase();
          seen.add(hex);
          const alt = r.alt_baro === 'ground' ? 'ground' : typeof r.alt_baro === 'number' ? r.alt_baro : null;
          aircraft.current.set(hex, { hex, lat: r.lat, lon: r.lon, trk: r.track ?? r.true_heading ?? 0, gs: r.gs ?? 0, alt, t0: now - (r.seen_pos ?? 0) * 1000, raw: r });
          const tr = trails.current.get(hex) || [];
          const last = tr[tr.length - 1];
          if (!last || Math.abs(last[0] - r.lon) + Math.abs(last[1] - r.lat) > 0.002) {
            tr.push([r.lon, r.lat, altKey(alt as any)]);
            if (tr.length > TRAIL_POINTS) tr.shift();
            trails.current.set(hex, tr);
          }
        }
        for (const k of [...aircraft.current.keys()]) if (!seen.has(k)) { aircraft.current.delete(k); trails.current.delete(k); }
        if (stop) return;
        const map = mapRef.current;
        if (map) {
          const hexes = [...seen];
          const f: any = hexes.length ? ['!', ['in', ['get', 'icao24'], ['literal', hexes]]] : null;
          OSIRIS_FLIGHT_LAYERS.forEach(id => map.getLayer(id) && map.setFilter(id, f));
        }
        setStats(s => ({ ...s, adsb: seen.size, adsbStale: !!d.stale, adsbOk: true }));
        drawAircraft(); drawTrails();
      } catch { if (!stop) setStats(s => ({ ...s, adsbOk: false })); }
    };
    poll();
    const iv = setInterval(poll, 8000);
    const glide = setInterval(() => { if (!document.hidden) drawAircraft(); }, 1000);
    return () => { stop = true; ac?.abort(); clearInterval(iv); clearInterval(glide); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, active.clyde_adsb]);

  useEffect(() => { if (mapReady) { drawAircraft(); drawTrails(); } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active.clyde_adsb_labels, active.clyde_adsb_trails, sel]);

  /* ── Ships, APRS, incidents: one live stream ── */
  function drawShips() {
    const a = activeRef.current;
    if (!a.clyde_ais) return;
    const now = Date.now() / 1000;
    const community = a.clyde_ais_community !== false;
    const labels = !!a.clyde_ais_labels;
    const colours = cfg.current?.aisLabelColors || {};
    const selId = selRef.current?.kind === 'ship' ? Number(selRef.current.id) : null;
    const feats: GeoJSON.Feature[] = [];
    let local = 0, comm = 0;
    for (const v of vessels.current.values()) {
      if (v.lat == null || v.lon == null) continue;
      if (v.community) { comm++; if (!community) continue; } else local++;
      const age = v.last_ts ? now - v.last_ts : 0;
      if (age > 3600) continue;
      const kind = shipKind(v.ship_type);
      const course = v.cog ?? v.heading;
      const moving = shipMoving(v.speed, course);
      const fade = age > 600 ? 0.4 : age > 300 ? 0.65 : 1;
      const props: any = {
        mmsi: v.mmsi, name: v.name || String(v.mmsi), icon: `ship:${kind}:${moving ? 'm' : 's'}`, rot: moving ? course : 0,
        op: +(fade * (v.community ? 0.62 : 1)).toFixed(2), lbl: (labels && v.name) || v.label || v.mmsi === selId ? 1 : 0,
      };
      if (v.label) props.ring = colours[v.label] || '#ffffff';
      feats.push(pt(v.lon, v.lat, props));
      if (v.mmsi === selId) setData('clyde-sel', fc([pt(v.lon, v.lat, {})]));
    }
    setData('clyde-ship', fc(feats));
    setStats(s => ({ ...s, aisLocal: local, aisCommunity: comm }));
    const map = mapRef.current;
    if (map) {
      const ids = [...vessels.current.keys()];
      // A literal list is checked per feature, so past a few thousand just stand Osiris's ships down.
      const f: any = ids.length > 6000 || world.current.size ? ['boolean', false] : ids.length ? ['!', ['in', ['get', 'mmsi'], ['literal', ids]]] : null;
      ['ship-dots', 'ship-label'].forEach(id => map.getLayer(id) && map.setFilter(id, f));
    }
    follow(selId != null ? feats.find(x => (x.properties as any).mmsi === selId) : undefined);
  }

  function drawAprs() {
    const now = Date.now() / 1000;
    const feats: GeoJSON.Feature[] = [];
    for (const s of aprs.current.values()) {
      if (s.lat == null || s.lng == null) continue;
      const age = s.lasttime ? now - s.lasttime : 0;
      feats.push(pt(s.lng, s.lat, { name: s.name, op: age > 3600 ? 0.45 : 0.95 }));
    }
    setData('clyde-aprs', fc(feats));
    setStats(st => ({ ...st, aprs: feats.length }));
  }

  function incidentPos(r: any): [number, number, boolean] | null {
    if (r.lat != null && r.lon != null) return [r.lon, r.lat, true];
    const c = cfg.current?.stationCoords?.[r.station];
    return c ? [c[1], c[0], false] : null;
  }

  function drawIncidents() {
    const now = Date.now() / 1000;
    const feats: GeoJSON.Feature[] = [];
    let latest = 0;
    for (const r of incidents.current.values()) {
      latest = Math.max(latest, r.ts || 0);
      const p = incidentPos(r);
      if (!p) continue;
      const age = now - (r.ts || 0);
      const col = age < 3600 ? '#ff3b30' : age < 86400 ? '#ff7a1a' : age < 7 * 86400 ? '#ffb020' : '#b08850';
      feats.push(pt(p[0], p[1], {
        id: r.id, fresh: age < 3600 ? 1 : 0, col, op: age < 7 * 86400 ? 0.95 : 0.55, r: age < 86400 ? 8 : 5.5,
        label: [r.station_code || r.incident_code, r.incident_type].filter(Boolean).join(' · '),
      }));
    }
    setData('clyde-inc', fc(feats));
    setStats(s => ({ ...s, incidents: feats.length, lastPage: latest || s.lastPage }));
  }

  useEffect(() => {
    if (!mapReady || !anyLive) return;
    let es: EventSource | null = null;
    let retry: any = null;
    const ac = new AbortController();
    // History for the incident layer comes decoded from the REST endpoint; the stream adds new ones.
    getJson(`incidents?since=${INCIDENT_WINDOW_S}&per=1500`, ac.signal).then(d => {
      for (const r of d.rows || []) incidents.current.set(r.id, r);
      dirty.current.inc = true;
    }).catch(() => {});
    const connect = () => {
      es = new EventSource(`${API}/events`);
      es.onopen = () => setStats(s => ({ ...s, liveOk: true }));
      es.onerror = () => { setStats(s => ({ ...s, liveOk: false })); es?.close(); retry = setTimeout(connect, 5000); };
      es.onmessage = ev => {
        let m: any;
        try { m = JSON.parse(ev.data); } catch { return; }
        switch (m.type) {
          case 'init':
            vessels.current.clear();
            for (const v of m.ais_vessels || []) vessels.current.set(v.mmsi, v);
            for (const s of m.aprs_stations || []) aprs.current.set(s.name, s);
            for (const r of m.incidents || []) if (!incidents.current.has(r.id)) incidents.current.set(r.id, r);
            dirty.current = { ships: true, aprs: true, inc: true };
            break;
          case 'ais_vessel': vessels.current.set(m.mmsi, { ...vessels.current.get(m.mmsi), ...m }); dirty.current.ships = true; break;
          case 'ais_vessel_remove': vessels.current.delete(m.mmsi); dirty.current.ships = true; break;
          case 'aprs_station': aprs.current.set(m.name, m); dirty.current.aprs = true; break;
          case 'incident': if (m.id != null) { incidents.current.set(m.id, m); dirty.current.inc = true; } break;
        }
      };
    };
    connect();
    // Batch the stream into one redraw a second: AIS alone can send dozens of updates a second.
    const flush = setInterval(() => {
      if (document.hidden) return;
      const d = dirty.current;
      if (d.ships) { d.ships = false; drawShips(); }
      if (d.aprs) { d.aprs = false; drawAprs(); }
      if (d.inc) { d.inc = false; drawIncidents(); }
    }, 1000);
    return () => { ac.abort(); es?.close(); clearTimeout(retry); clearInterval(flush); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, anyLive]);

  /* ── AIS worldwide: Clyde Watch's AISHub snapshot, once a minute ── */
  const worldOn = on('clyde_ais') && on('clyde_ais_world');
  useEffect(() => {
    if (!mapReady || !worldOn) {
      world.current.clear(); setData('clyde-ship-world', EMPTY); setStats(s => ({ ...s, aisWorld: undefined }));
      if (mapReady && on('clyde_ais')) drawShips();   // puts Osiris's own ships back where ours do not cover
      return;
    }
    const ac = new AbortController();
    const load = async () => {
      if (document.hidden) return;
      try {
        const d = await getJson('ais/world', ac.signal);
        const m = new Map<number, any>();
        for (const [mmsi, lat, lon, cog, speed, heading, ship_type, name, dest, callsign] of d.rows || [])
          m.set(mmsi, { mmsi, lat, lon, cog, speed, heading, ship_type, name, dest, callsign, community: true, world: true, source: 'aishub', last_ts: d.ts });
        world.current = m;
        drawWorld();
        setStats(s => ({ ...s, aisWorld: m.size }));
      } catch { /* next minute */ }
    };
    load();
    const iv = setInterval(load, 60000);
    return () => { ac.abort(); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, worldOn]);

  function drawWorld() {
    const feats: GeoJSON.Feature[] = [];
    for (const v of world.current.values()) {
      if (vessels.current.has(v.mmsi)) continue;
      const course = v.cog ?? v.heading;
      const moving = shipMoving(v.speed, course);
      feats.push(pt(v.lon, v.lat, { mmsi: v.mmsi, name: v.name || String(v.mmsi), icon: `ship:${shipKind(v.ship_type)}:${moving ? 'm' : 's'}`, rot: moving ? course : 0 }));
    }
    setData('clyde-ship-world', fc(feats));
    // Worldwide cover makes Osiris's own (hotspot-only) ships redundant.
    const map = mapRef.current;
    if (map && feats.length) ['ship-dots', 'ship-label'].forEach(id => map.getLayer(id) && map.setFilter(id, ['boolean', false]));
  }

  // Redraw at once when an AVIATION switch or the colour mode changes (the glide timer would take up to a second).
  useEffect(() => { if (mapReady && on('clyde_adsb')) drawAircraft(); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapReady, active.flights, active.private, active.jets, active.military, active.ac_colour_category, drawAircraft]);
  useEffect(() => { if (mapReady) { if (on('clyde_ais')) drawShips(); else setData('clyde-ship', EMPTY); } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mapReady, active.clyde_ais, active.clyde_ais_community, active.clyde_ais_labels, sel]);

  // Fresh incidents breathe: a ring that swells and fades, only while one exists.
  useEffect(() => {
    if (!mapReady || !on('clyde_incidents')) return;
    let raf = 0, last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 60) return;
      last = t;
      const map = mapRef.current;
      if (!map?.getLayer('clyde-inc-pulse')) return;
      const ph = (t % 1800) / 1800;
      map.setPaintProperty('clyde-inc-pulse', 'circle-radius', 8 + ph * 22);
      map.setPaintProperty('clyde-inc-pulse', 'circle-stroke-opacity', 0.9 * (1 - ph));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, active.clyde_incidents]);

  /* ── Incident heat (all history) ── */
  useEffect(() => {
    if (!mapReady || !on('clyde_incidents') || !on('clyde_incident_heat')) return;
    const ac = new AbortController();
    getJson('incidents/heatmap', ac.signal).then((rows: [number, number, number][]) => {
      setData('clyde-heat', fc((rows || []).map(([la, lo, w]) => pt(lo, la, { w }))));
    }).catch(() => {});
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, active.clyde_incidents, active.clyde_incident_heat]);

  /* ── SFRS stations ── */
  function drawStations() {
    const coords = cfg.current?.stationCoords;
    if (!coords) return;
    const areaColors = cfg.current?.areaColors || {};
    const byName = new Map<string, any>();
    for (const s of net.current?.stations || []) byName.set(s.station, s);
    const feats: GeoJSON.Feature[] = [];
    for (const [name, ll] of Object.entries<any>(coords)) {
      const s = byName.get(name);
      feats.push(pt(ll[1], ll[0], {
        name, code: s?.code || '', col: (s && areaColors[s.area]) || '#e5484d',
        label: s?.code ? `${s.code} ${name}` : name,
      }));
    }
    setData('clyde-stn', fc(feats));
  }

  /* ── WTR: what is in view, from zoom 8 ── */
  const wtrCats = WTR_CATS.filter(c => active[`wtr_${c.key}`] !== false).map(c => c.key).join(',');
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !on('clyde_wtr')) { setData('clyde-wtr', EMPTY); setData('clyde-wtr-links', EMPTY); return; }
    let ac: AbortController | null = null;
    let tm: any = null;
    const load = () => {
      ac?.abort();
      if (map.getZoom() < WTR_MIN_ZOOM || !wtrCats) {
        setData('clyde-wtr', EMPTY); setData('clyde-wtr-links', EMPTY);
        setStats(s => ({ ...s, wtr: undefined, wtrZoom: map.getZoom() < WTR_MIN_ZOOM }));
        return;
      }
      const b = map.getBounds();
      ac = new AbortController();
      getJson(`radios?cats=${wtrCats}&bbox=${b.getSouth().toFixed(4)},${b.getWest().toFixed(4)},${b.getNorth().toFixed(4)},${b.getEast().toFixed(4)}&limit=5000`, ac.signal).then(d => {
        const pts: GeoJSON.Feature[] = [];
        const links: GeoJSON.Feature[] = [];
        for (const p of d.pts || []) {
          const f = p.f ? (p.f >= 1000 ? `${(p.f / 1000).toFixed(3)} GHz` : `${p.f} MHz`) : '';
          pts.push(pt(p.lo, p.la, { i: p.i, c: p.c, label: f ? `${p.n} · ${f}` : p.n }));
          if (p.far) links.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[p.lo, p.la], [p.far[1], p.far[0]]] }, properties: {} });
        }
        setData('clyde-wtr', fc(pts)); setData('clyde-wtr-links', fc(links));
        setStats(s => ({ ...s, wtr: d.total, wtrTrunc: !!d.truncated, wtrZoom: false }));
      }).catch(() => {});
    };
    const deb = () => { clearTimeout(tm); tm = setTimeout(load, 350); };
    load();
    map.on('moveend', deb);
    return () => { map.off('moveend', deb); clearTimeout(tm); ac?.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, active.clyde_wtr, wtrCats]);

  /* ── Lightning (Clyde Watch keeps the last hour from Blitzortung) ── */
  useEffect(() => {
    if (!mapReady || !on('clyde_lightning')) { setData('clyde-lx', EMPTY); return; }
    const ac = new AbortController();
    const load = () => {
      if (document.hidden) return;
      getJson('lightning', ac.signal).then(d => {
        const now = d.now || Date.now();
        setData('clyde-lx', fc((d.strikes || []).map(([ts, la, lo]: number[]) => pt(lo, la, { age: Math.max(0, (now - ts) / 1000) }))));
      }).catch(() => {});
    };
    load();
    const iv = setInterval(load, 20000);
    return () => { ac.abort(); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, active.clyde_lightning]);

  /* ── Navaids (small, fetched once) ── */
  useEffect(() => {
    if (!mapReady || !on('clyde_navaids')) return;
    const ac = new AbortController();
    getJson('navaids', ac.signal).then(d => {
      const feats = [...(d.beacons || []), ...(d.fields || [])].map((b: any) => pt(b.lo, b.la, { k: b.k, id: b.id || b.icao || '', ref: JSON.stringify(b) }));
      setData('clyde-nav', fc(feats));
    }).catch(() => {});
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, active.clyde_navaids]);

  /** Select something and (optionally) fly to it. */
  const pick = useCallback((s: ClydeSelection, at?: [number, number], fly = false) => {
    setSel(s);
    setFollowing(false);
    if (at) setData('clyde-sel', fc([pt(at[0], at[1], {})]));
    const map = mapRef.current;
    if (fly && at && map) map.flyTo({ center: at, zoom: Math.max(map.getZoom(), s.kind === 'ac' ? 9 : 11), duration: 1600, essential: true });
  }, [mapRef, setData]);

  /** The find box: aircraft, vessels, fire stations and APRS calls that match. */
  const search = useCallback((q: string): SearchHit[] => {
    const t = q.trim().toUpperCase();
    if (t.length < 2) return [];
    const out: SearchHit[] = [];
    for (const a of aircraft.current.values()) {
      const r = a.raw, cs = (r.flight || '').trim();
      if ([cs, r.r, a.hex.toUpperCase(), r.t].some((x: string) => x && String(x).toUpperCase().includes(t)))
        out.push({ key: 'ac' + a.hex, label: cs || r.r || a.hex.toUpperCase(), sub: [r.t, r.r, typeof a.alt === 'number' ? `${a.alt} ft` : a.alt].filter(Boolean).join(' · '), color: '#ffee00',
          go: () => pick({ kind: 'ac', id: a.hex, data: r }, [a.lon, a.lat], true) });
      if (out.length >= 10) break;
    }
    for (const v of vessels.current.values()) {
      if (out.length >= 14) break;
      if (v.lat == null) continue;
      if ([v.name, String(v.mmsi), v.callsign].some((x: string) => x && String(x).toUpperCase().includes(t)))
        out.push({ key: 'v' + v.mmsi, label: v.name || String(v.mmsi), sub: `MMSI ${v.mmsi}${v.community ? '' : ' · our aerial'}`, color: '#00ff7f',
          go: () => pick({ kind: 'ship', id: String(v.mmsi), data: v }, [v.lon, v.lat], true) });
    }
    const coords = cfg.current?.stationCoords || {};
    for (const s of net.current?.stations || []) {
      if (out.length >= 18) break;
      const ll = coords[s.station];
      if (ll && [s.code, s.station].some((x: string) => x && x.toUpperCase().includes(t)))
        out.push({ key: 's' + s.code, label: `${s.code} ${s.station}`, sub: `SFRS · ${s.area}`, color: '#ff7a1a',
          go: () => pick({ kind: 'station', id: s.station, data: s }, [ll[1], ll[0]], true) });
    }
    for (const a of aprs.current.values()) {
      if (out.length >= 22) break;
      if (a.lat != null && a.name.toUpperCase().includes(t))
        out.push({ key: 'a' + a.name, label: a.name, sub: 'APRS', color: '#c084fc', go: () => pick({ kind: 'aprs', id: a.name, data: a }, [a.lng, a.lat], true) });
    }
    return out;
  }, [pick]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const stop = () => setFollowing(false);
    map.on('dragstart', stop);
    return () => { map.off('dragstart', stop); };
  }, [mapReady, mapRef]);

  /* ── Clicks, hover names, the selection ── */
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    let hover: MlPopup | null = null;
    const click = (e: MapMouseEvent & { features?: any[] }) => {
      const f = e.features?.[0];
      if (!f) return;
      const p = f.properties || {};
      const L = f.layer.id;
      let s: ClydeSelection | null = null;
      if (L === 'clyde-ac') { const a = aircraft.current.get(p.hex); if (a) s = { kind: 'ac', id: p.hex, data: a.raw }; }
      else if (L === 'clyde-ship' || L === 'clyde-ship-world') { const v = vessels.current.get(Number(p.mmsi)) || world.current.get(Number(p.mmsi)); if (v) s = { kind: 'ship', id: String(p.mmsi), data: v }; }
      else if (L === 'clyde-aprs') { const a = aprs.current.get(p.name); if (a) s = { kind: 'aprs', id: p.name, data: a }; }
      else if (L === 'clyde-inc') { const r = incidents.current.get(Number(p.id)); if (r) s = { kind: 'incident', id: String(p.id), data: r }; }
      else if (L === 'clyde-stn') {
        const n = (net.current?.stations || []).find((x: any) => x.station === p.name);
        s = { kind: 'station', id: p.name, data: n || { station: p.name } };
      }
      else if (L === 'clyde-wtr') s = { kind: 'wtr', id: String(p.i), data: { i: p.i, c: p.c, label: p.label } };
      else if (L === 'clyde-nav-beacon' || L === 'clyde-nav-field') s = { kind: 'navaid', id: p.id, data: JSON.parse(p.ref || '{}') };
      if (s) pick(s, f.geometry?.coordinates);
    };
    const names: Record<string, (p: any) => string> = {
      'clyde-ac': p => p.cs, 'clyde-ship': p => p.name, 'clyde-ship-world': p => p.name, 'clyde-aprs': p => p.name, 'clyde-inc': p => p.label,
      'clyde-stn': p => p.label, 'clyde-wtr': p => p.label, 'clyde-nav-beacon': p => p.id, 'clyde-nav-field': p => p.id,
    };
    const enter = (e: any) => {
      map.getCanvas().style.cursor = 'pointer';
      const f = e.features?.[0];
      const text = f && names[f.layer.id]?.(f.properties || {});
      if (!text) return;
      hover?.remove();
      const el = document.createElement('div');
      el.textContent = text;
      el.style.cssText = 'font:600 10px/1.2 "JetBrains Mono",monospace;letter-spacing:.06em;color:#e6edf3';
      hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14, className: 'clyde-hover' })
        .setLngLat(f.geometry.coordinates).setDOMContent(el).addTo(map);
    };
    const leave = () => { map.getCanvas().style.cursor = ''; hover?.remove(); hover = null; };
    const ids = Object.keys(names);
    ids.forEach(id => { map.on('click', id, click); map.on('mouseenter', id, enter); map.on('mouseleave', id, leave); });
    return () => { ids.forEach(id => { map.off('click', id, click); map.off('mouseenter', id, enter); map.off('mouseleave', id, leave); }); hover?.remove(); };
  }, [mapReady, mapRef, pick]);

  // Selected ship: draw its stored track.
  useEffect(() => {
    if (!mapReady) return;
    setData('clyde-ship-track', EMPTY);
    if (sel?.kind !== 'ship') return;
    const ac = new AbortController();
    getJson(`ais/track/${encodeURIComponent(sel.id)}`, ac.signal).then((rows: any[]) => {
      const c = (rows || []).filter(r => r.lat != null).map(r => [r.lon, r.lat]);
      if (c.length > 1) setData('clyde-ship-track', fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: {} }]));
    }).catch(() => {});
    return () => ac.abort();
  }, [mapReady, sel, setData]);

  const close = useCallback(() => { setSel(null); setFollowing(false); setData('clyde-sel', EMPTY); setData('clyde-ship-track', EMPTY); }, [setData]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && selRef.current) close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [close]);

  const anyOn = ['clyde_rings', 'clyde_lightning', 'clyde_adsb', 'clyde_ais', 'clyde_aprs', 'clyde_incidents', 'clyde_stations', 'clyde_wtr', 'clyde_navaids'].some(on);
  return (
    <>
      {anyOn && <ClydeStatus stats={stats} active={active} onSearch={search} />}
      {sel && <ClydeCard sel={sel} live={sel.kind === 'ac' ? aircraft.current.get(sel.id)?.raw : sel.kind === 'ship' ? vessels.current.get(Number(sel.id)) : undefined}
        cfg={cfg.current} net={net.current} onClose={close}
        following={following} onFollow={sel.kind === 'ac' || sel.kind === 'ship' ? () => setFollowing(f => !f) : undefined} />}
    </>
  );
}
