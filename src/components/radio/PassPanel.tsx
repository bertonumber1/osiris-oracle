'use client';
/* Upcoming passes over Greenock: countdowns, max elevation, rise and set
   directions, downlink, and a sky plot of the selected pass with the
   satellite's live position on it while it is up. */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Satellite } from 'lucide-react';
import type { SatRec } from '@/lib/radio/sgp4';
import { compass, lookAt, QTH, type Pass } from '@/lib/radio/passes';

const KIND_COLOR: Record<string, string> = { wx: '#38bdf8', iss: '#fbbf24', ham: '#a3e635' };
type Tab = 'wx' | 'ham';

function hhmm(t: number) { return new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
function until(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

function SkyPlot({ pass, live }: { pass: Pass; live: { az: number; el: number } | null }) {
  const R = 64, C = 72;
  const xy = (az: number, el: number) => { const r = R * (1 - el / 90), a = (az - 90) * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  const path = pass.sky.map(([az, el], i) => `${i ? 'L' : 'M'}${xy(az, el).map(v => v.toFixed(1)).join(' ')}`).join('');
  const c = KIND_COLOR[pass.kind];
  const [ax, ay] = xy(pass.sky[0][0], pass.sky[0][1]);
  const [lx, ly] = xy(pass.sky[pass.sky.length - 1][0], pass.sky[pass.sky.length - 1][1]);
  return (
    <svg viewBox="0 0 144 144" className="h-[132px] w-[132px] flex-shrink-0" aria-label="Sky plot">
      <circle cx={C} cy={C} r={R} fill="rgba(0,0,0,0.35)" stroke="rgba(255,255,255,0.14)" />
      <circle cx={C} cy={C} r={R * 2 / 3} fill="none" stroke="rgba(255,255,255,0.08)" />
      <circle cx={C} cy={C} r={R / 3} fill="none" stroke="rgba(255,255,255,0.08)" />
      <line x1={C} y1={C - R} x2={C} y2={C + R} stroke="rgba(255,255,255,0.06)" />
      <line x1={C - R} y1={C} x2={C + R} y2={C} stroke="rgba(255,255,255,0.06)" />
      {(['N', 'E', 'S', 'W'] as const).map((d, i) => {
        const [x, y] = xy(i * 90, -12);
        return <text key={d} x={x} y={y + 3} textAnchor="middle" fontSize="8" fill="rgba(255,255,255,0.45)" fontFamily="monospace">{d}</text>;
      })}
      <path d={path} fill="none" stroke={c} strokeWidth="2" strokeLinecap="round" opacity="0.9" />
      <circle cx={ax} cy={ay} r="2.5" fill="#3fb950" />
      <circle cx={lx} cy={ly} r="2.5" fill="#ff5c5c" />
      {live && live.el > 0 && (() => { const [x, y] = xy(live.az, live.el); return <g><circle cx={x} cy={y} r="7" fill={c} opacity="0.25"><animate attributeName="r" values="4;9;4" dur="1.6s" repeatCount="indefinite" /></circle><circle cx={x} cy={y} r="3.2" fill="#fff" /></g>; })()}
    </svg>
  );
}

export default function PassPanel({ passes, loading, selected, onPick, recs }: { passes: Pass[]; loading: boolean; selected: Pass | null; onPick: (p: Pass | null) => void; recs: Map<string, SatRec> }) {
  const [tab, setTab] = useState<Tab>('wx');
  const [open, setOpen] = useState(true);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);

  const list = useMemo(() => passes.filter(p => p.los > now && (tab === 'wx' ? p.kind !== 'ham' : p.kind !== 'wx')).slice(0, 12), [passes, now, tab]);
  const sel = selected && selected.los > now ? selected : null;
  const live = sel ? lookAt(recs.get(sel.name)!, new Date(now)) : null;
  const next = list[0];

  return (
    <div className="pointer-events-auto absolute bottom-[150px] right-16 z-[300] w-[312px] overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-panel)] font-mono shadow-[0_12px_36px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
      <button onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <Satellite className="h-3.5 w-3.5 text-[#38bdf8]" />
        <span className="text-[9.5px] font-bold tracking-[0.2em] text-[var(--text-heading)]">PASSES · {QTH.name}</span>
        {!open && next && <span className="ml-1 truncate text-[9px] text-[var(--text-secondary)]">{next.name.replace(/\s*\(.*\)$/, '')} {next.aos <= now ? 'UP NOW' : `in ${until(next.aos - now)}`}</span>}
        <span className="ml-auto text-[var(--text-muted)]">{open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}</span>
      </button>
      {open && (
        <>
          <div className="flex gap-1 px-3 pb-1.5">
            {([['wx', 'WEATHER + ISS'], ['ham', 'ISS + AMATEUR']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`rounded px-2 py-0.5 text-[8.5px] tracking-[0.14em] ${tab === k ? 'bg-white/10 text-white' : 'text-[var(--text-muted)] hover:text-white'}`}>{l}</button>
            ))}
          </div>
          {sel && (
            <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/25 p-1.5">
              <SkyPlot pass={sel} live={live} />
              <div className="min-w-0 flex-1 space-y-1 text-[9.5px]">
                <div className="truncate text-[11px] font-bold" style={{ color: KIND_COLOR[sel.kind] }}>{sel.name}</div>
                {sel.down && <div className="text-[var(--text-secondary)]">{sel.down}</div>}
                <div className="text-[var(--text-muted)]">MAX <span className="text-white">{Math.round(sel.maxEl)}°</span> at {hhmm(sel.tca)}</div>
                <div className="text-[var(--text-muted)]">{compass(sel.aosAz)} → {compass(sel.losAz)} · {Math.round((sel.los - sel.aos) / 60000)} min</div>
                {live && live.el > 0
                  ? <div className="text-[#3fb950]">UP · az {Math.round(live.az)}° el {Math.round(live.el)}°</div>
                  : <div className="text-[var(--text-secondary)]">rises in {until(sel.aos - now)}</div>}
                <button onClick={() => onPick(null)} className="text-[8px] tracking-[0.16em] text-[var(--text-muted)] hover:text-white">CLEAR</button>
              </div>
            </div>
          )}
          <div className="max-h-[260px] overflow-y-auto pb-1.5">
            {loading && <div className="px-3 py-2 text-[9px] tracking-[0.14em] text-[var(--text-muted)]">LOADING ELEMENTS…</div>}
            {!loading && !list.length && <div className="px-3 py-2 text-[9px] tracking-[0.14em] text-[var(--text-muted)]">WORKING OUT PASSES…</div>}
            {list.map(p => {
              const up = p.aos <= now;
              const on = selected?.key === p.key;
              return (
                <button key={p.key} onClick={() => onPick(on ? null : p)}
                  className={`grid w-full grid-cols-[1fr_auto] items-center gap-x-2 px-3 py-1 text-left transition-colors ${on ? 'bg-white/[0.08]' : 'hover:bg-white/[0.04]'}`}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${up ? 'animate-pulse' : ''}`} style={{ background: up ? '#3fb950' : KIND_COLOR[p.kind] }} />
                    <span className="truncate text-[10px] text-[var(--text-heading)]">{p.name.replace(/\s*\(.*\)$/, '')}</span>
                  </span>
                  <span className={`text-right text-[9.5px] tabular-nums ${up ? 'text-[#3fb950]' : 'text-[var(--text-secondary)]'}`}>{up ? 'UP NOW' : until(p.aos - now)}</span>
                  <span className="truncate pl-3 text-[8.5px] text-[var(--text-muted)]">{hhmm(p.aos)}–{hhmm(p.los)} · {compass(p.aosAz)}→{compass(p.losAz)}{p.down ? ` · ${p.down}` : ''}</span>
                  <span className="text-right text-[9px] tabular-nums" style={{ color: p.maxEl >= 45 ? '#3fb950' : p.maxEl >= 25 ? '#ffd60a' : '#94a3b8' }}>{Math.round(p.maxEl)}°</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
