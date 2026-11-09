'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cacheBustRedirectPath,
  cacheControlForError,
  SUCCESS_SITE_CACHE,
  SUCCESS_FALLBACK_CACHE,
  redirectCacheBusters,
} = require('./httpCache');
const { createHandler } = require('./handler');

test('cache busters are removed and every other parameter stays in order', () => {
  assert.equal(cacheBustRedirectPath('/api/extract?url=github.com&format=json'), null);
  assert.equal(
    cacheBustRedirectPath('/api/extract?url=github.com&format=json&t=123&v=9&_=1'),
    '/api/extract?url=github.com&format=json'
  );
  assert.equal(
    cacheBustRedirectPath('/api/proxy?url=https%3A%2F%2Fa.com%2Fx.png&size=32&v=9'),
    '/api/proxy?url=https%3A%2F%2Fa.com%2Fx.png&size=32'
  );
  assert.equal(
    cacheBustRedirectPath('https://favicondl.com/api/favicon?domain=example.com&t=1'),
    '/api/favicon?domain=example.com'
  );
});

test('a value of v inside the url parameter is not treated as a cache buster', () => {
  const path = '/api/proxy?url=' + encodeURIComponent('https://cdn.example/icon.png?v=2');
  assert.equal(cacheBustRedirectPath(path), null);
});

test('error cache windows stay inside minutes-to-an-hour, success windows stay put', () => {
  assert.equal(SUCCESS_SITE_CACHE, 'public, s-maxage=86400, stale-while-revalidate=604800');
  assert.equal(SUCCESS_FALLBACK_CACHE, 'public, s-maxage=3600, stale-while-revalidate=86400');
  assert.match(cacheControlForError(404), /s-maxage=3600/);
  assert.match(cacheControlForError(415), /s-maxage=3600/);
  assert.match(cacheControlForError(400), /s-maxage=3600/);
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

test('extract redirects cache-busting queries before doing any discovery', async () => {
  const handler = createHandler({ defaultFormat: 'redirect' });
  const res = mockRes();
  await handler({
    method: 'GET',
    url: '/api/extract?url=github.com&size=32&t=99',
    headers: { host: 'favicondl.com' },
  }, res);
  assert.equal(res.statusCode, 302);
  assert.equal(res.location, '/api/extract?url=github.com&size=32');
  assert.match(res.headers['cache-control'], /s-maxage=86400/);
});

test('a missing url is still a 400 and now carries a shared cache header', async () => {
  const handler = createHandler({ defaultFormat: 'json' });
  const res = mockRes();
  await handler({ method: 'GET', url: '/api/favicon', headers: { host: 'localhost' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Missing url');
  assert.match(res.headers['cache-control'], /s-maxage=3600/);
});

test('redirectCacheBusters leaves a canonical request alone', () => {
  const res = mockRes();
  const redirected = redirectCacheBusters({ url: '/api/proxy?url=https%3A%2F%2Fa.com%2Fi.png' }, res);
  assert.equal(redirected, false);
  assert.equal(res.statusCode, null);
});
