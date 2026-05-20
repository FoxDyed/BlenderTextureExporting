const state = {
  cols: 8,
  rows: 8,
  tileWidth: 128,
  tileHeight: 64,
  exportCols: 8,
  tiles: [],
  selectedTileId: null,
  tool: "paint",
  placements: new Map(),
  hoverCell: null
};

const els = {
  gridCols: document.querySelector("#gridCols"),
  gridRows: document.querySelector("#gridRows"),
  tileWidth: document.querySelector("#tileWidth"),
  tileHeight: document.querySelector("#tileHeight"),
  exportCols: document.querySelector("#exportCols"),
  applySettings: document.querySelector("#applySettings"),
  projectStatus: document.querySelector("#projectStatus"),
  fileInput: document.querySelector("#fileInput"),
  palette: document.querySelector("#palette"),
  paintTool: document.querySelector("#paintTool"),
  eraseTool: document.querySelector("#eraseTool"),
  clearGrid: document.querySelector("#clearGrid"),
  exportButton: document.querySelector("#exportButton"),
  placedCount: document.querySelector("#placedCount"),
  selectedTileName: document.querySelector("#selectedTileName"),
  hoverCell: document.querySelector("#hoverCell"),
  gridCanvas: document.querySelector("#gridCanvas"),
  cropDialog: document.querySelector("#cropDialog"),
  cropTitle: document.querySelector("#cropTitle"),
  cropCanvas: document.querySelector("#cropCanvas"),
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

function readSettings() {
  return {
    cols: clampNumber(els.gridCols.value, 1, 64, state.cols),
    rows: clampNumber(els.gridRows.value, 1, 64, state.rows),
    tileWidth: clampNumber(els.tileWidth.value, 8, 1024, state.tileWidth),
    tileHeight: clampNumber(els.tileHeight.value, 8, 1024, state.tileHeight),
    exportCols: clampNumber(els.exportCols.value, 1, 64, state.exportCols)
  };
}

function applySettings() {
  const next = readSettings();
  const resolutionChanged = next.tileWidth !== state.tileWidth || next.tileHeight !== state.tileHeight;
  const gridChanged = next.cols !== state.cols || next.rows !== state.rows;

  Object.assign(state, next);
  els.gridCols.value = state.cols;
  els.gridRows.value = state.rows;
  els.tileWidth.value = state.tileWidth;
  els.tileHeight.value = state.tileHeight;
  els.exportCols.value = state.exportCols;

  if (resolutionChanged) {
    state.tiles = [];
    state.selectedTileId = null;
    state.placements.clear();
    tileCounter = 1;
    setStatus("Tile size changed. Existing tiles were cleared so new crops match the export size.");
  } else if (gridChanged) {
    for (const [key, placement] of state.placements) {
      if (placement.x >= state.cols || placement.y >= state.rows) {
        state.placements.delete(key);
      }
    }
    setStatus("Grid settings applied.");
  } else {
    setStatus("Export settings applied.");
  }

  renderPalette();
  resizeGridCanvas();
  renderGrid();
  updateStats();
}

function setStatus(message) {
  els.projectStatus.textContent = message;
}

function resizeGridCanvas() {
  const pad = getGridPadding();
  els.gridCanvas.width = Math.ceil((state.cols + state.rows) * state.tileWidth / 2 + pad * 2);
  els.gridCanvas.height = Math.ceil((state.cols + state.rows) * state.tileHeight / 2 + state.tileHeight + pad * 2);
}

function getGridPadding() {
  return Math.max(32, Math.ceil(Math.max(state.tileWidth, state.tileHeight) * 0.35));
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
  ctx.strokeStyle = options.stroke || "rgba(32, 118, 109, 0.28)";
  ctx.lineWidth = options.lineWidth || 1;
  ctx.stroke();
  if (options.fill) {
    ctx.fillStyle = options.fill;
    ctx.fill();
  }
}

function renderGrid() {
  gridCtx.clearRect(0, 0, els.gridCanvas.width, els.gridCanvas.height);
  gridCtx.fillStyle = "#f9fbf9";
  gridCtx.fillRect(0, 0, els.gridCanvas.width, els.gridCanvas.height);

  for (let y = 0; y < state.rows; y += 1) {
    for (let x = 0; x < state.cols; x += 1) {
      drawDiamond(gridCtx, x, y);
    }
  }

  if (state.hoverCell) {
    drawDiamond(gridCtx, state.hoverCell.x, state.hoverCell.y, {
      stroke: "#20766d",
      lineWidth: 2,
      fill: "rgba(32, 118, 109, 0.08)"
    });
  }

  const sortedPlacements = [...state.placements.values()].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  for (const placement of sortedPlacements) {
    const tile = state.tiles.find((item) => item.id === placement.tileId);
    if (!tile) continue;
    const center = cellCenter(placement.x, placement.y);
    gridCtx.drawImage(
      tile.image,
      center.x - state.tileWidth / 2,
      center.y - state.tileHeight / 2,
      state.tileWidth,
      state.tileHeight
    );
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

function updateToolButtons() {
  els.paintTool.classList.toggle("is-active", state.tool === "paint");
  els.eraseTool.classList.toggle("is-active", state.tool === "erase");
}

function updateStats() {
  els.placedCount.textContent = String(state.placements.size);
  const selected = state.tiles.find((tile) => tile.id === state.selectedTileId);
  els.selectedTileName.textContent = selected ? selected.name : "None";
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
  const aspect = state.tileWidth / state.tileHeight;
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
  cropState.scale = Math.max(scaleX, scaleY);
  cropState.offsetX = (els.cropCanvas.width - cropState.image.width * cropState.scale) / 2;
  cropState.offsetY = (els.cropCanvas.height - cropState.image.height * cropState.scale) / 2;
  els.cropZoom.value = String(cropState.scale);
  els.cropZoom.min = String(Math.max(0.05, Math.min(scaleX, scaleY) * 0.5));
  els.cropZoom.max = String(Math.max(4, cropState.scale * 4));
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
  cropCtx.strokeStyle = "rgba(21, 95, 88, 0.9)";
  cropCtx.lineWidth = 3;
  cropCtx.strokeRect(1.5, 1.5, els.cropCanvas.width - 3, els.cropCanvas.height - 3);
}

function saveCurrentCrop() {
  if (!cropState) return;
  const output = document.createElement("canvas");
  output.width = state.tileWidth;
  output.height = state.tileHeight;
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
      image
    };
    tileCounter += 1;
    state.tiles.push(tile);
    state.selectedTileId = tile.id;
    URL.revokeObjectURL(cropState.sourceUrl);
    cropState = null;
    els.cropDialog.close();
    renderPalette();
    updateStats();
    setStatus(`Added ${tile.name} at ${state.tileWidth}x${state.tileHeight}.`);
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
  if (state.tool === "erase") {
    state.placements.delete(key);
  } else if (state.selectedTileId) {
    state.placements.set(key, { x: cell.x, y: cell.y, tileId: state.selectedTileId });
  } else {
    setStatus("Select a tile before painting the grid.");
    return;
  }

  renderGrid();
  updateStats();
}

function clearGrid() {
  state.placements.clear();
  renderGrid();
  updateStats();
  setStatus("Grid cleared.");
}

function exportSpritesheet() {
  const placements = [...state.placements.values()].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  if (placements.length === 0) {
    setStatus("Place at least one tile before exporting.");
    return;
  }

  const columns = Math.max(1, Math.min(state.exportCols, placements.length));
  const rows = Math.ceil(placements.length / columns);
  const sheet = document.createElement("canvas");
  sheet.width = columns * state.tileWidth;
  sheet.height = rows * state.tileHeight;
  const ctx = sheet.getContext("2d");
  ctx.clearRect(0, 0, sheet.width, sheet.height);
  ctx.imageSmoothingEnabled = false;

  placements.forEach((placement, index) => {
    const tile = state.tiles.find((item) => item.id === placement.tileId);
    if (!tile) return;
    const x = index % columns;
    const y = Math.floor(index / columns);
    ctx.drawImage(tile.image, x * state.tileWidth, y * state.tileHeight, state.tileWidth, state.tileHeight);
  });

  const link = document.createElement("a");
  link.download = `godot-tileset-${state.tileWidth}x${state.tileHeight}.png`;
  link.href = sheet.toDataURL("image/png");
  link.click();
  setStatus(`Exported ${placements.length} tiles as ${sheet.width}x${sheet.height} PNG.`);
}

function handleCropZoom() {
  if (!cropState) return;
  const previousScale = cropState.scale;
  const nextScale = Number.parseFloat(els.cropZoom.value);
  const centerX = els.cropCanvas.width / 2;
  const centerY = els.cropCanvas.height / 2;
  const imagePointX = (centerX - cropState.offsetX) / previousScale;
  const imagePointY = (centerY - cropState.offsetY) / previousScale;
  cropState.scale = nextScale;
  cropState.offsetX = centerX - imagePointX * nextScale;
  cropState.offsetY = centerY - imagePointY * nextScale;
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
els.paintTool.addEventListener("click", () => {
  state.tool = "paint";
  updateToolButtons();
});
els.eraseTool.addEventListener("click", () => {
  state.tool = "erase";
  updateToolButtons();
});
els.clearGrid.addEventListener("click", clearGrid);
els.exportButton.addEventListener("click", exportSpritesheet);
els.gridCanvas.addEventListener("pointermove", handleGridPointerMove);
els.gridCanvas.addEventListener("pointerleave", () => {
  state.hoverCell = null;
  els.hoverCell.textContent = "Cell: none";
  renderGrid();
});
els.gridCanvas.addEventListener("click", handleGridClick);

els.cropZoom.addEventListener("input", handleCropZoom);
els.centerCrop.addEventListener("click", centerCropImage);
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

resizeGridCanvas();
renderPalette();
renderGrid();
updateStats();
setStatus("Ready. Add PNGs, crop them, then paint the isometric grid.");

window.__tileBuilderDebug = {
  getState() {
    return {
      cols: state.cols,
      rows: state.rows,
      tileWidth: state.tileWidth,
      tileHeight: state.tileHeight,
      exportCols: state.exportCols,
      placedCount: state.placements.size,
      selectedTileId: state.selectedTileId
    };
  }
};
