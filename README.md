# Railplanet

Procedural planet terrain viewer in JavaScript and WebGL 2. Includes configurable terrain noise, oceans, downhill rivers, lakes, glaciers, unrestricted camera rotation, and a hovering flight camera. The railway planner builds a network between selected land points, reusing existing track and shared junctions. Trains and city simulation are not implemented yet.

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

Open **Railway**, then click two land points. Dragging still rotates the globe; a stationary click selects an endpoint. The search runs in a Web Worker, can be cancelled, and displays the resulting distance, journey time, grade, curve radius, and earthwork volume. Use **New railway** for another connection; all built lines stay visible during selection, search, cancellation, and failed searches. **Replan** replaces only the last connection after a successful search. **Undo last** restores the preceding network; **Clear all** removes it. Terrain, radius, sea-level, or mesh changes clear the network because its geometry and constraints depend on that surface. The network is kept for the current page session; reloading starts an empty network.

Selection snaps within 16 screen pixels to an existing endpoint or junction first, then within 11 pixels to existing track. Occluded far-side track is excluded. A snapped track point uses its actual formation elevation, including on bridges and in cuts. New connections create graph junctions at exact stations on the original track, without moving it. A yellow marker previews snapping. Cyan and amber markers show the selected start and destination.

**Track reuse preference** (default 1, range 0–2) adds a new-track construction allowance of that many equivalent metres per metre built. Existing sections avoid this allowance, earthwork, and bridge construction charges, while their full distance, curvature, grade, and running time remain in the objective. At the default, a flat new metre costs roughly twice a reused metre before running-time penalties. Set 0 to remove that additional allowance; existing earthwork still does not need rebuilding. The planner compares an independent terrain route with up to twelve diverse network alternatives, with four additional terrain refinements, using an undirected station-based graph and terrain connectors with fixed heights and matching tangents. Joining positions are sampled near endpoints and along the independent terrain corridor, so shared central stretches and passes can be discovered too. Poorly aligned straight approaches are ranked lower rather than rejected before a curved connection is tested. Cheap direct/terrain-guided trials broaden the search before full corridor refinement. The construction search uses a canonical geographic endpoint order; swapping the clicks returns the same alignment in reverse, with the acceleration/braking envelope recalculated for travel direction. This is a bounded approximation, not a global network optimizer. Reused geometry is rendered only once, and the statistics distinguish new from reused kilometres; earthwork reports new construction.

The default scale is a **650 km radius**, with a circumference of about **4,084 km**. Elevations retain their existing metre values. Terrain is displayed with **10× vertical exaggeration** so its appearance stays the same. Settings → Planet radius changes horizontal distances and physical slopes without changing elevations; the radius is stored in the URL. The original viewer used a 65 km radius, which made its kilometre-high mountains exceptionally steep for railway design.

The map shows a distance bar at the view centre, radius/circumference, and the exaggeration factor. Hover over terrain to inspect ground elevation and slope in percent/degrees. A 3% grade rises 30 m per horizontal kilometre. A 300 m curve radius gives a curve speed of about 50 km/h in the simplified model. Completed routes include a ground/track elevation profile.

Defaults target a simple passenger line: 120 km/h cruise speed, 3% maximum grade, 300 m minimum horizontal curve radius, 60 m maximum open cut/fill, and 300 m maximum viaduct height. Oceans, lakes, and frozen lakes remain blocked, including construction footprints. **Rivers are not routing obstacles and carry no crossing penalty.** Viaducts can replace expensive fills across valleys; their length and height contribute to construction cost. Set maximum bridge height to zero to disable them. No tunnels are generated.

The planner first tries a direct engineered profile, then finds alternative land corridors on a spherical chart with a multiresolution A* grid. Terrain grade and roughness guide corridor costs without prematurely fixing a track height at every coarse node. A finer pass can discover routes missed by the coarse grid. Curved splines round the corridor, and height-interval propagation finds a grade-limited vertical profile with cuts, fills, and bridges. Profile smoothing reduces unnecessary speed changes; corridor refinement keeps the lowest final engineering cost. A short-route continuous-heading search remains available as a fallback. Final water and construction-clearance checks sample at no more than 10 m intervals. Grade and horizontal curvature limits are checked on the final sampled centreline. The search runs in a cancellable worker.

**Pass preference** (default 1, range 0–2) favors nearby, well-defined terrain saddles when a route crosses a ridge. A canonical cube-sphere grid seeds a smoothed height/Hessian test; opposite curvature signs and measurable rises/drops identify passes rather than ordinary slopes or small noise ripples. Features are refined and deduplicated in a deterministic planet-wide catalogue, cached per terrain. Different route directions therefore refer to the same geographic anchors.

After ordinary routing, up to three relevant ridge crossings are tested with gently warped local approaches through the nearby saddle. The line outside each approach retains its dense horizontal geometry. Every alternative is refitted and validated against the original grade, curve, water, cut/fill, bridge, and self-intersection limits. A bounded bypass cost applies only after a feasible, modest-detour alternative is found. It scales with the line’s average engineering cost per metre and is capped at 4% of that cost per pass at the default setting, so the preference has a consistent effect on both easy ground and construction-heavy terrain. Distant saddles, routes remaining in one valley, flooded passes, and crossings already below the pass do not attract the route. This remains a soft preference; set it to 0 for the original distance/time/earthwork objective. Existing track is kept fixed during saddle guidance; only new terrain connectors can move.

The objective is distance plus travel-time, speed-change, and earthwork penalties. Segment speed is limited by grade and horizontal curvature. Estimated journey time also includes vertical-curve speed limits, acceleration at 0.55 m/s², braking at 0.7 m/s², and stops at both endpoints. Curve speed uses `sqrt(0.65 × radius)` in m/s; the grade-speed function is a simplified simulation model. Abrupt speed changes add cost.

Earthwork volume integrates an 8 m formation and its banks, including both centerline offsets and cross-slope grading. A line following a steep contour still needs cuts and fills across its width, and these are included in its cost. The default penalty adds 0.025 m of equivalent route cost per cubic metre; this makes deep cuts/fills expensive. The UI's Earthwork penalty slider scales that coefficient. The renderer replaces open-cut/fill footprints with the graded formation and banks. Viaducts have elevated decks and piers at roughly 80 m intervals, and do not remove the ground below them. All display displacements respect the separate horizontal and vertical metric scales. A dark charcoal overlay with light and dark outlines keeps railways visible against land, snow and blue water; rails and sleepers appear on the formation at close range.

This is an approximate, bounded search. A failed search is not proof that no feasible route exists. Very steep terrain, disconnected land, or endpoints with a large elevation difference may require much longer track or different limits. Self-crossing formations are rejected. Existing track can be reused in either direction through shared junctions. Detailed turnout design, parallel tracks, fixed city approach directions, and global network optimization are not modeled yet.

Planned extensions: [ferries across oceans and lakes](https://github.com/lukacslacko/railplanet/issues/1), [tunnels](https://github.com/lukacslacko/railplanet/issues/2).

## Implementation

Terrain height and analytic gradients are generated on the GPU into a 2048×1024 field. A Web Worker calculates drainage and fills basins from that elevation field. Smooth river paths are baked into a GPU mask; terrain and water use one continuous displaced cube sphere with shared edge vertices.

The noise is a seeded sum of independently rotated directional wave bands. Each additional layer multiplies spatial frequency by 1.7, with persistence controlling relative amplitude. Bands above the elevation map's resolution limit fade out. The finite directional distribution is approximately balanced; individual landforms can still be elongated.

Liquid water uses one saturated blue base color, independent of depth. Lakes above 3,500 m become flat ice. Rivers become ice at the same elevation where terrain shading becomes snowy. Lighting follows the camera. Rendering stops when the view is stationary.

All implementation code is original. [terrain3d](https://github.com/lukacslacko/terrain3d) was used as a visual reference; none of its code was reused.

## Verification

Run the JavaScript syntax and numerical checks with Node.js:

```sh
npm run check
```

These cover closed mesh topology at all detail levels, drainage, river continuity, camera rotation through poles, deterministic noise spectra, parameter bounds, spherical flight with collision checks against the actual displaced mesh, and railway routing. Railway fixtures check flat routes, lake avoidance, mountain-pass discovery, rotation/seam continuity, endpoint accuracy, grade and curve limits, volume-based earthwork costs, speed/acceleration envelopes, cancellation, viaducts, saddle preference (including reverse/opposite approaches, unrelated and flooded passes, rotation, and disable controls), 30/80/150 km connections on the production ten-layer terrain spectrum, immutable network geometry, exact partial/full reuse, smooth branch connections, endpoint/track snapping and occlusion, undo/replan, reverse travel through complete/partial tracks and junctions, reversed track construction order, broader shared-corridor discovery with curved approaches, and separate footprint bins without phantom rail segments. Actual WebGL browser checks also cover routes longer than 200 km using the full-resolution elevation field and lakes.

For actual GPU shader checks, serve the project root:

```sh
python3 -m http.server 4173
```

Open `http://localhost:4173/checks/render.html` for heights, gradients, and ice transitions, or `http://localhost:4173/checks/surface.html` for the seed 803297 displacement/seam regression.

## Deployment

The GitHub Actions workflow validates the source and deploys `dist/` to GitHub Pages on pushes to `main`. No server, API keys, or runtime dependencies are required.

## License

[MIT](LICENSE).
