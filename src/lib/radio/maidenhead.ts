/** Centre of a Maidenhead locator (2, 4, 6 or 8 characters), or null if it is not one. */
export function gridToLatLon(grid: string | null | undefined): [number, number] | null {
  const g = (grid || '').trim().toUpperCase();
  if (!/^[A-R]{2}(\d\d([A-X]{2}(\d\d)?)?)?$/.test(g)) return null;
  let lon = (g.charCodeAt(0) - 65) * 20 - 180;
  let lat = (g.charCodeAt(1) - 65) * 10 - 90;
  let w = 20, h = 10;
  if (g.length >= 4) { lon += +g[2] * 2; lat += +g[3]; w = 2; h = 1; }
  if (g.length >= 6) { lon += (g.charCodeAt(4) - 65) * (5 / 60); lat += (g.charCodeAt(5) - 65) * (2.5 / 60); w = 5 / 60; h = 2.5 / 60; }
  if (g.length >= 8) { lon += +g[6] * (0.5 / 60); lat += +g[7] * (0.25 / 60); w = 0.5 / 60; h = 0.25 / 60; }
  return [lat + h / 2, lon + w / 2];
}

/** Great-circle distance in km. */
export function distanceKm(a: [number, number], b: [number, number]): number {
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Amateur bands in display order, with the colours the PSK layer uses. */
export const BANDS: { key: string; color: string }[] = [
  { key: '160m', color: '#ff4d6d' }, { key: '80m', color: '#ff7b39' }, { key: '60m', color: '#ffa62b' },
  { key: '40m', color: '#ffd60a' }, { key: '30m', color: '#b5f23d' }, { key: '20m', color: '#2ee6a6' },
  { key: '17m', color: '#22d3ee' }, { key: '15m', color: '#4c9bff' }, { key: '12m', color: '#8b7bff' },
  { key: '10m', color: '#c77dff' }, { key: '6m', color: '#ff5dc8' }, { key: '4m', color: '#ff8fab' },
  { key: '2m', color: '#f1f5f9' },
];
export const BAND_COLOR: Record<string, string> = Object.fromEntries(BANDS.map(b => [b.key, b.color]));
