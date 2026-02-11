/**
 * Mzu favicondl - 即时网站图标获取器
 * 主页核心功能模块
 * 
 * 功能：
 * - 多源Favicon获取（Google、DuckDuckGo、直接获取）
 * - 实时预览
 * - 多格式下载
 * - 中英文切换
 */

class FaviconTool {
    constructor() {
        this.currentDomain = '';
        this.currentSize = 32;
        this.currentLang = this.loadSavedLanguage();
        this.faviconCache = new Map(); // 缓存已获取的favicon
        this.workerBaseUrl = this.initWorkerBaseUrl();
        this.fetchSeq = 0;
        this.init();
    }

    loadSavedLanguage() {
        const SUPPORTED = ['en', 'zh', 'ja', 'ko', 'es'];
        // 1. 优先从 URL 路径检测语言（/zh/、/ja/ 等）
        try {
            const pathMatch = window.location.pathname.match(/^\/(zh|ja|ko|es)(\/|$)/);
            if (pathMatch) return pathMatch[1];
        } catch {}
        // 2. 查询参数（兼容旧链接）
        try {
            const url = new URL(window.location.href);
            const fromQuery = String(url.searchParams.get('lang') || '').trim();
            if (SUPPORTED.includes(fromQuery)) return fromQuery;
        } catch {}
        // 3. localStorage
        const STORAGE_KEY = 'mzu_favicondl_lang';
        try {
            const saved = String(localStorage.getItem(STORAGE_KEY) || '').trim();
            if (saved === 'zh' || saved === 'en') return saved;
        } catch {}
        return 'en';
    }

    // 全局点击拦截器（URL 路由模式下已不需要加 ?lang= 参数）
    setupLangInterceptor() {
        // 如果当前在语言子目录（/zh/、/ja/ 等），不再拦截链接
        // 因为链接已经是正确的 URL 路由形式
        if (/^\/(zh|ja|ko|es)(\/|$)/.test(window.location.pathname)) return;
        // 仅对英文根页面保留旧的 ?lang= 兼容逻辑
        document.addEventListener('click', (e) => {
            const a = e.target.closest('a[href]');
            if (!a) return;
            const href = a.getAttribute('href') || '';
            if (!href || href.startsWith('#')) return;
            if (/^(https?:|mailto:|javascript:)/i.test(href)) return;
            if (!/\.html(\?|#|$)/i.test(href)) return;

            e.preventDefault();
            try {
                const url = new URL(href, window.location.href);
                url.searchParams.set('lang', this.currentLang);
                try {
                    const w = new URL(window.location.href).searchParams.get('worker');
                    if (w) url.searchParams.set('worker', w);
                } catch {}
                window.location.href = url.href;
            } catch {
                window.location.href = a.href;
            }
        });
    }

    // 更新语言下拉菜单的显示状态
    updateLangDropdown() {
        const isZh = this.currentLang === 'zh';
        const FLAG_US = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1fa-1f1f8.svg';
        const FLAG_CN = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1e8-1f1f3.svg';
        document.querySelectorAll('.lang-flag').forEach(el => {
            el.src = isZh ? FLAG_CN : FLAG_US;
        });
        document.querySelectorAll('.lang-option').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === this.currentLang);
        });
        document.querySelectorAll('.lang-mobile-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.lang === this.currentLang);
        });
    }

    saveLanguagePreference() {
        const STORAGE_KEY = 'mzu_favicondl_lang';
        try {
            localStorage.setItem(STORAGE_KEY, this.currentLang);
        } catch {
        }
    }

    init() {
        this.bindEvents();
        this.updateLanguage();
        this.updateLangDropdown();
        this.setupLangInterceptor();
        window.faviconTool = this;
    }

    initWorkerBaseUrl() {
        const STORAGE_KEY = 'mzu_favicondl_worker_base';
        const DEFAULT_WORKER_BASE = 'https://icy-glade-6d04favicon.sweeyeah.workers.dev';

        try {
            const url = new URL(window.location.href);
            const fromQuery = (url.searchParams.get('worker') || '').trim();
            if (fromQuery) {
                if (/^(off|0|false)$/i.test(fromQuery)) {
                    try {
                        localStorage.removeItem(STORAGE_KEY);
                    } catch {
                    }
                    return '';
                }
                const normalized = this.normalizeWorkerBaseUrl(fromQuery);
                if (normalized) {
                    localStorage.setItem(STORAGE_KEY, normalized);
                    return normalized;
                }
            }
        } catch {
        }

        try {
            const saved = (localStorage.getItem(STORAGE_KEY) || '').trim();
            const normalizedSaved = this.normalizeWorkerBaseUrl(saved);
            if (normalizedSaved) return normalizedSaved;
        } catch {
        }

        return this.normalizeWorkerBaseUrl(DEFAULT_WORKER_BASE);
    }

    normalizeWorkerBaseUrl(value) {
        const s = String(value || '').trim();
        if (!s) return '';
        try {
            const u = new URL(s);
            u.hash = '';
            u.search = '';
            u.pathname = '';
            return u.toString().replace(/\/$/, '');
        } catch {
            return '';
        }
    }

    async fetchJsonWithTimeout(url, timeoutMs = 8000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    async fetchFaviconViaWorker(domain, size) {
        const base = this.workerBaseUrl;
        if (!base) return null;
        const sz = typeof size === 'number' ? size : 128;
        const url = `${base}/api/favicon?domain=${encodeURIComponent(domain)}&size=${encodeURIComponent(sz)}`;
        const data = await this.fetchJsonWithTimeout(url, 8000);
        if (!data || !data.ok) return null;
        return data;
    }

    // ==================== 事件绑定 ====================
    bindEvents() {
        // 域名输入
        const domainInput = document.getElementById('domain-input');
        if (domainInput) {
            // 使用防抖处理输入
            let debounceTimer;
            domainInput.addEventListener('input', (e) => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => this.handleDomainInput(e, false), 300);
            });
            domainInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    clearTimeout(debounceTimer);
                    this.handleDomainInput(e, true);
                }
            });
        }

        // 尺寸选择
        document.querySelectorAll('input[name="size"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.currentSize = Number(e.target.value) || 32;
                if (this.currentDomain) {
                    this.fetchFavicon();
                }
            });
        });

        // 复制按钮
        document.getElementById('copy-url-btn')?.addEventListener('click', () => {
            const url = document.getElementById('api-url')?.textContent;
            if (url) this.copyToClipboard(url);
        });

        document.getElementById('copy-html-btn')?.addEventListener('click', () => {
            const html = document.getElementById('html-code')?.textContent;
            if (html) this.copyToClipboard(html);
        });

        // 下载和重置按钮
        document.getElementById('download-btn')?.addEventListener('click', () => this.downloadFavicon());
        document.getElementById('new-search-btn')?.addEventListener('click', () => this.resetForm());

        // 移动端菜单
        document.getElementById('mobile-menu-button')?.addEventListener('click', () => {
            document.getElementById('mobile-menu')?.classList.toggle('hidden');
        });

        // 语言切换
        const langToggle = document.getElementById('lang-toggle');
        const langMenu = document.getElementById('lang-menu');
        if (langToggle && langMenu) {
            langToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                langMenu.classList.toggle('show');
            });
            document.addEventListener('click', () => langMenu.classList.remove('show'));
            langMenu.addEventListener('click', (e) => e.stopPropagation());
        }
        document.querySelectorAll('.lang-option, .lang-mobile-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const lang = btn.dataset.lang;
                if (lang) this.setLanguage(lang);
            });
        });
    }

    // ==================== 域名处理 ====================
    handleDomainInput(e, forceRefresh = false) {
        let domain = e.target.value.trim();
        
        // 清理域名格式
        domain = this.cleanDomain(domain);
        
        if (domain && this.isValidDomain(domain)) {
            this.currentDomain = domain;
            this.fetchFavicon(forceRefresh);
        }
    }

    async downloadFirstAvailableBlob(urls, makeTransparent, targetSize) {
        for (const url of urls) {
            try {
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) continue;
                const blob = await response.blob();
                const finalBlob = await this.normalizeIconBlob(blob, makeTransparent, targetSize);
                if (finalBlob) return finalBlob;
            } catch {
            }
        }
        return null;
    }

    async writeBlobToFileHandle(handle, blob) {
        try {
            const writable = await handle.createWritable();
            await writable.write(await blob.arrayBuffer());
            await writable.close();
            return true;
        } catch {
            try {
                const writable = await handle.createWritable();
                await writable.close();
            } catch {
            }
            return false;
        }
    }

    cleanDomain(domain) {
        // 移除协议前缀
        domain = domain.replace(/^https?:\/\//i, '');
        // 移除www前缀（可选）
        domain = domain.replace(/^www\./, '');
        // 移除路径
        domain = domain.split('/')[0];
        // 移除端口
        domain = domain.split(':')[0];
        return domain.toLowerCase();
    }

    isValidDomain(domain) {
        // 简单的域名验证
        if (!domain || domain.length < 3) return false;
        if (!domain.includes('.')) return false;
        // 基本格式检查
        const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
        return domainRegex.test(domain);
    }

    // ==================== Favicon 获取 ====================
    
    /**
     * 获取Favicon的多个来源
     * 按优先级尝试不同的服务
     */
    getFaviconSources(domain, size, requestedSz) {
        const base = typeof size === 'number' ? size : 32;
        const sz = typeof requestedSz === 'number' ? requestedSz : base;
        return [
            // Google Favicon服务 - 最可靠
            `https://www.google.com/s2/favicons?domain=${domain}&sz=${sz}`,
            `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(`https://${domain}`)}&sz=${sz}`,
            `https://www.google.com/s2/favicons?domain_url=${encodeURIComponent(`http://${domain}`)}&sz=${sz}`,
            // DuckDuckGo - 备选
            `https://icons.duckduckgo.com/ip3/${domain}.ico`,
            // 直接获取网站favicon
            `https://${domain}/favicon.ico`,
            `https://${domain}/favicon.png`,
            `https://${domain}/apple-touch-icon.png`,
            `https://${domain}/apple-touch-icon-precomposed.png`,
            `https://${domain}/android-chrome-192x192.png`,
            `https://${domain}/android-chrome-512x512.png`,
            `http://${domain}/favicon.ico`,
            `http://${domain}/favicon.png`,
            `http://${domain}/apple-touch-icon.png`,
            `http://${domain}/apple-touch-icon-precomposed.png`,
            `http://${domain}/android-chrome-192x192.png`,
            `http://${domain}/android-chrome-512x512.png`,
            // 使用t3.gstatic.com（Google另一个服务）
            `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=${sz}`,
            `https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://${domain}&size=${sz}`
        ];
    }

    withCacheBust(url) {
        try {
            const u = new URL(url);
            u.searchParams.set('v', String(Date.now()));
            return u.toString();
        } catch {
            const sep = url.includes('?') ? '&' : '?';
            return `${url}${sep}v=${Date.now()}`;
        }
    }

    getDomainVariants(domain) {
        const d = String(domain || '').trim();
        if (!d) return [];
        const variants = [d];
        if (!d.startsWith('www.')) {
            variants.push(`www.${d}`);
        }
        return Array.from(new Set(variants));
    }

    async fetchTextThroughJina(targetUrl) {
        try {
            const url = `https://r.jina.ai/${targetUrl}`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) return '';
            return await res.text();
        } catch {
            return '';
        }
    }

    async fetchTextThroughAllOrigins(targetUrl) {
        try {
            const url = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(url, { cache: 'no-store', signal: controller.signal });
            clearTimeout(timer);

            if (!res.ok) return '';
            const data = await res.json();
            return typeof data?.contents === 'string' ? data.contents : '';
        } catch {
            return '';
        }
    }

    async fetchPageHtmlViaProxy(pageUrl) {
        const html = await this.fetchTextThroughAllOrigins(pageUrl);
        if (html) return html;
        return await this.fetchTextThroughJina(pageUrl);
    }

    extractIconUrlsFromHtml(html, baseUrl) {
        const out = [];
        const add = (u) => {
            try {
                const abs = new URL(u, baseUrl).toString();
                out.push(abs);
            } catch {
            }
        };

        const linkTagRegex = /<link\b[^>]*>/gi;
        const relRegex = /\brel\s*=\s*(["'])(.*?)\1/i;
        const hrefRegex = /\bhref\s*=\s*(["'])(.*?)\1/i;

        for (const tag of html.match(linkTagRegex) || []) {
            const relMatch = tag.match(relRegex);
            const hrefMatch = tag.match(hrefRegex);
            if (!relMatch || !hrefMatch) continue;
            const rel = String(relMatch[2] || '').toLowerCase();
            if (!rel.includes('icon')) continue;
            add(hrefMatch[2]);
        }

        const metaTagRegex = /<meta\b[^>]*>/gi;
        const propRegex = /\bproperty\s*=\s*(["'])(.*?)\1/i;
        const contentRegex = /\bcontent\s*=\s*(["'])(.*?)\1/i;

        for (const tag of html.match(metaTagRegex) || []) {
            const propMatch = tag.match(propRegex);
            const contentMatch = tag.match(contentRegex);
            if (!propMatch || !contentMatch) continue;
            const prop = String(propMatch[2] || '').toLowerCase();
            if (prop === 'og:image') {
                add(contentMatch[2]);
            }
        }

        return Array.from(new Set(out));
    }

    async discoverIconUrlsFromSite(domain) {
        const candidates = [];
        const pages = [`https://${domain}/`, `http://${domain}/`];
        for (const pageUrl of pages) {
            const html = await this.fetchPageHtmlViaProxy(pageUrl);
            if (!html) continue;
            const found = this.extractIconUrlsFromHtml(html, pageUrl);
            for (const u of found) candidates.push(u);
        }
        return Array.from(new Set(candidates));
    }

    async resolveFirstFaviconUrl(domain, size, forceRefresh) {
        const requestedSize = typeof size === 'number' ? size : 32;
        const fetchSz = Math.min(512, Math.max(64, requestedSize * 4));

        const domains = this.getDomainVariants(domain);

        let workerLowQualityFallback = '';

        for (const d of domains) {
            const workerData = await this.fetchFaviconViaWorker(d, fetchSz);
            if (workerData?.proxyUrl) {
                if (String(workerData.source || '').toLowerCase() === 'google_s2') {
                    workerLowQualityFallback = workerLowQualityFallback || workerData.proxyUrl;
                } else {
                    return forceRefresh ? this.withCacheBust(workerData.proxyUrl) : workerData.proxyUrl;
                }
            }
            if (workerData?.iconUrl) {
                if (String(workerData.source || '').toLowerCase() === 'google_s2') {
                    workerLowQualityFallback = workerLowQualityFallback || workerData.iconUrl;
                } else {
                    return forceRefresh ? this.withCacheBust(workerData.iconUrl) : workerData.iconUrl;
                }
            }
        }

        const discoveredPromise = Promise.all(domains.map((d) => this.discoverIconUrlsFromSite(d)))
            .then((arr) => Array.from(new Set(arr.flat())))
            .catch(() => []);

        const allSources = Array.from(
            new Set(
                domains.flatMap((d) => {
                    const sourcesHi = this.getFaviconSources(d, size, fetchSz);
                    const sourcesLo = this.getFaviconSources(d, size, requestedSize);
                    return [...sourcesHi, ...sourcesLo];
                })
            )
        );

        const isAggregator = (u) =>
            u.includes('www.google.com/s2/favicons') ||
            u.includes('icons.duckduckgo.com/ip3/') ||
            u.includes('t3.gstatic.com/faviconV2');

        const primarySources = allSources.filter((u) => !isAggregator(u));
        const aggregatorSources = allSources.filter((u) => isAggregator(u));

        const maxPrimaryTries = 18;
        let tries = 0;

        for (const url of primarySources) {
            if (tries >= maxPrimaryTries) break;
            tries++;
            try {
                await this.preloadImageWithTimeout(url, 2500);
                return url;
            } catch {
            }
        }

        const discovered = await discoveredPromise;
        if (discovered.length) {
            const discoveredToTry = discovered.flatMap((u) => {
                const out = [];
                out.push(forceRefresh ? this.withCacheBust(u) : u);
                out.push(this.buildProxyUrl(u));
                out.push(forceRefresh ? this.withCacheBust(this.buildProxyUrl(u)) : this.buildProxyUrl(u));
                return out;
            });

            for (const url of discoveredToTry) {
                try {
                    await this.preloadImageWithTimeout(url, 2500);
                    return url;
                } catch {
                }
            }
        }

        const maxFallbackTries = 12;
        let ftries = 0;
        for (const url of toTry(fallbackSources)) {
            if (ftries >= maxFallbackTries) break;
            ftries++;
            try {
                await this.preloadImageWithTimeout(url, 2500);
                return url;
            } catch {
            }
        }

        for (const url of aggregatorSources) {
            const ok = await this.preloadImageWithTimeout(forceRefresh ? this.withCacheBust(url) : url, 1500);
            if (ok) return forceRefresh ? this.withCacheBust(url) : url;
            const okProxy = await this.preloadImageWithTimeout(
                forceRefresh ? this.withCacheBust(this.buildProxyUrl(url)) : this.buildProxyUrl(url),
                1500
            );
            if (okProxy) return forceRefresh ? this.withCacheBust(this.buildProxyUrl(url)) : this.buildProxyUrl(url);
        }

        if (workerLowQualityFallback) {
            return forceRefresh ? this.withCacheBust(workerLowQualityFallback) : workerLowQualityFallback;
        }

        return null;
    }

    async fetchFavicon(forceRefresh = false) {
        if (!this.currentDomain) return;

        this.showLoading(false);
        this.hideError();

        // 检查缓存
        const cacheKey = `${this.currentDomain}-${this.currentSize}`;
        if (!forceRefresh && this.faviconCache.has(cacheKey)) {
            this.showPreview(this.faviconCache.get(cacheKey));
            this.showLoading(false);
            return;
        }

        const seq = ++this.fetchSeq;
        const quickUrl = this.getQuickFaviconUrl(this.currentDomain, this.currentSize);
        this.showPreview(quickUrl);

        try {
            const faviconUrl = await this.resolveFirstFaviconUrl(this.currentDomain, this.currentSize, forceRefresh);
            if (seq !== this.fetchSeq) return;

            if (!faviconUrl) {
                this.showError(
                    this.currentLang === 'zh'
                        ? '未能获取该网站的图标。可能原因：网站未提供 favicon、或被第三方服务缓存/屏蔽。你可以稍后再试，或尝试只输入主域名（如 example.com）。'
                        : 'Unable to fetch this site\'s favicon. The site may not provide one, or it may be blocked/cached by third-party services. Try again later or use the root domain (e.g. example.com).'
                );
                return;
            }

            this.faviconCache.set(cacheKey, faviconUrl);
            if (this.isAggregatorUrl(faviconUrl) && !this.isAggregatorUrl(quickUrl)) {
                return;
            }
            if (faviconUrl !== quickUrl) {
                this.showPreview(faviconUrl);
            }
        } catch {
        }
    }

    preloadImage(url, useCors = false) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            // 只有在需要Canvas操作时才设置crossOrigin
            if (useCors) {
                img.crossOrigin = 'anonymous';
            }
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Image load failed'));
            img.src = url;
        });
    }

    preloadImageWithTimeout(url, timeoutMs = 2500) {
        return new Promise((resolve, reject) => {
            let done = false;
            const img = new Image();

            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                try {
                    img.src = '';
                } catch {
                }
                reject(new Error('Image load timeout'));
            }, timeoutMs);

            img.onload = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(img);
            };
            img.onerror = () => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                reject(new Error('Image load failed'));
            };
            img.src = url;
        });
    }

    buildFaviconUrl(domain, size) {
        const sz = typeof size === 'number' ? size : 32;
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=${sz}`;
    }

    getQuickFaviconUrl(domain, size) {
        const sz = typeof size === 'number' ? size : 32;
        const normalized = this.cleanDomain(domain);

        const builtin = {
            'chatgpt.com': 'https://chatgpt.com/cdn/assets/favicon-eex17e9e.ico',
        };

        if (normalized && builtin[normalized]) {
            return builtin[normalized];
        }

        try {
            const raw = localStorage.getItem('mzu_favicondl_favicon_overrides') || '';
            const overrides = raw ? JSON.parse(raw) : null;
            const hit = overrides && normalized && overrides[normalized];
            if (hit) {
                return String(hit);
            }
        } catch {
        }

        return this.buildFaviconUrl(normalized || domain, sz);
    }

    isAggregatorUrl(u) {
        const s = String(u || '');
        return (
            s.includes('www.google.com/s2/favicons') ||
            s.includes('icons.duckduckgo.com/ip3/') ||
            s.includes('t3.gstatic.com/faviconV2')
        );
    }

    // ==================== 预览显示 ====================
    showPreview(faviconUrl) {
        const previewSection = document.getElementById('preview-section');
        const previewIcon = document.getElementById('preview-icon');
        const previewDomain = document.getElementById('preview-domain');
        const apiUrl = document.getElementById('api-url');
        const htmlCode = document.getElementById('html-code');

        if (!previewSection) return;

        // 更新预览图标
        if (previewIcon) {
            previewIcon.src = faviconUrl;
            previewIcon.alt = `${this.currentDomain} favicon`;
        }
        
        if (previewDomain) {
            previewDomain.textContent = this.currentDomain;
        }

        // 生成显示用的URL（使用Google服务的直接链接）
        const displayUrl = faviconUrl;
        if (apiUrl) apiUrl.textContent = displayUrl;

        // 生成HTML代码
        if (htmlCode) {
            const targetSize = typeof this.currentSize === 'number' ? this.currentSize : 32;
            const html = `<img src="${displayUrl}" alt="${this.currentDomain} favicon" width="${targetSize}" height="${targetSize}" />`;
            htmlCode.textContent = html;
        }

        // 显示预览区域
        previewSection.classList.remove('hidden');
        previewSection.classList.add('fade-in');
    }

    // ==================== 下载功能 ====================
    async downloadFavicon() {
        if (!this.currentDomain) return;

        const requestedSize = typeof this.currentSize === 'number' ? this.currentSize : 32;
        const makeTransparent = this.isTransparentBackgroundEnabled();
        const downloadMode = this.getDownloadMode();
        const forceExportSize = this.isExportSizeEnabled();
        const exportSize = forceExportSize ? requestedSize : null;

        const filename = forceExportSize
            ? `${this.currentDomain}-favicon-${requestedSize}x${requestedSize}.png`
            : `${this.currentDomain}-favicon-original.png`;

        const fetchSz = Math.min(512, Math.max(64, requestedSize * 4));

        this.setDownloadButtonLoading(true);

        try {
            const workerData = await this.fetchFaviconViaWorker(this.currentDomain, fetchSz);
            if (workerData?.proxyUrl) {
                const ok = await this.tryDownloadFromUrl(workerData.proxyUrl, filename, makeTransparent, exportSize);
                if (ok) return;
            }
            if (workerData?.iconUrl) {
                const ok = await this.tryDownloadFromUrl(workerData.iconUrl, filename, makeTransparent, exportSize);
                if (ok) return;
            }

            const sourcesHi = this.getFaviconSources(this.currentDomain, this.currentSize, fetchSz);
            const sourcesLo = this.getFaviconSources(this.currentDomain, this.currentSize, requestedSize);
            const sources = Array.from(new Set([...sourcesHi, ...sourcesLo]));
            const proxiedSources = sources.map(u => this.buildProxyUrl(u));
            const allSources = [...sources, ...proxiedSources];

            if (downloadMode === 'saveas' && this.supportsSaveFilePicker()) {
                const blobPromise = this.downloadFirstAvailableBlob(allSources, makeTransparent, exportSize);
                const handle = await this.openSaveFilePicker(filename);
                if (!handle) return;

                const finalBlob = await blobPromise;
                if (!finalBlob) return;

                const ok = await this.writeBlobToFileHandle(handle, finalBlob);
                if (ok) {
                    this.showToast(
                        this.currentLang === 'zh'
                            ? '已保存。注意：浏览器不允许网页读取你保存到的本地路径。'
                            : 'Saved. Note: browsers do not allow web pages to read the local save path.'
                    );
                    return;
                }
            } else {
                for (const url of allSources) {
                    const ok = await this.tryDownloadFromUrl(url, filename, makeTransparent, exportSize);
                    if (ok) return;
                }
            }

            this.showToast(
                this.currentLang === 'zh'
                    ? '浏览器安全限制导致无法自动下载。请在预览图标上右键 -> “图片另存为”。'
                    : 'Browser security blocked direct download. Please right-click the preview icon and choose “Save image as…”.'
            );
        } finally {
            this.setDownloadButtonLoading(false);
        }
    }

    async tryDownloadFromUrl(url, filename, makeTransparent, targetSize) {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) return false;

            const blob = await response.blob();
            const finalBlob = await this.normalizeIconBlob(blob, makeTransparent, targetSize);
            if (!finalBlob) return false;

            const blobUrl = URL.createObjectURL(finalBlob);
            this.triggerDownload(blobUrl, filename);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 300);
            this.showToast(
                this.currentLang === 'zh'
                    ? '已保存。注意：浏览器不允许网页读取你保存到的本地路径。'
                    : 'Saved. Note: browsers do not allow web pages to read the local save path.'
            );
            return true;
        } catch {
            return false;
        }
    }

    async normalizeIconBlob(blob, makeTransparent, targetSize) {
        try {
            const bitmap = await this.createBitmapFromBlob(blob);
            if (!bitmap) return null;

            const srcCanvas = document.createElement('canvas');
            srcCanvas.width = bitmap.width;
            srcCanvas.height = bitmap.height;
            const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
            srcCtx.imageSmoothingEnabled = true;
            srcCtx.imageSmoothingQuality = 'high';
            srcCtx.drawImage(bitmap, 0, 0);

            if (makeTransparent) {
                const imageData = srcCtx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
                const hasAlpha = this.imageHasTransparency(imageData);
                if (!hasAlpha) {
                    const bg = this.pickBackgroundColor(imageData);
                    this.makeBackgroundTransparent(imageData, bg);
                    srcCtx.putImageData(imageData, 0, 0);
                }
            }

            const outSize = typeof targetSize === 'number' && targetSize > 0 ? targetSize : srcCanvas.width;
            let outCanvas = srcCanvas;
            if (srcCanvas.width !== outSize || srcCanvas.height !== outSize) {
                const resized = document.createElement('canvas');
                resized.width = outSize;
                resized.height = outSize;
                const rctx = resized.getContext('2d', { willReadFrequently: true });
                rctx.imageSmoothingEnabled = true;
                rctx.imageSmoothingQuality = 'high';
                rctx.clearRect(0, 0, outSize, outSize);
                rctx.drawImage(srcCanvas, 0, 0, outSize, outSize);
                outCanvas = resized;
            }

            const out = await new Promise((resolve) => outCanvas.toBlob(resolve, 'image/png'));
            return out || null;
        } catch {
            return null;
        }
    }

    supportsSaveFilePicker() {
        return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function';
    }

    getDownloadMode() {
        const checked = document.querySelector('input[name="download-mode"]:checked');
        return checked?.value || 'saveas';
    }

    async openSaveFilePicker(filename) {
        try {
            return await window.showSaveFilePicker({
                suggestedName: filename,
                types: [
                    {
                        description: 'PNG Image',
                        accept: { 'image/png': ['.png'] }
                    }
                ]
            });
        } catch {
            return null;
        }
    }

    async tryDownloadToFileHandle(url, handle, makeTransparent) {
        try {
            const response = await fetch(url, { cache: 'no-store' });
            if (!response.ok) return false;

            const blob = await response.blob();
            const finalBlob = await this.normalizeIconBlob(blob, makeTransparent);
            if (!finalBlob) return false;

            const writable = await handle.createWritable();
            await writable.write(await finalBlob.arrayBuffer());
            await writable.close();
            return true;
        } catch {
            try {
                const writable = await handle.createWritable();
                await writable.close();
            } catch {
            }
            return false;
        }
    }

    isTransparentBackgroundEnabled() {
        const el = document.getElementById('transparent-bg-toggle');
        return !!el && !!el.checked;
    }

    isExportSizeEnabled() {
        const el = document.getElementById('export-size-toggle');
        return !!el && !!el.checked;
    }

    async createBitmapFromBlob(blob) {
        if (typeof createImageBitmap === 'function') {
            try {
                return await createImageBitmap(blob);
            } catch {
            }
        }

        return await new Promise((resolve) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth || img.width;
                canvas.height = img.naturalHeight || img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);
                resolve(canvas);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                resolve(null);
            };
            img.src = url;
        });
    }

    imageHasTransparency(imageData) {
        const data = imageData.data;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] !== 255) return true;
        }
        return false;
    }

    pickBackgroundColor(imageData) {
        const { width, height, data } = imageData;
        const step = Math.max(1, Math.floor(Math.min(width, height) / 24));
        const buckets = new Map();

        const add = (x, y) => {
            const idx = (y * width + x) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const key = `${r >> 4},${g >> 4},${b >> 4}`;
            buckets.set(key, (buckets.get(key) || 0) + 1);
        };

        for (let x = 0; x < width; x += step) {
            add(x, 0);
            add(x, height - 1);
        }
        for (let y = 0; y < height; y += step) {
            add(0, y);
            add(width - 1, y);
        }

        let bestKey = '15,15,15';
        let bestCount = -1;
        for (const [k, c] of buckets.entries()) {
            if (c > bestCount) {
                bestCount = c;
                bestKey = k;
            }
        }
        const [qr, qg, qb] = bestKey.split(',').map(Number);
        return { r: (qr << 4) + 8, g: (qg << 4) + 8, b: (qb << 4) + 8 };
    }

    makeBackgroundTransparent(imageData, bg) {
        const data = imageData.data;

        const t1 = 16;
        const t2 = 64;
        const t1Sq = t1 * t1;
        const t2Sq = t2 * t2;

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];

            const dr = r - bg.r;
            const dg = g - bg.g;
            const db = b - bg.b;
            const d2 = dr * dr + dg * dg + db * db;

            if (d2 <= t1Sq) {
                data[i + 3] = 0;
            } else if (d2 <= t2Sq) {
                const d = Math.sqrt(d2);
                data[i + 3] = Math.round(255 * (d - t1) / (t2 - t1));
            }

            const a = data[i + 3];
            if (a > 0 && a < 255) {
                const af = a / 255;
                data[i] = Math.max(0, Math.min(255, Math.round((r - bg.r * (1 - af)) / af)));
                data[i + 1] = Math.max(0, Math.min(255, Math.round((g - bg.g * (1 - af)) / af)));
                data[i + 2] = Math.max(0, Math.min(255, Math.round((b - bg.b * (1 - af)) / af)));
                if (a < 10) data[i + 3] = 0;
            }
        }

        this.denoiseAlpha(imageData);
    }

    denoiseAlpha(imageData) {
        const { width, height, data } = imageData;
        if (!width || !height) return;

        const alpha = new Uint8ClampedArray(width * height);
        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            alpha[p] = data[i + 3];
        }

        const idx = (x, y) => y * width + x;
        const next = new Uint8ClampedArray(alpha);

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const p = idx(x, y);
                const a = alpha[p];
                if (a === 0 || a === 255) continue;

                let transparent = 0;
                let opaque = 0;
                for (let yy = -1; yy <= 1; yy++) {
                    for (let xx = -1; xx <= 1; xx++) {
                        if (xx === 0 && yy === 0) continue;
                        const na = alpha[idx(x + xx, y + yy)];
                        if (na <= 20) transparent++;
                        if (na >= 235) opaque++;
                    }
                }

                if (a < 40 && transparent >= 6) {
                    next[p] = 0;
                } else if (a > 215 && opaque >= 6) {
                    next[p] = 255;
                }
            }
        }

        for (let i = 0, p = 0; i < data.length; i += 4, p++) {
            data[i + 3] = next[p];
        }
    }

    setDownloadButtonLoading(isLoading) {
        const btn = document.getElementById('download-btn');
        if (!btn) return;

        if (!btn.dataset.originalText) {
            btn.dataset.originalText = btn.textContent || '';
        }

        btn.disabled = !!isLoading;
        btn.style.opacity = isLoading ? '0.7' : '';
        btn.style.cursor = isLoading ? 'not-allowed' : '';

        if (isLoading) {
            btn.textContent = this.currentLang === 'zh' ? '下载中…' : 'Downloading…';
        } else {
            btn.textContent = btn.dataset.originalText;
        }
    }

    getFileExtensionFromContentType(contentType) {
        if (contentType.includes('image/png')) return 'png';
        if (contentType.includes('image/jpeg')) return 'jpg';
        if (contentType.includes('image/webp')) return 'webp';
        if (contentType.includes('image/gif')) return 'gif';
        if (contentType.includes('image/svg+xml')) return 'svg';
        if (contentType.includes('image/x-icon') || contentType.includes('image/vnd.microsoft.icon')) return 'ico';
        return '';
    }

    buildProxyUrl(originalUrl) {
        if (this.workerBaseUrl) {
            return `${this.workerBaseUrl}/api/proxy?url=${encodeURIComponent(String(originalUrl))}`;
        }
        const urlWithoutScheme = String(originalUrl).replace(/^https?:\/\//, '');
        return `https://images.weserv.nl/?url=${encodeURIComponent(urlWithoutScheme)}`;
    }

    triggerDownload(url, filename) {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // ==================== 工具方法 ====================
    async copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            this.showToast(this.currentLang === 'zh' ? '复制成功！' : 'Copied!');
        } catch {
            // 降级方案
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            this.showToast(this.currentLang === 'zh' ? '复制成功！' : 'Copied!');
        }
    }

    resetForm() {
        const domainInput = document.getElementById('domain-input');
        const previewSection = document.getElementById('preview-section');
        
        if (domainInput) domainInput.value = '';
        if (previewSection) previewSection.classList.add('hidden');
        
        this.currentDomain = '';
        this.hideError();
        domainInput?.focus();
    }

    showLoading(show) {
        const indicator = document.getElementById('loading-indicator');
        if (indicator) {
            indicator.classList.toggle('hidden', !show);
        }
    }

    showError(message) {
        const errorMessage = document.getElementById('error-message');
        const errorText = document.getElementById('error-text');
        if (errorText) errorText.textContent = message;
        if (errorMessage) errorMessage.classList.remove('hidden');
    }

    hideError() {
        document.getElementById('error-message')?.classList.add('hidden');
    }

    showToast(message) {
        const toast = document.getElementById('success-toast');
        const toastMessage = document.getElementById('toast-message');
        
        if (toastMessage) toastMessage.textContent = message;
        if (toast) {
            toast.style.transform = 'translateX(0)';
            setTimeout(() => {
                toast.style.transform = 'translateX(200%)';
            }, 3000);
        }
    }

    // ==================== 语言切换 ====================
    setLanguage(lang) {
        if (lang !== 'zh' && lang !== 'en') return;
        if (lang === this.currentLang) return;
        this.currentLang = lang;
        this.saveLanguagePreference();
        this.updateLanguage();
        this.updateLangDropdown();
        document.getElementById('lang-menu')?.classList.remove('show');
    }

    updateLanguage() {
        // 对 ja/ko/es 页面，文本已由构建脚本翻译，不需要 JS 覆盖
        if (['ja', 'ko', 'es'].includes(this.currentLang)) return;
        // 仅 en/zh 使用 data 属性切换
        document.querySelectorAll('[data-zh][data-en]').forEach(el => {
            const text = el.getAttribute(`data-${this.currentLang}`);
            if (text) el.textContent = text;
        });
    }

    // 热门网站点击
    selectDomain(domain) {
        const domainInput = document.getElementById('domain-input');
        if (domainInput) {
            domainInput.value = domain;
            this.currentDomain = domain;
            this.fetchFavicon();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }
}

// 初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new FaviconTool());
} else {
    new FaviconTool();
}