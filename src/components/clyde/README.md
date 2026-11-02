# Clyde Watch layers

Osiris reading from Clyde Watch, the pager / AIS / ADS-B / radio dashboard that runs on the same machine.

## What it adds

**CLYDE WATCH group in the layer panel**

- **Our ADS-B:** the Greenock Pi's readsb merged with adsb.lol, airplanes.live and adsb.fi.
  - Aircraft move smoothly between the 8-second polls, using their ground speed and track.
  - Optional callsigns and altitude-coloured trails.
  - Osiris's own copies of the same airframes are hidden while this layer is on.
- **Our AIS:** our aerial plus AISHub, live over Clyde Watch's event stream.
  - Community vessels are dimmed, watched vessels get a coloured ring, and clicking one draws its stored track.
- **APRS:** APRS-IS stations within 300 km.
- **SFRS Incidents:** pager decodes from the last 30 days.
  - Coloured by age, with a pulse on anything paged in the last hour.
  - Optional heatmap of all history.
- **SFRS Stations:** coloured by area, with units, jobs, top incident types and officers in the readout.
- **WTR Spectrum:** Ofcom Wireless Telegraphy Register sites in view from zoom 8.
  - Eight category sub-toggles.
  - Fixed links are drawn as paths.
  - Clicking a site shows the full licence with every channel.
- **Aero Navaids:** beacons and aerodrome frequencies.
- **Lightning:** in the Weather group, Blitzortung strikes from the last hour.

**One symbol set everywhere**

- Every aircraft in Osiris, the worldwide feeds included, is drawn with the tar1090 silhouettes, picked by type code or emitter category.
- Aircraft are coloured by altitude. *Colour by Category* in Aviation switches back to Osiris's category colours.
- Ships use the AIS dart (moving, rotated by course) or disc (stationary), coloured by ship type.
- See `lib/clyde/symbols.ts` and `symbols-draw.ts`.

**Map picker (LAYERS in the view strip)**

- 14 base maps with live preview tiles.
- Raster overlays with their own opacity: place names, roads, seamarks, railways, hillshade.
- One-click views: Clyde, Scotland, UK & Ireland.
- Kiosk mode (`K`): full screen, map only.
- Base map, overlays and layer choices are remembered between visits.

## Wiring

- `app/api/clyde/[...path]` is a read-only proxy.
  - It allows an explicit list of GET endpoints only, so nothing that controls the radios is reachable.
  - It forwards to `CLYDE_URL`, default `http://host.docker.internal:8083`.
- Docker needs `extra_hosts: host.docker.internal:host-gateway`, which `docker-compose.yml` already has.
- `components/clyde/ClydeLayers.tsx` owns every Clyde source, layer, poll and stream.
  - `ClydeCard.tsx` is the selection readout.
  - `ClydeStatus.tsx` is the feed strip.
  - `MapPicker.tsx` is the base map picker.

AIS data from AISHub is for display here only. Passing it on as raw data is against AISHub's terms.
