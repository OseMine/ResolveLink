#!/usr/bin/env node
/**
 * Build desktop icons from the source artwork.
 *
 * Source: web/public/icon.svg (the artwork shipped with the marketing site).
 * Outputs:
 *   assets/icon.png            512x512  (Linux + in-app window icon)
 *   assets/icon.ico            multi-size Windows icon (BMP entries, NSIS-safe)
 *   assets/icon.icns           multi-size macOS icon
 *   assets/dmg-background.png  DMG installer background
 *
 * Usage: node scripts/build-icons.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const ASSETS_DIR = path.join(ROOT, 'assets');
const SOURCE_CANDIDATES = [
  path.join(ROOT, 'web', 'public', 'icon.svg'),
  path.join(ROOT, 'assets', 'icon.svg'),
];

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];
const ICNS_SIZES = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
];

function findSource() {
  for (const candidate of SOURCE_CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Source icon not found (looked in web/public/icon.svg)');
}

/** Render a PNG buffer at an exact square size. */
async function renderPng(source, size) {
  return sharp(source, { density: 1200 })
    .resize(size, size, { kernel: 'lanczos3', fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * Encode a PNG buffer as a BMP (DIB) icon entry so every consumer, including
 * NSIS and the Windows shell, can read it without PNG decompression support.
 */
async function pngToIcoEntry(pngBuffer, size) {
  const { data } = await sharp(pngBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixelBytes = size * size * 4;
  const maskRowBytes = Math.ceil(size / 32) * 4;
  const maskBytes = maskRowBytes * size;
  const entry = Buffer.alloc(40 + pixelBytes + maskBytes);

  // BITMAPINFOHEADER
  entry.writeUInt32LE(40, 0); // header size
  entry.writeInt32LE(size, 4); // width
  entry.writeInt32LE(size * 2, 8); // height (XOR + AND mask)
  entry.writeUInt16LE(1, 12); // planes
  entry.writeUInt16LE(32, 14); // bit count
  entry.writeUInt32LE(0, 16); // compression: BI_RGB
  entry.writeUInt32LE(pixelBytes + maskBytes, 20); // image size

  // Pixels, bottom-up BGRA.
  let out = 40;
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      entry[out++] = data[i + 2]; // B
      entry[out++] = data[i + 1]; // G
      entry[out++] = data[i]; // R
      entry[out++] = data[i + 3]; // A
    }
  }

  // AND mask: fully transparent pixels are masked out. Leave 0 for opaque,
  // set 1 where alpha is 0.
  for (let y = size - 1; y >= 0; y--) {
    const rowStart = 40 + pixelBytes + (size - 1 - y) * maskRowBytes;
    for (let x = 0; x < size; x++) {
      const alpha = data[(y * size + x) * 4 + 3];
      if (alpha === 0) {
        const bit = 7 - (x % 8);
        entry[rowStart + Math.floor(x / 8)] |= 1 << bit;
      }
    }
  }

  return entry;
}

async function buildIco(source) {
  const images = [];
  for (const size of ICO_SIZES) {
    const png = await renderPng(source, size);
    images.push({ size, data: await pngToIcoEntry(png, size) });
  }

  const headerSize = 6 + images.length * 16;
  let offset = headerSize;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4); // image count

  images.forEach((image, index) => {
    const base = 6 + index * 16;
    header[base] = image.size >= 256 ? 0 : image.size; // width (0 = 256)
    header[base + 1] = image.size >= 256 ? 0 : image.size; // height
    header[base + 2] = 0; // palette colors
    header[base + 3] = 0; // reserved
    header.writeUInt16LE(1, base + 4); // color planes
    header.writeUInt16LE(32, base + 6); // bits per pixel
    header.writeUInt32LE(image.data.length, base + 8);
    header.writeUInt32LE(offset, base + 12);
    offset += image.data.length;
  });

  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

async function buildIcns(source) {
  const chunks = [];
  for (const [type, size] of ICNS_SIZES) {
    const png = await renderPng(source, size);
    const chunkHeader = Buffer.alloc(8);
    chunkHeader.write(type, 0, 4, 'ascii');
    chunkHeader.writeUInt32BE(png.length + 8, 4);
    chunks.push(chunkHeader, png);
  }

  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

async function buildDmgBackground() {
  const width = 540;
  const height = 380;
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#14181d"/>
          <stop offset="100%" stop-color="#1f2b24"/>
        </linearGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bg)"/>
      <rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="18" fill="none" stroke="#ffffff" stroke-opacity="0.06"/>
    </svg>
  `);
  return sharp(svg).png({ compressionLevel: 9 }).toBuffer();
}

async function main() {
  const source = findSource();
  console.log(`[icons] source: ${path.relative(ROOT, source)}`);

  fs.mkdirSync(ASSETS_DIR, { recursive: true });

  const png512 = await renderPng(source, 512);
  const [ico, icns, dmgBackground] = await Promise.all([
    buildIco(source),
    buildIcns(source),
    buildDmgBackground(),
  ]);

  const writes = [
    ['icon.png', png512],
    ['icon.ico', ico],
    ['icon.icns', icns],
    ['dmg-background.png', dmgBackground],
  ];

  for (const [name, data] of writes) {
    const target = path.join(ASSETS_DIR, name);
    fs.writeFileSync(target, data);
    console.log(`[icons] ${path.relative(ROOT, target)} (${data.length} bytes)`);
  }
}

main().catch((err) => {
  console.error('[icons] failed:', err);
  process.exit(1);
});
