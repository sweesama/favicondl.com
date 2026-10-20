'use strict';

/**
 * Exact-size favicon rendering for the public API.
 *
 * When a caller passes size, the image we serve is a size×size PNG:
 * Lanczos downscale, high-quality upscale, crisp SVG rasterization, and
 * transparent padding for non-square sources. The original bytes are left
 * alone when size is omitted.
 */

const MIN_SIZE = 16;
const MAX_SIZE = 512;

/**
 * @param {string|null|undefined} value
 * @returns {number|null|undefined} integer 16–512, null if invalid, undefined if omitted
 */
function parseRequestedSize(value) {
  if (value === null || value === undefined || String(value).trim() === '') return undefined;
  const parsed = Number(String(value).trim());
  if (!Number.isFinite(parsed)) return null;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.trunc(parsed)));
}

function appendSize(proxyUrl, size) {
  const u = new URL(proxyUrl);
  u.searchParams.set('size', String(size));
  return u.toString();
}

function nativeSizeLabel(info) {
  if (!info) return 'unknown';
  if (info.vector || info.format === 'svg') return 'vector';
  const w = info.nativeWidth || info.width || 0;
  const h = info.nativeHeight || info.height || 0;
  if (w > 0 && h > 0) return `${w}x${h}`;
  return 'unknown';
}

/**
 * Adds the public size fields onto an extractor result.
 * `width` / `height` stay the measured source size. `proxyUrl` points at the
 * exact-size PNG only when `requested` is an integer.
 */
function attachSize(data, requested) {
  const vector = !!data.vector || data.format === 'svg';
  const nativeWidth = !vector && data.width ? data.width : null;
  const nativeHeight = !vector && data.height ? data.height : null;
  const out = {
    ...data,
    vector,
    nativeWidth,
    nativeHeight,
    nativeFormat: data.format || null,
    resized: false,
    upscaled: false,
  };
  if (requested === undefined || requested === null) {
    out.size = null;
    return out;
  }
  out.size = requested;
  out.resized = true;
  out.outputFormat = 'png';
  out.outputWidth = requested;
  out.outputHeight = requested;
  out.upscaled = !!(nativeWidth && nativeHeight && Math.max(nativeWidth, nativeHeight) < requested);
  if (out.proxyUrl) out.proxyUrl = appendSize(out.proxyUrl, requested);
  return out;
}

function setFaviconSizeHeaders(res, info) {
  res.setHeader('x-favicon-native-size', nativeSizeLabel(info));
  res.setHeader('x-favicon-upscaled', info && info.upscaled ? '1' : '0');
  if (info && info.resized && info.outputWidth) {
    res.setHeader('x-favicon-output-size', String(info.outputWidth));
  }
}

function sanitizeSvg(text) {
  return String(text)
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\s(?:href|xlink:href)\s*=\s*(["'])(?!\s*data:)[\s\S]*?\1/gi, '');
}

function svgDensity(info, size) {
  const longest = Math.max(info.width || 0, info.height || 0);
  if (longest > 0) {
    // Rasterize at least at the target size (capped) so Lanczos only
    // downscales a sharp render, instead of enlarging a 72dpi thumbnail.
    const renderLong = Math.min(1024, Math.max(size, Math.min(longest, 1024)));
    return Math.min(2400, Math.max(72, Math.ceil((72 * renderLong) / longest)));
  }
  return Math.min(576, Math.max(144, size * 2));
}

/**
 * Largest embedded frame of an ICO/CUR. Modern files store PNG; older ones
 * store a bottom-up DIB plus a 1-bit AND mask.
 * @returns {{kind:'buffer', buffer:Buffer}|{kind:'raw', width:number, height:number, buffer:Buffer}|null}
 */
function extractBestIcoFrame(buf) {
  if (!buf || buf.length < 22) return null;
  if (buf.readUInt16LE(0) !== 0) return null;
  const kind = buf.readUInt16LE(2);
  if (kind !== 1 && kind !== 2) return null;
  const count = buf.readUInt16LE(4);
  if (count < 1 || count > 255 || buf.length < 6 + count * 16) return null;

  let bestPng = null;
  let bestPngScore = -1;
  let bestRaw = null;
  let bestRawScore = -1;

  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    const bytes = buf.readUInt32LE(off + 8);
    const dataOff = buf.readUInt32LE(off + 12);
    if (dataOff <= 0 || dataOff >= buf.length || bytes < 8) continue;
    const data = Buffer.from(buf.subarray(dataOff, Math.min(buf.length, dataOff + bytes)));
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 && data.length >= 24) {
      const score = Math.max(data.readUInt32BE(16), data.readUInt32BE(20));
      if (score > bestPngScore) {
        bestPngScore = score;
        bestPng = data;
      }
      continue;
    }
    const decoded = decodeIcoDib(data);
    if (decoded) {
      const score = Math.max(decoded.width, decoded.height);
      if (score > bestRawScore) {
        bestRawScore = score;
        bestRaw = decoded;
      }
    }
  }

  if (bestPng && bestPngScore >= bestRawScore) return { kind: 'buffer', buffer: bestPng };
  if (bestRaw) return { kind: 'raw', width: bestRaw.width, height: bestRaw.height, buffer: bestRaw.buffer };
  if (bestPng) return { kind: 'buffer', buffer: bestPng };
  return null;
}

function decodeIcoDib(data) {
  if (data.length < 40) return null;
  const headerSize = data.readUInt32LE(0);
  if (headerSize < 40 || headerSize > data.length) return null;
  const width = data.readInt32LE(4);
  const heightField = data.readInt32LE(8);
  const bitCount = data.readUInt16LE(14);
  const compression = data.readUInt32LE(16);
  if (compression !== 0 || width <= 0 || width > 1024 || heightField === 0) return null;
  if (bitCount !== 32 && bitCount !== 24 && bitCount !== 8 && bitCount !== 4 && bitCount !== 1) return null;
  // ICO stores XOR bitmap plus AND mask, so biHeight is twice the image height.
  const absHeight = Math.abs(heightField);
  const height = absHeight % 2 === 0 ? absHeight / 2 : absHeight;
  if (height <= 0 || height > 1024) return null;

  let paletteEntries = 0;
  if (bitCount <= 8) {
    const clrUsed = headerSize >= 36 ? data.readUInt32LE(32) : 0;
    paletteEntries = clrUsed || (1 << bitCount);
  }
  const paletteOff = headerSize;
  const xorOff = headerSize + paletteEntries * 4;
  const rowStride = Math.ceil((width * bitCount) / 32) * 4;
  const xorSize = rowStride * height;
  if (xorOff + xorSize > data.length) return null;

  const rgba = Buffer.alloc(width * height * 4);
  let maxAlpha = 0;
  for (let y = 0; y < height; y++) {
    const srcRow = xorOff + (height - 1 - y) * rowStride;
    for (let x = 0; x < width; x++) {
      let r;
      let g;
      let b;
      let alpha = 255;
      if (bitCount === 32 || bitCount === 24) {
        const s = srcRow + x * (bitCount / 8);
        b = data[s];
        g = data[s + 1];
        r = data[s + 2];
        alpha = bitCount === 32 ? data[s + 3] : 255;
      } else {
        let index = 0;
        if (bitCount === 8) index = data[srcRow + x];
        else if (bitCount === 4) {
          const byte = data[srcRow + (x >> 1)];
          index = (x & 1) === 0 ? byte >> 4 : byte & 0x0f;
        } else {
          const byte = data[srcRow + (x >> 3)];
          index = (byte >> (7 - (x & 7))) & 1;
        }
        const p = paletteOff + index * 4;
        if (p + 2 >= data.length) return null;
        b = data[p];
        g = data[p + 1];
        r = data[p + 2];
      }
      const d = (y * width + x) * 4;
      rgba[d] = r;
      rgba[d + 1] = g;
      rgba[d + 2] = b;
      rgba[d + 3] = alpha;
      if (alpha > maxAlpha) maxAlpha = alpha;
    }
  }

  // A 32-bit ICO often stores 0 in every alpha byte and uses the AND mask.
  if (bitCount !== 32 || maxAlpha === 0) {
    if (bitCount === 32 && maxAlpha === 0) {
      for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    }
    applyAndMask(data, xorOff + xorSize, width, height, rgba);
  }
  return { width, height, buffer: rgba };
}

function applyAndMask(data, maskOff, width, height, rgba) {
  const rowBytes = Math.ceil(width / 32) * 4;
  if (maskOff < 0 || maskOff + rowBytes * height > data.length) return;
  for (let y = 0; y < height; y++) {
    const srcRow = maskOff + (height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x++) {
      const bit = (data[srcRow + (x >> 3)] >> (7 - (x & 7))) & 1;
      if (bit) rgba[(y * width + x) * 4 + 3] = 0;
    }
  }
}

function loadSharp() {
  try {
    return require('sharp');
  } catch (error) {
    const err = new Error('Image resizing is unavailable');
    err.cause = error;
    throw err;
  }
}

/**
 * @param {Buffer} buffer original image bytes already known to be an image
 * @param {{format?:string, width?:number, height?:number, vector?:boolean}} info sniffImage result
 * @param {number} size exact output side, already clamped to 16–512
 * @returns {Promise<Buffer>} PNG of size×size
 */
async function resizeIcon(buffer, info, size) {
  const sharp = loadSharp();
  const target = Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.trunc(size)));
  let input = buffer;
  let raw = null;

  if (info && (info.format === 'ico' || info.format === 'cur')) {
    const frame = extractBestIcoFrame(buffer);
    if (!frame) throw new Error('Could not read ICO image');
    if (frame.kind === 'raw') raw = frame;
    else input = frame.buffer;
  } else if (info && (info.vector || info.format === 'svg')) {
    input = Buffer.from(sanitizeSvg(buffer.toString('utf8')));
  }

  const options = raw
    ? { raw: { width: raw.width, height: raw.height, channels: 4 }, limitInputPixels: 4096 * 4096, animated: false, pages: 1 }
    : {
        limitInputPixels: 4096 * 4096,
        animated: false,
        pages: 1,
        density: info && (info.vector || info.format === 'svg') ? svgDensity(info, target) : undefined,
      };

  const source = raw ? raw.buffer : input;
  const png = await sharp(source, options)
    .rotate()
    .resize(target, target, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      // Lanczos for downscales; the same kernel is a high-quality upscale
      // without claiming the result is sharper than the source pixels.
      kernel: 'lanczos3',
      withoutEnlargement: false,
      fastShrinkOnLoad: false,
    })
    .png({ compressionLevel: 9, effort: 7 })
    .toBuffer();

  const meta = await sharp(png).metadata();
  if (meta.width !== target || meta.height !== target) {
    throw new Error(`Resized image was ${meta.width}x${meta.height}, expected ${target}x${target}`);
  }
  return png;
}

module.exports = {
  MIN_SIZE,
  MAX_SIZE,
  parseRequestedSize,
  appendSize,
  attachSize,
  nativeSizeLabel,
  setFaviconSizeHeaders,
  extractBestIcoFrame,
  resizeIcon,
  sanitizeSvg,
};
