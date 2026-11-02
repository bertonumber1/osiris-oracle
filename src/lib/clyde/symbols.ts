/* The one symbol set for aircraft and ships, shared by every layer that draws
   them: Osiris's own global feeds and the Clyde Watch layers alike. Pure data
   and functions only, so the API routes can import it as well as the map. */

/** ICAO emitter category -> [silhouette, css px] (tar1090's CategoryIcons table). */
export const CAT_SHAPE: Record<string, [string, number]> = {
  A1: ['cessna', 22], A2: ['jet_swept', 26], A3: ['airliner', 33], A4: ['airliner', 34],
  A5: ['heavy_2e', 37], A6: ['hi_perf', 28], A7: ['helicopter', 32], B1: ['glider', 26],
  B2: ['balloon', 16], B4: ['cessna', 20], B6: ['uav', 24],
};

/** Size when the shape came from the type code rather than the category. */
export const SHAPE_SIZE: Record<string, number> = {
  cessna: 22, jet_swept: 26, airliner: 33, heavy_2e: 37, hi_perf: 28,
  helicopter: 32, glider: 26, balloon: 16, uav: 24, unknown: 16,
};

/** OpenSky's numeric emitter category (extended=1) -> the ICAO letter form. */
const OS_CAT: Record<number, string> = { 2: 'A1', 3: 'A2', 4: 'A3', 5: 'A4', 6: 'A5', 7: 'A6', 8: 'A7', 9: 'B1', 10: 'B2', 12: 'B4', 14: 'B6' };

const HEAVY = /^(B74|B77|B78|A33|A34|A35|A38|B76|MD11|IL96|A30|C17|C5|A400|A3ST|KC46|KC10|K35|B52|E3|AN12|AN22|AN24|IL76)/;
const NARROW = /^(A31|A32|A2|B73|B3[789]M|B75|B71|E1[3-9]|E2|E7|E9|CRJ|DH8|AT[47]|B46|RJ|BCS|A22|SB20|SF34|JS4|F70|F100|MD8|MD9|C130|C30J|P8|A124|SU95|C295|CN35)/;
const BIZJET = /^(GLF|GL[57X]|G[1-7]\d\d|GLEX|CL[36]|BD[17]|C25|C5[01]|C5[256]|C68|C70|C75|FA[0-9]|F2TH|F900|LJ|E55P|E50P|E35L|E545|PC24|H25|PRM1|HDJT|SF50|EA50)/;
const FIGHTER = /^(F1[4-8]|F22|F35|F117|EUFI|TYPH|TOR|HAWK|HAWK|A10|RFAL|MIR|SU[23]|MG|J[0-9]|T38|T6|L39|M346|JAS|GRIF|AJET)/;
const HELI = /^(R22|R44|R66|B0[6-9]|B2|B4|B5|AS[0-9]|EC[0-9]|H1[2-9]|H[1-6]\d$|A1[0-9]9|AW|S76|S92|S61|H60|UH|CH|MI[0-9]|KA|EH10|NH90|LYNX|MRLN|PUMA|WILD|A109|A119|A139|A169|A189|BK17|GAZL|ALO|EXPL|MD[56]|NOTA)/;
const GLIDER = /^(GLID|DG|ASK|ASW|ASG|LS[0-9]|DUO|ARCP|JANU|VENT|NIMB|PIK|SZD|LAK)/;
const LIGHT = /^(C1[0-9]|C2[0-9]|C3[0-9]|C4|P28|P32|P46|PA|SR2|DA[0-9]|DR[0-9]|BE[0-9]|M20|TB|RV|AA5|TOBA|PC12|PC6|BN2|DHC|C208|TBM|AC|EV|G1|GLAS|CH|J3|AR11|ULAC)/;

/** Pick a silhouette and its size for one aircraft, from whatever the feed gave. */
export function aircraftShape(o: { category?: string | null; osCategory?: number | null; type?: string | null; kind?: string | null }): { shape: string; size: number } {
  let cat = (o.category || '').toUpperCase();
  if (!cat && typeof o.osCategory === 'number') cat = OS_CAT[o.osCategory] || '';
  const t = (o.type || '').toUpperCase().trim();
  // The type code is more specific than the emitter category, so it wins when it is known.
  if (t && t !== 'UNKNOWN') {
    let s = '';
    if (t === 'BALL' || t.startsWith('BALL')) s = 'balloon';
    else if (GLIDER.test(t)) s = 'glider';
    else if (HELI.test(t)) s = 'helicopter';
    else if (FIGHTER.test(t)) s = 'hi_perf';
    else if (HEAVY.test(t)) s = 'heavy_2e';
    else if (NARROW.test(t)) s = 'airliner';
    else if (BIZJET.test(t)) s = 'jet_swept';
    else if (LIGHT.test(t)) s = 'cessna';
    if (s) return { shape: s, size: SHAPE_SIZE[s] };
  }
  if (CAT_SHAPE[cat]) return { shape: CAT_SHAPE[cat][0], size: CAT_SHAPE[cat][1] };
  // Nothing from the feed: fall back on how Osiris classified it.
  switch (o.kind) {
    case 'heli': return { shape: 'helicopter', size: 32 };
    case 'commercial': return { shape: 'airliner', size: 33 };
    case 'jet': return { shape: 'jet_swept', size: 26 };
    case 'private': return { shape: 'cessna', size: 22 };
    case 'military': return { shape: 'hi_perf', size: 28 };
  }
  return { shape: 'unknown', size: 16 };
}

/** Altitude colour ramp (tar1090 style), in feet. Key order matters: the legend draws it. */
export const ALT_BANDS: { key: string; max: number; color: string; label: string }[] = [
  { key: 'a0', max: 2500, color: '#ff2244', label: '<2.5k' },
  { key: 'a1', max: 5000, color: '#ff6600', label: '5k' },
  { key: 'a2', max: 10000, color: '#ffaa00', label: '10k' },
  { key: 'a3', max: 20000, color: '#ffee00', label: '20k' },
  { key: 'a4', max: 30000, color: '#88dd00', label: '30k' },
  { key: 'a5', max: 40000, color: '#00ddaa', label: '40k' },
  { key: 'a6', max: 50000, color: '#00aaff', label: '50k' },
  { key: 'a7', max: Infinity, color: '#ffffff', label: '50k+' },
];
export const ALT_GROUND = '#8a8f98';
export const ALT_UNKNOWN = '#b8bec8';

export function altKey(ft: number | null | undefined | string): string {
  if (ft === 'ground') return 'gnd';
  if (ft == null || typeof ft !== 'number' || !isFinite(ft)) return 'unk';
  if (ft <= 0) return 'gnd';
  for (const b of ALT_BANDS) if (ft < b.max) return b.key;
  return 'a7';
}

/* ── Ships ── AIS-catcher's sprite colours, which Clyde Watch uses. */
export const SHIP_KINDS: { key: string; color: string; label: string }[] = [
  { key: 'cargo', color: '#00ff7f', label: 'Cargo' },
  { key: 'tanker', color: '#ff2a2a', label: 'Tanker' },
  { key: 'passenger', color: '#3b5bff', label: 'Passenger' },
  { key: 'highspeed', color: '#ffff00', label: 'High speed' },
  { key: 'special', color: '#b0413e', label: 'Tug / SAR / Special' },
  { key: 'fishing', color: '#ff1493', label: 'Fishing' },
  { key: 'classb', color: '#ff00ff', label: 'Sailing / Pleasure' },
  { key: 'military', color: '#7c83ff', label: 'Military / Law' },
  { key: 'other', color: '#12a5ed', label: 'Other / Unknown' },
];

/** AIS ship-type code -> symbol kind (Clyde Watch's shipSpriteCx). */
export function shipKind(st: number | null | undefined): string {
  if (st == null || st === 0) return 'other';
  if (st >= 70 && st <= 79) return 'cargo';
  if (st >= 60 && st <= 69) return 'passenger';
  if (st >= 80 && st <= 89) return 'tanker';
  if ((st >= 40 && st <= 49) || (st >= 20 && st <= 29)) return 'highspeed';
  if (st === 30) return 'fishing';
  if (st === 35 || st === 55) return 'military';
  if (st === 36 || st === 37) return 'classb';
  if (st >= 50 && st <= 59) return 'special';
  return 'other';
}

/** Moving vessels get the pointed dart, rotated by course; still ones a disc. */
export function shipMoving(speed: number | null | undefined, course: number | null | undefined): boolean {
  return speed != null && speed > 0.5 && course != null && course < 360;
}
