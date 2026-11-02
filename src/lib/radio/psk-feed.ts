/* PSK Reporter live spots over MQTT (mqtt.pskreporter.info:1883, topic
   pskr/filter/v2/{band}/{mode}/{tx}/{rx}/{txgrid}/{rxgrid}/{txdxcc}/{rxdxcc}).

   One connection for the whole server, opened when the map first asks and
   closed again three minutes after the last request, so the ~300 spots a
   second only flow while someone has the layer on. A tiny MQTT 3.1.1 client
   (QoS 0 subscribe only) keeps it free of extra dependencies.

   Two views are kept:
   - paths: every spot with either end in the UK or Ireland, or with the
     watched callsign at either end, for 30 minutes
   - activity: transmitting stations per 4-character grid and band, worldwide,
     for 15 minutes */
import net from 'node:net';
import { gridToLatLon } from './maidenhead';

const HOST = 'mqtt.pskreporter.info';
const PORT = 1883;
const TOPIC = 'pskr/filter/v2/#';
// ADIF DXCC entities: Scotland, England, Wales, Northern Ireland, Ireland, Isle of Man, Guernsey, Jersey.
const HOME_DXCC = new Set([279, 223, 294, 265, 245, 114, 106, 122]);
const PATH_KEEP_S = 30 * 60;
const ACTIVITY_KEEP_S = 15 * 60;
const MAX_PATHS = 40000;
const IDLE_CLOSE_MS = 3 * 60 * 1000;

export interface Spot { t: number; f: number; b: string; md: string; rp: number | null; sc: string; rc: string; sl: string; rl: string; sa: number; ra: number }

interface State {
  sock: net.Socket | null;
  connected: boolean;
  connecting: boolean;
  lastAsk: number;
  watch: string;
  paths: Spot[];
  activity: Map<string, { lat: number; lon: number; b: string; n: number; t: number; calls: Set<string> }>;
  rate: number; count: number; rateAt: number;
  retry: ReturnType<typeof setTimeout> | null;
  ping: ReturnType<typeof setInterval> | null;
  prune: ReturnType<typeof setInterval> | null;
  backoff: number;
}

const g = globalThis as unknown as { __pskFeed?: State };
const S: State = g.__pskFeed ??= {
  sock: null, connected: false, connecting: false, lastAsk: 0, watch: '',
  paths: [], activity: new Map(), rate: 0, count: 0, rateAt: Date.now(),
  retry: null, ping: null, prune: null, backoff: 2000,
};

function str(s: string): Buffer { const b = Buffer.from(s, 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); }
function remLen(n: number): Buffer { const o: number[] = []; do { let d = n % 128; n = Math.floor(n / 128); if (n) d |= 0x80; o.push(d); } while (n); return Buffer.from(o); }
function packet(type: number, body: Buffer): Buffer { return Buffer.concat([Buffer.from([type]), remLen(body.length), body]); }

function onSpot(s: Spot) {
  const now = Date.now() / 1000;
  S.count++;
  const watch = S.watch;
  if (HOME_DXCC.has(s.sa) || HOME_DXCC.has(s.ra) || (watch && (s.sc === watch || s.rc === watch))) {
    S.paths.push(s);
    if (S.paths.length > MAX_PATHS) S.paths.splice(0, S.paths.length - MAX_PATHS);
  }
  const g4 = (s.sl || '').slice(0, 4).toUpperCase();
  if (g4.length === 4) {
    const k = `${g4}|${s.b}`;
    let a = S.activity.get(k);
    if (!a) {
      const ll = gridToLatLon(g4);
      if (!ll) return;
      a = { lat: ll[0], lon: ll[1], b: s.b, n: 0, t: now, calls: new Set() };
      S.activity.set(k, a);
    }
    a.n++; a.t = now;
    if (a.calls.size < 40) a.calls.add(s.sc);
  }
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
      try {
        const j = JSON.parse(payload.toString('utf8'));
        onSpot({ t: j.t, f: j.f, b: j.b, md: j.md, rp: typeof j.rp === 'number' ? j.rp : null, sc: j.sc, rc: j.rc, sl: j.sl, rl: j.rl, sa: j.sa, ra: j.ra });
      } catch { /* not a spot */ }
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

function pruneOld() {
  const now = Date.now() / 1000;
  const cut = now - PATH_KEEP_S;
  let i = 0;
  while (i < S.paths.length && S.paths[i].t < cut) i++;
  if (i) S.paths.splice(0, i);
  for (const [k, a] of S.activity) if (a.t < now - ACTIVITY_KEEP_S) S.activity.delete(k);
  const el = (Date.now() - S.rateAt) / 1000;
  if (el >= 10) { S.rate = Math.round(S.count / el); S.count = 0; S.rateAt = Date.now(); }
  if (Date.now() - S.lastAsk > IDLE_CLOSE_MS) { close(); S.paths = []; S.activity.clear(); }
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

/** Called by the API route: keeps the feed open and returns what it holds. */
export function pskSnapshot(opts: { watch?: string; maxAgeS?: number; bands?: Set<string> | null; limit?: number }) {
  S.lastAsk = Date.now();
  if (opts.watch !== undefined) S.watch = opts.watch.toUpperCase();
  connect();
  const now = Date.now() / 1000;
  const maxAge = opts.maxAgeS ?? 15 * 60;
  const limit = opts.limit ?? 8000;
  const out: (number | string | null)[][] = [];
  const bandCount: Record<string, number> = {};
  for (let i = S.paths.length - 1; i >= 0 && out.length < limit; i--) {
    const s = S.paths[i];
    const age = now - s.t;
    if (age > maxAge) break;
    bandCount[s.b] = (bandCount[s.b] || 0) + 1;
    if (opts.bands && !opts.bands.has(s.b)) continue;
    const a = gridToLatLon(s.sl), b = gridToLatLon(s.rl);
    if (!a || !b) continue;
    out.push([+a[0].toFixed(3), +a[1].toFixed(3), +b[0].toFixed(3), +b[1].toFixed(3), s.b, s.rp, Math.round(age), s.sc, s.rc, s.f, s.md]);
  }
  const act: (number | string)[][] = [];
  for (const a of S.activity.values()) {
    if (opts.bands && !opts.bands.has(a.b)) continue;
    act.push([+a.lat.toFixed(2), +a.lon.toFixed(2), a.b, a.n, [...a.calls].slice(0, 6).join(' ')]);
  }
  return { connected: S.connected, rate: S.rate, watch: S.watch, paths: out, activity: act, bandCount };
}
