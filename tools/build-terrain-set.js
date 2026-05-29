#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

function usage() {
  console.log(`Usage:
  npm run build:terrain-set -- --source <folder> --set "Ground A1"
  npm run build:terrain-set -- --source <folder> --prefix Ground --tile-size 128x128

Options:
  --source <folder>       Folder containing terrain PNG files.
  --set <name>            Base tile set name, for example "Ground A1".
  --prefix <name>         Build one terrain sheet from every matching directional tile, for example Ground.
  --out <folder>          Output folder. Defaults to "<source>/<set> edited".
  --directions <list>     Direction order. Defaults to N,E,S,W.
  --family <name>         Broader numeric family for report. Defaults to the set name without its trailing number.
  --tile-size <WxH>       Fixed output tile size. Defaults to alpha-cropped bounds for --set and 128x128 for --prefix.
`);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : "true";
    args[key] = value;
  }
  return args;
}

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

function paethPredictor(left, up, upperLeft) {
  const prediction = left + up - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
  if (upDistance <= upperLeftDistance) return up;
  return upperLeft;
}

function readPng(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error(`${filePath} is not a PNG file.`);
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
    throw new Error(`${filePath} uses unsupported PNG settings. Expected 8-bit, non-interlaced RGB or RGBA.`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const bytesPerPixel = channels;
  const rowBytes = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const rgba = Buffer.alloc(width * height * 4);
  let readOffset = 0;
  let previousRow = Buffer.alloc(rowBytes);

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[readOffset];
    readOffset += 1;
    const row = Buffer.from(inflated.subarray(readOffset, readOffset + rowBytes));
    readOffset += rowBytes;

    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previousRow[x] || 0;
      const upperLeft = x >= bytesPerPixel ? previousRow[x - bytesPerPixel] : 0;
      if (filter === 1) row[x] = (row[x] + left) & 0xff;
      if (filter === 2) row[x] = (row[x] + up) & 0xff;
      if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 0xff;
      if (filter === 4) row[x] = (row[x] + paethPredictor(left, up, upperLeft)) & 0xff;
    }

    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      rgba[target] = row[source];
      rgba[target + 1] = row[source + 1];
      rgba[target + 2] = row[source + 2];
      rgba[target + 3] = colorType === 6 ? row[source + 3] : 255;
    }

    previousRow = row;
  }

  return { width, height, pixels: rgba };
}

function writePng(filePath, image) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rowBytes = image.width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const rawOffset = y * (rowBytes + 1);
    raw[rawOffset] = 0;
    image.pixels.copy(raw, rawOffset + 1, y * rowBytes, (y + 1) * rowBytes);
  }

  fs.writeFileSync(
    filePath,
    Buffer.concat([
      PNG_SIGNATURE,
      pngChunk("IHDR", ihdr),
      pngChunk("IDAT", zlib.deflateSync(raw)),
      pngChunk("IEND", Buffer.alloc(0))
    ])
  );
}

function alphaBounds(image) {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const alpha = image.pixels[(y * image.width + x) * 4 + 3];
      if (alpha > 0) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX === -1) return { x: 0, y: 0, width: image.width, height: image.height };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

function createBlank(width, height) {
  return { width, height, pixels: Buffer.alloc(width * height * 4) };
}

function drawImage(target, source, sourceRect, targetX, targetY) {
  for (let y = 0; y < sourceRect.height; y += 1) {
    for (let x = 0; x < sourceRect.width; x += 1) {
      const sx = sourceRect.x + x;
      const sy = sourceRect.y + y;
      const tx = targetX + x;
      const ty = targetY + y;
      if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
      const sourceIndex = (sy * source.width + sx) * 4;
      const targetIndex = (ty * target.width + tx) * 4;
      source.pixels.copy(target.pixels, targetIndex, sourceIndex, sourceIndex + 4);
    }
  }
}

function slugName(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function inferFamily(setName) {
  return setName.replace(/\s*\d+\s*$/, "").trim();
}

function parseTileSize(value, fallback) {
  if (!value) return fallback;
  const match = value.match(/^(\d+)x(\d+)$/i);
  if (!match) throw new Error(`Invalid --tile-size "${value}". Use a value like 128x128.`);
  return {
    width: Number.parseInt(match[1], 10),
    height: Number.parseInt(match[2], 10)
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function analyzeFamily(sourceFolder, family, directions) {
  const files = fs.readdirSync(sourceFolder);
  const pattern = new RegExp(`^${escapeRegExp(family)}\\s*(\\d+)_(${directions.map(escapeRegExp).join("|")})\\.png$`, "i");
  const groups = new Map();

  for (const file of files) {
    const match = file.match(pattern);
    if (!match) continue;
    const index = Number.parseInt(match[1], 10);
    const direction = match[2].toUpperCase();
    if (!groups.has(index)) groups.set(index, new Set());
    groups.get(index).add(direction);
  }

  const sortedIndices = [...groups.keys()].sort((a, b) => a - b);
  const maxIndex = sortedIndices.length ? sortedIndices[sortedIndices.length - 1] : 0;
  const missingIndices = [];
  for (let index = 1; index <= maxIndex; index += 1) {
    if (!groups.has(index)) missingIndices.push(index);
  }

  const completeness = sortedIndices.map((index) => {
    const present = groups.get(index);
    const missing = directions.filter((direction) => !present.has(direction));
    return { index, present: directions.filter((direction) => present.has(direction)), missing };
  });

  return { missingIndices, completeness };
}

function terrainSort(a, b) {
  return (
    a.group.localeCompare(b.group) ||
    a.number - b.number ||
    a.directionIndex - b.directionIndex
  );
}

function cropToTile(image, bounds, tileWidth, tileHeight) {
  const tile = createBlank(tileWidth, tileHeight);
  const centeredX = bounds.x + bounds.width / 2 - tileWidth / 2;
  const cropX = Math.max(0, Math.min(image.width - tileWidth, Math.round(centeredX)));
  const cropY = Math.max(0, image.height - tileHeight);
  drawImage(tile, image, { x: cropX, y: cropY, width: tileWidth, height: tileHeight }, 0, 0);
  return {
    image: tile,
    crop: { x: cropX, y: cropY, width: tileWidth, height: tileHeight },
    clipped: bounds.x < cropX || bounds.y < cropY || bounds.x + bounds.width > cropX + tileWidth || bounds.y + bounds.height > cropY + tileHeight
  };
}

function buildPrefixTerrain(args) {
  const sourceFolder = path.resolve(args.source);
  const prefix = args.prefix.trim();
  const directions = (args.directions || "N,E,S,W").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  const tileSize = parseTileSize(args["tile-size"], { width: 128, height: 128 });
  const outputFolder = path.resolve(args.out || path.join(sourceFolder, `${prefix} edited`));
  const outputSlug = slugName(prefix);
  const pattern = new RegExp(`^${escapeRegExp(prefix)}\\s+([A-Z])(\\d+)_(${directions.map(escapeRegExp).join("|")})\\.png$`, "i");

  fs.mkdirSync(outputFolder, { recursive: true });

  const found = fs.readdirSync(sourceFolder)
    .map((fileName) => {
      const match = fileName.match(pattern);
      if (!match) return null;
      return {
        fileName,
        sourcePath: path.join(sourceFolder, fileName),
        group: match[1].toUpperCase(),
        number: Number.parseInt(match[2], 10),
        direction: match[3].toUpperCase(),
        directionIndex: directions.indexOf(match[3].toUpperCase())
      };
    })
    .filter(Boolean)
    .sort(terrainSort);

  if (found.length === 0) {
    throw new Error(`No ${prefix} directional PNG files found in ${sourceFolder}.`);
  }

  const groups = new Map();
  for (const item of found) {
    if (!groups.has(item.group)) groups.set(item.group, new Map());
    if (!groups.get(item.group).has(item.number)) groups.get(item.group).set(item.number, new Set());
    groups.get(item.group).get(item.number).add(item.direction);
  }

  const maxNumber = Math.max(...found.map((item) => item.number));
  const groupNames = [...groups.keys()].sort();
  const sheetColumns = maxNumber * directions.length;
  const sheetRows = groupNames.length;
  const sheet = createBlank(sheetColumns * tileSize.width, sheetRows * tileSize.height);
  const cropped = [];
  const clipped = [];

  for (const item of found) {
    const source = readPng(item.sourcePath);
    const bounds = alphaBounds(source);
    const result = cropToTile(source, bounds, tileSize.width, tileSize.height);
    const groupRow = groupNames.indexOf(item.group);
    const sheetColumn = (item.number - 1) * directions.length + item.directionIndex;
    const tileId = `${prefix}_${item.group}${item.number}_${item.direction}`;
    const fileName = `${slugName(tileId)}.png`;
    const outputPath = path.join(outputFolder, fileName);
    writePng(outputPath, result.image);
    drawImage(sheet, result.image, { x: 0, y: 0, width: tileSize.width, height: tileSize.height }, sheetColumn * tileSize.width, groupRow * tileSize.height);
    const record = {
      tileId,
      fileName,
      group: item.group,
      number: item.number,
      direction: item.direction,
      sheetColumn,
      sheetRow: groupRow,
      source: item.fileName,
      crop: result.crop,
      bounds
    };
    cropped.push(record);
    if (result.clipped) clipped.push(record);
  }

  const sheetName = `${outputSlug}_terrain_sheet.png`;
  writePng(path.join(outputFolder, sheetName), sheet);

  const missingLines = [];
  for (const group of groupNames) {
    const variants = groups.get(group);
    const maxInGroup = Math.max(...variants.keys());
    for (let number = 1; number <= maxInGroup; number += 1) {
      if (!variants.has(number)) {
        missingLines.push(`- ${prefix} ${group}${number}: missing entire variant`);
        continue;
      }
      const missingDirections = directions.filter((direction) => !variants.get(number).has(direction));
      if (missingDirections.length) {
        missingLines.push(`- ${prefix} ${group}${number}: missing ${missingDirections.join(", ")}`);
      }
    }
  }

  const csvRows = [
    "tile_id,file_name,source,group,number,direction,sheet_column,sheet_row,crop_x,crop_y,crop_width,crop_height,bounds_x,bounds_y,bounds_width,bounds_height"
  ];
  for (const item of cropped) {
    csvRows.push([
      item.tileId,
      item.fileName,
      item.source,
      item.group,
      item.number,
      item.direction,
      item.sheetColumn,
      item.sheetRow,
      item.crop.x,
      item.crop.y,
      item.crop.width,
      item.crop.height,
      item.bounds.x,
      item.bounds.y,
      item.bounds.width,
      item.bounds.height
    ].join(","));
  }
  fs.writeFileSync(path.join(outputFolder, `${outputSlug}_terrain_sheet_map.csv`), `${csvRows.join("\n")}\n`, "utf8");

  const report = [
    `# ${prefix} edited terrain report`,
    "",
    `Source folder: ${sourceFolder}`,
    `Output folder: ${outputFolder}`,
    "",
    "## Reference",
    "- The itch.io page describes the pack as modular top-down isometric terrain with ground tiles for dirt, grass, stone, pathways, tiled floors, and related surfaces.",
    "- The page lists tile PNG dimensions as 128 x 256, pixel per unit as 128, and a typical tile pivot of X 0.5 / Y 0.18.",
    "",
    "## Export settings",
    `- Tile size: ${tileSize.width} x ${tileSize.height} px`,
    `- Sprite sheet: ${sheetName}`,
    `- Sheet layout: ${sheetColumns} columns x ${sheetRows} rows`,
    `- Sheet order: group rows ${groupNames.join(", ")}; within each row, numeric variant ascending; directions ${directions.join(", ")}`,
    `- Cropped sprites: ${cropped.length}`,
    "",
    "## Godot slicing",
    `- Tile size: ${tileSize.width} x ${tileSize.height}`,
    "- Use the CSV map for tile coordinates.",
    "- For isometric placement, keep the pack's usual pivot/texture origin in mind: X 0.5 / Y 0.18 from the source page.",
    "",
    "## Missing parts",
    ...(missingLines.length ? missingLines : ["- None found within each letter group's numeric range."]),
    "",
    "## Crop warnings",
    ...(clipped.length
      ? clipped.map((item) => `- ${item.tileId}: alpha bounds exceeded ${tileSize.width}x${tileSize.height}; fixed crop may trim edge pixels.`)
      : ["- No fixed-size crop clipping detected."]),
    "",
    "## Group summary",
    ...groupNames.map((group) => {
      const variants = [...groups.get(group).keys()].sort((a, b) => a - b);
      return `- ${prefix} ${group}: ${variants.length} variants, ${variants[0]}-${variants[variants.length - 1]}`;
    })
  ];
  fs.writeFileSync(path.join(outputFolder, "missing_tiles_report.md"), `${report.join("\n")}\n`, "utf8");

  console.log(`Wrote ${cropped.length} cropped sprites, ${sheetName}, ${outputSlug}_terrain_sheet_map.csv, and missing_tiles_report.md`);
  console.log(`Output folder: ${outputFolder}`);
  console.log(`Tile size: ${tileSize.width}x${tileSize.height}`);
  console.log(`Sheet: ${sheetColumns} columns x ${sheetRows} rows (${sheet.width}x${sheet.height})`);
  if (missingLines.length) console.log(`Missing entries: ${missingLines.length}`);
  if (clipped.length) console.log(`Crop warnings: ${clipped.length}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.source || (!args.set && !args.prefix)) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  if (args.prefix) {
    buildPrefixTerrain(args);
    return;
  }

  const sourceFolder = path.resolve(args.source);
  const setName = args.set.trim();
  const directions = (args.directions || "N,E,S,W").split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
  const fixedTileSize = parseTileSize(args["tile-size"], null);
  const outputFolder = path.resolve(args.out || path.join(sourceFolder, `${setName} edited`));
  const family = (args.family || inferFamily(setName)).trim();
  const outputSlug = slugName(setName);

  fs.mkdirSync(outputFolder, { recursive: true });

  const loaded = [];
  const missingSetDirections = [];
  for (const direction of directions) {
    const sourcePath = path.join(sourceFolder, `${setName}_${direction}.png`);
    if (!fs.existsSync(sourcePath)) {
      missingSetDirections.push(direction);
      continue;
    }
    const image = readPng(sourcePath);
    loaded.push({ direction, sourcePath, image, bounds: alphaBounds(image) });
  }

  if (loaded.length === 0) {
    throw new Error(`No source files found for ${setName} in ${sourceFolder}.`);
  }

  const tileWidth = fixedTileSize ? fixedTileSize.width : Math.max(...loaded.map((item) => item.bounds.width));
  const tileHeight = fixedTileSize ? fixedTileSize.height : Math.max(...loaded.map((item) => item.bounds.height));
  const cropped = [];

  for (const item of loaded) {
    let tile;
    if (fixedTileSize) {
      tile = cropToTile(item.image, item.bounds, tileWidth, tileHeight).image;
    } else {
      tile = createBlank(tileWidth, tileHeight);
      const x = Math.floor((tileWidth - item.bounds.width) / 2);
      const y = Math.floor((tileHeight - item.bounds.height) / 2);
      drawImage(tile, item.image, item.bounds, x, y);
    }
    const fileName = `${outputSlug}_${item.direction.toLowerCase()}.png`;
    const outputPath = path.join(outputFolder, fileName);
    writePng(outputPath, tile);
    cropped.push({ direction: item.direction, fileName, outputPath, image: tile });
  }

  const sheet = createBlank(tileWidth * cropped.length, tileHeight);
  cropped.forEach((item, index) => {
    drawImage(sheet, item.image, { x: 0, y: 0, width: tileWidth, height: tileHeight }, index * tileWidth, 0);
  });
  const sheetName = `${outputSlug}_terrain_sheet.png`;
  writePng(path.join(outputFolder, sheetName), sheet);

  const familyReport = analyzeFamily(sourceFolder, family, directions);
  const report = [
    `# ${setName} edited terrain report`,
    "",
    `Source folder: ${sourceFolder}`,
    `Output folder: ${outputFolder}`,
    "",
    "## Export settings",
    `- Tile size: ${tileWidth} x ${tileHeight} px`,
    `- Sprite sheet: ${sheetName}`,
    `- Sheet layout: ${cropped.length} columns x 1 row`,
    `- Tile order: ${cropped.map((item) => item.direction).join(", ")}`,
    "",
    "## Cropped sprites",
    ...cropped.map((item) => `- ${item.direction}: ${item.fileName}`),
    "",
    `## Missing parts for ${setName}`,
    ...(missingSetDirections.length
      ? missingSetDirections.map((direction) => `- Missing direction: ${direction}`)
      : ["- None. Expected directions are present."]),
    "",
    `## Missing parts in the broader ${family} terrain run`,
    familyReport.missingIndices.length
      ? `- Missing numeric variant(s): ${familyReport.missingIndices.join(", ")}`
      : "- No missing numeric variants found.",
    "",
    `## ${family} direction completeness`,
    ...familyReport.completeness.map((item) => {
      if (item.missing.length === 0) return `- ${family}${item.index}: complete (${directions.join(", ")})`;
      return `- ${family}${item.index}: missing ${item.missing.join(", ")}`;
    })
  ];
  fs.writeFileSync(path.join(outputFolder, "missing_tiles_report.md"), `${report.join("\n")}\n`, "utf8");

  console.log(`Wrote ${cropped.length} cropped sprites, ${sheetName}, and missing_tiles_report.md`);
  console.log(`Output folder: ${outputFolder}`);
  console.log(`Tile size: ${tileWidth}x${tileHeight}`);
  if (missingSetDirections.length) console.log(`Missing directions: ${missingSetDirections.join(", ")}`);
  if (familyReport.missingIndices.length) console.log(`Missing ${family} numeric variants: ${familyReport.missingIndices.join(", ")}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
