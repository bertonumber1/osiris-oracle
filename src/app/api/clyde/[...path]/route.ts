/* Read-only window onto Clyde Watch (the radio/pager dashboard on the host).

   The browser only ever talks to Osiris; this route forwards an allow-listed
   set of GET endpoints to CLYDE_URL, so the Clyde Watch address never leaves
   the server. The live event stream and the scanner audio are passed through
   chunk by chunk and closed upstream when the browser leaves.

   Writes: only the scanner panel's own buttons (keys, VOL/SQL, record, audio
   restart) via POST_ALLOW. Settings, decoders, the SDS200E reboot and its menu
   driver stay reachable only from Clyde Watch itself. Osiris and Clyde Watch
   are both LAN-only on this box, so this exposes nothing Clyde Watch did not. */
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE = (process.env.CLYDE_URL || 'http://host.docker.internal:8083').replace(/\/+$/, '');

// Exact paths, or a prefix ending in '/' for one trailing segment (an id).
const ALLOW = [
  '_cfg', 'status', 'events',
  'adsb/aircraft', 'adsb/aircraft-info/',
  'ais/vessels', 'ais/world', 'ais/stats', 'ais/vessel-info/', 'ais/track/',
  'aprs/stations',
  'incidents', 'incidents/heatmap', 'sfrs-network', 'station-caps',
  'radios', 'radios/meta', 'radios/site', 'radios/byfreq', 'navaids', 'lightning',
  // Scanners (phase 4 dock)
  'sds200/status', 'sds200/info', 'sds200/log', 'sds200/audio', 'sds200/skin.png',
  'scanner/status', 'scanner/audio', 'xlt/screen', 'xlt/log', 'xlt/skin.png',
];

const POST_ALLOW = ['sds200/control', 'sds200/level', 'sds200/record', 'sds200/restart', 'xlt/key'];
// Endless streams: no timeout, closed when the browser leaves.
const STREAMS: Record<string, string> = { events: 'text/event-stream', 'sds200/audio': 'audio/mpeg', 'scanner/audio': 'audio/mpeg' };

function allowed(path: string): boolean {
  if (!/^[A-Za-z0-9_\-/.]+$/.test(path) || path.includes('..')) return false;
  return ALLOW.some(a => a.endsWith('/') ? (path.startsWith(a) && !path.slice(a.length).includes('/') && path.length > a.length) : path === a);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const path = (parts || []).join('/');
  if (!allowed(path)) return Response.json({ error: 'not allowed' }, { status: 404 });

  const url = `${BASE}/api/${path}${req.nextUrl.search}`;
  const stream = STREAMS[path];
  try {
    const res = await fetch(url, {
      signal: stream ? req.signal : AbortSignal.any([req.signal, AbortSignal.timeout(20000)]),
      cache: 'no-store',
      headers: { accept: stream || 'application/json' },
    });
    if (stream) {
      return new Response(res.body, {
        status: res.status,
        headers: { 'content-type': stream, 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
      });
    }
    return new Response(res.body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' },
    });
  } catch {
    // Clyde Watch restarting or the host unreachable: the layers show "offline" and retry.
    return Response.json({ error: 'clyde watch unreachable', clyde: 'down' }, { status: 503 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const path = (parts || []).join('/');
  if (!POST_ALLOW.includes(path)) return Response.json({ error: 'not allowed' }, { status: 404 });
  // Only the Osiris page itself: a JSON content type forces a CORS preflight from any
  // other site (which is never answered), and a foreign Origin is refused outright.
  const origin = req.headers.get('origin');
  if (!(req.headers.get('content-type') || '').startsWith('application/json') || (origin && new URL(origin).host !== req.headers.get('host')))
    return Response.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.text();
  if (body.length > 2000) return Response.json({ error: 'too large' }, { status: 413 });
  try {
    const res = await fetch(`${BASE}/api/${path}`, {
      method: 'POST', body: body || '{}', cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(20000)]),
    });
    return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' } });
  } catch {
    return Response.json({ error: 'clyde watch unreachable', clyde: 'down' }, { status: 503 });
  }
}
