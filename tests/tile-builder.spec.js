const { test, expect } = require("playwright/test");
const path = require("path");
const zlib = require("zlib");

const appUrl = `file://${path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/")}`;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function createSolidPng([red, green, blue, alpha]) {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const rawPixels = Buffer.from([0, red, green, blue, alpha]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(rawPixels)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function createVerticalSplitPng(width, height, topColor, bottomColor) {
  const signature = Buffer.from("89504e470d0a1a0a", "hex");
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = 1 + width * 4;
  const rawPixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const color = y < height / 2 ? topColor : bottomColor;
    const rowStart = y * stride;
    rawPixels[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixelStart = rowStart + 1 + x * 4;
      rawPixels[pixelStart] = color[0];
      rawPixels[pixelStart + 1] = color[1];
      rawPixels[pixelStart + 2] = color[2];
      rawPixels[pixelStart + 3] = color[3];
    }
  }

  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(rawPixels)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

const pngs = {
  red: createSolidPng([255, 0, 0, 255]),
  blue: createSolidPng([0, 0, 255, 255]),
  splitTall: createVerticalSplitPng(128, 256, [255, 0, 0, 255], [0, 0, 255, 255])
};

async function openApp(page) {
  await page.goto(appUrl);
  await expect(page).toHaveTitle("Isometric Tile Spritesheet Builder");
  await expect(page.locator("#gridCanvas")).toBeVisible();
}

async function setProject(page, { cols = 4, rows = 3, tileWidth = 64, tileHeight = 32, exportCols = 2 } = {}) {
  await page.locator("#gridCols").fill(String(cols));
  await page.locator("#gridRows").fill(String(rows));
  await page.locator("#tileWidth").fill(String(tileWidth));
  await page.locator("#tileHeight").fill(String(tileHeight));
  await page.locator("#exportCols").fill(String(exportCols));
  await page.getByRole("button", { name: "Apply Settings" }).click();
}

async function addTile(page, name, buffer) {
  await page.locator("#fileInput").setInputFiles({
    name,
    mimeType: "image/png",
    buffer
  });

  await expect(page.locator("#cropDialog")).toHaveJSProperty("open", true);
  await expect(page.locator("#cropTitle")).toHaveText(name);
  await page.getByRole("button", { name: "Add Tile" }).click();
  await expect(page.locator("#cropDialog")).toHaveJSProperty("open", false);
  await expect(page.locator("#selectedTileName")).toHaveText(name);
}

async function clickCell(page, x, y) {
  await page.locator("#gridCanvas").scrollIntoViewIfNeeded();
  const point = await page.locator("#gridCanvas").evaluate((canvas, cell) => {
    const state = window.__tileBuilderDebug.getState();
    const rect = canvas.getBoundingClientRect();
    const pad = Math.max(32, Math.ceil(Math.max(state.tileWidth, state.tileHeight) * 0.35));
    const halfW = state.tileWidth / 2;
    const halfH = state.tileHeight / 2;
    const canvasX = pad + (state.rows - 1) * halfW + halfW + (cell.x - cell.y) * halfW;
    const canvasY = pad + halfH + (cell.x + cell.y) * halfH;

    return {
      x: rect.left + (canvasX / canvas.width) * rect.width,
      y: rect.top + (canvasY / canvas.height) * rect.height
    };
  }, { x, y });

  await page.mouse.click(point.x, point.y);
}

async function captureExport(page) {
  await page.addInitScript(() => {
    window.__lastTileDownload = null;
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function interceptedClick() {
      if (this.download && this.href.startsWith("data:image/png")) {
        window.__lastTileDownload = {
          download: this.download,
          href: this.href
        };
        return;
      }
      return originalClick.call(this);
    };
  });
}

test.beforeEach(async ({ page }) => {
  await captureExport(page);
});

test("loads the static page and applies custom project settings", async ({ page }) => {
  await openApp(page);
  await setProject(page);

  await expect(page.locator("#projectStatus")).toHaveText(
    "Tile size changed. Existing tiles were cleared so new crops match the export size."
  );

  await expect(page.locator("#gridCanvas")).toHaveJSProperty("width", 288);
  await expect(page.locator("#gridCanvas")).toHaveJSProperty("height", 208);
});

test("zooms the grid viewer and labels non-1:1 preview scale", async ({ page }) => {
  await openApp(page);
  await expect(page.locator("#zoomScale")).toHaveText("Scale: 100% (1:1)");
  await expect(page.locator("#zoomScale")).not.toHaveClass(/is-scaled/);

  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(page.locator("#zoomScale")).toHaveText("Scale: 125% (preview scaled)");
  await expect(page.locator("#zoomScale")).toHaveClass(/is-scaled/);
  await expect(page.locator("#gridCanvas")).toHaveCSS("transform", /matrix\(1\.25/);

  await page.getByRole("button", { name: "1:1" }).click();
  await expect(page.locator("#zoomScale")).toHaveText("Scale: 100% (1:1)");
  await expect(page.locator("#zoomScale")).not.toHaveClass(/is-scaled/);

  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(page.locator("#zoomScale")).toHaveText("Scale: 75% (preview scaled)");
  await expect(page.locator("#zoomScale")).toHaveClass(/is-scaled/);
});

test("toggles dark mode and persists the display preference", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => localStorage.removeItem("tileBuilderTheme"));
  await page.reload();
  await expect(page.getByRole("button", { name: "Dark Mode" })).toBeVisible();

  const lightBackground = await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor);
  await page.getByRole("button", { name: "Dark Mode" }).click();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Light Mode" })).toHaveAttribute("aria-pressed", "true");
  const darkBackground = await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
  expect(await page.evaluate(() => localStorage.getItem("tileBuilderTheme"))).toBe("dark");

  await page.reload();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("button", { name: "Light Mode" })).toBeVisible();

  await setProject(page);
  await addTile(page, "red.png", pngs.red);
  await clickCell(page, 1, 0);
  await page.getByRole("button", { name: "Export PNG" }).click();

  const exportInfo = await page.waitForFunction(() => window.__lastTileDownload);
  const exported = await exportInfo.jsonValue();
  const sampled = await page.evaluate(async (href) => {
    const image = new Image();
    image.src = href;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(32, 16, 1, 1).data];
  }, exported.href);
  expect(sampled[0]).toBeGreaterThan(sampled[2]);
});

test("keeps controls usable on a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);

  await expect(page.locator("#zoomScale")).toHaveText("Scale: 50% (preview scaled)");
  await expect(page.locator("#zoomScale")).toHaveClass(/is-scaled/);
  await expect(page.getByRole("button", { name: "Export PNG" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply Settings" })).toBeVisible();
  await expect(page.locator("#gridCanvas")).toBeVisible();

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    headerHeight: document.querySelector(".app-header").getBoundingClientRect().height,
    controlTop: document.querySelector(".control-panel").getBoundingClientRect().top,
    toolbarHeight: document.querySelector(".canvas-toolbar").getBoundingClientRect().height
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.headerHeight).toBeLessThan(120);
  expect(layout.controlTop).toBeGreaterThanOrEqual(0);
  expect(layout.toolbarHeight).toBeLessThan(96);

  await setProject(page, { cols: 3, rows: 3, tileWidth: 64, tileHeight: 32, exportCols: 2 });
  await addTile(page, "red.png", pngs.red);
  await clickCell(page, 1, 1);
  await expect(page.locator("#placedCount")).toHaveText("1");

  await page.getByRole("button", { name: "1:1" }).click();
  await expect(page.locator("#zoomScale")).toHaveText("Scale: 100% (1:1)");
});

test("keeps controls compact on a short mobile landscape viewport", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openApp(page);

  await expect(page.locator("#zoomScale")).toHaveText("Scale: 50% (preview scaled)");
  await expect(page.locator("#zoomScale")).toHaveClass(/is-scaled/);
  await expect(page.getByRole("button", { name: "Export PNG" })).toBeVisible();
  await expect(page.locator("#gridCanvas")).toBeVisible();

  const layout = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    headerHeight: document.querySelector(".app-header").getBoundingClientRect().height,
    panelWidth: document.querySelector(".control-panel").getBoundingClientRect().width,
    panelHeight: document.querySelector(".control-panel").getBoundingClientRect().height,
    toolbarHeight: document.querySelector(".canvas-toolbar").getBoundingClientRect().height,
    workspaceLeft: document.querySelector(".workspace").getBoundingClientRect().left,
    canvasTop: document.querySelector("#gridCanvas").getBoundingClientRect().top
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
  expect(layout.headerHeight).toBeLessThan(64);
  expect(layout.panelWidth).toBeLessThan(300);
  expect(layout.panelHeight).toBeLessThanOrEqual(335);
  expect(layout.toolbarHeight).toBeLessThan(48);
  expect(layout.workspaceLeft).toBeGreaterThan(layout.panelWidth - 1);
  expect(layout.canvasTop).toBeLessThan(120);

  await setProject(page, { cols: 3, rows: 3, tileWidth: 64, tileHeight: 32, exportCols: 2 });
  await addTile(page, "red.png", pngs.red);
  await clickCell(page, 1, 1);
  await expect(page.locator("#placedCount")).toHaveText("1");
});

test("uploads, crops, places, erases, and clears a PNG tile", async ({ page }) => {
  await openApp(page);
  await setProject(page);
  await addTile(page, "red.png", pngs.red);

  await expect(page.locator(".tile-card")).toHaveCount(1);
  await clickCell(page, 1, 1);
  await expect(page.locator("#placedCount")).toHaveText("1");
  await expect(page.locator("#hoverCell")).toContainText("Cell:");

  await page.getByRole("button", { name: "Erase" }).click();
  await clickCell(page, 1, 1);
  await expect(page.locator("#placedCount")).toHaveText("0");

  await page.getByRole("button", { name: "Paint" }).click();
  await clickCell(page, 2, 1);
  await expect(page.locator("#placedCount")).toHaveText("1");
  await page.getByRole("button", { name: "Clear Grid" }).click();
  await expect(page.locator("#placedCount")).toHaveText("0");
});

test("locks crop source scale and aligns to the bottom half of a tall PNG", async ({ page }) => {
  await openApp(page);
  await setProject(page, { cols: 2, rows: 2, tileWidth: 128, tileHeight: 128, exportCols: 1 });

  await page.locator("#fileInput").setInputFiles({
    name: "split-tall.png",
    mimeType: "image/png",
    buffer: pngs.splitTall
  });

  await expect(page.locator("#cropDialog")).toHaveJSProperty("open", true);
  await page.locator("#cropScaleMode").selectOption("1");
  await expect(page.locator("#cropSourceInfo")).toHaveText("Crop source: 128x128px (1x locked)");
  await page.getByRole("button", { name: "Bottom" }).click();
  await page.getByRole("button", { name: "Add Tile" }).click();
  await expect(page.locator("#cropDialog")).toHaveJSProperty("open", false);

  const sampled = await page.locator(".tile-card img").evaluate(async (image) => {
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(64, 64, 1, 1).data];
  });

  expect(sampled[2]).toBeGreaterThan(sampled[0]);
  expect(sampled[3]).toBe(255);
});

test("exports placed tiles as a Y-then-X sorted packed PNG", async ({ page }) => {
  await openApp(page);
  await setProject(page);
  await addTile(page, "red.png", pngs.red);
  await addTile(page, "blue.png", pngs.blue);

  await page.locator(".tile-card", { hasText: "blue.png" }).click();
  await clickCell(page, 0, 1);
  await page.locator(".tile-card", { hasText: "red.png" }).click();
  await clickCell(page, 1, 0);

  await page.getByRole("button", { name: "Export PNG" }).click();

  const exportInfo = await page.waitForFunction(() => window.__lastTileDownload);
  const exported = await exportInfo.jsonValue();
  expect(exported.download).toBe("godot-tileset-64x32.png");
  await expect(page.locator("#projectStatus")).toHaveText("Exported 2 tiles as 128x32 PNG.");

  const inspected = await page.evaluate(async (href) => {
    const image = new Image();
    image.src = href;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0);
    const first = [...ctx.getImageData(32, 16, 1, 1).data];
    const second = [...ctx.getImageData(96, 16, 1, 1).data];

    return {
      width: image.width,
      height: image.height,
      first,
      second
    };
  }, exported.href);

  expect(inspected.width).toBe(128);
  expect(inspected.height).toBe(32);
  expect(inspected.first[0]).toBeGreaterThan(inspected.first[2]);
  expect(inspected.second[2]).toBeGreaterThan(inspected.second[0]);
});
