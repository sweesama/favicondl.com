/**
 * Favicon checker. The page calls the existing /api/extract endpoint with the
 * canonical query from api/_lib/canonical.js (url, then format=json, no other
 * parameters) and does the checklist here. ICO layers are read from /api/proxy
 * bytes in the browser, because the JSON only reports the largest layer.
 *
 * Classic script: window.FaviconChecker
 * Node: require('./favicon-checker.js')
 */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.FaviconChecker = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    var CHECK_IDS = ['ico', 'png16', 'png32', 'png48', 'apple', 'manifest', 'png192', 'png512', 'svg'];

    var LINKS = {
        sizes: { href: '/blog/favicon-sizes-guide.html', label: 'Favicon size guide' },
        tools: { href: '/tools.html', label: 'Image to Favicon generator' },
        ico: { href: '/blog/png-to-ico.html', label: 'PNG to ICO converter' },
        png: { href: '/blog/png-to-favicon.html', label: 'PNG to favicon' },
        jpg: { href: '/blog/jpg-to-favicon-converter.html', label: 'JPG to favicon' },
        svg: { href: '/blog/svg-to-ico.html', label: 'SVG to ICO' },
        bulk: { href: '/bulk-favicon-downloader.html', label: 'Bulk favicon downloader' },
        index: { href: '/favicon/', label: 'Site favicon examples' },
        manifest: { href: '/blog/web-app-manifest-icons-192-512.html', label: 'Manifest icon sizes' },
        apple: { href: '/blog/apple-touch-icon-guide.html', label: 'Apple touch icon guide' }
    };

    var SNIPPETS = {
        ico: '<link rel="icon" href="/favicon.ico" sizes="any">',
        png16: '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">',
        png32: '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">',
        png48: '<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png">',
        apple: '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
        manifest: '<link rel="manifest" href="/site.webmanifest">',
        svg: '<link rel="icon" type="image/svg+xml" href="/icon.svg" sizes="any">',
        png192: '{ "src": "/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" }',
        png512: '{ "src": "/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" }'
    };

    var MANIFEST_JSON = [
        '{',
        '  "icons": [',
        '    { "src": "/android-chrome-192x192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },',
        '    { "src": "/android-chrome-512x512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" }',
        '  ]',
        '}'
    ].join('\n');

    function normalizeSiteTarget(input) {
        var s = String(input || '').trim();
        if (!s) return null;
        if (s.indexOf('//') === 0) s = 'https:' + s;
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
        var u;
        try {
            u = new URL(s);
        } catch (err) {
            return null;
        }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
        var host = u.hostname.toLowerCase().replace(/\.+$/, '');
        if (!host || host.indexOf('.') === -1) return null;
        host = host.replace(/^www\./, '');
        if (!host || host.indexOf('.') === -1) return null;
        var port = u.port ? ':' + u.port : '';
        var path = u.pathname || '/';
        if (path.length > 1) path = path.replace(/\/+$/, '');
        if (path === '/') path = '';
        return host + port + path + u.search;
    }

    function hostOf(target) {
        if (!target) return '';
        return String(target).split('/')[0].split('?')[0].split(':')[0];
    }

    function isPrivateHost(hostname) {
        var host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
        if (!host) return true;
        if (host === 'localhost' || /\.localhost$/.test(host) || /\.local$/.test(host) || /\.internal$/.test(host) || /\.lan$/.test(host)) return true;
        if (host.indexOf(':') !== -1) {
            if (host === '::' || host === '::1') return true;
            if (/^fe[89ab]/.test(host) || /^f[cd]/.test(host)) return true;
            return false;
        }
        var parts = host.split('.');
        if (parts.length !== 4 || parts.some(function (part) { return !/^\d+$/.test(part) || Number(part) > 255; })) return false;
        var p = parts.map(Number);
        if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
        if (p[0] === 169 && p[1] === 254) return true;
        if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
        if (p[0] === 192 && p[1] === 168) return true;
        if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
        if (p[0] >= 224) return true;
        return false;
    }

    function failureReason(input) {
        var target = normalizeSiteTarget(input);
        if (!String(input || '').trim()) return 'empty';
        if (!target) return 'invalid';
        if (isPrivateHost(hostOf(target))) return 'blocked';
        return null;
    }

    /**
     * Path that canonicalApiPath already accepts for /api/extract.
     * Allowlisted params are url and format. size is omitted so the JSON
     * describes the original files. Scheme, leading www and a trailing slash
     * are removed before the request is sent.
     */
    function canonicalExtractPath(input) {
        if (failureReason(input)) return null;
        var target = normalizeSiteTarget(input);
        var params = new URLSearchParams();
        params.set('url', target);
        params.set('format', 'json');
        return '/api/extract?' + params.toString();
    }

    function isAggregator(icon) {
        var name = String((icon && (icon.source || icon.origin)) || '');
        return name === 'google_s2' || name === 'duckduckgo';
    }

    function pathnameOf(url) {
        try {
            return new URL(url).pathname.toLowerCase();
        } catch (err) {
            return String(url || '').split('?')[0].toLowerCase();
        }
    }

    function formatOf(icon) {
        if (!icon) return '';
        if (icon.vector || icon.format === 'svg') return 'svg';
        if (icon.format) return String(icon.format).toLowerCase();
        var match = pathnameOf(icon.url || '').match(/\.([a-z0-9]+)$/);
        return match ? match[1] : '';
    }

    function isIco(icon) {
        var format = formatOf(icon);
        if (format === 'ico' || format === 'cur') return true;
        if (/\/favicon\.ico$/.test(pathnameOf(icon && icon.url))) return true;
        return String(icon && icon.rel || '') === 'favicon.ico';
    }

    function isSvgColor(icon) {
        if (formatOf(icon) !== 'svg') return false;
        var rel = String(icon.rel || '').toLowerCase();
        return rel !== 'mask-icon';
    }

    function isApple(icon) {
        var rel = String(icon && icon.rel || '').toLowerCase();
        if (rel === 'apple-touch-icon' || rel === 'apple-touch-icon-precomposed') return true;
        return /apple-touch-icon/.test(pathnameOf(icon && icon.url));
    }

    function isManifest(icon) {
        return String(icon && icon.source || '') === 'manifest' || String(icon && icon.rel || '') === 'manifest';
    }

    function httpUrl(value) {
        try {
            var u = new URL(value);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
            return u.toString();
        } catch (err) {
            return '';
        }
    }

    /**
     * Same-origin proxy path. Keeps the query the API already canonicalized
     * and refuses anything that is not /api/proxy with url and optional size.
     */
    function proxyPath(proxyUrl) {
        var u;
        try {
            u = new URL(proxyUrl, 'https://favicondl.com');
        } catch (err) {
            return null;
        }
        if (u.pathname !== '/api/proxy') return null;
        var keys = [];
        u.searchParams.forEach(function (_value, key) { keys.push(key); });
        for (var i = 0; i < keys.length; i++) {
            if (keys[i] !== 'url' && keys[i] !== 'size') return null;
        }
        if (!httpUrl(u.searchParams.get('url'))) return null;
        return u.pathname + u.search;
    }

    function readIcoSizes(data) {
        var bytes = data instanceof Uint8Array ? data : new Uint8Array(data || []);
        if (bytes.length < 6) return [];
        var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) return [];
        var count = view.getUint16(4, true);
        if (!count || count > 255 || bytes.length < 6 + count * 16) return [];
        var sizes = [];
        for (var i = 0; i < count; i++) {
            var off = 6 + i * 16;
            var w = bytes[off] || 256;
            var h = bytes[off + 1] || 256;
            var dataOff = view.getUint32(off + 12, true);
            if (dataOff + 24 <= bytes.length && bytes[dataOff] === 0x89 && bytes[dataOff + 1] === 0x50 && bytes[dataOff + 2] === 0x4e && bytes[dataOff + 3] === 0x47) {
                w = view.getUint32(dataOff + 16, false);
                h = view.getUint32(dataOff + 20, false);
            }
            if (w > 0 && h > 0 && w <= 4096 && h <= 4096) sizes.push({ width: w, height: h });
        }
        return sizes;
    }

    function collectIcons(data) {
        var list = Array.isArray(data && data.candidates) ? data.candidates.slice() : [];
        var topUrl = data && data.iconUrl;
        var seen = {};
        list.forEach(function (icon) {
            if (icon && icon.url) seen[icon.url] = true;
        });
        if (topUrl && !seen[topUrl]) {
            list.unshift({
                url: data.iconUrl,
                proxyUrl: data.proxyUrl,
                source: data.source,
                rel: data.rel,
                format: data.format,
                width: data.width,
                height: data.height,
                vector: data.vector
            });
        }
        return list.filter(function (icon) { return icon && (icon.url || icon.proxyUrl); });
    }

    function layersOf(icon, embedded) {
        var extra = embedded && icon.url ? embedded[icon.url] : null;
        if (extra && extra.length) return extra;
        if (formatOf(icon) === 'svg') return [];
        var w = Number(icon.width) || 0;
        var h = Number(icon.height) || 0;
        if (!w || !h) return [];
        return [{ width: w, height: h }];
    }

    function siteIcons(icons) {
        return icons.filter(function (icon) { return !isAggregator(icon); });
    }

    function sizeHits(icons, side, embedded) {
        var hits = [];
        icons.forEach(function (icon) {
            layersOf(icon, embedded).forEach(function (layer) {
                if (layer.width === side && layer.height === side) hits.push(icon);
            });
        });
        return hits;
    }

    function sourceLabel(icon) {
        var source = String(icon.source || '');
        if (source === 'html') return 'HTML link';
        if (source === 'manifest') return 'Web manifest';
        if (source === 'direct') return 'Well-known path';
        if (source === 'google_s2') return 'Google fallback';
        if (source === 'duckduckgo') return 'DuckDuckGo fallback';
        return source || 'Icon';
    }

    function sizeLabel(icon, embedded) {
        if (formatOf(icon) === 'svg') return 'SVG';
        var layers = layersOf(icon, embedded);
        if (!layers.length) return 'Size unknown';
        var seen = {};
        var parts = [];
        layers.forEach(function (layer) {
            var label = layer.width + '×' + layer.height;
            if (!seen[label]) {
                seen[label] = true;
                parts.push(label);
            }
        });
        return parts.join(', ');
    }

    function check(id, label, status, detail, links) {
        return {
            id: id,
            label: label,
            status: status,
            detail: detail,
            snippet: status === 'present' ? '' : (SNIPPETS[id] || ''),
            links: links
        };
    }

    function sizeDetail(side, hits, embedded, icoPresent) {
        var inIco = hits.some(isIco);
        var asPng = hits.some(function (icon) { return !isIco(icon) && formatOf(icon) === 'png'; });
        if (inIco && asPng) return side + '×' + side + ' PNG, and the same layer inside favicon.ico.';
        if (inIco) return side + '×' + side + ' layer inside favicon.ico.';
        if (asPng) return side + '×' + side + ' PNG.';
        if (hits.length) return side + '×' + side + ' image.';
        if (icoPresent) return 'favicon.ico is present, but it has no ' + side + '×' + side + ' layer. Add that layer, or publish a PNG.';
        return 'No ' + side + '×' + side + ' file. Browsers and Google look for this size on its own, not inside a larger icon.';
    }

    function analyze(data, options) {
        if (!data || data.ok === false) return null;
        var embedded = (options && options.icoSizes) || {};
        var icons = collectIcons(data);
        var site = siteIcons(icons);
        var fallback = site.length === 0;
        var ico = site.filter(isIco);
        var icoPresent = ico.length > 0;

        function raster(side, id, label, links) {
            var hits = sizeHits(site, side, embedded);
            var status = hits.length ? 'present' : 'missing';
            return check(id, label, status, sizeDetail(side, hits, embedded, icoPresent), links);
        }

        var touch = site.filter(isApple);
        var touch180 = touch.filter(function (icon) {
            return layersOf(icon, embedded).some(function (layer) { return layer.width === 180 && layer.height === 180; });
        });
        var any180 = sizeHits(site, 180, embedded);
        var appleStatus = 'missing';
        var appleDetail = 'iOS home-screen shortcuts use a 180×180 PNG linked as apple-touch-icon. The tab icon is not reused.';
        if (touch180.length) {
            appleStatus = 'present';
            appleDetail = '180×180 apple-touch icon.';
        } else if (touch.length) {
            appleStatus = 'partial';
            appleDetail = 'An apple-touch icon was found, but not at 180×180. Current iPhone and iPad home screens use 180×180.';
        } else if (any180.length) {
            appleStatus = 'partial';
            appleDetail = 'A 180×180 image was found, but it is not linked as apple-touch-icon. Add the link tag so iOS can find it.';
        }

        var manifestHits = site.filter(isManifest);
        var svgHits = site.filter(isSvgColor);
        var fileLinks = [LINKS.tools, LINKS.ico, LINKS.png, LINKS.sizes];
        var checks = [
            check('ico', 'favicon.ico', icoPresent ? 'present' : 'missing', icoPresent ? 'A favicon.ico file was found. Browsers still request this path.' : 'Browsers still request /favicon.ico. Put 16×16, 32×32 and 48×48 in one file at the site root.', fileLinks),
            raster(16, 'png16', '16×16', fileLinks),
            raster(32, 'png32', '32×32', fileLinks),
            raster(48, 'png48', '48×48', fileLinks),
            check('apple', 'Apple touch icon, 180×180', appleStatus, appleDetail, [LINKS.tools, LINKS.apple, LINKS.sizes]),
            check('manifest', 'Web manifest icons', manifestHits.length ? 'present' : 'missing', manifestHits.length ? 'At least one icon comes from a web app manifest.' : 'Android and installed web apps read 192×192 and 512×512 from a manifest, not from the tab icon.', [LINKS.tools, LINKS.manifest, LINKS.sizes]),
            raster(192, 'png192', '192×192', [LINKS.tools, LINKS.manifest, LINKS.sizes]),
            raster(512, 'png512', '512×512', [LINKS.tools, LINKS.manifest, LINKS.sizes]),
            check('svg', 'SVG favicon', svgHits.length ? 'present' : 'missing', svgHits.length ? 'A color SVG favicon was found. It stays sharp in the tab.' : 'An SVG stays sharp in the tab. Keep a PNG as well: Google Search does not use SVG as the only icon. A Safari mask-icon does not count as this file.', [LINKS.tools, LINKS.svg, LINKS.sizes])
        ];

        if (fallback) {
            checks.forEach(function (item) {
                item.status = 'missing';
                item.snippet = SNIPPETS[item.id] || '';
                item.detail = 'No icon file on this site was verified. A fallback image is not one of the site\'s files, so this size still needs to be published.';
            });
        }

        var presentCount = checks.filter(function (item) { return item.status === 'present'; }).length;
        var fixLines = [];
        checks.forEach(function (item) {
            if (item.status !== 'present' && item.snippet && item.id !== 'png192' && item.id !== 'png512') fixLines.push(item.snippet);
        });
        var needsManifest = checks.some(function (item) {
            return item.status !== 'present' && (item.id === 'manifest' || item.id === 'png192' || item.id === 'png512');
        });

        return {
            domain: data.domain || hostOf(normalizeSiteTarget(data.pageUrl || '')) || '',
            pageUrl: httpUrl(data.pageUrl || ''),
            fallback: fallback,
            notice: fallback ? 'The extractor found no usable image on the site, so the preview is a Google or DuckDuckGo fallback. Every standard size below is missing until the site publishes its own files.' : '',
            icons: icons.map(function (icon) {
                return {
                    url: httpUrl(icon.url || ''),
                    proxyPath: proxyPath(icon.proxyUrl || ''),
                    format: formatOf(icon) || 'image',
                    rel: icon.rel || '',
                    source: icon.source || '',
                    sourceLabel: sourceLabel(icon),
                    sizeLabel: sizeLabel(icon, embedded),
                    fallback: isAggregator(icon)
                };
            }),
            checks: checks,
            presentCount: presentCount,
            total: checks.length,
            fixHtml: fixLines.join('\n'),
            fixManifest: needsManifest ? MANIFEST_JSON : '',
            related: [LINKS.tools, LINKS.bulk, LINKS.ico, LINKS.png, LINKS.jpg, LINKS.svg, LINKS.sizes, LINKS.index, LINKS.apple, LINKS.manifest]
        };
    }

    function loadIcoSizes(data, fetchImpl) {
        var fetchFn = fetchImpl || (typeof fetch === 'function' ? fetch : null);
        var icons = siteIcons(collectIcons(data || {})).filter(isIco);
        var jobs = icons.map(function (icon) {
            var path = proxyPath(icon.proxyUrl || '');
            if (!path || !icon.url || !fetchFn) return Promise.resolve(null);
            return Promise.resolve()
                .then(function () { return fetchFn(path); })
                .then(function (res) {
                    if (!res || !res.ok || !res.arrayBuffer) return null;
                    return res.arrayBuffer();
                })
                .then(function (buf) {
                    if (!buf) return null;
                    var sizes = readIcoSizes(new Uint8Array(buf));
                    return sizes.length ? { url: icon.url, sizes: sizes } : null;
                })
                .catch(function () { return null; });
        });
        return Promise.all(jobs).then(function (rows) {
            var out = {};
            rows.forEach(function (row) {
                if (row) out[row.url] = row.sizes;
            });
            return out;
        });
    }

    return {
        CHECK_IDS: CHECK_IDS,
        LINKS: LINKS,
        SNIPPETS: SNIPPETS,
        MANIFEST_JSON: MANIFEST_JSON,
        normalizeSiteTarget: normalizeSiteTarget,
        failureReason: failureReason,
        canonicalExtractPath: canonicalExtractPath,
        isIco: isIco,
        proxyPath: proxyPath,
        readIcoSizes: readIcoSizes,
        httpUrl: httpUrl,
        analyze: analyze,
        loadIcoSizes: loadIcoSizes
    };
});
