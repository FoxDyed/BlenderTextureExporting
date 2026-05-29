const state = {
  cols: 8,
  rows: 8,
  tileWidth: 128,
  tileHeight: 64,
  spriteWidth: 128,
  spriteHeight: 128,
  exportCols: 8,
  tiles: [],
  selectedTileId: null,
  tool: "paint",
  layers: [
    {
      id: "layer-1",
      name: "Layer 1",
      visible: true,
      placements: new Map()
    }
  ],
  activeLayerId: "layer-1",
  hoverCell: null,
  viewerScale: 1,
  userSetViewerScale: false
};

const viewerZoomLevels = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const els = {
  gridCols: document.querySelector("#gridCols"),
  gridRows: document.querySelector("#gridRows"),
  tileWidth: document.querySelector("#tileWidth"),
  tileHeight: document.querySelector("#tileHeight"),
  spriteWidth: document.querySelector("#spriteWidth"),
  spriteHeight: document.querySelector("#spriteHeight"),
  exportCols: document.querySelector("#exportCols"),
  applySettings: document.querySelector("#applySettings"),
  projectStatus: document.querySelector("#projectStatus"),
  fileInput: document.querySelector("#fileInput"),
  sheetFileInput: document.querySelector("#sheetFileInput"),
  palette: document.querySelector("#palette"),
  paintTool: document.querySelector("#paintTool"),
  eraseTool: document.querySelector("#eraseTool"),
  clearGrid: document.querySelector("#clearGrid"),
  themeToggle: document.querySelector("#themeToggle"),
  exportButton: document.querySelector("#exportButton"),
  exportMapButton: document.querySelector("#exportMapButton"),
  layerSelect: document.querySelector("#layerSelect"),
  addLayer: document.querySelector("#addLayer"),
  deleteLayer: document.querySelector("#deleteLayer"),
  layerVisible: document.querySelector("#layerVisible"),
  placedCount: document.querySelector("#placedCount"),
  selectedTileName: document.querySelector("#selectedTileName"),
  hoverCell: document.querySelector("#hoverCell"),
  zoomOut: document.querySelector("#zoomOut"),
  zoomIn: document.querySelector("#zoomIn"),
  zoomReset: document.querySelector("#zoomReset"),
  zoomScale: document.querySelector("#zoomScale"),
  gridCanvas: document.querySelector("#gridCanvas"),
  cropDialog: document.querySelector("#cropDialog"),
  cropTitle: document.querySelector("#cropTitle"),
  cropCanvas: document.querySelector("#cropCanvas"),
  cropScaleMode: document.querySelector("#cropScaleMode"),
  cropSourceInfo: document.querySelector("#cropSourceInfo"),
  alignTop: document.querySelector("#alignTop"),
  alignMiddle: document.querySelector("#alignMiddle"),
  alignBottom: document.querySelector("#alignBottom"),
  alignLeft: document.querySelector("#alignLeft"),
  alignCenterX: document.querySelector("#alignCenterX"),
  alignRight: document.querySelector("#alignRight"),
  cropZoom: document.querySelector("#cropZoom"),
  centerCrop: document.querySelector("#centerCrop"),
  saveCrop: document.querySelector("#saveCrop"),
  skipCrop: document.querySelector("#skipCrop")
};

const gridCtx = els.gridCanvas.getContext("2d");
const cropCtx = els.cropCanvas.getContext("2d");
const pendingFiles = [];
let cropState = null;
let tileCounter = 1;

function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (Number.isNaN(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function placementKey(x, y) {
  return `${x},${y}`;
}

function activeLayer() {
  return state.layers.find((layer) => layer.id === state.activeLayerId) || state.layers[0];
}

function visibleLayers() {
  return state.layers.filter((layer) => layer.visible);
}

function sortedLayerPlacements(layer) {
  return [...layer.placements.values()].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });
}

function placedTileCount() {
  return state.layers.reduce((sum, layer) => sum + layer.placements.size, 0);
}

function allPlacementsSorted() {
  return state.layers.flatMap((layer, layerIndex) => {
    return sortedLayerPlacements(layer).map((placement) => ({ ...placement, layerIndex }));
  });
}

function readSettings() {
  return {
    cols: clampNumber(els.gridCols.value, 1, 64, state.cols),
    rows: clampNumber(els.gridRows.value, 1, 64, state.rows),
    tileWidth: clampNumber(els.tileWidth.value, 8, 1024, state.tileWidth),
    tileHeight: clampNumber(els.tileHeight.value, 8, 1024, state.tileHeight),
    spriteWidth: clampNumber(els.spriteWidth.value, 8, 2048, state.spriteWidth),
    spriteHeight: clampNumber(els.spriteHeight.value, 8, 2048, state.spriteHeight),
    exportCols: clampNumber(els.exportCols.value, 1, 64, state.exportCols)
  };
}

function applySettings() {
  const next = readSettings();
  const resolutionChanged = next.spriteWidth !== state.spriteWidth || next.spriteHeight !== state.spriteHeight;
  const gridScaleChanged = next.tileWidth !== state.tileWidth || next.tileHeight !== state.tileHeight;
  const gridChanged = next.cols !== state.cols || next.rows !== state.rows;

  Object.assign(state, next);
  els.gridCols.value = state.cols;
  els.gridRows.value = state.rows;
  els.tileWidth.value = state.tileWidth;
  els.tileHeight.value = state.tileHeight;
  els.spriteWidth.value = state.spriteWidth;
  els.spriteHeight.value = state.spriteHeight;
  els.exportCols.value = state.exportCols;

  if (resolutionChanged) {
    state.tiles = [];
    state.selectedTileId = null;
    state.layers.forEach((layer) => layer.placements.clear());
    tileCounter = 1;
    setStatus("Tile size changed. Existing tiles were cleared so new crops match the export size.");
  } else if (gridChanged || gridScaleChanged) {
    for (const layer of state.layers) {
      for (const [key, placement] of layer.placements) {
        if (placement.x >= state.cols || placement.y >= state.rows) {
          layer.placements.delete(key);
        }
      }
    }
    setStatus("Grid settings applied.");
  } else {
    setStatus("Export settings applied.");
  }

  renderPalette();
  renderLayers();
  resizeGridCanvas();
  renderGrid();
  updateViewerZoom();
  updateStats();
}

function setStatus(message) {
  els.projectStatus.textContent = message;
}

function cssVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function applyTheme(theme) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.body.dataset.theme = nextTheme;
  els.themeToggle.textContent = nextTheme === "dark" ? "Light Mode" : "Dark Mode";
  els.themeToggle.setAttribute("aria-pressed", String(nextTheme === "dark"));
  localStorage.setItem("tileBuilderTheme", nextTheme);
  renderGrid();
  drawCrop();
}

function initializeTheme() {
  const storedTheme = localStorage.getItem("tileBuilderTheme");
  const preferredTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  applyTheme(storedTheme || preferredTheme);
}

function resizeGridCanvas() {
  const pad = getGridPadding();
  els.gridCanvas.width = Math.ceil((state.cols + state.rows) * state.tileWidth / 2 + pad * 2);
  els.gridCanvas.height = Math.ceil((state.cols + state.rows) * state.tileHeight / 2 + state.tileHeight + pad * 2);
}

function getGridPadding() {
  return Math.max(32, Math.ceil(Math.max(state.tileWidth, state.spriteHeight) * 0.35));
}

function cellCenter(x, y) {
  const halfW = state.tileWidth / 2;
  const halfH = state.tileHeight / 2;
  const pad = getGridPadding();
  return {
    x: pad + (state.rows - 1) * halfW + halfW + (x - y) * halfW,
    y: pad + halfH + (x + y) * halfH
  };
}

function cellFromPoint(px, py) {
  const halfW = state.tileWidth / 2;
  const halfH = state.tileHeight / 2;
  const origin = cellCenter(0, 0);
  const a = (px - origin.x) / halfW;
  const b = (py - origin.y) / halfH;
  const x = Math.floor((a + b) / 2 + 0.5);
  const y = Math.floor((b - a) / 2 + 0.5);

  if (x < 0 || y < 0 || x >= state.cols || y >= state.rows) return null;

  const center = cellCenter(x, y);
  const inside = Math.abs(px - center.x) / halfW + Math.abs(py - center.y) / halfH <= 1;
  return inside ? { x, y } : null;
}

function drawDiamond(ctx, x, y, options = {}) {
  const center = cellCenter(x, y);
  const halfW = state.tileWidth / 2;
  const halfH = state.tileHeight / 2;
  ctx.beginPath();
  ctx.moveTo(center.x, center.y - halfH);
  ctx.lineTo(center.x + halfW, center.y);
  ctx.lineTo(center.x, center.y + halfH);
  ctx.lineTo(center.x - halfW, center.y);
  ctx.closePath();
  ctx.strokeStyle = options.stroke || cssVar("--grid-line");
  ctx.lineWidth = options.lineWidth || 1;
  ctx.stroke();
  if (options.fill) {
    ctx.fillStyle = options.fill;
    ctx.fill();
  }
}

function tileDrawRect(tile, cell) {
  const center = cellCenter(cell.x, cell.y);
  const width = tile.width || tile.image.naturalWidth || state.spriteWidth;
  const height = tile.height || tile.image.naturalHeight || state.spriteHeight;
  return {
    x: center.x - width / 2,
    y: center.y + state.tileHeight / 2 - height,
    width,
    height
  };
}

function renderGrid() {
  gridCtx.clearRect(0, 0, els.gridCanvas.width, els.gridCanvas.height);
  gridCtx.fillStyle = cssVar("--canvas-bg");
  gridCtx.fillRect(0, 0, els.gridCanvas.width, els.gridCanvas.height);

  for (let y = 0; y < state.rows; y += 1) {
    for (let x = 0; x < state.cols; x += 1) {
      drawDiamond(gridCtx, x, y);
    }
  }

  if (state.hoverCell) {
    drawDiamond(gridCtx, state.hoverCell.x, state.hoverCell.y, {
      stroke: cssVar("--accent"),
      lineWidth: 2,
      fill: cssVar("--grid-hover")
    });
  }

  for (const layer of visibleLayers()) {
    for (const placement of sortedLayerPlacements(layer)) {
      const tile = state.tiles.find((item) => item.id === placement.tileId);
      if (!tile) continue;
      const rect = tileDrawRect(tile, placement);
      gridCtx.drawImage(tile.image, rect.x, rect.y, rect.width, rect.height);
    }
  }
}

function renderPalette() {
  els.palette.replaceChildren();
  if (state.tiles.length === 0) {
    const empty = document.createElement("p");
    empty.className = "status-text";
    empty.textContent = "Add PNGs to build your tile palette.";
    els.palette.append(empty);
    return;
  }

  for (const tile of state.tiles) {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "tile-card";
    if (tile.id === state.selectedTileId) card.classList.add("is-selected");
    card.title = tile.name;

    const image = document.createElement("img");
    image.src = tile.url;
    image.alt = tile.name;

    const label = document.createElement("span");
    label.textContent = tile.name;

    card.append(image, label);
    card.addEventListener("click", () => {
      state.selectedTileId = tile.id;
      state.tool = "paint";
      updateToolButtons();
      renderPalette();
      updateStats();
    });
    els.palette.append(card);
  }
}

function renderLayers() {
  els.layerSelect.replaceChildren();
  for (const layer of state.layers) {
    const option = document.createElement("option");
    option.value = layer.id;
    option.textContent = `${layer.name} (${layer.placements.size})`;
    els.layerSelect.append(option);
  }

  const layer = activeLayer();
  state.activeLayerId = layer.id;
  els.layerSelect.value = layer.id;
  els.layerVisible.checked = layer.visible;
  els.deleteLayer.disabled = state.layers.length === 1;
}

function updateToolButtons() {
  els.paintTool.classList.toggle("is-active", state.tool === "paint");
  els.eraseTool.classList.toggle("is-active", state.tool === "erase");
}

function updateStats() {
  els.placedCount.textContent = String(placedTileCount());
  const selected = state.tiles.find((tile) => tile.id === state.selectedTileId);
  els.selectedTileName.textContent = selected ? selected.name : "None";
}

function viewerScaleLabel() {
  const percent = Math.round(state.viewerScale * 100);
  return state.viewerScale === 1 ? `Scale: ${percent}% (1:1)` : `Scale: ${percent}% (preview scaled)`;
}

function updateViewerZoom() {
  els.gridCanvas.style.transform = `scale(${state.viewerScale})`;
  els.gridCanvas.style.width = `${els.gridCanvas.width}px`;
  els.gridCanvas.style.height = `${els.gridCanvas.height}px`;
  els.gridCanvas.style.marginRight = `${Math.max(0, els.gridCanvas.width * state.viewerScale - els.gridCanvas.width)}px`;
  els.gridCanvas.style.marginBottom = `${Math.max(0, els.gridCanvas.height * state.viewerScale - els.gridCanvas.height)}px`;
  els.zoomScale.textContent = viewerScaleLabel();
  els.zoomScale.classList.toggle("is-scaled", state.viewerScale !== 1);
  els.zoomOut.disabled = state.viewerScale === viewerZoomLevels[0];
  els.zoomIn.disabled = state.viewerScale === viewerZoomLevels[viewerZoomLevels.length - 1];
}

function setViewerScale(nextScale, userInitiated = true) {
  state.viewerScale = Number(nextScale.toFixed(2));
  if (userInitiated) state.userSetViewerScale = true;
  updateViewerZoom();
}

function stepViewerZoom(direction) {
  const currentIndex = viewerZoomLevels.findIndex((level) => level === state.viewerScale);
  const fallbackIndex = viewerZoomLevels.reduce((best, level, index) => {
    return Math.abs(level - state.viewerScale) < Math.abs(viewerZoomLevels[best] - state.viewerScale) ? index : best;
  }, 0);
  const index = currentIndex === -1 ? fallbackIndex : currentIndex;
  const nextIndex = Math.min(viewerZoomLevels.length - 1, Math.max(0, index + direction));
  setViewerScale(viewerZoomLevels[nextIndex]);
}

function defaultViewerScaleForViewport() {
  if (window.matchMedia("(max-height: 480px) and (orientation: landscape)").matches) return 0.5;
  if (window.matchMedia("(max-width: 420px)").matches) return 0.5;
  if (window.matchMedia("(max-width: 700px)").matches) return 0.67;
  return 1;
}

function applyResponsiveViewerScale() {
  if (state.userSetViewerScale) return;
  setViewerScale(defaultViewerScaleForViewport(), false);
}

async function readImageFile(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return { image, url };
}

async function enqueueFiles(files) {
  const pngFiles = [...files].filter((file) => file.type === "image/png" || file.name.toLowerCase().endsWith(".png"));
  pendingFiles.push(...pngFiles);
  if (!cropState) processNextCrop();
}

function addTileFromCanvas(canvas, name) {
  return new Promise((resolve) => {
    const url = canvas.toDataURL("image/png");
    const image = new Image();
    image.onload = () => {
      const tile = {
        id: globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `tile-${Date.now()}-${tileCounter}`,
        name,
        url,
        image,
        width: canvas.width,
        height: canvas.height
      };
      tileCounter += 1;
      state.tiles.push(tile);
      state.selectedTileId = tile.id;
      resolve(tile);
    };
    image.src = url;
  });
}

function tileHasVisiblePixels(canvas) {
  const ctx = canvas.getContext("2d");
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] > 0) return true;
  }
  return false;
}

async function importSpritesheet(file) {
  if (!file) return;
  try {
    const { image, url } = await readImageFile(file);
    const columns = Math.floor(image.width / state.spriteWidth);
    const rows = Math.floor(image.height / state.spriteHeight);
    if (columns < 1 || rows < 1) {
      setStatus(`Sprite sheet is smaller than ${state.spriteWidth}x${state.spriteHeight}.`);
      URL.revokeObjectURL(url);
      return;
    }

    const baseName = file.name.replace(/\.png$/i, "");
    let imported = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const tileCanvas = document.createElement("canvas");
        tileCanvas.width = state.spriteWidth;
        tileCanvas.height = state.spriteHeight;
        const tileCtx = tileCanvas.getContext("2d");
        tileCtx.imageSmoothingEnabled = false;
        tileCtx.clearRect(0, 0, tileCanvas.width, tileCanvas.height);
        tileCtx.drawImage(
          image,
          column * state.spriteWidth,
          row * state.spriteHeight,
          state.spriteWidth,
          state.spriteHeight,
          0,
          0,
          state.spriteWidth,
          state.spriteHeight
        );
        if (!tileHasVisiblePixels(tileCanvas)) continue;
        await addTileFromCanvas(tileCanvas, `${baseName}_${row + 1}_${column + 1}.png`);
        imported += 1;
      }
    }

    URL.revokeObjectURL(url);
    renderPalette();
    updateStats();
    setStatus(`Imported ${imported} tiles from ${file.name} using ${state.spriteWidth}x${state.spriteHeight} sprite cells.`);
  } catch (error) {
    console.error(error);
    setStatus(`Could not import ${file.name}.`);
  }
}

async function processNextCrop() {
  const file = pendingFiles.shift();
  if (!file) {
    cropState = null;
    return;
  }

  try {
    const { image, url } = await readImageFile(file);
    cropState = {
      file,
      image,
      sourceUrl: url,
      scale: 1,
      scaleMode: els.cropScaleMode.value,
      offsetX: 0,
      offsetY: 0,
      dragging: false,
      dragStartX: 0,
      dragStartY: 0,
      startOffsetX: 0,
      startOffsetY: 0
    };
    els.cropTitle.textContent = file.name;
    setupCropCanvas();
    centerCropImage();
    els.cropDialog.showModal();
  } catch (error) {
    console.error(error);
    setStatus(`Could not load ${file.name}.`);
    processNextCrop();
  }
}

function setupCropCanvas() {
  const aspect = state.spriteWidth / state.spriteHeight;
  let width = 560;
  let height = width / aspect;
  if (height > 380) {
    height = 380;
    width = height * aspect;
  }
  els.cropCanvas.width = Math.max(180, Math.round(width));
  els.cropCanvas.height = Math.max(120, Math.round(height));
}

function centerCropImage() {
  if (!cropState) return;
  const scaleX = els.cropCanvas.width / cropState.image.width;
  const scaleY = els.cropCanvas.height / cropState.image.height;
  cropState.scale = cropScaleForMode(cropState.scaleMode || "free");
  cropState.offsetX = (els.cropCanvas.width - cropState.image.width * cropState.scale) / 2;
  cropState.offsetY = (els.cropCanvas.height - cropState.image.height * cropState.scale) / 2;
  els.cropZoom.min = String(Math.max(0.05, Math.min(scaleX, scaleY) * 0.5));
  els.cropZoom.max = String(Math.max(4, cropState.scale * 4));
  syncCropControls();
  drawCrop();
}

function cropScaleForMode(mode) {
  if (!cropState) return 1;
  const scaleX = els.cropCanvas.width / cropState.image.width;
  const scaleY = els.cropCanvas.height / cropState.image.height;
  if (mode === "fit") return Math.min(scaleX, scaleY);
  if (mode === "free") return Math.max(scaleX, scaleY);
  const sourceScale = Number.parseFloat(mode);
  if (!Number.isFinite(sourceScale) || sourceScale <= 0) return Math.max(scaleX, scaleY);
  return els.cropCanvas.width / (state.spriteWidth / sourceScale);
}

function syncCropControls() {
  if (!cropState) return;
  els.cropScaleMode.value = cropState.scaleMode || "free";
  els.cropZoom.value = String(cropState.scale);
  els.cropZoom.disabled = cropState.scaleMode !== "free";
  updateCropSourceInfo();
}

function updateCropSourceInfo() {
  if (!cropState) {
    els.cropSourceInfo.textContent = "Crop source: auto";
    return;
  }
  const sourceWidth = Math.round(els.cropCanvas.width / cropState.scale);
  const sourceHeight = Math.round(els.cropCanvas.height / cropState.scale);
  const modeText = cropState.scaleMode === "free" ? "free zoom" : cropState.scaleMode === "fit" ? "fit image" : `${cropState.scaleMode}x locked`;
  els.cropSourceInfo.textContent = `Crop source: ${sourceWidth}x${sourceHeight}px (${modeText})`;
}

function setCropScaleMode(mode) {
  if (!cropState) return;
  const previousScale = cropState.scale;
  const centerX = els.cropCanvas.width / 2;
  const centerY = els.cropCanvas.height / 2;
  const imagePointX = (centerX - cropState.offsetX) / previousScale;
  const imagePointY = (centerY - cropState.offsetY) / previousScale;
  cropState.scaleMode = mode;
  cropState.scale = cropScaleForMode(mode);
  cropState.offsetX = centerX - imagePointX * cropState.scale;
  cropState.offsetY = centerY - imagePointY * cropState.scale;
  syncCropControls();
  drawCrop();
}

function alignCrop(axis, position) {
  if (!cropState) return;
  const drawnWidth = cropState.image.width * cropState.scale;
  const drawnHeight = cropState.image.height * cropState.scale;
  if (axis === "x") {
    if (position === "start") cropState.offsetX = 0;
    if (position === "center") cropState.offsetX = (els.cropCanvas.width - drawnWidth) / 2;
    if (position === "end") cropState.offsetX = els.cropCanvas.width - drawnWidth;
  }
  if (axis === "y") {
    if (position === "start") cropState.offsetY = 0;
    if (position === "center") cropState.offsetY = (els.cropCanvas.height - drawnHeight) / 2;
    if (position === "end") cropState.offsetY = els.cropCanvas.height - drawnHeight;
  }
  drawCrop();
}

function drawCrop() {
  if (!cropState) return;
  cropCtx.clearRect(0, 0, els.cropCanvas.width, els.cropCanvas.height);
  cropCtx.drawImage(
    cropState.image,
    cropState.offsetX,
    cropState.offsetY,
    cropState.image.width * cropState.scale,
    cropState.image.height * cropState.scale
  );
  cropCtx.strokeStyle = cssVar("--accent");
  cropCtx.lineWidth = 3;
  cropCtx.strokeRect(1.5, 1.5, els.cropCanvas.width - 3, els.cropCanvas.height - 3);
  updateCropSourceInfo();
}

function saveCurrentCrop() {
  if (!cropState) return;
  const output = document.createElement("canvas");
  output.width = state.spriteWidth;
  output.height = state.spriteHeight;
  const outputCtx = output.getContext("2d");
  outputCtx.imageSmoothingEnabled = false;

  const sx = -cropState.offsetX / cropState.scale;
  const sy = -cropState.offsetY / cropState.scale;
  const sw = els.cropCanvas.width / cropState.scale;
  const sh = els.cropCanvas.height / cropState.scale;
  outputCtx.clearRect(0, 0, output.width, output.height);
  outputCtx.drawImage(cropState.image, sx, sy, sw, sh, 0, 0, output.width, output.height);

  const url = output.toDataURL("image/png");
  const image = new Image();
  image.onload = () => {
    const tile = {
      id: globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `tile-${Date.now()}-${tileCounter}`,
      name: cropState.file.name || `Tile ${tileCounter}`,
      url,
      image,
      width: output.width,
      height: output.height
    };
    tileCounter += 1;
    state.tiles.push(tile);
    state.selectedTileId = tile.id;
    URL.revokeObjectURL(cropState.sourceUrl);
    cropState = null;
    els.cropDialog.close();
    renderPalette();
    updateStats();
    setStatus(`Added ${tile.name} at ${state.spriteWidth}x${state.spriteHeight}.`);
    processNextCrop();
  };
  image.src = url;
}

function skipCurrentCrop() {
  if (cropState) {
    URL.revokeObjectURL(cropState.sourceUrl);
  }
  cropState = null;
  els.cropDialog.close();
  processNextCrop();
}

function canvasPointFromEvent(event) {
  const rect = els.gridCanvas.getBoundingClientRect();
  const scaleX = els.gridCanvas.width / rect.width;
  const scaleY = els.gridCanvas.height / rect.height;
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

function handleGridPointerMove(event) {
  const point = canvasPointFromEvent(event);
  const cell = cellFromPoint(point.x, point.y);
  const changed = JSON.stringify(cell) !== JSON.stringify(state.hoverCell);
  state.hoverCell = cell;
  els.hoverCell.textContent = cell ? `Cell: ${cell.x}, ${cell.y}` : "Cell: none";
  if (changed) renderGrid();
}

function handleGridClick(event) {
  const point = canvasPointFromEvent(event);
  const cell = cellFromPoint(point.x, point.y);
  if (!cell) return;

  const key = placementKey(cell.x, cell.y);
  const layer = activeLayer();
  if (state.tool === "erase") {
    layer.placements.delete(key);
  } else if (state.selectedTileId) {
    layer.placements.set(key, { x: cell.x, y: cell.y, tileId: state.selectedTileId });
  } else {
    setStatus("Select a tile before painting the grid.");
    return;
  }

  renderGrid();
  renderLayers();
  updateStats();
}

function clearGrid() {
  activeLayer().placements.clear();
  renderGrid();
  renderLayers();
  updateStats();
  setStatus(`${activeLayer().name} cleared.`);
}

function addLayer() {
  const nextNumber = state.layers.length + 1;
  const layer = {
    id: globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : `layer-${Date.now()}-${nextNumber}`,
    name: `Layer ${nextNumber}`,
    visible: true,
    placements: new Map()
  };
  state.layers.push(layer);
  state.activeLayerId = layer.id;
  renderLayers();
  renderGrid();
  updateStats();
  setStatus(`${layer.name} added.`);
}

function deleteActiveLayer() {
  if (state.layers.length === 1) {
    setStatus("At least one layer is required.");
    return;
  }
  const layer = activeLayer();
  const index = state.layers.findIndex((item) => item.id === layer.id);
  state.layers.splice(index, 1);
  state.activeLayerId = state.layers[Math.max(0, index - 1)].id;
  renderLayers();
  renderGrid();
  updateStats();
  setStatus(`${layer.name} deleted.`);
}

function setActiveLayer(layerId) {
  if (!state.layers.some((layer) => layer.id === layerId)) return;
  state.activeLayerId = layerId;
  renderLayers();
  setStatus(`${activeLayer().name} selected.`);
}

function setActiveLayerVisibility(visible) {
  const layer = activeLayer();
  layer.visible = visible;
  renderLayers();
  renderGrid();
  setStatus(`${layer.name} ${visible ? "shown" : "hidden"}.`);
}

function exportSpritesheet() {
  const placements = allPlacementsSorted();

  if (placements.length === 0) {
    setStatus("Place at least one tile before exporting.");
    return;
  }

  const columns = Math.max(1, Math.min(state.exportCols, placements.length));
  const rows = Math.ceil(placements.length / columns);
  const sheet = document.createElement("canvas");
  sheet.width = columns * state.spriteWidth;
  sheet.height = rows * state.spriteHeight;
  const ctx = sheet.getContext("2d");
  ctx.clearRect(0, 0, sheet.width, sheet.height);
  ctx.imageSmoothingEnabled = false;

  placements.forEach((placement, index) => {
    const tile = state.tiles.find((item) => item.id === placement.tileId);
    if (!tile) return;
    const x = index % columns;
    const y = Math.floor(index / columns);
    ctx.drawImage(tile.image, x * state.spriteWidth, y * state.spriteHeight, state.spriteWidth, state.spriteHeight);
  });

  const link = document.createElement("a");
  link.download = `godot-tileset-${state.spriteWidth}x${state.spriteHeight}.png`;
  link.href = sheet.toDataURL("image/png");
  link.click();
  setStatus(`Exported ${placements.length} tiles as ${sheet.width}x${sheet.height} PNG.`);
}

function exportMapImage() {
  const placements = visibleLayers().flatMap((layer, layerIndex) => {
    return sortedLayerPlacements(layer).map((placement) => ({ ...placement, layerIndex }));
  });

  if (placements.length === 0) {
    setStatus("Paint at least one visible tile before exporting the map.");
    return;
  }

  const map = document.createElement("canvas");
  map.width = els.gridCanvas.width;
  map.height = els.gridCanvas.height;
  const ctx = map.getContext("2d");
  ctx.clearRect(0, 0, map.width, map.height);
  ctx.imageSmoothingEnabled = false;

  placements.forEach((placement) => {
    const tile = state.tiles.find((item) => item.id === placement.tileId);
    if (!tile) return;
    const rect = tileDrawRect(tile, placement);
    ctx.drawImage(tile.image, rect.x, rect.y, rect.width, rect.height);
  });

  const link = document.createElement("a");
  link.download = `isometric-map-${state.cols}x${state.rows}.png`;
  link.href = map.toDataURL("image/png");
  link.click();
  setStatus(`Exported map as ${map.width}x${map.height} PNG from ${placements.length} visible tiles.`);
}

function handleCropZoom() {
  if (!cropState) return;
  cropState.scaleMode = "free";
  const previousScale = cropState.scale;
  const nextScale = Number.parseFloat(els.cropZoom.value);
  const centerX = els.cropCanvas.width / 2;
  const centerY = els.cropCanvas.height / 2;
  const imagePointX = (centerX - cropState.offsetX) / previousScale;
  const imagePointY = (centerY - cropState.offsetY) / previousScale;
  cropState.scale = nextScale;
  cropState.offsetX = centerX - imagePointX * nextScale;
  cropState.offsetY = centerY - imagePointY * nextScale;
  syncCropControls();
  drawCrop();
}

function cropPointer(event) {
  const rect = els.cropCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (els.cropCanvas.width / rect.width),
    y: (event.clientY - rect.top) * (els.cropCanvas.height / rect.height)
  };
}

els.applySettings.addEventListener("click", applySettings);
els.fileInput.addEventListener("change", (event) => {
  enqueueFiles(event.target.files);
  event.target.value = "";
});
els.sheetFileInput.addEventListener("change", (event) => {
  importSpritesheet(event.target.files[0]);
  event.target.value = "";
});
els.paintTool.addEventListener("click", () => {
  state.tool = "paint";
  updateToolButtons();
});
els.eraseTool.addEventListener("click", () => {
  state.tool = "erase";
  updateToolButtons();
});
els.clearGrid.addEventListener("click", clearGrid);
els.themeToggle.addEventListener("click", () => {
  applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
});
els.exportButton.addEventListener("click", exportSpritesheet);
els.exportMapButton.addEventListener("click", exportMapImage);
els.layerSelect.addEventListener("change", () => setActiveLayer(els.layerSelect.value));
els.addLayer.addEventListener("click", addLayer);
els.deleteLayer.addEventListener("click", deleteActiveLayer);
els.layerVisible.addEventListener("change", () => setActiveLayerVisibility(els.layerVisible.checked));
els.zoomOut.addEventListener("click", () => stepViewerZoom(-1));
els.zoomIn.addEventListener("click", () => stepViewerZoom(1));
els.zoomReset.addEventListener("click", () => setViewerScale(1));
window.addEventListener("resize", applyResponsiveViewerScale);
els.gridCanvas.addEventListener("pointermove", handleGridPointerMove);
els.gridCanvas.addEventListener("pointerleave", () => {
  state.hoverCell = null;
  els.hoverCell.textContent = "Cell: none";
  renderGrid();
});
els.gridCanvas.addEventListener("click", handleGridClick);

els.cropZoom.addEventListener("input", handleCropZoom);
els.cropScaleMode.addEventListener("change", () => setCropScaleMode(els.cropScaleMode.value));
els.centerCrop.addEventListener("click", centerCropImage);
els.alignTop.addEventListener("click", () => alignCrop("y", "start"));
els.alignMiddle.addEventListener("click", () => alignCrop("y", "center"));
els.alignBottom.addEventListener("click", () => alignCrop("y", "end"));
els.alignLeft.addEventListener("click", () => alignCrop("x", "start"));
els.alignCenterX.addEventListener("click", () => alignCrop("x", "center"));
els.alignRight.addEventListener("click", () => alignCrop("x", "end"));
els.saveCrop.addEventListener("click", saveCurrentCrop);
els.skipCrop.addEventListener("click", skipCurrentCrop);
els.cropCanvas.addEventListener("pointerdown", (event) => {
  if (!cropState) return;
  const point = cropPointer(event);
  cropState.dragging = true;
  cropState.dragStartX = point.x;
  cropState.dragStartY = point.y;
  cropState.startOffsetX = cropState.offsetX;
  cropState.startOffsetY = cropState.offsetY;
  els.cropCanvas.setPointerCapture(event.pointerId);
});
els.cropCanvas.addEventListener("pointermove", (event) => {
  if (!cropState || !cropState.dragging) return;
  const point = cropPointer(event);
  cropState.offsetX = cropState.startOffsetX + point.x - cropState.dragStartX;
  cropState.offsetY = cropState.startOffsetY + point.y - cropState.dragStartY;
  drawCrop();
});
els.cropCanvas.addEventListener("pointerup", (event) => {
  if (!cropState) return;
  cropState.dragging = false;
  els.cropCanvas.releasePointerCapture(event.pointerId);
});
els.cropCanvas.addEventListener("pointercancel", () => {
  if (cropState) cropState.dragging = false;
});

initializeTheme();
resizeGridCanvas();
renderPalette();
renderLayers();
renderGrid();
applyResponsiveViewerScale();
updateStats();
setStatus("Ready. Add PNGs or import a sprite sheet, then paint the layered isometric grid.");

window.__tileBuilderDebug = {
  getState() {
    return {
      cols: state.cols,
      rows: state.rows,
      tileWidth: state.tileWidth,
      tileHeight: state.tileHeight,
      spriteWidth: state.spriteWidth,
      spriteHeight: state.spriteHeight,
      exportCols: state.exportCols,
      viewerScale: state.viewerScale,
      placedCount: placedTileCount(),
      layerCount: state.layers.length,
      activeLayerId: state.activeLayerId,
      activeLayerName: activeLayer().name,
      layerPlacements: state.layers.map((layer) => ({ name: layer.name, count: layer.placements.size, visible: layer.visible })),
      selectedTileId: state.selectedTileId
    };
  }
};
