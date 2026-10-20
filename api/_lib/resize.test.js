'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { sniffImage } = require('./extractor');
const {
  parseRequestedSize,
  attachSize,
  extractBestIcoFrame,
  resizeIcon,
} = require('./resize');

async function png(width, height, { r = 200, g = 20, b = 20, a = 255 } = {}) {
  return sharp({
    create: { width, height, channels: 4, background: { r, g, b, alpha: a } },
  }).png().toBuffer();
}

function buildPngIco(pngBuffer, width, height) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header[6] = width >= 256 ? 0 : width;
  header[7] = height >= 256 ? 0 : height;
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(pngBuffer.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, pngBuffer]);
}

function buildDibIco(width, height, rgbaAt) {
  const headerSize = 40;
  const rowStride = Math.ceil((width * 4) / 4) * 4;
  const xor = Buffer.alloc(rowStride * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = rgbaAt(x, y);
      const s = (height - 1 - y) * rowStride + x * 4;
      xor[s] = b;
      xor[s + 1] = g;
      xor[s + 2] = r;
      xor[s + 3] = a;
    }
  }
  const maskRow = Math.ceil(width / 32) * 4;
  const mask = Buffer.alloc(maskRow * height);
  const dib = Buffer.alloc(headerSize);
  dib.writeUInt32LE(headerSize, 0);
  dib.writeInt32LE(width, 4);
  dib.writeInt32LE(height * 2, 8);
  dib.writeUInt16LE(1, 12);
  dib.writeUInt16LE(32, 14);
  const image = Buffer.concat([dib, xor, mask]);
  return buildPngIco(image, width, height).subarray(0, 6 + 16).length
    ? (() => {
        const dir = Buffer.alloc(22);
        dir.writeUInt16LE(1, 2);
        dir.writeUInt16LE(1, 4);
        dir[6] = width;
        dir[7] = height;
        dir.writeUInt16LE(1, 10);
        dir.writeUInt16LE(32, 12);
        dir.writeUInt32LE(image.length, 14);
        dir.writeUInt32LE(22, 18);
        return Buffer.concat([dir, image]);
      })()
    : image;
}

async function pixel(buf, x, y) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3], width: info.width, height: info.height };
}

test('parseRequestedSize clamps 16-512 and treats omission separately', () => {
  assert.equal(parseRequestedSize(undefined), undefined);
  assert.equal(parseRequestedSize(null), undefined);
  assert.equal(parseRequestedSize(''), undefined);
  assert.equal(parseRequestedSize('  '), undefined);
  assert.equal(parseRequestedSize('nope'), null);
  assert.equal(parseRequestedSize('0'), 16);
  assert.equal(parseRequestedSize('15'), 16);
  assert.equal(parseRequestedSize('16'), 16);
  assert.equal(parseRequestedSize('32'), 32);
  assert.equal(parseRequestedSize('32.9'), 32);
  assert.equal(parseRequestedSize('512'), 512);
  assert.equal(parseRequestedSize('9000'), 512);
});

test('attachSize leaves the original URL when size is omitted', () => {
  const proxyUrl = 'https://favicondl.com/api/proxy?url=https%3A%2F%2Fexample.com%2Fa.png';
  const out = attachSize({ format: 'png', width: 160, height: 160, vector: false, proxyUrl, size: 128 }, undefined);
  assert.equal(out.size, null);
  assert.equal(out.resized, false);
  assert.equal(out.upscaled, false);
  assert.equal(out.nativeWidth, 160);
  assert.equal(out.proxyUrl, proxyUrl);
});

test('attachSize points proxyUrl at an exact square and flags upscaling', () => {
  const out = attachSize({
    format: 'png',
    width: 32,
    height: 16,
    vector: false,
    proxyUrl: 'https://favicondl.com/api/proxy?url=https%3A%2F%2Fexample.com%2Fa.png',
    size: 128,
  }, 64);
  assert.equal(out.size, 64);
  assert.equal(out.outputWidth, 64);
  assert.equal(out.outputHeight, 64);
  assert.equal(out.outputFormat, 'png');
  assert.equal(out.upscaled, true);
  assert.equal(out.nativeWidth, 32);
  assert.equal(out.nativeHeight, 16);
  assert.match(out.proxyUrl, /[?&]size=64$/);
});

test('attachSize does not call an SVG upscaled', () => {
  const out = attachSize({ format: 'svg', width: null, height: null, vector: true, proxyUrl: 'https://favicondl.com/api/proxy?url=https%3A%2F%2Fexample.com%2Fa.svg' }, 32);
  assert.equal(out.upscaled, false);
  assert.equal(out.vector, true);
  assert.equal(out.nativeWidth, null);
  assert.equal(out.outputWidth, 32);
});

test('downscale, upscale, and pad without stretching', async () => {
  const wide = await png(40, 20);
  const info = sniffImage(wide);
  const out = await resizeIcon(wide, info, 16);
  const meta = await sharp(out).metadata();
  assert.equal(meta.width, 16);
  assert.equal(meta.height, 16);
  const corner = await pixel(out, 0, 0);
  const center = await pixel(out, 8, 8);
  assert.equal(corner.a, 0);
  assert.ok(center.a > 200);
  assert.ok(center.r > 150);

  const tiny = await png(16, 16, { r: 10, g: 80, b: 200 });
  const big = await resizeIcon(tiny, sniffImage(tiny), 32);
  const bigMeta = await sharp(big).metadata();
  assert.equal(bigMeta.width, 32);
  assert.equal(bigMeta.height, 32);
  const mid = await pixel(big, 16, 16);
  assert.ok(mid.b > mid.r);
});

test('SVG rasterizes to the requested square, including 32', async () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#1122ee"/></svg>'
  );
  const info = sniffImage(svg);
  assert.equal(info.format, 'svg');
  for (const size of [16, 32, 64]) {
    const out = await resizeIcon(svg, info, size);
    const meta = await sharp(out).metadata();
    assert.equal(meta.width, size);
    assert.equal(meta.height, size);
    const mid = await pixel(out, Math.floor(size / 2), Math.floor(size / 2));
    assert.ok(mid.b > 180 && mid.r < 80, `size ${size} center was ${mid.r},${mid.g},${mid.b}`);
  }
});

test('non-square SVG is contained, not stretched', async () => {
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 16"><rect width="32" height="16" fill="#00aa44"/></svg>'
  );
  const out = await resizeIcon(svg, sniffImage(svg), 32);
  const top = await pixel(out, 16, 0);
  const mid = await pixel(out, 16, 16);
  assert.equal(top.a, 0);
  assert.ok(mid.g > 120 && mid.a > 200);
});

test('ICO PNG frame and 32-bit DIB both resize to 32', async () => {
  const embedded = await png(20, 20, { r: 240, g: 180, b: 10 });
  const ico = buildPngIco(embedded, 20, 20);
  const sniffed = sniffImage(ico);
  assert.equal(sniffed.format, 'ico');
  const frame = extractBestIcoFrame(ico);
  assert.equal(frame.kind, 'buffer');
  const out = await resizeIcon(ico, sniffed, 32);
  assert.equal((await sharp(out).metadata()).width, 32);

  const dib = buildDibIco(8, 4, () => [20, 20, 220, 255]);
  const dibInfo = sniffImage(dib);
  assert.equal(dibInfo.format, 'ico');
  const dibOut = await resizeIcon(dib, dibInfo, 32);
  const meta = await sharp(dibOut).metadata();
  assert.equal(meta.width, 32);
  assert.equal(meta.height, 32);
  const corner = await pixel(dibOut, 0, 0);
  const center = await pixel(dibOut, 16, 16);
  assert.equal(corner.a, 0);
  assert.ok(center.b > 150 && center.a > 200);
});
