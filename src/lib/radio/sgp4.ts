/* The pure-JavaScript SGP4 parts of satellite.js, for code that runs in the browser.
   satellite.js 7's main entry also re-exports its WebAssembly runtime, which
   dynamic-imports an Emscripten pthreads build; pulling that into a client bundle
   makes `next build` (Turbopack) hang forever at "Creating an optimized production
   build". Server code (lib/orbit.ts) can keep importing 'satellite.js' directly.
   The package's exports map only exposes ".", hence the relative paths. */
export { twoline2satrec } from '../../../node_modules/satellite.js/dist/io.js';
export { propagate, gstime } from '../../../node_modules/satellite.js/dist/propagation.js';
export { eciToGeodetic, eciToEcf, ecfToLookAngles, degreesLat, degreesLong } from '../../../node_modules/satellite.js/dist/transforms.js';
export type { SatRec } from '../../../node_modules/satellite.js/dist/propagation/SatRec.js';
