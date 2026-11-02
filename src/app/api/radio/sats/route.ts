/* Orbital elements for RADIO + SPACE, from Celestrak: weather satellites, the
   ISS, the amateur fleet, GPS + Galileo, Starlink, Iridium, geostationary and
   Inmarsat. Celestrak refuses this line's IP, so the host fetches the groups
   through the VPN every 6 h (oracle-tle-fetch) into tle-cache, mounted here
   read-only at TLE_DIR; a direct fetch is only the fallback. */
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TLE_DIR = process.env.TLE_DIR || '/app/tle-cache';

const CT = 'https://celestrak.org/NORAD/elements/gp.php?FORMAT=tle&GROUP=';
const TTL = 6 * 3600 * 1000;

/* Downlinks shown only where they are well established; status changes, so the
   panel says "as published". */
const DOWNLINK: Record<string, string> = {
  'METEOR-M2 3': 'LRPT 137.900 MHz',
  'METEOR-M2 4': 'LRPT 137.900 MHz',
  'METOP-B': 'AHRPT 1701.3 MHz',
  'METOP-C': 'AHRPT 1701.3 MHz',
  'ISS (ZARYA)': 'APRS 145.825 MHz',
  'SAUDISAT 1C (SO-50)': 'FM 436.795 MHz',
};
const WEATHER = /^(METEOR-M2 [34]|METOP-[BC]|NOAA (15|18|19|20|21)|FENGYUN 3[D-H])/;
const KIND_DOWN: Record<string, string> = {
  gnss: 'L1/E1 1575.42 MHz', iridium: 'L-band 1616-1626.5 MHz', inmarsat: 'L-band 1525-1559 MHz (STD-C, AERO)',
};

type Kind = 'wx' | 'iss' | 'ham' | 'gnss' | 'starlink' | 'iridium' | 'geo' | 'inmarsat';
type Sat = { name: string; l1: string; l2: string; kind: Kind; down?: string };
const g = globalThis as unknown as { __radioSats?: { at: number; sats: Sat[] } };

function parseTle(txt: string): { name: string; l1: string; l2: string }[] {
  const lines = txt.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
  const out = [];
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    if (lines[i + 1]?.startsWith('1 ') && lines[i + 2]?.startsWith('2 ')) out.push({ name: lines[i].trim(), l1: lines[i + 1], l2: lines[i + 2] });
  }
  return out;
}

async function group(name: string): Promise<{ name: string; l1: string; l2: string }[]> {
  try {
    const f = join(TLE_DIR, `${name}.txt`);
    if ((await stat(f)).size > 0) return parseTle(await readFile(f, 'utf8'));
  } catch { /* no cached copy: try Celestrak directly */ }
  const r = await fetch(CT + name, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'osiris-radio/1.0' } });
  if (!r.ok) throw new Error(`celestrak ${name} ${r.status}`);
  return parseTle(await r.text());
}

export async function GET() {
  const c = g.__radioSats;
  if (c && Date.now() - c.at < TTL) return Response.json({ sats: c.sats, cached: true });
  try {
    const [wx, stations, ham, gps, gal, starlink, iridium, geo] = await Promise.allSettled(
      ['weather', 'stations', 'amateur', 'gps-ops', 'galileo', 'starlink', 'iridium-NEXT', 'geo'].map(group));
    const val = <T,>(p: PromiseSettledResult<T[]>) => (p.status === 'fulfilled' ? p.value : []);
    const seen = new Set<string>();
    const sats: Sat[] = [];
    const add = (s: { name: string; l1: string; l2: string }, kind: Sat['kind']) => {
      const id = s.l1.slice(2, 7);
      if (seen.has(id)) return;
      seen.add(id);
      const down = DOWNLINK[s.name] || KIND_DOWN[kind];
      sats.push({ ...s, kind, ...(down ? { down } : {}) });
    };
    for (const s of val(wx)) if (WEATHER.test(s.name)) add(s, 'wx');
    for (const s of val(stations)) if (s.name === 'ISS (ZARYA)') add(s, 'iss');
    for (const s of val(ham)) add(s, 'ham');
    for (const s of [...val(gps), ...val(gal)]) add(s, 'gnss');
    for (const s of val(starlink)) add(s, 'starlink');
    for (const s of val(iridium)) add(s, 'iridium');
    for (const s of val(geo)) add(s, /^(INMARSAT|ALPHASAT)/.test(s.name) ? 'inmarsat' : 'geo');
    if (!sats.length) throw new Error('no elements');
    g.__radioSats = { at: Date.now(), sats };
    return Response.json({ sats });
  } catch (e) {
    if (c) return Response.json({ sats: c.sats, stale: true });
    return Response.json({ sats: [], error: String(e) }, { status: 502 });
  }
}
