# Isometric Tile Spritesheet Builder

A static GitHub Pages tool for turning individual PNG tiles into a Godot-ready
spritesheet.

## Features

- Upload one or more PNG files.
- Crop each incoming PNG to the configured tile width and height.
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

Enable GitHub Pages for this repository and serve from the branch root. The app
is entirely static and uses only browser APIs.

## Godot

After export, import the PNG into Godot and slice it using the same tile width
and height that were selected in the app.
