/* Clyde Watch layer ids that take a click, so Osiris's satellite picker defers to them. */
export const CLYDE_CLICKABLE = [
  'clyde-ac', 'clyde-ship', 'clyde-aprs', 'clyde-inc', 'clyde-stn', 'clyde-wtr', 'clyde-nav-beacon', 'clyde-nav-field', 'clyde-lx',
];

/** The WTR categories, in panel order, with Clyde Watch's colours. */
export const WTR_CATS: { key: string; label: string; color: string }[] = [
  { key: 'airwave', label: 'Airwave (TETRA)', color: '#ef4444' },
  { key: 'business', label: 'Business Radio', color: '#3fb950' },
  { key: 'maritime', label: 'Maritime / Coast / AIS', color: '#22d3ee' },
  { key: 'fixed', label: 'Fixed Links', color: '#f59e0b' },
  { key: 'navaid', label: 'Radar & Navaids', color: '#38bdf8' },
  { key: 'telemetry', label: 'Telemetry', color: '#a78bfa' },
  { key: 'shared', label: 'Shared Access', color: '#e879f9' },
  { key: 'satellite', label: 'Satellite Earth Stn', color: '#fbbf24' },
];
