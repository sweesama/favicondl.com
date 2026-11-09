'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const converter = require('./favicon-converter.js');

function crc32(bytes) {
    return converter.crc32(bytes);
}

function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
}

function solidPng(size, rgba) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
        row[1 + x * 4] = rgba[0];
        row[2 + x * 4] = rgba[1];
        row[3 + x * 4] = rgba[2];
        row[4 + x * 4] = rgba[3];
    }
    const raw = Buffer.alloc(row.length * size);
    for (let y = 0; y < size; y++) row.copy(raw, y * row.length);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

function readZip(bytes) {
    const files = [];
    let offset = 0;
    while (offset + 30 <= bytes.length) {
        if (bytes.readUInt32LE(offset) !== 0x04034b50) break;
        const method = bytes.readUInt16LE(offset + 8);
        const crc = bytes.readUInt32LE(offset + 14);
        const size = bytes.readUInt32LE(offset + 18);
        const nameLen = bytes.readUInt16LE(offset + 26);
        const extraLen = bytes.readUInt16LE(offset + 28);
        const name = bytes.slice(offset + 30, offset + 30 + nameLen).toString('utf8');
        const start = offset + 30 + nameLen + extraLen;
        const data = bytes.slice(start, start + size);
        assert.equal(method, 0, name + ' should be stored, not compressed');
        assert.equal(converter.crc32(data), crc);
        files.push({ name, data });
        offset = start + size;
    }
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    return files;
}

test('multi-size ICO stores PNG payloads at 16, 32 and 48', () => {
    const entries = [16, 32, 48].map((size, i) => ({
        size,
        png: solidPng(size, [20 + i, 40, 60, 255])
    }));
    const ico = Buffer.from(converter.buildIco(entries));
    assert.equal(ico.readUInt16LE(0), 0);
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 3);
    const images = converter.parseIco(ico);
    assert.deepEqual(images.map((img) => img.dirWidth), [16, 32, 48]);
    images.forEach((img) => {
        assert.equal(img.pngSize.width, img.dirWidth);
        assert.equal(img.pngSize.height, img.dirHeight);
    });
});

test('ZIP round-trips the favicon package names', () => {
    const png = solidPng(16, [1, 2, 3, 255]);
    const files = [
        { name: 'favicon.ico', data: converter.buildIco([{ size: 16, png }]) },
        { name: 'favicon-16x16.png', data: png },
        { name: 'site.webmanifest', data: Buffer.from(converter.manifestJson()) },
        { name: 'favicon-links.html', data: Buffer.from(converter.htmlSnippet()) }
    ];
    const zip = Buffer.from(converter.buildZip(files));
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    const unpacked = readZip(zip);
    assert.deepEqual(unpacked.map((file) => file.name), files.map((file) => file.name));
    unpacked.forEach((file, i) => {
        assert.deepEqual(file.data, Buffer.from(files[i].data));
    });
    const html = converter.htmlSnippet();
    assert.match(html, /favicon\.ico/);
    assert.match(html, /apple-touch-icon/);
    assert.match(html, /32x32/);
    assert.match(converter.manifestJson(), /192x192/);
    assert.match(converter.manifestJson(), /512x512/);
});

test('accepted types are PNG, JPG, SVG and WebP only', () => {
    assert.equal(converter.isAccepted({ name: 'a.PNG', type: '' }), true);
    assert.equal(converter.isAccepted({ name: 'a.jpeg', type: '' }), true);
    assert.equal(converter.isAccepted({ name: 'a.svg', type: 'image/svg+xml' }), true);
    assert.equal(converter.isAccepted({ name: 'a.webp', type: '' }), true);
    assert.equal(converter.isAccepted({ name: 'a.gif', type: 'image/gif' }), false);
    assert.equal(converter.isAccepted({ name: 'a.txt', type: 'text/plain' }), false);
});
