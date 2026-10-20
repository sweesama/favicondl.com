'use strict';

// Local check of the public handlers: size=16,32,64,256,512 must be exact.
const http = require('http');
const sharp = require('sharp');
const extractHandler = require('../api/extract');
const proxyHandler = require('../api/proxy');

function enhance(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    if (!res.getHeader('content-type')) res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj));
  };
  res.send = (body) => res.end(body);
  res.redirect = (code, location) => {
    res.statusCode = code;
    res.setHeader('location', location);
    res.end();
  };
  return res;
}

function listen(handler) {
  const server = http.createServer((req, res) => {
    enhance(res);
    Promise.resolve(handler(req, res)).catch((error) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end(String(error && error.stack || error));
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path, headers: { host: '127.0.0.1' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
  });
}

async function measure(port, domain, size) {
  const qs = size == null
    ? `/api/extract?url=${encodeURIComponent(domain)}&format=json`
    : `/api/extract?url=${encodeURIComponent(domain)}&size=${size}&format=json`;
  const meta = await get(port, qs);
  const data = JSON.parse(meta.body.toString('utf8'));
  if (!data.ok) return { domain, size, error: data.error || meta.status };
  const imagePath = new URL(data.proxyUrl).pathname + new URL(data.proxyUrl).search;
  const image = await get(port, imagePath);
  let width = null;
  let height = null;
  let format = null;
  if (image.status === 200 && image.body.length) {
    try {
      const info = await sharp(image.body).metadata();
      width = info.width;
      height = info.height;
      format = info.format;
    } catch (error) {
      format = `unreadable:${error.message}`;
    }
  }
  return {
    domain,
    size: size == null ? 'omit' : size,
    source: data.source,
    fileFormat: data.format,
    native: data.nativeWidth && data.nativeHeight ? `${data.nativeWidth}x${data.nativeHeight}` : (data.vector ? 'vector' : 'unknown'),
    upscaled: data.upscaled,
    output: width && height ? `${width}x${height}` : `${image.status}`,
    imageFormat: format,
    headerNative: image.headers['x-favicon-native-size'] || '',
    headerUpscaled: image.headers['x-favicon-upscaled'] || '',
    headerOutput: image.headers['x-favicon-output-size'] || '',
  };
}

async function main() {
  const server = await listen((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/proxy') return proxyHandler(req, res);
    return extractHandler(req, res);
  });
  const port = server.address().port;
  const sizes = [16, 32, 64, 256, 512];
  // wikipedia: large raster. github: SVG. gnu.org: 32px site PNG.
  // info.cern.ch: classic 16px ICO. w3.org: Google S2 fallback (the site
  // answers 403 and has no usable icon of its own).
  const cases = [
    'wikipedia.org',
    'github.com',
    'gnu.org',
    'info.cern.ch',
    'w3.org',
  ];
  const rows = [];
  try {
    for (const domain of cases) {
      rows.push(await measure(port, domain, null));
      for (const size of sizes) rows.push(await measure(port, domain, size));
    }
  } finally {
    server.close();
  }
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
