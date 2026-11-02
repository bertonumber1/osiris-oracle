/* PSK Reporter live spots over MQTT (mqtt.pskreporter.info:1883, topic
   pskr/filter/v2/{band}/{mode}/{tx}/{rx}/{txgrid}/{rxgrid}/{txdxcc}/{rxdxcc}).

   One connection for the whole server, opened when the map first asks and
   closed again three minutes after the last request, so the ~300 spots a
   second only flow while someone has the layer on. A tiny MQTT 3.1.1 client
   (QoS 0 subscribe only) keeps it free of extra dependencies.

   What is kept:
   - calls: every spot sent or heard by a callsign someone is watching. A newly
     entered callsign is backfilled once from the PSK Reporter query API, so it
     does not start empty; the live feed keeps it current after that.
   - local: every spot with either end within RADIUS_MAX_KM of our locator
     (IO75OW), for the radius filter. 30 minutes of each.
   - activity: transmitting stations per 4-character grid and band, worldwide,
     for 15 minutes. */
import net from 'node:net';
import { distanceKm, freqToBand, gridToLatLon, HOME_GRID } from './maidenhead';

const HOST = 'mqtt.pskreporter.info';
const PORT = 1883;
const TOPIC = 'pskr/filter/v2/#';
const HOME = gridToLatLon(HOME_GRID)!;
export const RADIUS_MAX_KM = 2000;
const PATH_KEEP_S = 30 * 60;
const ACTIVITY_KEEP_S = 15 * 60;
const MAX_LOCAL = 120000;
const MAX_PER_CALL = 20000;
const IDLE_CLOSE_MS = 3 * 60 * 1000;
// A callsign nobody has asked about for this long stops being collected.
const WATCH_IDLE_MS = 10 * 60 * 1000;
// The query API asks for no more than one request per callsign every 5 minutes; we do one per callsign per 30.
const BACKFILL_EVERY_MS = 30 * 60 * 1000;

/** One spot with both ends located. d = the nearer end's distance from our locator, km. */
interface Spot { t: number; f: number; b: string; md: string; rp: number | null; sc: string; rc: string; sla: number; slo: number; rla: number; rlo: number; d: number }

interface State {
  sock: net.Socket | null;
  connected: boolean;
  connecting: boolean;
  lastAsk: number;
  watch: Map<string, number>;          // callsign -> last asked (ms)
  calls: Map<string, Spot[]>;          // callsign -> its spots, oldest first
  backfilled: Map<string, number>;     // callsign -> last backfill (ms)
  local: Spot[];
  activity: Map<string, { lat: number; lon: number; b: string; n: number; t: number; calls: Set<string> }>;
  rate: number; count: number; rateAt: number;
  retry: ReturnType<typeof setTimeout> | null;
  ping: ReturnType<typeof setInterval> | null;
  prune: ReturnType<typeof setInterval> | null;
  backoff: number;
}

const g = globalThis as unknown as { __pskFeed2?: State };
const S: State = g.__pskFeed2 ??= {
  sock: null, connected: false, connecting: false, lastAsk: 0,
  watch: new Map(), calls: new Map(), backfilled: new Map(),
  local: [], activity: new Map(), rate: 0, count: 0, rateAt: Date.now(),
  retry: null, ping: null, prune: null, backoff: 2000,
};

function str(s: string): Buffer { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); }
function remLen(n: number): Buffer { const o: number[] = []; do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 0x80; o.push(d); } while (n); return Buffer.from(o); }
function packet(type: number, body: Buffer): Buffer { return Buffer.concat([Buffer.from([type]), remLen(body.length), body]); }

function locate(t: number, f: number, b: string, md: string, rp: number | null, sc: string, rc: string, sl: string, rl: string): Spot | null {
  const a = gridToLatLon(sl), z = gridToLatLon(rl);
  if (!a || !z) return null;
  const d = Math.min(distanceKm(HOME, a), distanceKm(HOME, z));
  return { t, f, b, md, rp, sc: (sc || '').toUpperCase(), rc: (rc || '').toUpperCase(), sla: a[0], slo: a[1], rla: z[0], rlo: z[1], d };
}

function addToCall(call: string, s: Spot) {
  let list = S.calls.get(call);
  if (!list) S.calls.set(call, list = []);
  list.push(s);
  if (list.length > MAX_PER_CALL) list.splice(0, list.length - MAX_PER_CALL);
}

function onSpot(j: any) {
  const now = Date.now() / 1000;
  S.count++;
  const sc = String(j.sc || '').toUpperCase(), rc = String(j.rc || '').toUpperCase();
  const wS = S.watch.has(sc), wR = S.watch.has(rc);
  // Cheap pre-check on the 4-character grids before working out distances for every spot.
  if (wS || wR || near(j.sl) || near(j.rl)) {
    const s = locate(j.t, j.f, j.b, j.md, typeof j.rp === 'number' ? j.rp : null, sc, rc, j.sl, j.rl);
    if (s) {
      if (wS) addToCall(sc, s);
      if (wR && rc !== sc) addToCall(rc, s);
      if (s.d <= RADIUS_MAX_KM) {
        S.local.push(s);
        if (S.local.length > MAX_LOCAL) S.local.splice(0, S.local.length - MAX_LOCAL);
      }
    }
  }
  const g4 = String(j.sl || '').slice(0, 4).toUpperCase();
  if (g4.length === 4) {
    const k = `${g4}|${j.b}`;
    let a = S.activity.get(k);
    if (!a) {
      const ll = gridToLatLon(g4);
      if (!ll) return;
      a = { lat: ll[0], lon: ll[1], b: j.b, n: 0, t: now, calls: new Set() };
      S.activity.set(k, a);
    }
    a.n++; a.t = now;
    if (a.calls.size < 40) a.calls.add(sc);
  }
}

// 4-character grid -> within RADIUS_MAX_KM (plus a grid's half-diagonal) of home, memoised.
const nearCache = new Map<string, boolean>();
function near(grid: string | undefined): boolean {
  const g4 = String(grid || '').slice(0, 4).toUpperCase();
  let v = nearCache.get(g4);
  if (v === undefined) {
    const ll = gridToLatLon(g4);
    v = !!ll && distanceKm(HOME, ll) <= RADIUS_MAX_KM + 120;
    nearCache.set(g4, v);
  }
  return v;
}

function parse(buf: Buffer): Buffer {
  let off = 0;
  while (buf.length - off >= 2) {
    const h = buf[off];
    let mult = 1, len = 0, i = off + 1, d = 0;
    do { if (i >= buf.length) return buf.subarray(off); d = buf[i++]; len += (d & 127) * mult; mult *= 128; } while (d & 128);
    if (buf.length < i + len) break;
    const pk = buf.subarray(i, i + len);
    off = i + len;
    if (h >> 4 === 3) {
      const tl = pk.readUInt16BE(0);
      const qos = (h >> 1) & 3;
      const payload = pk.subarray(2 + tl + (qos ? 2 : 0));
      try { onSpot(JSON.parse(payload.toString('utf8'))); } catch { /* not a spot */ }
    } else if (h >> 4 === 2) {
      S.connected = true; S.connecting = false; S.backoff = 2000;
      S.sock?.write(packet(0x82, Buffer.concat([Buffer.from([0, 1]), str(TOPIC), Buffer.from([0])])));
    }
  }
  return buf.subarray(off);
}

function close() {
  if (S.ping) clearInterval(S.ping);
  if (S.prune) clearInterval(S.prune);
  if (S.retry) clearTimeout(S.retry);
  S.ping = S.prune = S.retry = null;
  try { S.sock?.end(); S.sock?.destroy(); } catch { /* already gone */ }
  S.sock = null; S.connected = false; S.connecting = false;
}

function dropOlder<T extends { t: number }>(list: T[], cut: number) {
  let i = 0;
  while (i < list.length && list[i].t < cut) i++;
  if (i) list.splice(0, i);
}

function pruneOld() {
  const now = Date.now() / 1000;
  dropOlder(S.local, now - PATH_KEEP_S);
  for (const [c, list] of S.calls) {
    dropOlder(list, now - PATH_KEEP_S);
    if (!S.watch.has(c)) S.calls.delete(c);
  }
  for (const [c, at] of S.watch) if (Date.now() - at > WATCH_IDLE_MS) { S.watch.delete(c); S.calls.delete(c); }
  for (const [k, a] of S.activity) if (a.t < now - ACTIVITY_KEEP_S) S.activity.delete(k);
  const el = (Date.now() - S.rateAt) / 1000;
  if (el >= 10) { S.rate = Math.round(S.count / el); S.count = 0; S.rateAt = Date.now(); }
  if (Date.now() - S.lastAsk > IDLE_CLOSE_MS) { close(); S.local = []; S.calls.clear(); S.watch.clear(); S.activity.clear(); }
}

function connect() {
  if (S.sock || S.connecting) return;
  S.connecting = true;
  const sock = net.createConnection({ host: HOST, port: PORT });
  S.sock = sock;
  let buf: Buffer = Buffer.alloc(0);
  sock.setTimeout(90000);
  sock.on('connect', () => {
    const vh = Buffer.concat([str('MQTT'), Buffer.from([4, 2, 0, 60])]);
    sock.write(packet(0x10, Buffer.concat([vh, str(`osiris-${Math.random().toString(36).slice(2, 10)}`)])));
    S.ping = setInterval(() => { try { sock.write(Buffer.from([0xc0, 0])); } catch { /* closing */ } }, 30000);
    S.prune = setInterval(pruneOld, 5000);
  });
  sock.on('data', d => { buf = parse(buf.length ? Buffer.concat([buf, d]) : d); });
  const lost = () => {
    const wanted = Date.now() - S.lastAsk < IDLE_CLOSE_MS;
    close();
    if (wanted) { S.retry = setTimeout(connect, S.backoff); S.backoff = Math.min(S.backoff * 2, 60000); }
  };
  sock.on('timeout', lost);
  sock.on('error', lost);
  sock.on('close', () => { if (S.sock === sock) lost(); });
}

/** The last 30 minutes for one callsign from the PSK Reporter query API, merged under the live spots. */
async function backfill(call: string) {
  S.backfilled.set(call, Date.now());
  try {
    const url = `https://retrieve.pskreporter.info/query?callsign=${encodeURIComponent(call)}&flowStartSeconds=-${PATH_KEEP_S}&rronly=1&appcontact=osiris-oracle`;
    const r = await fetch(url, { signal: AbortSignal.timeout(45000), headers: { 'user-agent': 'Osiris-Oracle (PSK layer)' } });
    if (!r.ok) return;
    const xml = await r.text();
    const got: Spot[] = [];
    for (const m of xml.matchAll(/<receptionReport\s([^>]*)\/>/g)) {
      const at: Record<string, string> = {};
      for (const a of m[1].matchAll(/(\w+)="([^"]*)"/g)) at[a[1]] = a[2];
      const f = Number(at.frequency), b = freqToBand(f);
      if (!b) continue;
      const s = locate(Number(at.flowStartSeconds), f, b, at.mode || '', at.sNR ? Number(at.sNR) : null,
        at.senderCallsign, at.receiverCallsign, at.senderLocator, at.receiverLocator);
      if (s) got.push(s);
    }
    const list = S.calls.get(call) || [];
    const seen = new Set(list.map(s => `${s.sc}|${s.rc}|${s.f}|${s.t}`));
    const merged = [...got.filter(s => !seen.has(`${s.sc}|${s.rc}|${s.f}|${s.t}`)), ...list].sort((a, b) => a.t - b.t);
    S.calls.set(call, merged.slice(-MAX_PER_CALL));
  } catch { /* the live feed still fills it */ }
}

type Row = (number | string | null)[];
const row = (s: Spot, age: number, me: 0 | 1): Row =>
  [+s.sla.toFixed(3), +s.slo.toFixed(3), +s.rla.toFixed(3), +s.rlo.toFixed(3), s.b, s.rp, Math.round(age), s.sc, s.rc, s.f, s.md, me];

/** Called by the API route: keeps the feed open and returns what it holds.
    paths rows: [txLat, txLon, rxLat, rxLon, band, snr, ageS, txCall, rxCall, freq, mode, mine] */
export function pskSnapshot(opts: { call?: string; radiusKm?: number; maxAgeS?: number; bands?: Set<string> | null; limit?: number }) {
  S.lastAsk = Date.now();
  const call = (opts.call || '').toUpperCase();
  if (call) {
    S.watch.set(call, Date.now());
    if (Date.now() - (S.backfilled.get(call) || 0) > BACKFILL_EVERY_MS) void backfill(call);
  }
  connect();
  const now = Date.now() / 1000;
  const maxAge = opts.maxAgeS ?? 15 * 60;
  const limit = opts.limit ?? 6000;
  const radius = Math.min(RADIUS_MAX_KM, Math.max(0, opts.radiusKm || 0));
  const out: Row[] = [];
  const bandCount: Record<string, number> = {};
  const seen = new Set<string>();
  const take = (s: Spot, me: 0 | 1) => {
    const age = now - s.t;
    bandCount[s.b] = (bandCount[s.b] || 0) + 1;
    if (opts.bands && !opts.bands.has(s.b)) return;
    out.push(row(s, age, me));
  };

  // The callsign's own spots first, so the limit never cuts them.
  const stats = { call, sent: 0, heard: 0, farKm: 0, farCall: '', bands: [] as string[] };
  const mine = call ? (S.calls.get(call) || []) : [];
  const callBands = new Set<string>();
  for (let i = mine.length - 1; i >= 0; i--) {
    const s = mine[i];
    if (now - s.t > maxAge) break;
    seen.add(`${s.sc}|${s.rc}|${s.f}|${s.t}`);
    if (s.sc === call) stats.sent++; else stats.heard++;
    callBands.add(s.b);
    const km = distanceKm([s.sla, s.slo], [s.rla, s.rlo]);
    if (km > stats.farKm) { stats.farKm = Math.round(km); stats.farCall = s.sc === call ? s.rc : s.sc; }
    take(s, 1);
  }
  stats.bands = [...callBands];

  if (radius) {
    for (let i = S.local.length - 1; i >= 0 && out.length < limit; i--) {
      const s = S.local[i];
      if (now - s.t > maxAge) break;
      if (s.d > radius || seen.has(`${s.sc}|${s.rc}|${s.f}|${s.t}`)) continue;
      take(s, 0);
    }
  }

  const act: (number | string)[][] = [];
  for (const a of S.activity.values()) {
    if (opts.bands && !opts.bands.has(a.b)) continue;
    act.push([+a.lat.toFixed(2), +a.lon.toFixed(2), a.b, a.n, [...a.calls].slice(0, 6).join(' ')]);
  }
  return { connected: S.connected, rate: S.rate, call, radiusKm: radius, home: { grid: HOME_GRID, lat: HOME[0], lon: HOME[1] }, stats, paths: out, activity: act, bandCount };
}
