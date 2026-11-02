'use client';
/* PSK Reporter controls: one chip per band (click to hide, double-click to
   solo), live rate, and the callsign whose spots are highlighted. */
import { useState } from 'react';
import { BANDS } from '@/lib/radio/maidenhead';

interface Props {
  data: { connected: boolean; rate: number; paths: any[]; bandCount: Record<string, number> } | null;
  call: string; onCall: (c: string) => void;
  bandsOff: string[]; onToggleBand: (b: string) => void; onSolo: (b: string) => void; onAll: () => void;
}

export default function PskBar({ data, call, onCall, bandsOff, onToggleBand, onSolo, onAll }: Props) {
  const [edit, setEdit] = useState(false);
  const [draft, setDraft] = useState(call);
  const counts = data?.bandCount || {};
  const mine = (data?.paths || []).filter(p => p[7] === call.toUpperCase() || p[8] === call.toUpperCase()).length;
  return (
    <div className="pointer-events-auto absolute bottom-[88px] left-1/2 z-[209] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-2 overflow-x-auto rounded-xl border border-[var(--border-primary)] bg-[var(--bg-panel)] px-2.5 py-1.5 font-mono shadow-[0_8px_28px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
      <div className="flex flex-col pr-1">
        <span className="whitespace-nowrap text-[8.5px] font-bold tracking-[0.22em] text-[#2ee6a6]">PSK REPORTER</span>
        <span className="whitespace-nowrap text-[8px] tracking-[0.1em] text-[var(--text-muted)]">
          <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${data?.connected ? 'bg-[#3fb950] shadow-[0_0_6px_#3fb950]' : 'bg-[#6b7280]'}`} />
          {data?.connected ? `${data.rate}/s live · ${data.paths.length.toLocaleString()} paths` : 'connecting…'}
        </span>
      </div>
      <div className="flex items-center gap-[3px]">
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
      <div className="flex items-center gap-1 border-l border-white/[0.07] pl-2">
        {edit ? (
          <input autoFocus value={draft} onChange={e => setDraft(e.target.value.toUpperCase())}
            onBlur={() => { setEdit(false); onCall(draft.trim()); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(call); setEdit(false); } }}
            className="w-20 rounded bg-black/40 px-1.5 py-0.5 text-[10px] tracking-[0.08em] text-white focus:outline-none" />
        ) : (
          <button onClick={() => { setDraft(call); setEdit(true); }} title="Callsign whose spots are drawn bold (click to change)"
            className="whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-bold tracking-[0.08em] text-white hover:bg-white/10">
            {call || 'SET CALL'}
          </button>
        )}
        <span className="whitespace-nowrap text-[8.5px] tabular-nums text-[var(--text-muted)]">{mine} spots</span>
      </div>
    </div>
  );
}
