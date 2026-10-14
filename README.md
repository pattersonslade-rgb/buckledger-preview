# Buck Ledger

A hunter's trail cam logbook that fills itself in from your SD card. Phone web app (PWA): no account, no subscription, and photos never leave the phone.

Live: https://pocketappstudio.github.io/buckledger/

Tiers (one-time, via Gumroad): Free (1 camera, 1 named buck, 1 prediction) · Pro $30 (3 / 3, 3 open predictions) · Elite $50 (unlimited + 3D Terrain Sim) · Elite Upgrade $20 for Pro owners.

v3 adds: state picker with rut/acorn/drought/crop info (`data/states.js`), sun + moon per visit, hourly weather per visit (Open-Meteo, on a tap), ribbon temp (typed or read on the phone with the self-hosted OCR in `vendor/ocr`), travel headings, bait log, points + small-buck filter, rename history, profile photos, companions, conservative buck ID suggestions, sha256-locked predictions scored hit/miss, and the 3D Terrain Sim (`terrain.js`, USGS 3DEP elevation on a tap).

To launch paid tiers, fill the product IDs and checkout links in `config.js` (instructions at the top of that file), bump VERSION in `sw.js`, and push.

The Simulator (Elite) runs one engine (`terrain.js`) in the phone for the buyer's own property, shown as 3D terrain (`sim.js` holds only the property map editor where the buyer marks bedding, food and stands): USGS 3DEP elevation and Open-Meteo hourly weather on a tap (on the property's own clock), wind with its published wavering spread, slope air, scent, deer routes worked out from the buyer's bedding and food marks, green/yellow/red stands with plain reasons, and the safest walk-in. No numbers, graphs or trail-cam photos in the view. It is a model, not a forecast. The free and Pro Example is the lean 3D preview (`hbk3d/`).

## 3D view: aerial photo and elevation
- The 3D view (`t3gl.js`, Three.js r-vendored in `vendor/three/`) loads only when the 3D tab opens.
- Aerial photo for the buyer's land: USGS The National Map "USGS Imagery Only" service (`USGSImageryOnly` MapServer, mostly USDA NAIP leaf-on imagery). Terms, checked live Oct 12, 2026 (https://www.usgs.gov/faqs/what-are-terms-uselicensing-map-services-and-data-national-map): "Map services and data downloaded from The National Map are free and in the public domain. There are no restrictions"; credit requested: "Map services and data available from U.S. Geological Survey, National Geospatial Program." (shown under the view). No key needed.
- Elevation: USGS 3DEP (`3DEPElevation` ImageServer), same public-domain terms.
- Both are requested for the same box in Web Mercator (EPSG:3857) so pixels stay square and the servers return exactly that box; the photo lines up with the ground. "Exaggerate terrain" multiplies drawn height only; physics uses true elevation.
- Example property: a real lidar ground model and NAIP photo used with the owner's permission; names, places and coordinates are not shown.

## 3D view: the original sim, ported 1:1 (Oct 12, 2026)

The Elite 3D view and both Example teasers now run the original sim renderer (original source kept outside this repo) in its own frame, `hbk3d/sim.html`. It's loaded only when the 3D view opens.

- **Source:** `buckledger-build/port/patch_app.py` copies the original source and makes only marked `BL:` swaps: data paths, names hidden, palette colors, tap-only labels, and the hooks for the layers below. `build.sh` bundles it with the same three.js (r160) as the original.
- **Same as the original:** terrain mesh, aerial texture, shaders (terrain, mist, sky, clouds, cold front, particles), lighting and sun/moon/stars, camera, OrbitControls, views and fit poses, wind streaks, wind arrows, ground air, engine scent puffs, acorns and oaks, routes, crossings, visits, walk-ins, the setup lesson, the tour, and the day, view and key sheets with the time arc.
- **Example data** (`hbk3d/data/`): the original precomputed data, with text identifiers hidden by `buckledger-build/port/sanitize.js`. The engine was re-run for the four Example stands (North, South, East and West) by `precompute_bl.js`, which is the original precompute with only the stand list and output folder changed.
- **Buyers** (`hbk3d/buyer.js`): the same renderer, filled with the buyer's own data:
  - ground: a USGS 3DEP mesh at a 3 m step;
  - aerial: a 2048 px USGS image (Web Mercator, same box);
  - the original engine (`hbk3d/engine/`, unmodified), run in the phone on Open-Meteo hours with the buyer's stands, bedding, food and parking.
- **Layers on top** (`buckledger-build/port/src/bl_layers.js`):
  - Wind / Thermals / Scent / Routes chips; Routes and Scent are on by default.
  - Yellow hoof prints with a constant-length trail; routes are staggered.
  - Violet telescoping scent cones.
  - Blue (sinking) and rose-pink (rising) vapor.
  - A 3D wind vane and a north marker.
  - Tap callouts. Every original label is still there, shown on tap.
  - Field Tips on a ground tap, with a native Share button.
  - The palette above.
  - Tweak configs: `HOOF`, `MOTION`, `THERMAL` and `CONE`, which can be overridden live with `window.BL_HOOF`, `BL_MOTION`, `BL_THERMAL` and `BL_CONE` inside the frame.
- **Rebuild:** `sh buckledger-build/port/build.sh`. For new Example data, run `node buckledger-build/port/precompute_bl.js && node buckledger-build/port/sanitize.js`.

## 3D sim color palette (one color per icon type)

Defined once in `t3gl.js` as `PALETTE` (the stand chips use the same values). No two icon types share a color.

| Layer / icon | Color | Hex |
|---|---|---|
| Stand: good | teal | `#00BFA5` |
| Stand: caution | amber-orange | `#FF8A00` |
| Stand: avoid | deep crimson | `#A0001E` |
| Hoof prints (buck routes) | yellow | `#FFD23F` |
| Scent cones | violet | `#9C6BFF` |
| Thermal vapor, sinking air | icy sky-blue | `#7FD4FF` |
| Thermal vapor, rising air | rose pink | `#FF80AB` |
| Wind vane and wind lines | white | `#FFFFFF` |
| Bedding cover markup | forest green | `#2E7D32` |
| Bedded-deer marker | brown | `#6D4C41` |
| Food markup and crop-clump marker | wheat | `#C8A26A` |
| Property boundary / outside | coral-red | `#FF5252` |
| Water / creek | deep blue | `#1E4FA8` |
| Walk-in path | lime | `#C6FF00` |
| North marker | black tip on a white post | `#212121` |
| Selected-stand ring | white | `#FFFFFF` |

The wind vane and the selected-stand ring are both white, but they're different shapes and never mean the same thing. The tree stand's dark-green canopy is part of the stand model, not a color code.

Tweak config, also at the top of `t3gl.js`: `HOOF` (stagger, step spacing, trail length, pace, size, color), `THERMAL` (opacity, flow speed), `MOTION` (scent pulse, wind speed), `OBJ3D` (object size). The same keys can be overridden live with `window.BL_HOOF`, `BL_THERMAL`, `BL_MOTION` and `BL_OBJ3D`.
