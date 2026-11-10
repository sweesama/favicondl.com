'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALLOWED_SIZES,
  snapSize,
  normalizeSiteTarget,
  normalizeProxyTarget,
  buildProxyUrl,
  canonicalApiPath,
  requestPath,
} = require('./canonical');

test('snapSize only returns the sizes the site actually requests', () => {
  assert.deepEqual(ALLOWED_SIZES, [16, 32, 48, 64, 128, 180, 192, 256, 512]);
  for (const size of ALLOWED_SIZES) assert.equal(snapSize(size), size);
  assert.equal(snapSize(0), 16);
  assert.equal(snapSize(15), 16);
  assert.equal(snapSize(-4), 16);
  assert.equal(snapSize(137), 128);
  assert.equal(snapSize(100), 128);
  assert.equal(snapSize(96), 64);
  assert.equal(snapSize(154), 128);
  assert.equal(snapSize(155), 180);
  assert.equal(snapSize(9000), 512);
});

test('site targets drop scheme, www and a trailing slash, and keep the path', () => {
  assert.equal(normalizeSiteTarget('github.com'), 'github.com');
  assert.equal(normalizeSiteTarget('https://github.com'), 'github.com');
  assert.equal(normalizeSiteTarget('https://github.com/'), 'github.com');
  assert.equal(normalizeSiteTarget('HTTPS://WWW.GitHub.com/'), 'github.com');
  assert.equal(normalizeSiteTarget('http://www.github.com'), 'github.com');
  assert.equal(normalizeSiteTarget('https://github.com/docs/'), 'github.com/docs');
  assert.equal(normalizeSiteTarget('//cdn.example.com'), 'cdn.example.com');
  assert.equal(normalizeSiteTarget('not a url'), null);
  assert.equal(normalizeSiteTarget('javascript:alert(1)'), null);
});

test('proxy targets keep www and a file path, and lowercase the host', () => {
  assert.equal(
    normalizeProxyTarget('HTTPS://WWW.Example.com/icon.png'),
    'https://www.example.com/icon.png'
  );
  assert.equal(
    normalizeProxyTarget('https://cdn.example.com/icon.png/'),
    'https://cdn.example.com/icon.png/'
  );
  assert.equal(normalizeProxyTarget('https://cdn.example.com/'), 'https://cdn.example.com');
  assert.equal(normalizeProxyTarget('https://cdn.example.com:443/a.png'), 'https://cdn.example.com/a.png');
  assert.equal(normalizeProxyTarget('ftp://cdn.example.com/a.png'), null);
});

test('the homepage and bulk extract URL is already canonical', () => {
  const path = '/api/extract?url=github.com&format=json';
  const result = canonicalApiPath(path);
  assert.equal(result.error, null);
  assert.equal(result.path, path);
  assert.equal(requestPath(path), path);
});

test('extra params, size and host variants collapse to one extract URL', () => {
  const canonical = '/api/extract?url=github.com&format=json';
  const inputs = [
    '/api/extract?url=github.com&format=json&zz=123',
    '/api/extract?url=https%3A%2F%2Fwww.GitHub.com%2F&format=json&t=1&v=2',
    '/api/extract?format=json&url=github.com',
    '/api/extract?domain=github.com&format=JSON&zz=9',
    '/api/extract?url=http://github.com&format=json',
  ];
  for (const input of inputs) {
    const result = canonicalApiPath(input);
    assert.equal(result.error, null, input);
    assert.equal(result.path, canonical, input);
    assert.equal(canonicalApiPath(result.path).path, result.path, input);
  }
});

test('an off-list size snaps and the default extract format is omitted', () => {
  assert.deepEqual(canonicalApiPath('/api/extract?url=github.com&size=137'), {
    path: '/api/extract?url=github.com&size=128',
    error: null,
  });
  assert.deepEqual(canonicalApiPath('/api/extract?url=github.com&size=32&format=redirect'), {
    path: '/api/extract?url=github.com&size=32',
    error: null,
  });
  assert.deepEqual(canonicalApiPath('/api/extract?url=github.com&size=48'), {
    path: '/api/extract?url=github.com&size=48',
    error: null,
  });
  assert.deepEqual(canonicalApiPath('/api/favicon?domain=GitHub.com&size=32&format=json'), {
    path: '/api/favicon?url=github.com&size=32',
    error: null,
  });
  assert.deepEqual(canonicalApiPath('/api/favicon?url=github.com&format=redirect'), {
    path: '/api/favicon?url=github.com&format=redirect',
    error: null,
  });
});

test('a non-numeric size or format is a 400 and is not redirected', () => {
  assert.deepEqual(canonicalApiPath('/api/extract?url=github.com&size=nope'), {
    path: null,
    error: 'Invalid size',
  });
  assert.deepEqual(canonicalApiPath('/api/extract?url=github.com&format=png'), {
    path: null,
    error: 'Invalid format',
  });
  assert.deepEqual(canonicalApiPath('/api/proxy?url=notaurl'), {
    path: null,
    error: 'Invalid url',
  });
});

test('a missing target drops junk params instead of running the handler', () => {
  assert.deepEqual(canonicalApiPath('/api/favicon?zz=1'), { path: '/api/favicon', error: null });
  assert.deepEqual(canonicalApiPath('/api/proxy?size=32'), { path: '/api/proxy', error: null });
});

test('proxy keeps www, snaps size, and ignores cache busters', () => {
  const raw = '/api/proxy?url=https%3A%2F%2Fwww.example.com%2Ficon.png&size=137&zz=1&v=9';
  const result = canonicalApiPath(raw);
  assert.equal(result.error, null);
  assert.equal(result.path, '/api/proxy?url=https%3A%2F%2Fwww.example.com%2Ficon.png&size=128');
  assert.equal(canonicalApiPath(result.path).path, result.path);
});

test('proxy host case and an origin trailing slash share one URL', () => {
  assert.equal(
    canonicalApiPath('/api/proxy?url=HTTPS%3A%2F%2FCDN.Example.com%2Fa.png').path,
    '/api/proxy?url=https%3A%2F%2Fcdn.example.com%2Fa.png'
  );
  assert.equal(
    canonicalApiPath('/api/proxy?url=https%3A%2F%2Fcdn.example.com%2F').path,
    '/api/proxy?url=https%3A%2F%2Fcdn.example.com'
  );
});

test('buildProxyUrl emits the same query the proxy route accepts without a redirect', () => {
  const absolute = buildProxyUrl(
    'https://favicondl.com/api/proxy',
    'https://www.google.com/s2/favicons?domain=github.com&sz=64',
    64
  );
  assert.equal(
    absolute,
    'https://favicondl.com/api/proxy?url=https%3A%2F%2Fwww.google.com%2Fs2%2Ffavicons%3Fdomain%3Dgithub.com%26sz%3D64&size=64'
  );
  const path = absolute.slice('https://favicondl.com'.length);
  assert.equal(canonicalApiPath(path).path, path);
});
