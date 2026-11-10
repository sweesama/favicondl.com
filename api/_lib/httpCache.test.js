'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cacheControlForError,
  SUCCESS_SITE_CACHE,
  SUCCESS_FALLBACK_CACHE,
  PROXY_SUCCESS_CACHE,
  redirectIfNonCanonical,
} = require('./httpCache');
const { createHandler } = require('./handler');

test('success and error cache windows stay in the ranges the CDN should store', () => {
  assert.equal(SUCCESS_SITE_CACHE, 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800');
  assert.equal(SUCCESS_FALLBACK_CACHE, 'public, max-age=600, s-maxage=3600, stale-while-revalidate=86400');
  assert.equal(PROXY_SUCCESS_CACHE, 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800');
  assert.match(cacheControlForError(404), /s-maxage=3600/);
  assert.match(cacheControlForError(415), /s-maxage=3600/);
  assert.match(cacheControlForError(400), /s-maxage=3600/);
  assert.match(cacheControlForError(400), /max-age=0/);
  assert.match(cacheControlForError(504), /s-maxage=300/);
  assert.match(cacheControlForError(502), /s-maxage=300/);
  assert.match(cacheControlForError(504), /stale-while-revalidate=/);
});

function mockRes() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    location: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    redirect(code, location) {
      this.statusCode = code;
      this.location = location;
      return this;
    },
    end() {
      return this;
    },
  };
}

function assertCdnHeaders(res, pattern) {
  for (const name of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) {
    assert.match(res.headers[name], pattern, name);
  }
}

test('extract 308s variant queries before doing any discovery', async () => {
  const handler = createHandler({ defaultFormat: 'redirect' });
  const cases = [
    ['/api/extract?url=github.com&size=32&t=99', '/api/extract?url=github.com&size=32'],
    ['/api/extract?url=github.com&size=137&zz=1', '/api/extract?url=github.com&size=128'],
    ['/api/extract?url=https%3A%2F%2Fwww.GitHub.com%2F&format=json', '/api/extract?url=github.com&format=json'],
  ];
  for (const [url, location] of cases) {
    const res = mockRes();
    await handler({ method: 'GET', url, headers: { host: 'favicondl.com' } }, res);
    assert.equal(res.statusCode, 308, url);
    assert.equal(res.location, location, url);
    assertCdnHeaders(res, /s-maxage=86400/);
    assert.match(res.headers['cache-control'], /stale-while-revalidate=604800/);
  }
});

test('a missing url is still a 400 and carries the three shared cache headers', async () => {
  const handler = createHandler({ defaultFormat: 'json' });
  const res = mockRes();
  await handler({ method: 'GET', url: '/api/favicon', headers: { host: 'localhost' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Missing url');
  assertCdnHeaders(res, /s-maxage=3600/);
});

test('a non-numeric size is a 400 and does not redirect', async () => {
  const handler = createHandler({ defaultFormat: 'json' });
  const res = mockRes();
  await handler({
    method: 'GET',
    url: '/api/favicon?url=github.com&size=nope',
    headers: { host: 'favicondl.com' },
  }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Invalid size');
  assert.equal(res.location, null);
});

test('redirectIfNonCanonical leaves a canonical request alone', () => {
  const res = mockRes();
  const redirected = redirectIfNonCanonical({ url: '/api/proxy?url=https%3A%2F%2Fa.com%2Fi.png' }, res);
  assert.equal(redirected, false);
  assert.equal(res.statusCode, null);
});

test('the homepage extract URL does not redirect', () => {
  const res = mockRes();
  const redirected = redirectIfNonCanonical({
    url: '/api/extract?url=github.com&format=json',
  }, res);
  assert.equal(redirected, false);
  assert.equal(res.statusCode, null);
});
