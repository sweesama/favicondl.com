/**
 * In-browser favicon converter.
 * Raster work uses canvas in the browser. ICO and ZIP are built from those
 * PNG bytes in this file, so nothing is uploaded and no server image API runs.
 *
 * Classic script: window.FaviconConverter
 * Node: require('./favicon-converter.js')
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.FaviconConverter = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var PNG_SIZES = [16, 32, 48, 180, 192, 512];
    var ICO_SIZES = [16, 32, 48];
    var MAX_BYTES = 15 * 1024 * 1024;
    var SVG_MAX_BYTES = 1024 * 1024;
    var SVG_MAX_ELEMENTS = 5000;
    var SVG_MAX_USES = 40;
    var SVG_MAX_LENGTH = 8192;
    var RASTER_LONG_SIDE = 512;

    var HTML_SNIPPET = [
        '<link rel="icon" href="/favicon.ico" sizes="48x48">',
        '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
        '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
        '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
        '<link rel="manifest" href="/site.webmanifest">'
    ].join('\n');

    var MANIFEST_JSON = [
        '{',
        '  "icons": [',
        '    { "src": "/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },',
        '    { "src": "/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" }',
        '  ]',
        '}'
    ].join('\n');

    function asBytes(data) {
        if (data instanceof Uint8Array) {
            if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) return data;
            return new Uint8Array(data);
        }
        return new Uint8Array(data);
    }

    function crc32(data) {
        var bytes = asBytes(data);
        var c = 0xffffffff;
        for (var i = 0; i < bytes.length; i++) {
            c ^= bytes[i];
            for (var k = 0; k < 8; k++) {
                var mask = -(c & 1);
                c = (c >>> 1) ^ (0xedb88320 & mask);
            }
        }
        return (c ^ 0xffffffff) >>> 0;
    }

    function pngSize(data) {
        var bytes = asBytes(data);
        if (bytes.length < 24) return null;
        var sig = [137, 80, 78, 71, 13, 10, 26, 10];
        for (var i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;
        var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        var width = view.getUint32(16);
        var height = view.getUint32(20);
        if (!width || !height || width > 65535 || height > 65535) return null;
        return { width: width, height: height };
    }

    function buildIco(entries) {
        var list = entries.map(function (entry) {
            return { size: entry.size, png: asBytes(entry.png || entry.bytes) };
        });
        var count = list.length;
        var headerSize = 6 + 16 * count;
        var total = headerSize;
        for (var n = 0; n < list.length; n++) total += list[n].png.length;
        var out = new Uint8Array(total);
        var view = new DataView(out.buffer);
        view.setUint16(2, 1, true);
        view.setUint16(4, count, true);
        var offset = headerSize;
        list.forEach(function (entry, i) {
            var dir = 6 + 16 * i;
            out[dir] = entry.size >= 256 ? 0 : entry.size;
            out[dir + 1] = entry.size >= 256 ? 0 : entry.size;
            view.setUint16(dir + 4, 1, true);
            view.setUint16(dir + 6, 32, true);
            view.setUint32(dir + 8, entry.png.length, true);
            view.setUint32(dir + 12, offset, true);
            out.set(entry.png, offset);
            offset += entry.png.length;
        });
        return out;
    }

    function parseIco(data) {
        var bytes = asBytes(data);
        if (bytes.length < 6) return [];
        var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) return [];
        var count = view.getUint16(4, true);
        var images = [];
        for (var i = 0; i < count; i++) {
            var dir = 6 + 16 * i;
            if (dir + 16 > bytes.length) break;
            var len = view.getUint32(dir + 8, true);
            var start = view.getUint32(dir + 12, true);
            if (!len || start + len > bytes.length) continue;
            var png = bytes.slice(start, start + len);
            images.push({
                dirWidth: bytes[dir] === 0 ? 256 : bytes[dir],
                dirHeight: bytes[dir + 1] === 0 ? 256 : bytes[dir + 1],
                png: png,
                pngSize: pngSize(png)
            });
        }
        return images;
    }

    function dosStamp(date) {
        var d = date || new Date(Date.UTC(2026, 10, 9, 12, 0, 0));
        var time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
        var day = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
        return { time: time, date: day };
    }

    function buildZip(files, options) {
        var stamp = dosStamp(options && options.date);
        var encoder = new TextEncoder();
        var locals = [];
        var centrals = [];
        var offset = 0;
        files.forEach(function (file) {
            var name = encoder.encode(file.name);
            var data = asBytes(file.data);
            var crc = crc32(data);
            var local = new Uint8Array(30 + name.length + data.length);
            var view = new DataView(local.buffer);
            view.setUint32(0, 0x04034b50, true);
            view.setUint16(4, 20, true);
            view.setUint16(10, stamp.time, true);
            view.setUint16(12, stamp.date, true);
            view.setUint32(14, crc, true);
            view.setUint32(18, data.length, true);
            view.setUint32(22, data.length, true);
            view.setUint16(26, name.length, true);
            local.set(name, 30);
            local.set(data, 30 + name.length);
            locals.push(local);

            var central = new Uint8Array(46 + name.length);
            var cv = new DataView(central.buffer);
            cv.setUint32(0, 0x02014b50, true);
            cv.setUint16(4, 20, true);
            cv.setUint16(6, 20, true);
            cv.setUint16(12, stamp.time, true);
            cv.setUint16(14, stamp.date, true);
            cv.setUint32(16, crc, true);
            cv.setUint32(20, data.length, true);
            cv.setUint32(24, data.length, true);
            cv.setUint16(28, name.length, true);
            cv.setUint32(42, offset, true);
            central.set(name, 46);
            centrals.push(central);
            offset += local.length;
        });
        var centralSize = centrals.reduce(function (sum, part) { return sum + part.length; }, 0);
        var eocd = new Uint8Array(22);
        var ev = new DataView(eocd.buffer);
        ev.setUint32(0, 0x06054b50, true);
        ev.setUint16(8, files.length, true);
        ev.setUint16(10, files.length, true);
        ev.setUint32(12, centralSize, true);
        ev.setUint32(16, offset, true);
        var out = new Uint8Array(offset + centralSize + 22);
        var cursor = 0;
        locals.forEach(function (part) { out.set(part, cursor); cursor += part.length; });
        centrals.forEach(function (part) { out.set(part, cursor); cursor += part.length; });
        out.set(eocd, cursor);
        return out;
    }

    function htmlSnippet() { return HTML_SNIPPET; }
    function manifestJson() { return MANIFEST_JSON; }

    function isAccepted(file) {
        var name = String(file && file.name || '').toLowerCase();
        var type = String(file && file.type || '').toLowerCase();
        if (type === 'image/png' || name.endsWith('.png')) return true;
        if (type === 'image/jpeg' || name.endsWith('.jpg') || name.endsWith('.jpeg')) return true;
        if (type === 'image/svg+xml' || name.endsWith('.svg')) return true;
        if (type === 'image/webp' || name.endsWith('.webp')) return true;
        return false;
    }

    function loadImage(url) {
        return new Promise(function (resolve, reject) {
            var image = new Image();
            var settled = false;
            var timer = setTimeout(function () {
                if (settled) return;
                settled = true;
                image.onload = null;
                image.onerror = null;
                image.removeAttribute('src');
                reject(new Error('That image took too long to draw. Export a simpler file and try again.'));
            }, 8000);
            image.onload = function () {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(image);
            };
            image.onerror = function () {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                reject(new Error('Could not read that image. Use a PNG, JPG, SVG, or WebP.'));
            };
            image.src = url;
        });
    }

    function svgAttr(tag, name) {
        var match = new RegExp('\\s' + name + '\\s*=\\s*(["\'])([\\s\\S]*?)\\1', 'i').exec(tag);
        return match ? match[2] : null;
    }

    function trimNum(value) {
        return String(Math.round(value * 1000) / 1000);
    }

    function svgLength(raw) {
        if (raw == null) return null;
        var match = String(raw).trim().match(/^(\d+(?:\.\d+)?)(px)?$/i);
        if (!match) return null;
        var number = parseFloat(match[1]);
        if (!isFinite(number) || number <= 0) return null;
        if (number > SVG_MAX_LENGTH) {
            throw new Error('That SVG declares a width or height above ' + SVG_MAX_LENGTH + '. Export a smaller canvas.');
        }
        return number;
    }

    function decodeXmlRefs(text) {
        if (text.indexOf('&') === -1) return text;
        if (/&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-f]{1,6});)/i.test(text)) {
            throw new Error('SVG entities other than the five XML character references are not supported.');
        }
        return text.replace(/&#x([0-9a-f]{1,6});|&#(\d{1,7});|&(amp|lt|gt|quot|apos);/gi, function (all, hex, dec, named) {
            if (named) {
                if (named.toLowerCase() === 'amp') return '&';
                if (named.toLowerCase() === 'lt') return '<';
                if (named.toLowerCase() === 'gt') return '>';
                if (named.toLowerCase() === 'quot') return '"';
                return "'";
            }
            var code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
            if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
                throw new Error('That SVG contains an invalid character reference.');
            }
            return String.fromCodePoint(code);
        });
    }

    function assertNoDangerousMarkup(text) {
        var lower = text.toLowerCase();
        if (lower.indexOf('<!doctype') !== -1 || lower.indexOf('<!entity') !== -1 || lower.indexOf('<!element') !== -1 || lower.indexOf('<!attlist') !== -1) {
            throw new Error('SVG with a DOCTYPE or custom entities is not supported.');
        }
        if (/<\?(?!xml\s)/i.test(text)) {
            throw new Error('SVG processing instructions other than the XML declaration are not supported.');
        }
        var banned = ['script', 'foreignobject', 'iframe', 'embed', 'object', 'audio', 'video', 'canvas', 'link', 'meta', 'handler', 'set', 'animate', 'animatetransform', 'animatemotion', 'feimage', 'image', 'img', 'applet', 'frame', 'frameset', 'annotation', 'math'];
        for (var i = 0; i < banned.length; i++) {
            if (new RegExp('<\\s*/?\\s*' + banned[i] + '\\b', 'i').test(text)) {
                throw new Error('That SVG uses <' + banned[i] + '>, which this generator does not rasterize.');
            }
        }
        if (/\son[a-z]+\s*=/i.test(text)) throw new Error('SVG event handlers are not supported.');
        if (/javascript\s*:|vbscript\s*:|data\s*:/i.test(text)) throw new Error('Script and data URLs in SVG are not supported.');
        if (/@import\b|expression\s*\(|-moz-binding|behavior\s*:/i.test(text)) throw new Error('External or executable CSS in SVG is not supported.');
        if (/\s(?:src|srcset|poster)\s*=\s*(['"])\s*[^'"]/i.test(text)) {
            throw new Error('External links and embedded images in SVG are not supported.');
        }
        var hrefRe = /(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
        var hrefMatch;
        while ((hrefMatch = hrefRe.exec(text))) {
            var href = String(hrefMatch[1] != null ? hrefMatch[1] : hrefMatch[2]).trim();
            if (href && !/^#[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(href)) {
                throw new Error('External links and embedded images in SVG are not supported.');
            }
        }
        var urlRe = /url\s*\(\s*(['"]?)\s*([^)'"]*)\1\s*\)/gi;
        var urlMatch;
        while ((urlMatch = urlRe.exec(text))) {
            var target = String(urlMatch[2] || '').trim();
            if (!/^#[A-Za-z_:][A-Za-z0-9_.:-]*$/.test(target)) {
                throw new Error('External CSS or image URLs in SVG are not supported.');
            }
        }
    }

    function assertSvgLengths(text) {
        var re = /<svg\b[^>]*>/gi;
        var match;
        while ((match = re.exec(text))) {
            svgLength(svgAttr(match[0], 'width'));
            svgLength(svgAttr(match[0], 'height'));
        }
    }

    function lockRasterSize(text) {
        var match = /<svg\b[^>]*>/i.exec(text);
        if (!match) throw new Error('That file is not an SVG.');
        var tag = match[0];
        var viewBox = svgAttr(tag, 'viewBox');
        var width = svgLength(svgAttr(tag, 'width'));
        var height = svgLength(svgAttr(tag, 'height'));
        var boxW;
        var boxH;
        if (viewBox != null) {
            var parts = viewBox.trim().split(/[\s,]+/).map(Number);
            if (parts.length !== 4 || parts.some(function (n) { return !isFinite(n); }) || parts[2] <= 0 || parts[3] <= 0) {
                throw new Error('That SVG viewBox is invalid.');
            }
            if (parts.some(function (n) { return Math.abs(n) > 1000000; })) {
                throw new Error('That SVG viewBox is too large to rasterize.');
            }
            boxW = parts[2];
            boxH = parts[3];
            viewBox = [parts[0], parts[1], parts[2], parts[3]].map(trimNum).join(' ');
        } else if (width && height) {
            boxW = width;
            boxH = height;
            viewBox = '0 0 ' + trimNum(width) + ' ' + trimNum(height);
        } else {
            boxW = RASTER_LONG_SIDE;
            boxH = RASTER_LONG_SIDE;
            viewBox = '0 0 ' + RASTER_LONG_SIDE + ' ' + RASTER_LONG_SIDE;
        }
        var longSide = Math.max(boxW, boxH);
        var scale = RASTER_LONG_SIDE / longSide;
        var rasterW = Math.max(1, Math.round(boxW * scale));
        var rasterH = Math.max(1, Math.round(boxH * scale));
        var rebuilt = tag
            .replace(/\swidth\s*=\s*(["'])[\s\S]*?\1/i, '')
            .replace(/\sheight\s*=\s*(["'])[\s\S]*?\1/i, '')
            .replace(/\sviewBox\s*=\s*(["'])[\s\S]*?\1/i, '');
        rebuilt = rebuilt.replace(/<svg\b/i, '<svg width="' + rasterW + '" height="' + rasterH + '" viewBox="' + viewBox + '"');
        return text.slice(0, match.index) + rebuilt + text.slice(match.index + tag.length);
    }

    function assertXmlDeclaration(text) {
        var match = /^\s*<\?xml\b([^?]*)\?>/i.exec(text);
        if (!match) return;
        var encoding = /\bencoding\s*=\s*(['"])(.*?)\1/i.exec(match[1]);
        if (encoding && !/^(utf-8|us-ascii)$/i.test(encoding[2])) {
            throw new Error('Only UTF-8 SVG files are supported.');
        }
    }

    // Reject active or network-capable SVG before any rasterizer sees it.
    // The decoded copy is only a scan. The returned markup is the original
    // text plus a capped root width, height and viewBox.
    function prepareSvg(text) {
        if (typeof text !== 'string') throw new Error('That file is not an SVG.');
        if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
        if (text.length > SVG_MAX_BYTES) throw new Error('That SVG is over 1 MB. Export a simpler file and try again.');
        if (text.indexOf('\0') !== -1) throw new Error('That file is not an SVG.');
        assertXmlDeclaration(text);
        assertNoDangerousMarkup(text);
        var decoded = decodeXmlRefs(text);
        if (decoded !== text) assertNoDangerousMarkup(decoded);
        if (!/<svg\b/i.test(text)) throw new Error('That file is not an SVG.');
        var elements = text.match(/<[a-zA-Z]/g);
        if (elements && elements.length > SVG_MAX_ELEMENTS) {
            throw new Error('That SVG has too many elements. Export a simpler icon.');
        }
        var uses = text.match(/<use\b/gi);
        if (uses && uses.length > SVG_MAX_USES) throw new Error('That SVG uses too many <use> references.');
        assertSvgLengths(text);
        return lockRasterSize(text);
    }

    async function svgBlob(file) {
        if (file.size > SVG_MAX_BYTES) throw new Error('That SVG is over 1 MB. Export a simpler file and try again.');
        if (typeof file.text !== 'function') throw new Error('That file is not an SVG.');
        return new Blob([prepareSvg(await file.text())], { type: 'image/svg+xml' });
    }

    function drawContain(image, size) {
        var canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        var ctx = canvas.getContext('2d', { alpha: true });
        ctx.clearRect(0, 0, size, size);
        var sw = image.naturalWidth || image.width;
        var sh = image.naturalHeight || image.height;
        if (!sw || !sh) throw new Error('The image has no pixel size.');
        var scale = Math.min(size / sw, size / sh);
        var dw = Math.max(1, Math.round(sw * scale));
        var dh = Math.max(1, Math.round(sh * scale));
        var dx = Math.floor((size - dw) / 2);
        var dy = Math.floor((size - dh) / 2);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(image, dx, dy, dw, dh);
        return canvas;
    }

    function canvasToPng(canvas) {
        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (blob) {
                if (!blob) {
                    reject(new Error('This browser could not encode a PNG.'));
                    return;
                }
                blob.arrayBuffer().then(function (buffer) {
                    resolve(new Uint8Array(buffer));
                }, reject);
            }, 'image/png');
        });
    }

    async function convertFile(file, options) {
        options = options || {};
        var name = String(file && file.name || '').toLowerCase();
        var type = String(file && file.type || '').toLowerCase();
        var isSvg = type === 'image/svg+xml' || name.endsWith('.svg');
        if (options.svgOnly && !isSvg) throw new Error('Use an SVG file.');
        if (!isAccepted(file)) throw new Error('Use a PNG, JPG, SVG, or WebP file.');
        var blob = file;
        if (isSvg) blob = await svgBlob(file);
        else if (file.size > MAX_BYTES) throw new Error('That file is over 15 MB. Export a smaller image and try again.');
        var url = URL.createObjectURL(blob);
        try {
            var image = await loadImage(url);
            var pngs = new Map();
            for (var i = 0; i < PNG_SIZES.length; i++) {
                var size = PNG_SIZES[i];
                pngs.set(size, await canvasToPng(drawContain(image, size)));
            }
            var ico = buildIco(ICO_SIZES.map(function (size) {
                return { size: size, png: pngs.get(size) };
            }));
            var encoder = new TextEncoder();
            var files = [
                { name: 'favicon.ico', data: ico },
                { name: 'favicon-16x16.png', data: pngs.get(16) },
                { name: 'favicon-32x32.png', data: pngs.get(32) },
                { name: 'favicon-48x48.png', data: pngs.get(48) },
                { name: 'apple-touch-icon.png', data: pngs.get(180) },
                { name: 'android-chrome-192x192.png', data: pngs.get(192) },
                { name: 'android-chrome-512x512.png', data: pngs.get(512) },
                { name: 'site.webmanifest', data: encoder.encode(manifestJson()) },
                { name: 'favicon-links.html', data: encoder.encode(htmlSnippet()) }
            ];
            return {
                pngs: pngs,
                ico: ico,
                files: files,
                zip: buildZip(files),
                html: htmlSnippet(),
                manifest: manifestJson(),
                sourceWidth: image.naturalWidth || image.width,
                sourceHeight: image.naturalHeight || image.height
            };
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    function ensureStyle() {
        if (document.getElementById('fc-tool-style')) return;
        var style = document.createElement('style');
        style.id = 'fc-tool-style';
        style.textContent = [
            '.fc-tool{background:#fff;border:1px solid #e5e5ea;border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(0,0,0,.04)}',
            '.fc-tool h2{font-size:1.25rem;line-height:1.3;font-weight:700;color:#1d1d1f;margin:0 0 8px}',
            '.fc-lead,.fc-note,.fc-status{color:#3a3a3c;font-size:14px;line-height:1.5;margin:0 0 14px}',
            '.fc-note{color:#6e6e73;margin:14px 0 0}',
            '.fc-drop{border:1.5px dashed #d2d2d7;border-radius:12px;padding:18px;text-align:center;background:#fafafa}',
            '.fc-drop.drag{border-color:#0071e3;background:#f0f7ff}',
            '.fc-file{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}',
            '.fc-btn,.fc-btn-secondary{display:inline-flex;align-items:center;justify-content:center;border-radius:980px;padding:10px 16px;font-size:14px;font-weight:500;cursor:pointer;border:0;text-decoration:none}',
            '.fc-btn{background:#0071e3;color:#fff}',
            '.fc-btn:hover{background:#0077ed}',
            '.fc-btn-secondary{background:#f5f5f7;color:#1d1d1f}',
            '.fc-btn[disabled]{opacity:.45;cursor:not-allowed}',
            '.fc-actions,.fc-pngs{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}',
            '.fc-actions[hidden],.fc-pngs[hidden],.fc-previews[hidden],.fc-code[hidden]{display:none !important}',
            '.fc-previews{display:flex;flex-wrap:wrap;gap:14px;align-items:end;margin-top:16px}',
            '.fc-previews figure{margin:0;text-align:center}',
            '.fc-previews img{background-image:linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%);background-size:12px 12px;background-position:0 0,0 6px,6px -6px,-6px 0;border:1px solid #e5e5ea;border-radius:6px}',
            '.fc-previews figcaption{font-size:12px;color:#6e6e73;margin-top:4px}',
            '.fc-code{margin-top:14px;background:#f5f5f7;border-radius:12px;padding:12px;overflow:auto;font-size:12px;line-height:1.45}',
            '.fc-status.error{color:#b42318}',
            '.fc-meta{font-size:13px;color:#6e6e73;margin-top:8px}'
        ].join('');
        document.head.appendChild(style);
    }

    function downloadBytes(bytes, filename, mime) {
        var blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    }

    function clearPreviews(box) {
        box.querySelectorAll('img').forEach(function (img) {
            if (img.dataset.blob) URL.revokeObjectURL(img.dataset.blob);
        });
        box.innerHTML = '';
    }

    function mount(target) {
        var root = typeof target === 'string' ? document.querySelector(target) : target;
        if (!root || root.dataset.fcReady === '1') return;
        root.dataset.fcReady = '1';
        ensureStyle();
        var heading = root.dataset.heading || 'Favicon converter';
        var svgOnly = root.dataset.accept === 'svg';
        var lead = root.dataset.lead || (svgOnly
            ? 'Drop an SVG. Your browser rasterizes favicon.ico at 16, 32 and 48, plus PNGs at 16, 32, 48, 180, 192 and 512, and a ZIP. The file is not uploaded.'
            : 'Drop a PNG, JPG, SVG, or WebP. Your browser builds a multi-size favicon.ico (16, 32, 48), PNGs at 16, 32, 48, 180, 192 and 512, and a ZIP. The file is not uploaded.');
        var accept = svgOnly
            ? '.svg,image/svg+xml'
            : '.png,.jpg,.jpeg,.svg,.webp,image/png,image/jpeg,image/svg+xml,image/webp';
        var meta = svgOnly
            ? 'SVG only, up to 1 MB. Fitted inside each square on a transparent background. Nothing is uploaded.'
            : 'PNG, JPG, SVG, or WebP. Fitted inside each square. Nothing is uploaded.';
        var pickLabel = svgOnly ? 'Choose SVG' : 'Choose image';
        root.innerHTML = ''
            + '<div class="fc-tool">'
            + '<h2></h2>'
            + '<p class="fc-lead"></p>'
            + '<div class="fc-drop">'
            + '<input class="fc-file" type="file" accept="' + accept + '">'
            + '<button type="button" class="fc-btn fc-pick"></button>'
            + '<p class="fc-meta"></p>'
            + '</div>'
            + '<p class="fc-status" role="status"></p>'
            + '<div class="fc-previews" hidden></div>'
            + '<div class="fc-actions" hidden>'
            + '<button type="button" class="fc-btn" data-dl="ico">Download favicon.ico</button>'
            + '<button type="button" class="fc-btn" data-dl="zip">Download ZIP</button>'
            + '</div>'
            + '<div class="fc-pngs" hidden></div>'
            + '<pre class="fc-code" hidden></pre>'
            + '<div class="fc-actions" data-copy hidden><button type="button" class="fc-btn-secondary fc-copy">Copy HTML snippet</button></div>'
            + '<p class="fc-note">Which file each platform reads is the <a href="/blog/favicon-sizes-guide.html">favicon size</a> guide. The pixel rows are the <a href="/blog/favicon-best-size-2026.html">favicon dimensions</a> chart. To copy an existing site icon, use the <a href="/">favicon downloader</a>.</p>'
            + '</div>';
        root.querySelector('h2').textContent = heading;
        root.querySelector('.fc-lead').textContent = lead;
        root.querySelector('.fc-pick').textContent = pickLabel;
        root.querySelector('.fc-meta').textContent = meta;

        var input = root.querySelector('.fc-file');
        var drop = root.querySelector('.fc-drop');
        var status = root.querySelector('.fc-status');
        var previews = root.querySelector('.fc-previews');
        var actions = root.querySelector('.fc-actions');
        var pngs = root.querySelector('.fc-pngs');
        var code = root.querySelector('.fc-code');
        var copyRow = root.querySelector('[data-copy]');
        var result = null;

        root.querySelector('.fc-pick').addEventListener('click', function () { input.click(); });

        function setStatus(message, isError) {
            status.textContent = message || '';
            status.classList.toggle('error', !!isError);
            root.dataset.fcStatus = isError ? 'error' : (result ? 'ready' : 'idle');
        }

        async function run(file) {
            setStatus('Converting in your browser…', false);
            root.dataset.fcStatus = 'working';
            try {
                result = await convertFile(file, { svgOnly: svgOnly });
                root.__fcResult = result;
                clearPreviews(previews);
                [16, 32, 48, 180].forEach(function (size) {
                    var figure = document.createElement('figure');
                    var img = document.createElement('img');
                    var blobUrl = URL.createObjectURL(new Blob([result.pngs.get(size)], { type: 'image/png' }));
                    img.src = blobUrl;
                    img.dataset.blob = blobUrl;
                    img.width = size > 48 ? 96 : size;
                    img.height = size > 48 ? 96 : size;
                    img.alt = size + ' by ' + size + ' PNG';
                    img.dataset.size = String(size);
                    var caption = document.createElement('figcaption');
                    caption.textContent = size + '×' + size;
                    figure.appendChild(img);
                    figure.appendChild(caption);
                    previews.appendChild(figure);
                });
                previews.hidden = false;
                actions.hidden = false;
                pngs.hidden = false;
                pngs.textContent = '';
                [
                    ['favicon-16x16.png', 16],
                    ['favicon-32x32.png', 32],
                    ['favicon-48x48.png', 48],
                    ['apple-touch-icon.png', 180],
                    ['android-chrome-192x192.png', 192],
                    ['android-chrome-512x512.png', 512]
                ].forEach(function (item) {
                    var button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'fc-btn-secondary';
                    button.textContent = item[0];
                    button.addEventListener('click', function () {
                        downloadBytes(result.pngs.get(item[1]), item[0], 'image/png');
                    });
                    pngs.appendChild(button);
                });
                code.hidden = false;
                code.textContent = result.html + '\n\n' + result.manifest;
                copyRow.hidden = false;
                var source = result.sourceWidth + '×' + result.sourceHeight;
                setStatus('Ready. Source ' + source + ' fitted into 16, 32, 48, 180, 192 and 512. favicon.ico contains 16, 32 and 48.', false);
            } catch (error) {
                result = null;
                root.__fcResult = null;
                clearPreviews(previews);
                previews.hidden = true;
                actions.hidden = true;
                pngs.hidden = true;
                pngs.textContent = '';
                code.hidden = true;
                code.textContent = '';
                copyRow.hidden = true;
                setStatus(error && error.message ? error.message : 'Could not convert that file.', true);
            }
        }

        input.addEventListener('change', function () {
            if (input.files && input.files[0]) run(input.files[0]);
        });
        ['dragenter', 'dragover'].forEach(function (name) {
            drop.addEventListener(name, function (event) {
                event.preventDefault();
                drop.classList.add('drag');
            });
        });
        ['dragleave', 'drop'].forEach(function (name) {
            drop.addEventListener(name, function (event) {
                event.preventDefault();
                drop.classList.remove('drag');
            });
        });
        drop.addEventListener('drop', function (event) {
            var file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            if (file) run(file);
        });
        root.querySelector('[data-dl="ico"]').addEventListener('click', function () {
            if (result) downloadBytes(result.ico, 'favicon.ico', 'image/x-icon');
        });
        root.querySelector('[data-dl="zip"]').addEventListener('click', function () {
            if (result) downloadBytes(result.zip, 'favicon-package.zip', 'application/zip');
        });
        root.querySelector('.fc-copy').addEventListener('click', function () {
            if (!result) return;
            var text = result.html + '\n\n' + result.manifest;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(function () {
                    setStatus('HTML and manifest copied.', false);
                }, function () {
                    setStatus('Select the snippet and copy it manually.', true);
                });
            } else {
                setStatus('Select the snippet and copy it manually.', true);
            }
        });
    }

    function autoMount() {
        if (typeof document === 'undefined') return;
        document.querySelectorAll('.fc-mount').forEach(function (el) { mount(el); });
    }

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount);
        else autoMount();
    }

    return {
        PNG_SIZES: PNG_SIZES,
        ICO_SIZES: ICO_SIZES,
        SVG_MAX_BYTES: SVG_MAX_BYTES,
        prepareSvg: prepareSvg,
        asBytes: asBytes,
        crc32: crc32,
        pngSize: pngSize,
        buildIco: buildIco,
        parseIco: parseIco,
        buildZip: buildZip,
        htmlSnippet: htmlSnippet,
        manifestJson: manifestJson,
        isAccepted: isAccepted,
        convertFile: convertFile,
        mount: mount
    };
});
