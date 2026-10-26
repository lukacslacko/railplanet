# Railplanet

Procedural planet terrain viewer in JavaScript and WebGL 2. Includes configurable terrain noise, oceans, downhill rivers, lakes, glaciers, unrestricted camera rotation, and a hovering flight camera. The railway planner connects two selected land points. Trains and city simulation are not implemented yet.

[Open the viewer](https://lukacslacko.github.io/railplanet/)

## Run locally

No build step or package installation is needed. Serve `dist/` over HTTP:

```sh
python3 -m http.server 4173 --directory dist
```

Open `http://localhost:4173`. A WebGL 2 browser with hardware acceleration is required. Opening `index.html` directly as a file will not load the worker.

## Controls

- Drag to rotate through any orientation, including the poles.
- Scroll, pinch, or use +/− to zoom. Double-click a location to center it.
- Arrow keys rotate the globe.
- The seed field, Generate button, and random-seed button remain visible when Settings is closed. Enter a seed and press Enter or Generate to load that planet.
- Settings starts closed and controls spatial frequency, noise persistence, layer count, vertical scale, sea level, and mesh density. Defaults: frequency 1.5, persistence 0.53, 10 layers, mountain height 1.4, sea level 0, and Balanced mesh detail. Explicit URL parameters override the noise defaults.
- Noise controls regenerate on release. The seed, frequency, persistence, and layer count are stored in the URL.
- Mesh detail changes geometry immediately without changing the landscape: 196,608, 442,368, or 995,328 triangles.
- Airplane mode starts above the center of the globe view. W/S moves forward/backward, A/D yaws, and Q/E descends/climbs. Combine keys to turn while flying. Release to hover.
- In airplane mode, drag to look, scroll or use +/− to change height, and press Escape or the mode button to return to the globe. The camera follows planetary curvature and stays above terrain, lakes, water, and ice. Height is measured above the surface.


## Railway planning

Open **Railway**, then click two land points. Dragging still rotates the globe; a stationary click selects an endpoint. The search runs in a Web Worker, can be cancelled, and displays the resulting distance, journey time, grade, curve radius, and earthwork volume. Use **Choose endpoints** for another connection or **Replan** after changing routing settings. Terrain, sea-level, or mesh changes clear the route because its geometry and constraints depend on that surface.

Defaults target a simple passenger line: 120 km/h cruise speed, 3% maximum grade, 300 m minimum horizontal curve radius, and at most 60 m of open cut/fill. Oceans, lakes, and frozen lakes are blocked, including the formation's side slopes. Narrow rivers can be crossed; dedicated bridge structures are not modeled yet. No tunnels are generated.

The original planner uses bounded hybrid A* on the sphere. Its state includes position, tangent heading, and railway formation elevation. Analytic circular motion primitives preserve continuous tangents and do not flip at geographic poles or longitude seams. Local terrain gradients supply additional contour-following directions. A weighted distance/elevation heuristic finds coarse alternatives; finer searches then improve their corridors. The final centerline is checked at no more than 10 m intervals for water, grade, cut/fill depth, and horizontal curvature.

The objective is distance plus travel-time, speed-change, and earthwork penalties. Segment speed is limited by grade and horizontal curvature. Estimated journey time also includes vertical-curve speed limits, acceleration at 0.55 m/s², braking at 0.7 m/s², and stops at both endpoints. Curve speed uses `sqrt(0.65 × radius)` in m/s; the grade-speed function is a simplified simulation model. Abrupt speed changes add cost.

Earthwork volume integrates an 8 m formation and its banks, including both centerline offsets and cross-slope grading. A line following a steep contour still needs cuts and fills across its width, and these are included in its cost. The default penalty adds 0.025 m of equivalent route cost per cubic metre; this makes deep cuts/fills expensive. The UI's Earthwork penalty slider scales that coefficient. The renderer replaces the construction footprint with the graded formation and banks, rather than drawing underground rails over unmodified terrain. A thin speed-coloured overlay keeps the route visible at globe scale; rails and sleepers appear on the formation at close range.

This is an approximate, bounded search. A failed search is not proof that no feasible route exists. Very steep terrain, disconnected land, or endpoints with a large elevation difference may require much longer track or different limits. Self-crossing formations are rejected. Existing tracks, junctions, parallel tracks, city approach directions, and network optimization are outside this first planner.

Planned extensions: [ferries across oceans and lakes](https://github.com/lukacslacko/railplanet/issues/1), [tunnels](https://github.com/lukacslacko/railplanet/issues/2).

## Implementation

Terrain height and analytic gradients are generated on the GPU into a 2048×1024 field. A Web Worker calculates drainage and fills basins from that elevation field. Smooth river paths are baked into a GPU mask; terrain and water use one continuous displaced cube sphere with shared edge vertices.

The noise is a seeded sum of independently rotated directional wave bands. Each additional layer doubles spatial frequency, with persistence controlling relative amplitude. Bands above the elevation map's resolution limit fade out. The finite directional distribution is approximately balanced; individual landforms can still be elongated.

Liquid water uses one saturated blue base color, independent of depth. Lakes above 3,500 m become flat ice. Rivers become ice at the same elevation where terrain shading becomes snowy. Lighting follows the camera. Rendering stops when the view is stationary.

All implementation code is original. [terrain3d](https://github.com/lukacslacko/terrain3d) was used as a visual reference; none of its code was reused.

## Verification

Run the JavaScript syntax and numerical checks with Node.js:

```sh
npm run check
```

These cover closed mesh topology at all detail levels, drainage, river continuity, camera rotation through poles, deterministic noise spectra, parameter bounds, spherical flight with collision checks against the actual displaced mesh, and railway routing. Railway fixtures check flat routes, lake avoidance, mountain-pass discovery, rotation/seam continuity, endpoint accuracy, grade and curve limits, volume-based earthwork costs, speed/acceleration envelopes, and cancellation.

For actual GPU shader checks, serve the project root:

```sh
python3 -m http.server 4173
```

Open `http://localhost:4173/checks/render.html` for heights, gradients, and ice transitions, or `http://localhost:4173/checks/surface.html` for the seed 803297 displacement/seam regression.

## Deployment

The GitHub Actions workflow validates the source and deploys `dist/` to GitHub Pages on pushes to `main`. No server, API keys, or runtime dependencies are required.

## License

[MIT](LICENSE).
