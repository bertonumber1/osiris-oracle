/* Osiris's aircraft categories (commercial / private / jet / military), moved
   here from api/flights so our own ADS-B feed is sorted the same way and the
   AVIATION switches act on every aircraft on the map. Input is a tar1090 /
   readsb aircraft record: t, flight, hex, dbFlags, alt_baro, gs, and either
   OpenSky's numeric category_os or the ADS-B emitter category ('A1'...'A7'). */

export type FlightCategory = 'commercial' | 'private' | 'jet' | 'military';

export const HELI_TYPES = new Set([
  'R22','R44','R66','B06','B06T','B204','B205','B206','B212','B222','B230',
  'B407','B412','B427','B429','B430','B505','B525',
  'AS32','AS35','AS50','AS55','AS65',
  'EC20','EC25','EC30','EC35','EC45','EC55','EC75',
  'H125','H130','H135','H145','H155','H160','H175','H215','H225',
  'S55','S58','S61','S64','S70','S76','S92',
  'A109','A119','A139','A169','A189','AW09',
  'MD52','MD60','MDHI','MD90','NOTR',
  'B47G','HUEY','GAMA','CABR','EXE',
]);

export const PRIVATE_JET_TYPES = new Set([
  'G150','G200','G280','GLEX','G500','G550','G600','G650','G700',
  'GLF2','GLF3','GLF4','GLF5','GLF6','GL5T','GL7T','GV','GIV',
  'CL30','CL35','CL60','BD70','BD10',
  'C25A','C25B','C25C','C500','C510','C525','C550','C560','C56X','C680','C700','C750',
  'E35L','E50P','E55P','E545','E550',
  'FA50','FA7X','FA8X','F900','F2TH',
  'LJ35','LJ40','LJ45','LJ60','LJ70','LJ75',
  'PC12','PC24','TBM7','TBM8','TBM9',
  'PRM1','SF50','EA50','VLJ',
]);

export const MILITARY_INDICATORS = new Set([
  'C17','C5M','C130','C30J','KC10','KC46','KC35','E3CF','E3TF','E8A',
  'B1B','B2','B52','F16','F15','F18','F22','F35','A10','F117',
  'RC135','E6B','P8A','P3','MQ9','RQ4','U2','EP3','RC12',
  'V22','CH47','UH60','AH64','AH1Z','MV22',
  'EUFI','RFAL','TORD','TYP','GR4',
]);

// Airliner and regional types, hoisted out of the classifier condition it used
// to sit inside. A typed airliner stays commercial whatever its callsign says.
export const AIRLINER_TYPES = new Set([
  'A319','A320','A321','A332','A333','A339','A343','A359','A388',
  'B737','B738','B739','B38M','B39M','B752','B753','B763','B764',
  'B772','B77L','B77W','B788','B789','B78X',
  'E170','E175','E190','E195','CRJ7','CRJ9','AT43','AT72','DH8D',
]);

// Fractional-ownership and charter operators file under a 3-letter ICAO
// designator exactly like an airline, so AIRLINE_CODE_RE matches them and they
// would otherwise be counted as commercial traffic.
export const BIZJET_OPERATORS = new Set([
  'EJA','EJM','NJE','LXJ','FJO','VJT','XOJ','JTL','WUP','GAJ','DPJ','CLY','TWY',
]);

export const AIRLINE_CODE_RE = /^([A-Z]{3})\d/;

// A callsign that is not an airline designator + flight number is a
// registration: what general-aviation aircraft broadcast once the hyphen is
// stripped — DMMKG (D-MMKG), HBYKO (HB-YKO), OEDLH (OE-DLH), N425RS, CGABC.
export const CALLSIGN_RE = /^[A-Z0-9]{3,8}$/;

// Business jets cruise in the mid-thirties at transonic speed; nothing flying
// under a civil registration reaches FL280 at 300 kt without turbofans. This is
// the only bizjet/piston discriminator available for OpenSky aircraft, which
// carry no aircraft type at all.
export const JET_CRUISE_ALT_M = 8500;
export const JET_CRUISE_KTS = 300;

// ADS-B emitter category -> the OpenSky number the tests below were written for.
const EMITTER_TO_OS: Record<string, number> = { A1: 2, A2: 3, A3: 4, A4: 5, A5: 6, A6: 7, A7: 8 };

export function flightCategory(f: any): FlightCategory {
  const modelUpper = (f.t || '').toUpperCase();
  const flightStr = (f.flight || '').trim().toUpperCase();
  const dbFlags = (f.dbFlags || 0);
  const callsign = flightStr || f.hex || 'UNKNOWN';
  const altRaw = f.alt_baro;
  const altMeters = typeof altRaw === 'number' ? altRaw * 0.3048 : 0;
  const speedKnots = typeof f.gs === 'number' ? Math.round(f.gs * 10) / 10 : null;
  const os = typeof f.category_os === 'number' ? f.category_os : EMITTER_TO_OS[String(f.category || '')];

  const isOsMilitary = os === 14;
  const isOsHighPerf = os === 7;
  const isOsLight = os === 2;
  // Large / high-vortex large / heavy — airline or cargo metal by weight alone.
  const isOsHeavy = os === 4 || os === 5 || os === 6;

  const airlineMatch = AIRLINE_CODE_RE.exec(callsign);
  const airlineCode = airlineMatch ? airlineMatch[1] : '';

  // OpenSky supplies no aircraft type, and its ADS-B emitter category is
  // "no information" for ~96% of aircraft even with extended=1 (measured live:
  // 597 of 620 over central Europe). Every type-based test below therefore only
  // fires on the adsb.fi feeds, which is what left all OpenSky traffic in the
  // commercial bucket. The callsign is the field OpenSky always fills, so the
  // airline-designator test is what carries the split for the bulk of the map.
  const isGaCallsign = !airlineCode && CALLSIGN_RE.test(flightStr);
  const cruisesLikeAJet =
    altMeters > JET_CRUISE_ALT_M && (speedKnots ?? 0) > JET_CRUISE_KTS;

  let category: FlightCategory = 'commercial';
  if (isOsMilitary || dbFlags & 1 || MILITARY_INDICATORS.has(modelUpper) || (f.flight || '').match(/^(RCH|KING|DUKE|EVAC|JAKE|REACH|CONVOY)\d/i)) {
    category = 'military';
  } else if (AIRLINER_TYPES.has(modelUpper) || isOsHeavy) {
    category = 'commercial';
  } else if (
    BIZJET_OPERATORS.has(airlineCode) ||
    PRIVATE_JET_TYPES.has(modelUpper) ||
    isOsHighPerf ||
    (isGaCallsign && cruisesLikeAJet)
  ) {
    category = 'jet';
  } else if (isGaCallsign || isOsLight) {
    category = 'private';
  }

  return category;
}
