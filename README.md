# Railplanet

Procedural planet terrain viewer in JavaScript and WebGL 2. Includes configurable terrain noise, oceans, downhill rivers, lakes, glaciers, and unrestricted camera rotation. Cities, railways, and trains are not implemented yet.

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
- Arrow keys rotate; Home resets; Space toggles automatic orbit.
- Settings controls the seed, spatial frequency, noise persistence, layer count, vertical scale, sea level, and mesh density.
- Noise controls regenerate on release. The seed, frequency, persistence, and layer count are stored in the URL.
- Mesh detail changes geometry immediately without changing the landscape: 196,608, 442,368, or 995,328 triangles.
- Natural and Elevation switch the surface coloring.

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

These cover closed mesh topology at all detail levels, drainage, river continuity, camera rotation through poles, deterministic noise spectra, and parameter bounds.

For actual GPU shader checks, serve the project root:

```sh
python3 -m http.server 4173
```

Open `http://localhost:4173/checks/render.html` for heights, gradients, and ice transitions, or `http://localhost:4173/checks/surface.html` for the seed 803297 displacement/seam regression.

## Deployment

The GitHub Actions workflow validates the source and deploys `dist/` to GitHub Pages on pushes to `main`. No server, API keys, or runtime dependencies are required.

## License

[MIT](LICENSE).
