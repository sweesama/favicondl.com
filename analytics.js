/**
 * GA4 custom-event helper for favicondl.com (measurement ID G-7QLC8QV609).
 *
 * The page snippet already defines window.gtag and loads gtag.js. This file
 * does not inject a tag, read cookies, or change the UI. It only forwards
 * custom events through that existing gtag function.
 *
 * Safety:
 * - If gtag is missing (ad blocker, snippet removed) or throws, calls no-op.
 * - If this file fails to load, tool code must call window.favicondlTrack
 *   with optional chaining (or the trackEvent wrappers in main.js / tools.js)
 *   so downloads and copy buttons keep working.
 * - Consent: the site has no consent banner. gtag('config') already runs on
 *   every page. Calling gtag('event', ...) goes through the same function, so
 *   Google Consent Mode (if added later) still applies — do not push events
 *   straight onto dataLayer. A future opt-out can set
 *   window.favicondlAnalyticsDisabled = true before this script runs.
 *
 * Events (mark favicon_download and copy_api as Key Events in GA Admin):
 * - favicon_download — a file or ZIP was actually handed to the browser.
 * - copy_api — a documentation copy button wrote an API URL or code sample.
 * - copy_snippet — homepage HTML snippet or direct icon URL was copied.
 *
 * Adding a tool: after the action succeeds (not on click, not on failure),
 * call window.favicondlTrack from the shared script (main.js or tools.js).
 * Load this file synchronously before that script on any new HTML page.
 * page_type and page_lang are added here from the URL, including /zh /ja /ko /es.
 */
(function () {
    var EVENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

    function pageContext() {
        var path = '/';
        try {
            path = String(window.location && window.location.pathname || '/');
        } catch (err) {
            path = '/';
        }
        var langMatch = path.match(/^\/(zh|ja|ko|es)(?=\/|$)/);
        var lang = langMatch ? langMatch[1] : 'en';
        var stripped = path.replace(/^\/(zh|ja|ko|es)(?=\/|$)/, '') || '/';
        var file = stripped.split('?')[0].split('#')[0];
        var pageType = 'other';
        if (file === '/' || file === '/index.html') pageType = 'homepage';
        else if (/\/tools\.html$/.test(file)) pageType = 'tools';
        else if (/\/bulk-favicon-downloader\.html$/.test(file)) pageType = 'bulk';
        else if (/\/documentation\.html$/.test(file)) pageType = 'docs';
        return { page_type: pageType, page_lang: lang };
    }

    function cleanParams(params) {
        var clean = {};
        var source = params || {};
        var keys = Object.keys(source);
        for (var i = 0; i < keys.length; i++) {
            var rawKey = keys[i];
            var value = source[rawKey];
            if (value === undefined || value === null || value === '') continue;
            var key = String(rawKey).replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
            if (!key) continue;
            if (typeof value === 'number') {
                if (!isFinite(value)) continue;
                clean[key] = value;
            } else if (typeof value === 'boolean') {
                clean[key] = value ? 'true' : 'false';
            } else {
                clean[key] = String(value).slice(0, 100);
            }
        }
        return clean;
    }

    function favicondlTrack(eventName, params) {
        try {
            if (window.favicondlAnalyticsDisabled === true) return;
            if (typeof window.gtag !== 'function') return;
            if (!EVENT_NAME.test(String(eventName || ''))) return;
            var context = pageContext();
            var payload = cleanParams(params);
            if (!payload.page_type) payload.page_type = context.page_type;
            if (!payload.page_lang) payload.page_lang = context.page_lang;
            window.gtag('event', String(eventName), payload);
        } catch (err) {
            // Analytics must never break a download or a copy.
        }
    }

    window.favicondlTrack = favicondlTrack;
})();
