/* Read-only window onto Clyde Watch (the radio/pager dashboard on the host).

   The browser only ever talks to Osiris; this route forwards an allow-listed
   set of GET endpoints to CLYDE_URL, so the Clyde Watch address never leaves
   the server and nothing that changes state (scanner control, settings,
   decoder start/stop) can be reached through here. The live event stream is
   passed through chunk by chunk and closed upstream when the browser leaves. */
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BASE = (process.env.CLYDE_URL || 'http://host.docker.internal:8083').replace(/\/+$/, '');

// Exact paths, or a prefix ending in '/' for one trailing segment (an id).
const ALLOW = [
  '_cfg', 'status', 'events',
  'adsb/aircraft', 'adsb/aircraft-info/',
  'ais/vessels', 'ais/stats', 'ais/vessel-info/', 'ais/track/',
  'aprs/stations',
  'incidents', 'incidents/heatmap', 'sfrs-network', 'station-caps',
  'radios', 'radios/meta', 'radios/site', 'navaids', 'lightning',
];

function allowed(path: string): boolean {
  if (!/^[A-Za-z0-9_\-/.]+$/.test(path) || path.includes('..')) return false;
  return ALLOW.some(a => a.endsWith('/') ? (path.startsWith(a) && !path.slice(a.length).includes('/') && path.length > a.length) : path === a);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const path = (parts || []).join('/');
  if (!allowed(path)) return Response.json({ error: 'not allowed' }, { status: 404 });

  const url = `${BASE}/api/${path}${req.nextUrl.search}`;
  const stream = path === 'events';
  try {
    const res = await fetch(url, {
      signal: stream ? req.signal : AbortSignal.any([req.signal, AbortSignal.timeout(20000)]),
      cache: 'no-store',
      headers: { accept: stream ? 'text/event-stream' : 'application/json' },
    });
    if (stream) {
      return new Response(res.body, {
        status: res.status,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
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
