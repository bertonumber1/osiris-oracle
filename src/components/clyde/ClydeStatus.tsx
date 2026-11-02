'use client';
/* One slim strip with the state of every Clyde Watch feed that is switched on:
   counts, freshness, and the altitude key for the aircraft colours. It stays
   up in kiosk mode, where the rest of the HUD steps back. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { ALT_BANDS } from '@/lib/clyde/symbols';

export interface SearchHit { key: string; label: string; sub: string; color: string; go: () => void }

export interface ClydeStats {
  adsb?: number; adsbOk?: boolean; adsbStale?: boolean;
  aisLocal?: number; aisCommunity?: number; liveOk?: boolean;
  aprs?: number; incidents?: number; lastPage?: number; sfrsSilentH?: number;
  wtr?: number; wtrTrunc?: boolean; wtrZoom?: boolean;
}

function Dot({ ok }: { ok?: boolean }) {
  const c = ok === undefined ? '#6b7280' : ok ? '#3fb950' : '#ff3b30';
  return <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: c, boxShadow: ok ? `0 0 6px ${c}` : undefined }} />;
}

function Item({ label, value, ok, warn, title }: { label: string; value: React.ReactNode; ok?: boolean; warn?: boolean; title?: string }) {
  return (
    <div className="flex items-center gap-1.5 whitespace-nowrap px-2.5" title={title}>
      <Dot ok={ok} />
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className={`tabular-nums ${warn ? 'text-[#ffb020]' : 'text-[var(--text-primary)]'}`}>{value}</span>
    </div>
  );
}

function since(ts?: number): string {
  if (!ts) return '-';
  const h = (Date.now() / 1000 - ts) / 3600;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  if (h < 48) return `${Math.round(h)}h`;
  return `${Math.round(h / 24)}d`;
}

export default function ClydeStatus({ stats: s, active: a, onSearch }: { stats: ClydeStats; active: Record<string, boolean | undefined>; onSearch?: (q: string) => SearchHit[] }) {
  const silent = s.lastPage ? (Date.now() / 1000 - s.lastPage) > 86400 : false;
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // Recomputed with the stats too, so a hit list follows the live data while it is open.
  const hits = useMemo(() => (open && onSearch ? onSearch(q) : []), [open, q, onSearch, s]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => setHi(0), [q]);
  // "/" opens the find box from anywhere on the map.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === '/' && !e.shiftKey && !/INPUT|TEXTAREA/.test(t.tagName) && !t.isContentEditable) { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  const go = (h?: SearchHit) => { if (!h) return; h.go(); setOpen(false); setQ(''); };
  return (
    <div className="absolute bottom-[44px] left-1/2 z-[210] max-w-[calc(100vw-24px)] -translate-x-1/2">
      {open && q.trim().length >= 2 && (
        <div className="pointer-events-auto absolute bottom-[calc(100%+6px)] left-0 w-[320px] overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-panel)] shadow-[0_12px_36px_rgba(0,0,0,0.6)] backdrop-blur-2xl">
          {hits.length === 0 && <div className="px-3 py-2 font-mono text-[9.5px] tracking-[0.12em] text-[var(--text-muted)]">NOTHING MATCHES</div>}
          {hits.map((h, i) => (
            <button key={h.key} onMouseEnter={() => setHi(i)} onClick={() => go(h)}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left ${i === hi ? 'bg-white/[0.07]' : ''}`}>
              <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: h.color }} />
              <span className="truncate font-mono text-[10.5px] text-[var(--text-heading)]">{h.label}</span>
              <span className="ml-auto truncate pl-2 font-mono text-[8.5px] text-[var(--text-muted)]">{h.sub}</span>
            </button>
          ))}
        </div>
      )}
    <div className="pointer-events-auto flex items-center overflow-x-auto rounded-full border border-[var(--border-primary)] bg-[var(--bg-panel)] py-1.5 pl-3 pr-1 font-mono text-[9.5px] tracking-[0.12em] shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
      <span className="whitespace-nowrap pr-1.5 text-[8.5px] font-bold tracking-[0.22em] text-[var(--cyan-primary)]">CLYDE WATCH</span>
      {onSearch && (open ? (
        <div className="mx-1 flex items-center gap-1 rounded-full bg-black/40 px-2 py-0.5">
          <Search className="h-2.5 w-2.5 text-[var(--cyan-primary)]" />
          <input ref={input} value={q} onChange={e => setQ(e.target.value)} placeholder="callsign, ship, MMSI, station"
            onKeyDown={e => {
              if (e.key === 'Escape') { setOpen(false); setQ(''); }
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, hits.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
              if (e.key === 'Enter') go(hits[hi]);
            }}
            className="w-44 bg-transparent font-mono text-[10px] tracking-[0.06em] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none" />
          <button onClick={() => { setOpen(false); setQ(''); }} aria-label="Close find"><X className="h-2.5 w-2.5 text-[var(--text-muted)] hover:text-white" /></button>
        </div>
      ) : (
        <button onClick={() => setOpen(true)} title="Find an aircraft, ship, station or APRS call (/)" aria-label="Find"
          className="mx-1 rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-white/10 hover:text-[var(--cyan-primary)]">
          <Search className="h-3 w-3" />
        </button>
      ))}
      {a.clyde_adsb && (
        <Item label="ADSB" value={s.adsb ?? '-'} ok={s.adsbOk && !s.adsbStale} warn={s.adsbStale}
          title={s.adsbStale ? 'Every source failed: showing the last good picture' : 'Greenock Pi readsb + adsb.lol + airplanes.live + adsb.fi'} />
      )}
      {a.clyde_ais && (
        <Item label="AIS" value={<>{s.aisLocal ?? '-'}<span className="text-[var(--text-muted)]"> / {s.aisCommunity ?? '-'}</span></>} ok={s.liveOk}
          title="Heard on our aerial / from the community (AISHub)" />
      )}
      {a.clyde_aprs && <Item label="APRS" value={s.aprs ?? '-'} ok={s.liveOk} />}
      {a.clyde_incidents && (
        <Item label="SFRS" value={s.lastPage ? `last page ${since(s.lastPage)} ago` : '-'} ok={s.liveOk && !silent} warn={silent}
          title={silent ? 'No pager traffic decoded in over a day: check the SDR and aerial' : `${s.incidents ?? 0} incidents in the last 30 days`} />
      )}
      {a.clyde_wtr && (
        <Item label="WTR" value={s.wtrZoom ? 'zoom in' : s.wtr != null ? `${s.wtr.toLocaleString()}${s.wtrTrunc ? '+' : ''}` : '-'} ok={s.wtrZoom ? undefined : s.wtr != null}
          title={s.wtrTrunc ? 'More sites than can be drawn here: zoom in for all of them' : 'Ofcom Wireless Telegraphy Register sites in view'} />
      )}
      {a.clyde_adsb && !a.ac_colour_category && (
        <div className="ml-1 flex items-center gap-1 rounded-full bg-black/30 px-2 py-1" title="Aircraft colour = altitude (feet)">
          {ALT_BANDS.map(b => (
            <span key={b.key} className="flex flex-col items-center">
              <span className="h-1 w-4 rounded-sm" style={{ background: b.color }} />
              <span className="mt-0.5 text-[7px] tracking-normal text-[var(--text-muted)]">{b.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
    </div>
  );
}
