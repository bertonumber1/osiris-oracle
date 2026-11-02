'use client';
/* PSK Reporter controls: the callsign whose spots are drawn (with what it
   sent, heard and its best distance), an optional radius round IO75OW, and one
   chip per band (click to hide, double-click to solo). */
import { useState } from 'react';
import { BANDS, HOME_GRID } from '@/lib/radio/maidenhead';
import type { PskData } from './RadioLayers';

const RADII = [0, 100, 250, 500, 1000, 2000];

interface Props {
  data: PskData | null;
  call: string; onCall: (c: string) => void;
  radius: number; onRadius: (km: number) => void;
  bandsOff: string[]; onToggleBand: (b: string) => void; onSolo: (b: string) => void; onAll: () => void;
}

export default function PskBar({ data, call, onCall, radius, onRadius, bandsOff, onToggleBand, onSolo, onAll }: Props) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(call);
  const counts = data?.bandCount || {};
  const st = data?.stats;
  return (
    <div className="pointer-events-auto absolute bottom-[88px] left-1/2 z-[209] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 overflow-x-auto rounded-xl border border-[var(--border-primary)] bg-[var(--bg-panel)] px-2.5 py-1.5 font-mono shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
      <div className="flex flex-col pr-1">
        <span className="whitespace-nowrap text-[8.5px] font-bold tracking-[0.22em] text-[#2ee6a6]">PSK REPORTER</span>
        <span className="whitespace-nowrap text-[8px] tracking-[0.1em] text-[var(--text-muted)]">
          <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${data?.connected ? 'bg-[#3fb950] shadow-[0_0_6px_#3fb950]' : 'bg-[#6b7280]'}`} />
          {data?.connected ? `${data.rate}/s live · ${data.paths.length.toLocaleString()} drawn` : 'connecting…'}
        </span>
      </div>
      <div className="flex items-center gap-1 border-l border-white/[0.07] pl-2 pr-1">
        {edit ? (
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value.toUpperCase())}
            onBlur={() => { setEdit(false); onCall(draft.trim()); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(call); setEdit(false); } }}
            className="w-20 rounded bg-black/40 px-1.5 py-0.5 text-[10px] tracking-[0.08em] text-white focus:outline-none" />
        ) : (
          <button onClick={() => { setDraft(call); setEdit(true); }} title="Callsign whose spots are drawn (click to change, clear it for radius only)"
            className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold tracking-[0.08em] text-white hover:bg-white/10">
            {call || 'SET CALL'}
          </button>
        )}
        {call && st && (
          <span className="flex flex-col whitespace-nowrap text-[8px] leading-tight tabular-nums text-[var(--text-muted)]"
            title={st.farCall ? `Furthest: ${st.farCall}, ${st.farKm.toLocaleString()} km` : undefined}>
            <span><span className="text-[#ffd60a]">TX</span> {st.sent} heard by · <span className="text-[#22d3ee]">RX</span> {st.heard} heard</span>
            <span>{st.farKm ? `best ${st.farKm.toLocaleString()} km${st.farCall ? ` ${st.farCall}` : ''}` : 'no spots in 15 min'}</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-[3px] border-l border-white/[0.07] pl-2" title={`Also draw every spot with an end within this distance of ${HOME_GRID}`}>
        <span className="mr-0.5 whitespace-nowrap text-[8px] tracking-[0.14em] text-[var(--text-muted)]">{HOME_GRID}</span>
        {RADII.map(r => (
          <button key={r} onClick={() => onRadius(r)}
            className={`rounded-md border px-1.5 py-1 text-[8.5px] tabular-nums tracking-[0.06em] transition-all ${radius === r ? 'border-[#2ee6a6]/60 bg-[#2ee6a6]/15 text-[#2ee6a6]' : 'border-white/10 text-[var(--text-secondary)] hover:border-white/30 hover:text-white'}`}>
            {r ? (r >= 1000 ? `${r / 1000}k` : r) : 'OFF'}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-[3px] border-l border-white/[0.07] pl-2">
        {BANDS.map(b => {
          const off = bandsOff.includes(b.key);
          const n = counts[b.key] || 0;
          return (
            <button key={b.key} onClick={() => onToggleBand(b.key)} onDoubleClick={() => onSolo(b.key)}
              title={`${b.key}: ${n} spots in view window. Click to hide, double-click to show only this band`}
              className={`flex min-w-[34px] flex-col items-center rounded-md border px-1 py-0.5 transition-all ${off ? 'border-white/5 opacity-35' : 'border-white/10 hover:border-white/30'}`}
              style={off ? undefined : { boxShadow: n ? `inset 0 -2px 0 ${b.color}` : undefined }}>
              <span className="text-[9px] font-bold" style={{ color: b.color }}>{b.key.replace('m', '')}</span>
              <span className="text-[7.5px] tabular-nums text-[var(--text-muted)]">{n ? (n > 999 ? `${(n / 1000).toFixed(1)}k` : n) : '·'}</span>
            </button>
          );
        })}
        {bandsOff.length > 0 && <button onClick={onAll} className="ml-0.5 rounded-md border border-white/10 px-1.5 py-1 text-[8px] tracking-[0.14em] text-[var(--text-secondary)] hover:text-white">ALL</button>}
      </div>
    </div>
  );
}
