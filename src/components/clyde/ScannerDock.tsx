'use client';
/* Scanners (phase 4): a dock for the SDS200E and the 785XLT, both driven by
   Clyde Watch through /api/clyde.
   - SDS200E: the scanner's own display (STS rows), listen, hold / avoid / scan,
     VOL and SQL, record, and the latest hits.
   - 785XLT: the 4-line LCD mirror over the serial cable, listen, the keypad.
   - Map: each SDS200E hit is matched by frequency to the nearest Ofcom WTR site
     licensed on it, which pulses while the channel is live and fades after. */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Map as MlMap, GeoJSONSource } from 'maplibre-gl';
import { ChevronDown, ChevronUp, Headphones, Radio, Square, X } from 'lucide-react';

type Active = Record<string, boolean | undefined>;
interface Props { mapRef: React.RefObject<MlMap | null>; mapReady: boolean; active: Active; onClose: () => void }

const API = '/api/clyde';
const HIT_FADE_S = 15 * 60;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

async function get(path: string, signal?: AbortSignal) {
  const r = await fetch(`${API}/${path}`, { signal, cache: 'no-store' });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
async function post(path: string, body: any) {
  const r = await fetch(`${API}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}

interface Hit { id: number; start: number; dur: number; system?: string; dept?: string; channel?: string; freq?: string; mod?: string; tone?: string; tgid?: string; rssi_now?: number; rssi_avg?: number; live?: boolean }
interface Site { i: number; la: number; lo: number; c: string; n: string; km: number }

const ago = (t: number) => { const s = Math.max(0, Date.now() / 1000 - t); return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`; };
const fmtFreq = (f?: string | null) => (f ? String(f).replace(/MHz$/i, '').replace(/0+$/, '').replace(/\.$/, '') : '');

/** One audio stream at a time; the browser holds the connection only while playing. */
function useListen() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const play = useCallback((path: string | null) => {
    if (audio.current) { audio.current.pause(); audio.current.src = ''; audio.current = null; }
    setErr('');
    setSrc(path);
    if (!path) return;
    const a = new Audio(`${API}/${path}?t=${Date.now()}`);
    a.onerror = () => setErr('no audio');
    a.play().catch(() => setErr('blocked'));
    audio.current = a;
  }, []);
  useEffect(() => () => { audio.current?.pause(); }, []);
  return { src, err, play };
}

function Btn({ children, onClick, on, title, wide }: { children: React.ReactNode; onClick: () => void; on?: boolean; title?: string; wide?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={`rounded border px-1.5 py-[3px] font-mono text-[9px] tracking-[0.08em] transition-colors ${wide ? 'col-span-2' : ''} ${on ? 'border-[#2ee6a6]/60 bg-[#2ee6a6]/15 text-[#2ee6a6]' : 'border-white/10 bg-white/[0.03] text-white/75 hover:border-white/30 hover:text-white'}`}>
      {children}
    </button>
  );
}

function Level({ label, value, onSet }: { label: string; value: number | null; onSet: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1 font-mono text-[9px] text-white/60">
      <span className="w-6 tracking-[0.1em]">{label}</span>
      <button type="button" className="h-4 w-4 rounded border border-white/10 hover:border-white/30" onClick={() => value != null && onSet(Math.max(0, value - 1))}>-</button>
      <span className="w-4 text-center tabular-nums text-white">{value ?? '-'}</span>
      <button type="button" className="h-4 w-4 rounded border border-white/10 hover:border-white/30" onClick={() => value != null && onSet(Math.min(15, value + 1))}>+</button>
    </div>
  );
}

export default function ScannerDock({ mapRef, mapReady, active, onClose }: Props) {
  const open = !!active.scanners;
  const hitsOn = open && active.scanner_hits !== false;
  // The satellite pass panel sits below on the same side: keep the dock short when it is up.
  const satsOpen = !!active.wx_sats || !!active.ham_sats;
  const [tab, setTab] = useState<'sds' | 'xlt'>('sds');
  const [min, setMin] = useState(false);
  const listen = useListen();

  /* ── SDS200E ── */
  const [info, setInfo] = useState<any>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [live, setLive] = useState<Hit | null>(null);
  const [rec, setRec] = useState(false);
  useEffect(() => {
    if (!open || tab !== 'sds') return;
    const ac = new AbortController();
    const tick = async () => { if (!document.hidden) try { setInfo(await get('sds200/info', ac.signal)); } catch { /* next tick */ } };
    tick();
    const iv = setInterval(tick, 1500);
    return () => { ac.abort(); clearInterval(iv); };
  }, [open, tab]);
  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    const tick = async () => {
      if (document.hidden) return;
      try { const d = await get('sds200/log?limit=12', ac.signal); setHits(d.rows || []); setLive(d.live || null); } catch { /* next tick */ }
    };
    tick();
    const iv = setInterval(tick, 2000);
    return () => { ac.abort(); clearInterval(iv); };
  }, [open]);
  useEffect(() => { if (info?.gsi?.rec) setRec(info.gsi.rec !== 'Off'); }, [info?.gsi?.rec]);
  const sds = (action: string) => post('sds200/control', { action });
  const level = (k: 'vol' | 'sql', v: number) => post('sds200/level', { [k]: v }).then(() => setInfo((i: any) => i ? { ...i, [k]: v } : i));

  /* ── 785XLT ── */
  const [xlt, setXlt] = useState<any>(null);
  const [xltLog, setXltLog] = useState<any[]>([]);
  useEffect(() => {
    if (!open || tab !== 'xlt') return;
    const ac = new AbortController();
    const tick = async () => { if (!document.hidden) try { setXlt(await get('xlt/screen', ac.signal)); } catch { /* next tick */ } };
    const slow = async () => { try { setXltLog((await get('xlt/log', ac.signal)).log || []); } catch { /* next tick */ } };
    tick(); slow();
    const a = setInterval(tick, 1000), b = setInterval(slow, 5000);
    return () => { ac.abort(); clearInterval(a); clearInterval(b); };
  }, [open, tab]);
  const key = (code: string) => post('xlt/key', { code });

  /* ── Map: hits on their WTR site ── */
  const siteCache = useRef(new Map<string, Site | null>());
  const [placed, setPlaced] = useState<{ hit: Hit; site: Site }[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || map.getSource('scan-hits')) return;
    map.addSource('scan-hits', { type: 'geojson', data: EMPTY });
    map.addLayer({ id: 'scan-hit-pulse', type: 'circle', source: 'scan-hits', filter: ['==', ['get', 'live'], 1], paint: {
      'circle-radius': 14, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#ff3b30', 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.8 } });
    map.addLayer({ id: 'scan-hit', type: 'circle', source: 'scan-hits', paint: {
      'circle-radius': ['case', ['==', ['get', 'live'], 1], 7, 5], 'circle-color': ['case', ['==', ['get', 'live'], 1], '#ff3b30', '#ff9f0a'],
      'circle-opacity': ['get', 'op'], 'circle-stroke-color': '#0b1020', 'circle-stroke-width': 1.2 } });
    map.addLayer({ id: 'scan-hit-label', type: 'symbol', source: 'scan-hits', layout: {
      'text-field': ['get', 'label'], 'text-size': 10, 'text-font': ['Open Sans Bold'], 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-allow-overlap': false },
      paint: { 'text-color': ['case', ['==', ['get', 'live'], 1], '#ff6b60', '#ffbf60'], 'text-opacity': ['get', 'op'], 'text-halo-color': 'rgba(0,0,0,0.85)', 'text-halo-width': 1.3 } });
  }, [mapReady, mapRef]);

  useEffect(() => {
    if (!hitsOn) { setPlaced([]); return; }
    let cancelled = false;
    const all = [...(live ? [{ ...live, id: -1 }] : []), ...hits].filter(h => h.freq && Date.now() / 1000 - h.start < HIT_FADE_S);
    (async () => {
      const out: { hit: Hit; site: Site }[] = [];
      const seen = new Set<string>();
      for (const h of all) {
        const f = String(parseFloat(String(h.freq)));
        if (seen.has(f)) continue;
        seen.add(f);
        if (!siteCache.current.has(f)) {
          try { siteCache.current.set(f, (await get(`radios/byfreq?f=${f}&limit=1`)).sites?.[0] || null); } catch { continue; }
        }
        const site = siteCache.current.get(f);
        if (site) out.push({ hit: h, site });
      }
      if (!cancelled) setPlaced(out);
    })();
    return () => { cancelled = true; };
  }, [hitsOn, hits, live]);

  useEffect(() => {
    const src = mapRef.current?.getSource('scan-hits') as GeoJSONSource | undefined;
    if (!src) return;
    src.setData({ type: 'FeatureCollection', features: placed.map(({ hit, site }) => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [site.lo, site.la] },
      properties: { live: hit.live ? 1 : 0, op: +(Math.max(0.25, 1 - (Date.now() / 1000 - hit.start) / HIT_FADE_S)).toFixed(2),
        label: `${hit.channel || fmtFreq(hit.freq)}${hit.live ? ' ●' : ''}` } })) });
  }, [placed, mapRef]);

  // The live ring breathes.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !placed.some(p => p.hit.live)) return;
    let raf = 0;
    const step = (t: number) => {
      const k = (t % 1400) / 1400;
      if (map.getLayer('scan-hit-pulse')) {
        map.setPaintProperty('scan-hit-pulse', 'circle-radius', 8 + 22 * k);
        map.setPaintProperty('scan-hit-pulse', 'circle-stroke-opacity', 0.9 * (1 - k));
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [mapReady, mapRef, placed]);

  const flyTo = (h: Hit) => {
    const p = placed.find(x => x.hit.id === h.id || (x.hit.freq && x.hit.freq === h.freq));
    if (p) mapRef.current?.flyTo({ center: [p.site.lo, p.site.la], zoom: Math.max(mapRef.current.getZoom(), 10), duration: 1200 });
  };
  const siteFor = (h: Hit) => placed.find(x => x.hit.freq === h.freq)?.site;

  // Stop listening when the dock closes.
  useEffect(() => { if (!open) listen.play(null); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;
  const gsi = info?.gsi;
  const rows: { t: string; a: string }[] = info?.sts?.rows || [];

  return (
    <div className="pointer-events-auto absolute right-16 top-[86px] z-[210] max-h-[calc(100vh-110px)] w-[330px] overflow-y-auto rounded-xl border border-[var(--border-primary)] bg-[var(--bg-panel)] font-mono shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
      <div className="flex items-center gap-1 border-b border-white/[0.06] px-2 py-1.5">
        <Radio className="h-3.5 w-3.5 text-[#ff9f0a]" />
        {(['sds', 'xlt'] as const).map(t => (
          <button key={t} type="button" onClick={() => { setTab(t); setMin(false); }}
            className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold tracking-[0.16em] ${tab === t ? 'bg-white/10 text-white' : 'text-white/45 hover:text-white'}`}>
            {t === 'sds' ? 'SDS200E' : '785XLT'}
          </button>
        ))}
        <span className="flex-1" />
        <button type="button" title={listen.src ? 'Stop listening' : 'Listen'} onClick={() => listen.play(listen.src ? null : tab === 'sds' ? 'sds200/audio' : 'scanner/audio')}
          className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] tracking-[0.1em] ${listen.src ? 'border-[#2ee6a6]/60 bg-[#2ee6a6]/15 text-[#2ee6a6]' : 'border-white/10 text-white/70 hover:text-white'}`}>
          {listen.src ? <Square className="h-2.5 w-2.5" /> : <Headphones className="h-3 w-3" />}
          {listen.src ? (listen.src.startsWith('sds') ? 'SDS' : 'XLT') : 'LISTEN'}
        </button>
        {listen.err && <span className="text-[8px] text-[#ff6b60]">{listen.err}</span>}
        <button type="button" onClick={() => setMin(m => !m)} className="p-0.5 text-white/50 hover:text-white" aria-label={min ? 'Expand' : 'Collapse'}>
          {min ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
        <button type="button" onClick={onClose} className="p-0.5 text-white/50 hover:text-white" aria-label="Close"><X className="h-3.5 w-3.5" /></button>
      </div>

      {!min && tab === 'sds' && (
        <div className="flex flex-col gap-2 p-2">
          <div className="rounded-md border border-[#ff9f0a]/25 bg-[#120c02] px-2 py-1.5 shadow-[inset_0_0_18px_rgba(255,159,10,0.08)]">
            {info?.control_alive === false && <div className="text-[10px] text-[#ff6b60]">SDS200E not answering</div>}
            {rows.length ? rows.filter(r => r.t.trim()).slice(0, 9).map((r, i) => (
              <pre key={i} className={`m-0 whitespace-pre text-[10px] leading-[1.35] ${r.a.trim() ? 'bg-[#ffb347] text-black' : 'text-[#ffb347]'}`}>{r.t.trimEnd()}</pre>
            )) : <div className="text-[10px] text-[#ffb347]/60">{info ? '' : 'connecting…'}</div>}
          </div>
          {live && (
            <div className="flex items-center gap-2 rounded-md border border-[#ff3b30]/40 bg-[#ff3b30]/10 px-2 py-1 text-[9.5px] text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff3b30]" />
              <span className="truncate font-bold">{live.channel || live.system || 'LIVE'}</span>
              <span className="text-white/60">{fmtFreq(live.freq)} {live.mod}</span>
              <span className="ml-auto tabular-nums text-white/60">{live.dur}s{live.rssi_now != null ? ` · ${live.rssi_now} dBm` : ''}</span>
            </div>
          )}
          <div className="grid grid-cols-5 gap-1">
            <Btn onClick={() => sds('scan')} title="Resume scanning">SCAN</Btn>
            <Btn onClick={() => sds('channel_hold')} title="Hold on this channel">HOLD</Btn>
            <Btn onClick={() => sds('avoid')} title="Avoid (lock out) this channel">AVOID</Btn>
            <Btn onClick={() => sds('replay')}>REPLAY</Btn>
            <Btn onClick={() => post('sds200/record', { on: !rec }).then(r => r?.ok && setRec(!rec))} on={rec} title="Record to the scanner's SD card">{rec ? 'REC ●' : 'REC'}</Btn>
            <Btn onClick={() => sds('system_hold')}>SYS H</Btn>
            <Btn onClick={() => sds('dept_hold')}>DEPT H</Btn>
            <Btn onClick={() => sds('rot_left')} title="Knob left">◀</Btn>
            <Btn onClick={() => sds('rot_right')} title="Knob right">▶</Btn>
            <Btn onClick={() => sds('select')} title="Knob push">SEL</Btn>
          </div>
          <div className="flex items-center justify-between">
            <Level label="VOL" value={info?.vol ?? null} onSet={v => level('vol', v)} />
            <Level label="SQL" value={info?.sql ?? null} onSet={v => level('sql', v)} />
            <span className="text-[8px] text-white/35" title="VOL is the scanner's speaker only; the stream is unaffected">{gsi?.mode || ''}</span>
          </div>
          <div className="flex flex-col">
            <div className="mb-0.5 flex items-center text-[8px] tracking-[0.18em] text-white/40">
              <span>LAST HITS</span><span className="ml-auto normal-case tracking-normal">{hitsOn ? 'on map: nearest licensed site' : ''}</span>
            </div>
            {hits.slice(0, satsOpen ? 4 : 8).map(h => {
              const site = siteFor(h);
              return (
                <button key={h.id} type="button" onClick={() => flyTo(h)} title={site ? `${site.n} · ${site.km} km` : 'No licensed site on this frequency within 150 km'}
                  className="flex items-center gap-2 rounded px-1 py-[3px] text-left text-[9.5px] hover:bg-white/[0.05]">
                  <span className="w-7 tabular-nums text-white/40">{ago(h.start)}</span>
                  <span className="w-[62px] tabular-nums text-[#ffb347]">{fmtFreq(h.freq)}</span>
                  <span className="flex-1 truncate text-white/80">{h.channel || site?.n || h.system || ''}</span>
                  <span className="tabular-nums text-white/40">{h.dur}s</span>
                </button>
              );
            })}
            {!hits.length && <span className="px-1 text-[9px] text-white/35">No hits logged yet</span>}
          </div>
        </div>
      )}

      {!min && tab === 'xlt' && (
        <div className="flex flex-col gap-2 p-2">
          <div className="rounded-md border border-[#9be15d]/25 bg-[#081004] px-2 py-1.5">
            {xlt?.online ? (xlt.lines || []).map((l: string, i: number) => (
              <pre key={i} className="m-0 whitespace-pre text-[11px] leading-[1.35] text-[#b8f27a]">{l}</pre>
            )) : <div className="text-[10px] text-[#b8f27a]/60">{xlt ? '785XLT offline (serial cable / power)' : 'connecting…'}</div>}
            {xlt?.online && (
              <div className="mt-1 flex items-center gap-2 text-[8.5px] text-[#b8f27a]/70">
                <span>{xlt.mod || ''}</span><span>{xlt.mode || ''}</span>{xlt.mute && <span>MUTE</span>}
                <span className="ml-auto flex h-1.5 w-16 overflow-hidden rounded bg-white/10">
                  <span className="bg-[#b8f27a]" style={{ width: `${Math.min(100, ((xlt.sig || 0) / (xlt.sigmax && xlt.sigmax < 999 ? xlt.sigmax : 255)) * 100)}%` }} />
                </span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-5 gap-1">
            {[['01', 'SCAN'], ['07', 'HOLD'], ['00', 'RSM'], ['09', 'SRCH'], ['10', 'SRVC'],
              ['02 1', '1'], ['02 2', '2'], ['02 3', '3'], ['08', 'LIMIT'], ['11', 'MENU'],
              ['02 4', '4'], ['02 5', '5'], ['02 6', '6'], ['13', 'TRUNK'], ['05', 'PRI'],
              ['02 7', '7'], ['02 8', '8'], ['02 9', '9'], ['06', 'L/O'], ['12', 'MUTE'],
              ['03', '·'], ['02 0', '0'], ['04', 'E']].map(([c, l]) => <Btn key={c} onClick={() => key(c)} title={`KEY${c}`}>{l}</Btn>)}
          </div>
          <div className="flex flex-col">
            <div className="mb-0.5 text-[8px] tracking-[0.18em] text-white/40">RECEPTION LOG</div>
            {xltLog.slice(0, 8).map((e: any, i: number) => (
              <div key={i} className="flex items-center gap-2 px-1 py-[3px] text-[9.5px]">
                <span className="w-7 tabular-nums text-white/40">{e.ts ? ago(e.ts) : ''}</span>
                <span className="w-[62px] tabular-nums text-[#b8f27a]">{fmtFreq(e.freq)}</span>
                <span className="flex-1 truncate text-white/80">{[e.op, e.ctcss || e.dcs].filter(Boolean).join(' · ')}</span>
              </div>
            ))}
            {!xltLog.length && <span className="px-1 text-[9px] text-white/35">Nothing heard yet</span>}
          </div>
        </div>
      )}
    </div>
  );
}
