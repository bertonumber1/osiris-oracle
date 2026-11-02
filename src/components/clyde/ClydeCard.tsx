'use client';
/* The readout for whatever Clyde Watch object is selected on the map: an
   aircraft, a vessel, an APRS station, a pager incident, a fire station, a
   licensed radio site or a navaid. Fixed in place like the satellite card,
   with the selection ring on the map tying it to its marker. */
import { useEffect, useState } from 'react';
import { Crosshair, ExternalLink, Flame, Plane, Radio, Ship, TowerControl, X, Antenna, Building2 } from 'lucide-react';
import { ALT_BANDS, ALT_GROUND, altKey, SHIP_KINDS, shipKind } from '@/lib/clyde/symbols';
import { WTR_CATS } from '@/lib/clyde/layer-ids';

export interface ClydeSelection { kind: 'ac' | 'ship' | 'aprs' | 'incident' | 'station' | 'wtr' | 'navaid'; id: string; data: any }

const API = '/api/clyde';

function ago(ts?: number | null): string {
  if (!ts) return '-';
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 90) return `${Math.round(s)}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
function when(ts?: number | null): string {
  if (!ts) return '-';
  return new Date(ts * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
const safeUrl = (u?: string | null) => (u && /^https?:\/\//i.test(u) ? u : undefined);

function Field({ label, value, color, wide }: { label: string; value: React.ReactNode; color?: string; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? 'col-span-2' : ''}`}>
      <div className="text-[8px] font-mono tracking-[0.15em] text-[var(--text-muted)]">{label}</div>
      <div className="truncate text-[11px] font-mono tabular-nums text-[var(--text-primary)]" style={color ? { color } : undefined}
        title={typeof value === 'string' ? value : undefined}>{value ?? '-'}</div>
    </div>
  );
}

function Photo({ url, link, credit }: { url?: string; link?: string; credit?: string | null }) {
  const [ok, setOk] = useState(true);
  if (!url || !ok) return null;
  return (
    <a href={link || url} target="_blank" rel="noreferrer" className="relative block h-[132px] w-full overflow-hidden bg-black/40">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={() => setOk(false)} />
      {credit && <span className="absolute bottom-1 right-1.5 rounded bg-black/60 px-1 text-[8px] font-mono text-white/70">© {credit}</span>}
    </a>
  );
}

function Links({ items }: { items: [string, string | undefined][] }) {
  const live = items.filter(([, u]) => u);
  if (!live.length) return null;
  return (
    <div className="flex flex-wrap gap-1 px-2.5 pb-2.5">
      {live.map(([label, u]) => (
        <a key={label} href={u} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1 rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[9px] font-mono tracking-[0.12em] text-[var(--text-secondary)] transition-colors hover:border-[var(--cyan-primary)]/40 hover:text-[var(--cyan-primary)]">
          {label}<ExternalLink className="h-2.5 w-2.5" />
        </a>
      ))}
    </div>
  );
}

function useJson(path: string | null) {
  const [d, setD] = useState<any>(null);
  useEffect(() => {
    setD(null);
    if (!path) return;
    const ac = new AbortController();
    fetch(`${API}/${path}`, { signal: ac.signal }).then(r => (r.ok ? r.json() : null)).then(setD).catch(() => {});
    return () => ac.abort();
  }, [path]);
  return d;
}

const altColor = (alt: any) => { const k = altKey(alt === 'ground' ? 'ground' : alt); return ALT_BANDS.find(b => b.key === k)?.color || ALT_GROUND; };
const EMERGENCY: Record<string, string> = { '7500': 'HIJACK', '7600': 'RADIO FAILURE', '7700': 'EMERGENCY' };

function Aircraft({ a }: { a: any }) {
  const info = useJson(a?.hex ? `adsb/aircraft-info/${encodeURIComponent(a.hex)}` : null);
  const alt = a.alt_baro;
  const sq = String(a.squawk || '');
  const cs = (a.flight || '').trim();
  return (
    <>
      <Photo url={safeUrl(info?.photo_url)} link={safeUrl(info?.photo_link)} credit={info?.photographer} />
      {EMERGENCY[sq] && <div className="bg-[#ff3b30]/20 px-2.5 py-1 text-center text-[10px] font-bold tracking-[0.2em] text-[#ff6b60]">SQUAWK {sq} · {EMERGENCY[sq]}</div>}
      <div className="grid grid-cols-3 gap-x-2.5 gap-y-2 px-2.5 py-2.5">
        <Field label="ALTITUDE" value={alt === 'ground' ? 'GROUND' : alt != null ? `${Math.round(alt).toLocaleString()} ft` : '-'} color={altColor(alt)} />
        <Field label="SPEED" value={a.gs != null ? `${Math.round(a.gs)} kt` : '-'} />
        <Field label="TRACK" value={a.track != null ? `${Math.round(a.track)}°` : '-'} />
        <Field label="V/S" value={a.baro_rate != null ? `${a.baro_rate > 0 ? '+' : ''}${a.baro_rate} fpm` : a.geom_rate != null ? `${a.geom_rate} fpm` : '-'} />
        <Field label="SQUAWK" value={sq || '-'} color={EMERGENCY[sq] ? '#ff6b60' : undefined} />
        <Field label="CATEGORY" value={a.category || '-'} />
        <Field label="REG" value={a.r || '-'} />
        <Field label="TYPE" value={a.t || '-'} />
        <Field label="HEX" value={(a.hex || '').toUpperCase()} />
        <Field label="POSITION" value={a.lat != null ? `${a.lat.toFixed(3)}, ${a.lon.toFixed(3)}` : '-'} wide />
        <Field label="SEEN" value={a.seen_pos != null ? `${Math.round(a.seen_pos)}s` : '-'} />
      </div>
      <Links items={[
        ['ADSB.LOL', `https://adsb.lol/?icao=${encodeURIComponent(a.hex || '')}`],
        ['FR24', cs ? `https://www.flightradar24.com/${encodeURIComponent(cs)}` : undefined],
        ['PLANESPOTTERS', safeUrl(info?.photo_link)],
      ]} />
    </>
  );
}

function Vessel({ v }: { v: any }) {
  const info = useJson(v?.mmsi ? `ais/vessel-info/${encodeURIComponent(v.mmsi)}` : null);
  const loc = info?.local || {};
  const kind = SHIP_KINDS.find(k => k.key === shipKind(v.ship_type ?? loc.shiptype));
  const len = loc.to_bow != null && loc.to_stern != null ? loc.to_bow + loc.to_stern : null;
  const beam = loc.to_port != null && loc.to_starboard != null ? loc.to_port + loc.to_starboard : null;
  return (
    <>
      <Photo url={safeUrl(info?.photo_url)} link={safeUrl(info?.vessel_url)} />
      <div className="grid grid-cols-3 gap-x-2.5 gap-y-2 px-2.5 py-2.5">
        <Field label="TYPE" value={kind?.label || '-'} color={kind?.color} wide />
        <Field label="SOURCE" value={v.community ? 'COMMUNITY' : 'OUR AERIAL'} color={v.community ? undefined : '#3fb950'} />
        <Field label="SPEED" value={v.speed != null ? `${Number(v.speed).toFixed(1)} kn` : '-'} />
        <Field label="COURSE" value={v.cog != null ? `${Math.round(v.cog)}°` : '-'} />
        <Field label="HEADING" value={v.heading != null && v.heading < 360 ? `${Math.round(v.heading)}°` : '-'} />
        <Field label="DESTINATION" value={v.dest || loc.destination || '-'} wide />
        <Field label="FLAG" value={loc.country || '-'} />
        <Field label="CALLSIGN" value={v.callsign || loc.callsign || '-'} />
        <Field label="MMSI" value={String(v.mmsi)} />
        <Field label="SIZE" value={len ? `${len}×${beam ?? '?'} m` : '-'} />
        <Field label="DRAUGHT" value={loc.draught ? `${loc.draught} m` : '-'} />
        <Field label="LAST HEARD" value={ago(v.last_ts)} wide />
      </div>
      {v.label && <div className="mx-2.5 mb-2 rounded border border-white/10 px-2 py-1 text-[9px] font-mono tracking-[0.12em] text-[var(--text-secondary)]">WATCHED · {v.label}</div>}
      <Links items={[['VESSELFINDER', safeUrl(info?.vessel_url)], ['MARINETRAFFIC', `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${encodeURIComponent(v.mmsi)}`]]} />
    </>
  );
}

function Aprs({ s }: { s: any }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 px-2.5 py-2.5">
        <Field label="LAST HEARD" value={ago(s.lasttime)} />
        <Field label="POSITION" value={s.lat != null ? `${s.lat.toFixed(4)}, ${s.lng.toFixed(4)}` : '-'} />
        {s.comment && <Field label="COMMENT" value={s.comment} wide />}
      </div>
      <pre className="mx-2.5 mb-2.5 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-[9.5px] leading-snug text-[#c4b5fd]">{s.raw}</pre>
      <Links items={[['APRS.FI', `https://aprs.fi/#!call=a%2F${encodeURIComponent(s.name)}`]]} />
    </>
  );
}

function Incident({ r, cfg }: { r: any; cfg: any }) {
  const exact = r.lat != null;
  return (
    <>
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 px-2.5 py-2.5">
        <Field label="PAGED" value={`${when(r.ts)} · ${ago(r.ts)}`} wide />
        <Field label="STATION" value={`${r.station_code || ''} ${r.station || ''}`.trim()} />
        <Field label="APPLIANCE" value={r.appliance || r.incident_code || '-'} />
        <Field label="TYPE" value={r.incident_type || '-'} wide />
        <Field label="RESOURCES" value={r.resource_summary || '-'} />
        <Field label="LOCATION" value={exact ? (r.gridref || 'Grid ref') : 'At station (no grid ref)'} color={exact ? '#3fb950' : '#ffb020'} />
        {r.officer && <Field label="OFFICER" value={typeof r.officer === 'string' ? r.officer : r.officer.name || r.officer.code || '-'} wide />}
      </div>
      {Array.isArray(r.resources) && r.resources.length > 0 && (
        <div className="mx-2.5 mb-2 space-y-0.5">
          {r.resources.map((x: any, i: number) => (
            <div key={i} className="flex items-center justify-between gap-2 text-[10px] font-mono">
              <span className="text-[#ffb4a8]">{x.code}</span>
              <span className="truncate text-[var(--text-secondary)]">{x.appliance} · {x.station}</span>
            </div>
          ))}
        </div>
      )}
      <pre className="mx-2.5 mb-2.5 max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-black/40 p-2 text-[9.5px] leading-snug text-[#ffd0c8]">{r.raw_msg}</pre>
      <Links items={[['MAP', safeUrl(r.map_url)]]} />
    </>
  );
}

function Station({ s }: { s: any }) {
  const units: any[] = s.units || [];
  return (
    <>
      <div className="grid grid-cols-3 gap-x-2.5 gap-y-2 px-2.5 py-2.5">
        <Field label="AREA" value={s.area || '-'} wide />
        <Field label="TYPE" value={s.type || '-'} />
        <Field label="JOBS" value={s.jobs != null ? s.jobs.toLocaleString() : '-'} />
        <Field label="LAST PAGED" value={ago(s.last)} wide />
        {s.legacy && <Field label="LEGACY CODE" value={s.legacy} />}
      </div>
      {s.top_types?.length > 0 && (
        <div className="mx-2.5 mb-2 flex flex-wrap gap-1">
          {s.top_types.map((t: string) => <span key={t} className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-[var(--text-secondary)]">{t}</span>)}
        </div>
      )}
      {units.length > 0 && (
        <div className="mx-2.5 mb-2.5 max-h-40 space-y-1 overflow-auto">
          {units.map(u => (
            <div key={u.callsign} className="flex items-baseline justify-between gap-2 text-[10px] font-mono">
              <span className="text-[#ffb4a8]">{u.callsign}</span>
              <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]" title={u.desc}>{u.desc || u.kind}</span>
              <span className="text-[var(--text-muted)] tabular-nums">{u.paged ?? 0}</span>
            </div>
          ))}
        </div>
      )}
      {s.officers?.length > 0 && <div className="px-2.5 pb-2.5 text-[9px] font-mono text-[var(--text-muted)]">OFFICERS · {s.officers.join(' ')}</div>}
    </>
  );
}

const mhz = (f?: number | null) => (f == null ? '-' : f >= 1000 ? `${(f / 1000).toFixed(3)} GHz` : `${f.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} MHz`);

function Wtr({ i }: { i: number }) {
  const d = useJson(`radios/site?i=${i}`);
  if (!d) return <div className="px-2.5 py-3 text-[9px] font-mono tracking-[0.15em] text-[var(--text-muted)]">READING THE REGISTER…</div>;
  const ch: any[] = d.ch || [];
  return (
    <>
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 px-2.5 py-2.5">
        <Field label="LICENCE" value={d.l || '-'} />
        <Field label="STATUS" value={d.st || '-'} color={d.st === 'Live' ? '#3fb950' : undefined} />
        <Field label="PRODUCT" value={d.p || '-'} wide />
        <Field label="NGR" value={d.ngr || '-'} />
        <Field label="ISSUED" value={d.d || '-'} />
        {d.far && <Field label="LINK" value={`${d.far[2]} km to ${d.far[0].toFixed(4)}, ${d.far[1].toFixed(4)}`} wide />}
      </div>
      <div className="mx-2.5 mb-2.5 max-h-48 space-y-1.5 overflow-auto">
        {ch.map((c, k) => (
          <div key={k} className="rounded bg-black/30 p-1.5 text-[9.5px] font-mono leading-snug">
            <div className="flex justify-between gap-2">
              <span className="text-[var(--cyan-primary)]">TX {mhz(c.tx)}</span>
              <span className="text-[var(--text-secondary)]">RX {mhz(c.rx)}</span>
            </div>
            <div className="truncate text-[var(--text-secondary)]" title={c.emd}>{c.em}{c.emd ? ` · ${c.emd}` : ''}</div>
            <div className="text-[var(--text-muted)]">
              {[c.band, c.erp != null ? `ERP ${c.erp} W` : null, c.ht != null ? `${c.ht} m agl` : null, c.az != null ? `az ${Math.round(c.az)}°` : null, c.role].filter(Boolean).join(' · ')}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Navaid({ n }: { n: any }) {
  if (n.k === 'aerodrome') {
    return (
      <>
        <div className="grid grid-cols-3 gap-x-2.5 gap-y-2 px-2.5 py-2.5">
          <Field label="ICAO" value={n.icao || n.id || '-'} />
          <Field label="IATA" value={n.iata || '-'} />
          <Field label="ELEV" value={n.elev != null ? `${Math.round(n.elev)} ft` : '-'} />
          <Field label="TOWN" value={n.town || '-'} wide />
        </div>
        <div className="mx-2.5 mb-2.5 space-y-0.5">
          {(n.f || []).map((f: any, k: number) => (
            <div key={k} className="flex justify-between gap-2 text-[10px] font-mono">
              <span className="text-[#fcd34d]">{f.t}</span><span className="truncate text-[var(--text-secondary)]">{f.d}</span><span className="tabular-nums text-[var(--text-primary)]">{f.f}</span>
            </div>
          ))}
        </div>
      </>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-x-2.5 gap-y-2 px-2.5 py-2.5">
      <Field label="TYPE" value={n.tl || n.t || '-'} wide />
      <Field label="FREQUENCY" value={n.f || '-'} color="#7dd3fc" />
      <Field label="DME" value={n.dme ? `${n.dme} (${n.dch || ''})` : '-'} />
      <Field label="USE" value={n.use || '-'} />
      <Field label="POWER" value={n.pwr || '-'} />
      {n.td && <Field label="NOTE" value={n.td} wide />}
    </div>
  );
}

export default function ClydeCard({ sel, live, cfg, onClose, following, onFollow }: { sel: ClydeSelection; live?: any; cfg?: any; net?: any; onClose: () => void; following?: boolean; onFollow?: () => void }) {
  const d = live || sel.data;
  let title = '', sub = '', accent = '#00e5ff', Icon: any = Radio;
  switch (sel.kind) {
    case 'ac': title = (d.flight || '').trim() || d.r || (d.hex || '').toUpperCase(); sub = d.desc || [d.t, d.r].filter(Boolean).join(' · ') || 'Aircraft'; accent = altColor(d.alt_baro); Icon = Plane; break;
    case 'ship': { const k = SHIP_KINDS.find(x => x.key === shipKind(d.ship_type)); title = d.name || String(d.mmsi); sub = `MMSI ${d.mmsi}`; accent = k?.color || accent; Icon = Ship; break; }
    case 'aprs': title = d.name; sub = 'APRS station'; accent = '#c084fc'; Icon = Antenna; break;
    case 'incident': title = d.incident_code || d.station_code || 'Pager message'; sub = d.station || 'SFRS'; accent = '#ff7a1a'; Icon = Flame; break;
    case 'station': title = `${d.code ? d.code + ' ' : ''}${d.station}`; sub = 'SFRS fire station'; accent = (cfg?.areaColors || {})[d.area] || '#e5484d'; Icon = Building2; break;
    case 'wtr': { const c = WTR_CATS.find(x => x.key === d.c); title = (d.label || '').split(' · ')[0]; sub = c?.label || 'Licensed radio site'; accent = c?.color || accent; Icon = Radio; break; }
    case 'navaid': title = d.k === 'aerodrome' ? d.n : `${d.id} ${d.n || ''}`; sub = d.k === 'aerodrome' ? 'Aerodrome' : 'Navigation beacon'; accent = d.k === 'aerodrome' ? '#fbbf24' : '#38bdf8'; Icon = TowerControl; break;
  }
  return (
    <div className="pointer-events-auto absolute left-2 right-2 top-16 z-[350] max-h-[calc(100vh-180px)] overflow-y-auto overflow-x-hidden rounded-lg border bg-[var(--bg-panel)] shadow-[0_10px_32px_rgba(0,0,0,0.55)] backdrop-blur-2xl md:left-auto md:right-16 md:top-[88px] md:w-[300px]"
      style={{ borderColor: `${accent}40` }} role="dialog" aria-label={title}>
      <div className="h-[2px] w-full" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}00)` }} />
      <div className="flex items-start gap-2 px-2.5 pt-2.5 pb-2">
        <Icon className="mt-[2px] h-3.5 w-3.5 flex-shrink-0" style={{ color: accent }} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold leading-tight tracking-wide text-[var(--text-heading)]" title={title}>{title}</div>
          <div className="truncate text-[9px] font-mono tracking-[0.12em] text-[var(--text-secondary)]">{sub}</div>
        </div>
        {onFollow ? (
          <button onClick={onFollow} title="Keep the camera on it (drag the map to stop)"
            className={`mt-[1px] flex items-center gap-1 rounded border px-1.5 py-[1px] text-[8px] font-mono tracking-[0.16em] transition-colors ${following ? 'border-[var(--cyan-primary)] bg-[var(--cyan-primary)]/15 text-[var(--cyan-primary)]' : 'border-white/15 text-[var(--text-secondary)] hover:border-white/30 hover:text-white'}`}>
            <Crosshair className="h-2.5 w-2.5" />{following ? 'FOLLOWING' : 'FOLLOW'}
          </button>
        ) : (
          <span className="mt-[1px] rounded border border-white/10 px-1 text-[7.5px] font-mono tracking-[0.18em] text-[var(--text-muted)]">CLYDE WATCH</span>
        )}
        <button onClick={onClose} className="-mr-1 -mt-1 flex-shrink-0 rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-1 focus-visible:ring-white/50"
          aria-label="Clear selection" title="Clear selection (Esc)"><X className="h-3 w-3" /></button>
      </div>
      {sel.kind === 'ac' && <Aircraft a={d} />}
      {sel.kind === 'ship' && <Vessel v={d} />}
      {sel.kind === 'aprs' && <Aprs s={d} />}
      {sel.kind === 'incident' && <Incident r={d} cfg={cfg} />}
      {sel.kind === 'station' && <Station s={d} />}
      {sel.kind === 'wtr' && <Wtr i={Number(sel.id)} />}
      {sel.kind === 'navaid' && <Navaid n={d} />}
    </div>
  );
}
