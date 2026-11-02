'use client';
/* The map picker: every base map as a live preview card, raster overlays with
   their own opacity, one-click views, and kiosk mode. Opens from the view
   strip at the bottom left. */
import { useEffect, useRef } from 'react';
import { Layers, Maximize2, MapPin, X } from 'lucide-react';
import { BASEMAPS, OVERLAYS, thumb } from '@/lib/clyde/basemaps';

interface Props {
  base: string;
  onBase: (key: string) => void;
  overlays: Record<string, number>;
  onOverlays: (next: Record<string, number>) => void;
  onView: (v: 'clyde' | 'scotland' | 'uk') => void;
  onKiosk: () => void;
  onClose: () => void;
}

const GROUPS = ['Dark', 'Plain', 'Street', 'Terrain', 'Marine', 'Imagery'] as const;

export default function MapPicker({ base, onBase, overlays, onOverlays, onView, onKiosk, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const current = base === 'satellite' || /^https?:/.test(base) ? 'satellite' : base;

  useEffect(() => {
    const away = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest('[data-map-picker-toggle]')) onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); window.removeEventListener('keydown', esc); };
  }, [onClose]);

  return (
    <div ref={ref} className="pointer-events-auto w-[min(392px,calc(100vw-24px))] overflow-hidden rounded-xl border border-[var(--border-primary)] bg-[var(--bg-panel)] shadow-[0_16px_48px_rgba(0,0,0,0.6)] backdrop-blur-2xl"
      role="dialog" aria-label="Map layers">
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <Layers className="h-3.5 w-3.5 text-[var(--cyan-primary)]" />
        <span className="text-[10px] font-mono font-bold tracking-[0.22em] text-[var(--text-heading)]">MAP LAYERS</span>
        <button onClick={onClose} className="ml-auto rounded p-1 text-[var(--text-muted)] hover:bg-white/10 hover:text-white" aria-label="Close"><X className="h-3 w-3" /></button>
      </div>

      <div className="max-h-[min(62vh,560px)] overflow-y-auto px-3 pb-3">
        {GROUPS.map(g => {
          const items = BASEMAPS.filter(b => b.group === g);
          return (
            <div key={g} className="mt-2.5">
              <div className="mb-1.5 text-[8px] font-mono tracking-[0.22em] text-[var(--text-muted)]">{g.toUpperCase()}</div>
              <div className="grid grid-cols-3 gap-1.5">
                {items.map(b => {
                  const on = current === b.key;
                  const src = thumb(b.tiles);
                  return (
                    <button key={b.key} onClick={() => onBase(b.key)} title={b.label}
                      className={`group relative h-[58px] overflow-hidden rounded-md border text-left transition-all ${on ? 'border-[var(--cyan-primary)] shadow-[0_0_0_1px_var(--cyan-primary),0_0_14px_rgba(0,229,255,0.25)]' : 'border-white/10 hover:border-white/30'}`}>
                      {src
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={src} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-110" />
                        : <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,#1b2433,#05070c_70%)]">
                            {b.key === 'dark' && <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(0,229,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(0,229,255,.12)_1px,transparent_1px)] [background-size:12px_12px]" />}
                            {b.key === 'night-clean' && <span className="absolute left-2 top-1.5 font-mono text-[7px] tracking-[0.2em] text-white/35">NO LINES</span>}
                            {b.key === 'night-blank' && <span className="absolute left-2 top-1.5 font-mono text-[7px] tracking-[0.2em] text-white/35">NO LINES · NO NAMES</span>}
                          </div>}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-1.5 pb-1 pt-3">
                        <span className={`block truncate text-[9px] font-mono tracking-[0.06em] ${on ? 'text-[var(--cyan-primary)]' : 'text-white/90'}`}>{b.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="mt-3.5 mb-1.5 text-[8px] font-mono tracking-[0.22em] text-[var(--text-muted)]">OVERLAYS</div>
        <div className="space-y-1">
          {OVERLAYS.map(o => {
            const op = overlays[o.key] || 0;
            const on = op > 0;
            return (
              <div key={o.key} className={`rounded-md border px-2 py-1.5 transition-colors ${on ? 'border-[var(--cyan-primary)]/30 bg-[var(--cyan-primary)]/[0.05]' : 'border-white/[0.06]'}`}>
                <button className="flex w-full items-center gap-2 text-left" onClick={() => onOverlays({ ...overlays, [o.key]: on ? 0 : o.opacity })}>
                  <span className={`relative h-3.5 w-6 flex-shrink-0 rounded-full transition-colors ${on ? 'bg-[var(--cyan-primary)]/70' : 'bg-white/15'}`}>
                    <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${on ? 'left-3' : 'left-0.5'}`} />
                  </span>
                  <span className="text-[10px] font-mono tracking-[0.08em] text-[var(--text-primary)]">{o.label}</span>
                  <span className="ml-auto truncate text-[8.5px] text-[var(--text-muted)]">{o.note}</span>
                </button>
                {on && (
                  <div className="mt-1.5 flex items-center gap-2 pl-8">
                    <input type="range" min={0.1} max={1} step={0.05} value={op} aria-label={`${o.label} opacity`}
                      onChange={e => onOverlays({ ...overlays, [o.key]: Number(e.target.value) })}
                      className="h-1 flex-1 cursor-pointer accent-[var(--cyan-primary)]" />
                    <span className="w-8 text-right text-[9px] font-mono tabular-nums text-[var(--text-secondary)]">{Math.round(op * 100)}%</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-3.5 mb-1.5 text-[8px] font-mono tracking-[0.22em] text-[var(--text-muted)]">VIEWS</div>
        <div className="grid grid-cols-4 gap-1.5">
          {([['clyde', 'CLYDE'], ['scotland', 'SCOTLAND'], ['uk', 'UK & IRL']] as const).map(([k, l]) => (
            <button key={k} onClick={() => onView(k)}
              className="flex items-center justify-center gap-1 rounded-md border border-white/10 py-1.5 text-[9px] font-mono tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--cyan-primary)]/50 hover:text-[var(--cyan-primary)]">
              <MapPin className="h-2.5 w-2.5" />{l}
            </button>
          ))}
          <button onClick={onKiosk} title="Full screen, map only (K)"
            className="flex items-center justify-center gap-1 rounded-md border border-[var(--cyan-primary)]/40 bg-[var(--cyan-primary)]/[0.08] py-1.5 text-[9px] font-mono font-bold tracking-[0.12em] text-[var(--cyan-primary)] transition-colors hover:bg-[var(--cyan-primary)]/20">
            <Maximize2 className="h-2.5 w-2.5" />KIOSK
          </button>
        </div>
      </div>
    </div>
  );
}
