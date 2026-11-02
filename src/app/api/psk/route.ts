/* PSK Reporter spots for the map. The live MQTT feed behind it opens on the
   first request and closes itself a few minutes after the last. */
import { NextRequest } from 'next/server';
import { pskSnapshot } from '@/lib/radio/psk-feed';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const call = (q.get('call') ?? process.env.PSK_CALLSIGN ?? '').replace(/[^A-Za-z0-9/]/g, '').slice(0, 16);
  const radiusKm = Math.max(0, Number(q.get('radius')) || 0);
  const minutes = Math.min(30, Math.max(1, Number(q.get('minutes')) || 15));
  const bands = q.get('bands') ? new Set(q.get('bands')!.split(',').filter(Boolean)) : null;
  const snap = pskSnapshot({ call, radiusKm, maxAgeS: minutes * 60, bands, limit: 6000 });
  return Response.json(snap, { headers: { 'cache-control': 'no-store' } });
}
