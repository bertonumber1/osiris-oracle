/* Base maps and raster overlays for the map picker. The same set Clyde Watch
   offers, so both dashboards look the same over the Clyde. 'dark' is Osiris's
   own vector style; every other base is a raster drawn over it. */

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const GOOGLE = (lyr: string) => ['mt0', 'mt1', 'mt2', 'mt3'].map(s => `https://${s}.google.com/vt/lyrs=${lyr}&x={x}&y={y}&z={z}`);
const ABC = (u: string) => ['a', 'b', 'c'].map(s => u.replace('{s}', s));

export interface Basemap {
  key: string; label: string; group: 'Dark' | 'Street' | 'Terrain' | 'Marine' | 'Imagery';
  tiles: string[]; maxzoom: number; attribution: string;
  /** Imagery reads a touch translucent so the night shade and glow layers still sit in it. */
  imagery?: boolean;
}

export const BASEMAPS: Basemap[] = [
  { key: 'dark', label: 'Osiris Night', group: 'Dark', tiles: [], maxzoom: 22, attribution: '' },
  // The same night style with its lines (and labels) switched off: just land and sea.
  { key: 'night-clean', label: 'Night Clean', group: 'Dark', tiles: [], maxzoom: 22, attribution: '' },
  { key: 'night-blank', label: 'Night Blank', group: 'Dark', tiles: [], maxzoom: 22, attribution: '' },
  { key: 'esri-dark', label: 'Dark Grey', group: 'Dark', tiles: [ESRI + 'Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'], maxzoom: 16, attribution: '© Esri' },
  { key: 'light', label: 'Light Grey', group: 'Street', tiles: [ESRI + 'Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}'], maxzoom: 16, attribution: '© Esri' },
  { key: 'street', label: 'Street', group: 'Street', tiles: [ESRI + 'World_Street_Map/MapServer/tile/{z}/{y}/{x}'], maxzoom: 19, attribution: '© Esri' },
  { key: 'groad', label: 'Google Roads', group: 'Street', tiles: GOOGLE('m'), maxzoom: 20, attribution: '© Google' },
  { key: 'osm', label: 'OpenStreetMap', group: 'Street', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], maxzoom: 19, attribution: '© OpenStreetMap contributors' },
  { key: 'topo', label: 'Topographic', group: 'Terrain', tiles: [ESRI + 'World_Topo_Map/MapServer/tile/{z}/{y}/{x}'], maxzoom: 19, attribution: '© Esri' },
  { key: 'otm', label: 'OpenTopoMap', group: 'Terrain', tiles: ABC('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png'), maxzoom: 17, attribution: '© OpenTopoMap (CC-BY-SA)' },
  { key: 'gterrain', label: 'Google Terrain', group: 'Terrain', tiles: GOOGLE('p'), maxzoom: 20, attribution: '© Google' },
  { key: 'natgeo', label: 'National Geographic', group: 'Terrain', tiles: [ESRI + 'NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}'], maxzoom: 16, attribution: '© Esri, National Geographic' },
  { key: 'ocean', label: 'Ocean / Bathymetry', group: 'Marine', tiles: [ESRI + 'Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}'], maxzoom: 13, attribution: '© Esri, GEBCO' },
  { key: 'satellite', label: 'Esri Imagery', group: 'Imagery', tiles: [ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}'], maxzoom: 19, attribution: '© Esri, Maxar', imagery: true },
  { key: 'gsat', label: 'Google Satellite', group: 'Imagery', tiles: GOOGLE('s'), maxzoom: 20, attribution: '© Google', imagery: true },
  { key: 'ghyb', label: 'Google Hybrid', group: 'Imagery', tiles: GOOGLE('y'), maxzoom: 20, attribution: '© Google', imagery: true },
];

export function basemapFor(key?: string | null): Basemap | null {
  if (!key || key === 'dark' || key.startsWith('night-')) return null;
  // Older callers (and the OI assistant) pass 'satellite' or a raw tile URL for the Esri imagery.
  if (/^https?:/.test(key)) return BASEMAPS.find(b => b.key === 'satellite')!;
  return BASEMAPS.find(b => b.key === key) || null;
}

export interface Overlay { key: string; label: string; note: string; tiles: string[]; maxzoom: number; opacity: number; attribution: string }

export const OVERLAYS: Overlay[] = [
  { key: 'labels', label: 'Place Names', note: 'Towns, borders and places', tiles: [ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], maxzoom: 19, opacity: 1, attribution: '© Esri' },
  { key: 'roads', label: 'Roads', note: 'Road network and names', tiles: [ESRI + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'], maxzoom: 19, opacity: 0.85, attribution: '© Esri' },
  { key: 'seamarks', label: 'Seamarks', note: 'Buoys, lights, beacons, channels', tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'], maxzoom: 18, opacity: 0.95, attribution: '© OpenSeaMap' },
  { key: 'rail', label: 'Railways', note: 'Lines and stations', tiles: ABC('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png'), maxzoom: 19, opacity: 0.9, attribution: '© OpenRailwayMap' },
  { key: 'hillshade', label: 'Hillshade', note: 'Relief shading over any base', tiles: [ESRI + 'Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}'], maxzoom: 16, opacity: 0.35, attribution: '© Esri' },
];

/** Preview tile for a card: the Firth of Clyde at z8. */
export function thumb(tiles: string[]): string | null {
  const t = tiles[0];
  return t ? t.replace('{z}', '8').replace('{x}', '124').replace('{y}', '79') : null;
}
