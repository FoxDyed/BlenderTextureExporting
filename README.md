# Isometric Tile Spritesheet Builder

A static GitHub Pages tool for turning individual PNG tiles into a Godot-ready
spritesheet.

Live site: <https://foxdyed.github.io/BlenderTextureExporting/>

## Features

- Upload one or more PNG files.
- Crop each incoming PNG to the configured tile width and height.
- Lock crop source scale and align/pan tall or wide source images before
  cropping.
- Place cropped tiles onto a custom isometric diamond grid.
- Erase or replace placed tiles.
- Export placed tiles as a packed transparent PNG spritesheet sorted by grid
  row (`y`) and then column (`x`).

## Use Locally

Open `index.html` in a browser. No build step or server is required.

## Batch Terrain Sets

For asset packs that already use a directional naming pattern such as
`Ground A1_N.png`, `Ground A1_E.png`, `Ground A1_S.png`, and `Ground A1_W.png`,
use the CLI helper to crop the alpha bounds, build a Godot-ready sheet, and
write a missing-parts report:

```bash
npm run build:terrain-set -- --source "C:\path\to\Environment" --set "Ground A1"
```

By default this creates `<source>\Ground A1 edited` with cropped sprites, a
one-row terrain sheet, and `missing_tiles_report.md`.

To turn every directional `Ground` tile into one terrain sheet with fixed
Godot-friendly cells:

```bash
npm run build:terrain-set -- --source "C:\path\to\Environment" --prefix Ground --tile-size 128x128
```

This creates `<source>\Ground edited` with every cropped sprite, a full terrain
sheet, `ground_terrain_sheet_map.csv`, and `missing_tiles_report.md`.

## Tests

Install dependencies and run the Playwright suite:

```bash
npm install
npm run install:browsers
npm test
```

The tests open the static page, verify custom grid settings, exercise PNG
cropping and grid placement, and inspect the exported spritesheet PNG.

## GitHub Pages

The repository includes a GitHub Actions workflow that deploys the static app to
GitHub Pages from `main`.

If Pages is not already enabled, set **Settings -> Pages -> Build and deployment
-> Source** to **GitHub Actions**. After the workflow finishes, the app will be
available at <https://foxdyed.github.io/BlenderTextureExporting/>.

## Godot

After export, import the PNG into Godot and slice it using the same tile width
and height that were selected in the app.
