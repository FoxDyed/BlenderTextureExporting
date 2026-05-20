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
