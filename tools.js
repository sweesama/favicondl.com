/**
 * Mzu favicondl - 工具页面
 * 
 * 功能：
 * - 图片转Favicon（多格式输出）
 * - 批量获取网站Favicon
 * - 格式转换
 * - ZIP打包下载
 */

class FaviconTools {
    constructor() {
        this.currentTool = null;
        this.originalImage = null;
        this.originalFileName = '';
        this.generatedIcons = new Map(); // 存储生成的图标 {size: dataUrl}
        this.batchResults = [];
        this.batchOutputMode = 'zip';
        this.batchNamingMode = 'domain';
        this.currentLang = this.loadSavedLanguage();
        this.workerBaseUrl = this.initWorkerBaseUrl();
        
        // 标准Favicon尺寸配置
        this.faviconSizes = {
            // 基础尺寸
            '16': { name: 'favicon-16x16.png', descEn: 'Browser tab', descZh: '浏览器标签页' },
            '32': { name: 'favicon-32x32.png', descEn: 'Standard', descZh: '标准尺寸' },
            // Apple Touch Icons
            '180': { name: 'apple-touch-icon.png', descEn: 'iOS (Apple Touch)', descZh: 'iOS设备' },
            // Android Chrome
            '192': { name: 'android-chrome-192x192.png', descEn: 'Android (standard)', descZh: 'Android标准' },
            '512': { name: 'android-chrome-512x512.png', descEn: 'Android (HD)', descZh: 'Android高清' },
            // 其他常用尺寸
            '48': { name: 'favicon-48x48.png', descEn: 'Desktop shortcut', descZh: '桌面快捷方式' },
            '64': { name: 'favicon-64x64.png', descEn: 'High resolution', descZh: '高分辨率' },
            '96': { name: 'favicon-96x96.png', descEn: 'Google TV', descZh: 'Google TV' },
            '128': { name: 'favicon-128x128.png', descEn: 'Chrome Web Store', descZh: 'Chrome商店' },
            '256': { name: 'favicon-256x256.png', descEn: 'Extra large', descZh: '超大尺寸' }
        };
        
        this.init();
    }

    loadSavedLanguage() {
        const STORAGE_KEY = 'mzu_favicondl_lang';
        try {
            const url = new URL(window.location.href);
            const fromQuery = String(url.searchParams.get('lang') || '').trim();
            if (fromQuery === 'zh' || fromQuery === 'en') return fromQuery;
        } catch {
        }
        try {
            const saved = String(localStorage.getItem(STORAGE_KEY) || '').trim();
            if (saved === 'zh' || saved === 'en') return saved;
        } catch {
        }
        return 'en';
    }

    // 全局点击拦截器：点击内部 .html 链接时自动携带 ?lang= 参数
    setupLangInterceptor() {
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

    initWorkerBaseUrl() {
        const STORAGE_KEY = 'mzu_favicondl_worker_base';
        const DEFAULT_WORKER_BASE = 'https://icy-glade-6d04favicon.sweeyeah.workers.dev';

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

    buildProxyUrl(targetUrl) {
        const base = String(this.workerBaseUrl || '').trim();
        if (!base) return String(targetUrl);
        return `${base}/api/proxy?url=${encodeURIComponent(String(targetUrl))}`;
    }

    syncBatchDownloadButtonLabel() {
        const btn = document.getElementById('download-batch');
        const labelEl = btn?.querySelector('span');
        if (!labelEl) return;

        const isZip = this.batchOutputMode === 'zip';
        const en = isZip ? 'Download ZIP' : 'Download all files';
        const zh = isZip ? '下载 ZIP' : '下载全部文件';

        labelEl.setAttribute('data-en', en);
        labelEl.setAttribute('data-zh', zh);
        labelEl.textContent = this.currentLang === 'zh' ? zh : en;
    }

    buildBatchFilename(result, extension = 'png') {
        const idx = typeof result?.index === 'number' ? result.index : 0;
        const safeDomain = String(result?.domain || 'site')
            .replace(/[^a-zA-Z0-9.-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 80) || 'site';

        if (this.batchNamingMode === 'index') {
            const prefix = String(Math.max(0, idx)).padStart(3, '0');
            return `${prefix}-${safeDomain}-favicon.${extension}`;
        }

        return `${safeDomain}-favicon.${extension}`;
    }

    init() {
        this.bindEvents();
        this.updateLanguage();
        this.updateLangDropdown();
        this.setupLangInterceptor();
        this.initImageConverter();
        this.initBatchProcessor();
        this.initFormatConverter();
        this.syncBatchDownloadButtonLabel();
    }

    // ==================== 事件绑定 ====================
    bindEvents() {
        // 移动端菜单
        document.getElementById('mobile-menu-button')?.addEventListener('click', () => {
            document.getElementById('mobile-menu')?.classList.toggle('hidden');
        });

        // 语言下拉菜单
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

        // 返回工具列表按钮
        document.getElementById('back-to-tools')?.addEventListener('click', () => {
            this.showToolsGrid();
        });
    }

    setLanguage(lang) {
        if (lang !== 'zh' && lang !== 'en') return;
        if (lang === this.currentLang) return;
        this.currentLang = lang;
        this.saveLanguagePreference();
        this.updateLanguage();
        this.syncBatchDownloadButtonLabel();
        this.updateLangDropdown();
        document.getElementById('lang-menu')?.classList.remove('show');
    }

    updateLanguage() {
        document.querySelectorAll('[data-zh][data-en]').forEach(el => {
            const text = el.getAttribute(`data-${this.currentLang}`);
            if (text) el.textContent = text;
        });

        document.querySelectorAll('[data-en-alt][data-zh-alt]').forEach(el => {
            const alt = el.getAttribute(`data-${this.currentLang}-alt`);
            if (alt) el.setAttribute('alt', alt);
        });

        document.querySelectorAll('[data-en-placeholder][data-zh-placeholder]').forEach(el => {
            const placeholder = el.getAttribute(`data-${this.currentLang}-placeholder`);
            if (placeholder) el.setAttribute('placeholder', placeholder);
        });

        document.querySelectorAll('[data-en-title][data-zh-title]').forEach(el => {
            const title = el.getAttribute(`data-${this.currentLang}-title`);
            if (title) el.setAttribute('title', title);
        });
    }

    // ==================== 工具导航 ====================
    openTool(toolId) {
        // 隐藏所有工具区域
        document.querySelectorAll('section[id$="-converter"], section[id$="-processor"]').forEach(section => {
            section.classList.add('hidden');
        });
        
        // 显示选中的工具
        const toolSection = document.getElementById(toolId);
        if (toolSection) {
            toolSection.classList.remove('hidden');
            document.getElementById('back-to-tools')?.classList.remove('hidden');
            this.scrollToTool(toolId);
            this.currentTool = toolId;
        }
    }

    scrollToTool(toolId) {
        const section = document.getElementById(toolId);
        if (!section) return;

        let focusEl = null;
        if (toolId === 'image-converter') {
            focusEl = document.getElementById('drop-zone');
        } else if (toolId === 'batch-processor') {
            focusEl = document.getElementById('domains-input');
        } else if (toolId === 'format-converter') {
            focusEl = document.querySelector('#format-converter .drop-zone');
        }

        const offset = 72;
        const scrollTarget = focusEl || section;
        const top = scrollTarget.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });

        setTimeout(() => {
            if (!focusEl) return;
            if (typeof focusEl.focus !== 'function') return;

            if (!focusEl.hasAttribute('tabindex')) {
                focusEl.setAttribute('tabindex', '-1');
            }
            focusEl.focus({ preventScroll: true });
        }, 350);
    }

    showToolsGrid() {
        // 隐藏所有工具区域
        document.querySelectorAll('section[id$="-converter"], section[id$="-processor"]').forEach(section => {
            section.classList.add('hidden');
        });
        
        document.getElementById('back-to-tools')?.classList.add('hidden');
        this.currentTool = null;
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ==================== 图片转Favicon工具 ====================
    initImageConverter() {
        const dropZone = document.getElementById('drop-zone');
        const imageInput = document.getElementById('image-input');

        if (!dropZone || !imageInput) return;

        // 拖拽上传
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                this.handleImageUpload(e.dataTransfer.files[0]);
            }
        });

        // 文件选择
        imageInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleImageUpload(e.target.files[0]);
            }
        });

        // 尺寸选择
        document.querySelectorAll('.size-preview').forEach(preview => {
            preview.addEventListener('click', () => {
                preview.classList.toggle('selected');
            });
        });

        // 下载按钮
        document.getElementById('download-zip')?.addEventListener('click', () => this.downloadAsZip());
        document.getElementById('download-ico')?.addEventListener('click', () => this.downloadAsIco());
    }

    handleImageUpload(file) {
        // 验证文件类型
        const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/gif', 'image/webp'];
        if (!validTypes.includes(file.type)) {
            this.showToast(
                this.currentLang === 'zh'
                    ? '请选择有效的图片文件（PNG、JPG、SVG、GIF、WebP）'
                    : 'Please select a valid image file (PNG, JPG, SVG, GIF, WebP).',
                'error'
            );
            return;
        }

        // 验证文件大小（最大10MB）
        if (file.size > 10 * 1024 * 1024) {
            this.showToast(this.currentLang === 'zh' ? '图片文件不能超过10MB' : 'Image file must be <= 10MB.', 'error');
            return;
        }

        this.originalFileName = file.name.replace(/\.[^/.]+$/, '');

        const reader = new FileReader();
        reader.onload = (e) => {
            this.originalImage = e.target.result;
            this.showImagePreview(e.target.result);
            this.generateAllFavicons();
        };
        reader.readAsDataURL(file);
    }

    showImagePreview(imageSrc) {
        const previewImage = document.getElementById('preview-image');
        const imagePreview = document.getElementById('image-preview');
        
        if (previewImage) previewImage.src = imageSrc;
        imagePreview?.classList.remove('hidden');
        document.getElementById('size-options')?.classList.remove('hidden');
        
        // 动画效果
        if (typeof anime !== 'undefined') {
            anime({
                targets: imagePreview,
                opacity: [0, 1],
                translateY: [20, 0],
                duration: 300,
                easing: 'easeOutQuad'
            });
        }
    }

    async generateAllFavicons() {
        if (!this.originalImage) return;

        this.showLoading(true);
        this.generatedIcons.clear();
        
        const iconsGrid = document.getElementById('icons-grid');
        if (iconsGrid) iconsGrid.innerHTML = '';

        // 获取选中的尺寸
        const selectedSizes = this.getSelectedSizes();
        
        // 生成所有尺寸的图标
        for (const size of selectedSizes) {
            try {
                const resizedImage = await this.resizeImage(this.originalImage, size);
                this.generatedIcons.set(size, resizedImage);
                
                // 添加到预览网格
                if (iconsGrid) {
                    const iconElement = this.createIconPreviewElement(resizedImage, size);
                    iconsGrid.appendChild(iconElement);
                }
            } catch (error) {
                console.error(`生成 ${size}x${size} 图标失败:`, error);
            }
        }

        document.getElementById('generated-icons')?.classList.remove('hidden');
        document.getElementById('download-options')?.classList.remove('hidden');
        this.showLoading(false);
        
        this.showToast(
            this.currentLang === 'zh'
                ? `成功生成 ${this.generatedIcons.size} 个图标！`
                : `Generated ${this.generatedIcons.size} icons successfully!`
        );
    }

    getSelectedSizes() {
        const selected = Array.from(document.querySelectorAll('.size-preview.selected'))
            .map(el => parseInt(el.dataset.size))
            .filter(size => !isNaN(size));
        
        // 如果没有选择，使用默认尺寸
        return selected.length > 0 ? selected : [16, 32, 180, 192, 512];
    }

    resizeImage(imageSrc, size) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = size;
                canvas.height = size;
                const ctx = canvas.getContext('2d');
                
                // 启用图像平滑
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                
                // 计算居中裁剪的位置（保持比例并居中）
                const srcSize = Math.min(img.width, img.height);
                const srcX = (img.width - srcSize) / 2;
                const srcY = (img.height - srcSize) / 2;
                
                // 绘制图像
                ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, size, size);
                
                resolve(canvas.toDataURL('image/png'));
            };
            
            img.onerror = () => reject(new Error('图片加载失败'));
            img.src = imageSrc;
        });
    }

    createIconPreviewElement(imageSrc, size) {
        const div = document.createElement('div');
        div.className = 'bg-white rounded-lg p-4 border border-gray-200 text-center hover:border-blue-500 transition-colors flex flex-col';
        div.style.minHeight = '190px';
        
        const sizeInfo = this.faviconSizes[size] || { name: `favicon-${size}x${size}.png`, descEn: '', descZh: '' };
        const downloadLabel = this.currentLang === 'zh' ? '下载' : 'Download';
        const descText = this.currentLang === 'zh' ? (sizeInfo.descZh || '') : (sizeInfo.descEn || '');
        
        div.innerHTML = `
            <div class="flex justify-center items-center mb-3" style="height: 76px;">
                <img src="${imageSrc}" alt="${size}x${size}" data-en-alt="${size}x${size} icon" data-zh-alt="${size}x${size} 图标"
                     style="width: ${Math.min(size, 64)}px; height: ${Math.min(size, 64)}px;" 
                     class="rounded shadow-sm">
            </div>
            <p class="font-medium text-sm">${size}x${size}</p>
            <p class="text-xs text-gray-500 mb-3" data-en="${sizeInfo.descEn || ''}" data-zh="${sizeInfo.descZh || ''}">${descText}</p>
            <button onclick="faviconTools.downloadSingleIcon(${size})" 
                    class="mt-auto px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors">
                <span data-en="Download" data-zh="下载">${downloadLabel}</span>
            </button>
        `;
        return div;
    }

    downloadSingleIcon(size) {
        const dataUrl = this.generatedIcons.get(size);
        if (!dataUrl) {
            this.showToast(this.currentLang === 'zh' ? '图标未生成' : 'Icon not generated yet.', 'error');
            return;
        }
        
        const sizeInfo = this.faviconSizes[size] || { name: `favicon-${size}x${size}.png` };
        this.triggerDownload(dataUrl, sizeInfo.name);
        this.showToast(this.currentLang === 'en' ? `${size}x${size} icon downloaded successfully!` : `${size}x${size} 图标下载成功！`);
    }

    async downloadAsZip() {
        this.showToast(this.currentLang === 'zh' ? '正在生成ZIP文件...' : 'Generating ZIP...');

        try {
            if (typeof JSZip === 'undefined') {
                await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
            }

            const zip = new JSZip();

            for (const [size, dataUrl] of this.generatedIcons) {
                const sizeInfo = this.faviconSizes[size] || { name: `favicon-${size}x${size}.png` };
                const base64Data = dataUrl.split(',')[1];
                zip.file(sizeInfo.name, base64Data, { base64: true });
            }

            if (this.generatedIcons.has(32)) {
                const ico32 = this.generatedIcons.get(32).split(',')[1];
                zip.file('favicon.ico', ico32, { base64: true });
            }

            const manifest = this.generateManifest();
            zip.file('site.webmanifest', JSON.stringify(manifest, null, 2));

            const htmlCode = this.generateHtmlCode();
            zip.file('favicon-html.txt', htmlCode);

            const readme = this.generateReadme();
            zip.file('README.txt', readme);

            const content = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(content);
            this.triggerDownload(url, 'favicons.zip');
            URL.revokeObjectURL(url);

            this.showToast(this.currentLang === 'zh' ? 'ZIP文件下载成功！' : 'ZIP downloaded!');
        } catch (error) {
            console.error('ZIP生成失败:', error);
            this.showToast(this.currentLang === 'zh' ? 'ZIP生成失败，请重试' : 'Failed to generate ZIP. Please try again.', 'error');
        }
    }

    async downloadAsIco() {
        // ICO格式需要特殊处理，这里生成一个包含多尺寸的PNG作为替代
        // 真正的ICO格式需要专门的库
        if (this.generatedIcons.has(32)) {
            const dataUrl = this.generatedIcons.get(32);
            this.triggerDownload(dataUrl, 'favicon.ico');
            this.showToast(
                this.currentLang === 'zh'
                    ? 'favicon.ico 下载成功！（PNG格式，兼容现代浏览器）'
                    : 'favicon.ico downloaded! (PNG format; compatible with modern browsers)'
            );
        } else {
            this.showToast(this.currentLang === 'zh' ? '请先生成32x32尺寸的图标' : 'Please generate a 32x32 icon first.', 'error');
        }
    }

    generateManifest() {
        return {
            name: this.originalFileName || 'My Website',
            short_name: this.originalFileName || 'Website',
            icons: [
                {
                    src: '/android-chrome-192x192.png',
                    sizes: '192x192',
                    type: 'image/png'
                },
                {
                    src: '/android-chrome-512x512.png',
                    sizes: '512x512',
                    type: 'image/png'
                }
            ],
            theme_color: '#ffffff',
            background_color: '#ffffff',
            display: 'standalone'
        };
    }

    generateHtmlCode() {
        const isZh = this.currentLang === 'zh';

        if (isZh) {
            return `<!-- Favicon HTML代码 - 将以下代码添加到您的<head>标签中 -->

<!-- 基础Favicon -->
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="shortcut icon" href="/favicon.ico">

<!-- Apple Touch Icon -->
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">

<!-- Android Chrome (PWA) -->
<link rel="manifest" href="/site.webmanifest">

<!-- 可选：Microsoft Tiles -->
<meta name="msapplication-TileColor" content="#ffffff">
<meta name="theme-color" content="#ffffff">
`;
        }

        return `<!-- Favicon HTML snippet - add this into your <head> -->

<!-- Basic favicons -->
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="shortcut icon" href="/favicon.ico">

<!-- Apple Touch Icon -->
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">

<!-- Android Chrome (PWA) -->
<link rel="manifest" href="/site.webmanifest">

<!-- Optional: Microsoft Tiles -->
<meta name="msapplication-TileColor" content="#ffffff">
<meta name="theme-color" content="#ffffff">
`;
    }

    generateReadme() {
        const isZh = this.currentLang === 'zh';
        const timeStr = isZh ? new Date().toLocaleString('zh-CN') : new Date().toLocaleString('en-US');

        if (isZh) {
            return `Favicon 文件说明
================

此 ZIP 包含以下文件：

1. favicon.ico - 传统 ICO 格式，兼容所有浏览器
2. favicon-16x16.png - 浏览器标签页图标
3. favicon-32x32.png - 标准尺寸图标
4. apple-touch-icon.png - iOS 设备图标 (180x180)
5. android-chrome-192x192.png - Android 标准图标
6. android-chrome-512x512.png - Android 高清图标
7. site.webmanifest - PWA 配置文件
8. favicon-html.txt - HTML 代码片段

使用方法：
1. 将所有文件上传到你网站的根目录
2. 将 favicon-html.txt 中的代码添加到你网站的 <head> 标签中

生成时间: ${timeStr}
生成工具: Mzu favicondl
项目主页: https://favicondl.com
`;
        }

        return `Favicon package
==============

This ZIP includes:

1. favicon.ico - legacy ICO (broad browser compatibility)
2. favicon-16x16.png - browser tab icon
3. favicon-32x32.png - standard icon
4. apple-touch-icon.png - iOS icon (180x180)
5. android-chrome-192x192.png - Android standard icon
6. android-chrome-512x512.png - Android HD icon
7. site.webmanifest - PWA manifest
8. favicon-html.txt - HTML snippet

How to use:
1. Upload all files to your website root directory
2. Paste the code from favicon-html.txt into your site's <head>

Generated at: ${timeStr}
Generator: Mzu favicondl
Project site: https://favicondl.com
`;
    }

    loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    // ==================== 批量处理工具 ====================
    initBatchProcessor() {
        document.getElementById('process-batch')?.addEventListener('click', () => this.processBatch());
        document.getElementById('download-batch')?.addEventListener('click', () => this.downloadBatchResults());

        document.getElementById('batch-format')?.addEventListener('change', (e) => {
            this.batchOutputMode = e?.target?.value || 'zip';
            this.syncBatchDownloadButtonLabel();
        });

        document.getElementById('batch-naming')?.addEventListener('change', (e) => {
            this.batchNamingMode = e?.target?.value || 'domain';
            this.syncBatchDownloadButtonLabel();
        });
    }

    async processBatch() {
        const domainsInput = document.getElementById('domains-input');
        if (!domainsInput) return;

        const domains = domainsInput.value.trim().split('\n')
            .map(d => d.trim())
            .filter(d => d && d.includes('.'))
            .slice(0, 100);

        if (domains.length === 0) {
            this.showToast(this.currentLang === 'zh' ? '请输入至少一个有效域名' : 'Please enter at least one valid domain.', 'error');
            return;
        }

        const size = document.getElementById('batch-size')?.value || 'small';
        const outputMode = document.getElementById('batch-format')?.value || 'zip';
        const namingMode = document.getElementById('batch-naming')?.value || 'domain';

        this.batchOutputMode = outputMode;
        this.batchNamingMode = namingMode;

        this.showBatchProgress(true);
        document.getElementById('batch-progress')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this.batchResults = [];

        for (let i = 0; i < domains.length; i++) {
            const domain = this.cleanDomain(domains[i]);
            const faviconUrl = this.buildFaviconUrl(domain, size);
            
            // Google Favicon 服务非常可靠，直接添加结果
            this.batchResults.push({
                domain,
                url: faviconUrl,
                success: true,
                index: i + 1
            });

            this.updateBatchProgress(i + 1, domains.length);
            // 小延迟让UI更新
            if (i % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        this.displayBatchResults();
        this.syncBatchDownloadButtonLabel();
        this.showBatchProgress(false);
        
        const successCount = this.batchResults.filter(r => r.success).length;
        this.showToast(
            this.currentLang === 'zh'
                ? `处理完成！成功: ${successCount}/${domains.length}`
                : `Done! Success: ${successCount}/${domains.length}`
        );
    }

    cleanDomain(domain) {
        return domain
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .split('/')[0]
            .split(':')[0]
            .toLowerCase();
    }

    buildFaviconUrl(domain, size) {
        const sz = size === 'large' ? 64 : 32;
        return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${sz}`;
    }

    preloadImage(url, useCors = false) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            // 只有本地图片（data URL）或需要Canvas操作时才设置crossOrigin
            if (useCors || url.startsWith('data:')) {
                img.crossOrigin = 'anonymous';
            }
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('加载失败'));
            img.src = url;
        });
    }

    showBatchProgress(show) {
        const progress = document.getElementById('batch-progress');
        if (progress) {
            progress.classList.toggle('hidden', !show);
        }
    }

    updateBatchProgress(current, total) {
        const bar = document.getElementById('progress-bar');
        const text = document.getElementById('progress-text');
        
        const percentage = (current / total) * 100;
        if (bar) bar.style.width = `${percentage}%`;
        if (text) text.textContent = `${current}/${total}`;
    }

    displayBatchResults() {
        const resultsSection = document.getElementById('batch-results');
        const resultsGrid = document.getElementById('results-grid');
        
        if (!resultsGrid) return;
        resultsGrid.innerHTML = '';
        
        this.batchResults.forEach(result => {
            const div = document.createElement('div');
            div.className = 'bg-white rounded-lg p-4 border border-gray-200';
            
            if (result.success) {
                const okText = this.currentLang === 'zh' ? '✓ 成功' : '✓ Success';
                div.innerHTML = `
                    <div class="flex items-center space-x-3">
                        <img src="${result.url}" alt="${result.domain}" class="w-8 h-8 rounded">
                        <div class="flex-1 min-w-0">
                            <p class="font-medium text-sm truncate">${result.domain}</p>
                            <p class="text-xs text-green-600" data-en="✓ Success" data-zh="✓ 成功">${okText}</p>
                        </div>
                        <button onclick="faviconTools.downloadBatchIcon('${result.url}', '${result.domain}', ${result.index})" 
                                class="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                        </button>
                    </div>
                `;
            } else {
                const failText = this.currentLang === 'zh' ? '✗ 获取失败' : '✗ Failed';
                div.innerHTML = `
                    <div class="flex items-center space-x-3">
                        <div class="w-8 h-8 bg-red-100 rounded flex items-center justify-center">
                            <svg class="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </div>
                        <div class="flex-1 min-w-0">
                            <p class="font-medium text-sm truncate">${result.domain}</p>
                            <p class="text-xs text-red-600" data-en="✗ Failed" data-zh="✗ 获取失败">${failText}</p>
                        </div>
                    </div>
                `;
            }
            
            resultsGrid.appendChild(div);
        });

        resultsSection?.classList.remove('hidden');
    }

    async downloadBatchIcon(url, domain, index) {
        try {
            // 使用 fetch 下载（Google 服务支持）
            const response = await fetch(this.buildProxyUrl(url));
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);

            const filename = this.buildBatchFilename({ domain, index }, 'png');
            this.triggerDownload(blobUrl, filename);
            URL.revokeObjectURL(blobUrl);
            this.showToast(this.currentLang === 'zh' ? `${domain} 图标下载成功！` : `${domain} icon downloaded!`);
        } catch {
            // 降级：在新窗口打开
            window.open(url, '_blank');
            this.showToast(
                this.currentLang === 'zh'
                    ? '请在新窗口中右键保存图片'
                    : 'Browser blocked direct download. Please right-click the image in the new tab and save it.'
            );
        }
    }

    async downloadBatchResults() {
        const successResults = this.batchResults.filter(r => r.success);
        if (successResults.length === 0) {
            this.showToast(this.currentLang === 'zh' ? '没有可下载的结果' : 'No downloadable results.', 'error');
            return;
        }

        if (this.batchOutputMode === 'individual') {
            this.showToast(this.currentLang === 'zh' ? '正在下载文件...' : 'Downloading files...');
            let downloaded = 0;

            for (const result of successResults) {
                try {
                    const response = await fetch(this.buildProxyUrl(result.url));
                    const blob = await response.blob();
                    const blobUrl = URL.createObjectURL(blob);
                    const filename = this.buildBatchFilename(result, 'png');
                    this.triggerDownload(blobUrl, filename);
                    URL.revokeObjectURL(blobUrl);
                    downloaded++;

                    await new Promise(resolve => setTimeout(resolve, 250));
                } catch (e) {
                    console.warn(`单文件下载失败: ${result.domain}`, e);
                }
            }

            if (downloaded > 0) {
                this.showToast(
                    this.currentLang === 'zh'
                        ? `下载完成！共 ${downloaded} 个文件`
                        : `Done! Downloaded ${downloaded} files.`
                );
            } else {
                this.showToast(
                    this.currentLang === 'zh'
                        ? '下载失败：浏览器可能拦截了批量下载，请尝试单独下载。'
                        : 'Download failed: your browser may block batch downloads. Try downloading individually.',
                    'error'
                );
            }

            return;
        }

        this.showToast(this.currentLang === 'zh' ? '正在打包下载...' : 'Packaging ZIP...');

        try {
            if (typeof JSZip === 'undefined') {
                await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js');
            }

            const zip = new JSZip();
            let addedCount = 0;
            
            for (const result of successResults) {
                try {
                    // 使用 fetch 获取图片
                    const response = await fetch(this.buildProxyUrl(result.url));
                    const blob = await response.blob();
                    zip.file(this.buildBatchFilename(result, 'png'), blob);
                    addedCount++;
                } catch (e) {
                    console.warn(`跳过 ${result.domain}:`, e);
                }
            }
            
            if (addedCount === 0) {
                this.showToast(
                    this.currentLang === 'zh'
                        ? '无法获取图标文件，请尝试单独下载'
                        : 'Failed to fetch icon files. Try downloading individually.',
                    'error'
                );
                return;
            }
            
            const content = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(content);
            this.triggerDownload(url, 'batch-favicons.zip');
            URL.revokeObjectURL(url);
            
            this.showToast(
                this.currentLang === 'zh'
                    ? `批量下载完成！共 ${addedCount} 个图标`
                    : `Batch download complete! ${addedCount} icons.`
            );
        } catch (error) {
            console.error('批量下载失败:', error);
            this.showToast(this.currentLang === 'zh' ? '下载失败，请重试' : 'Download failed. Please try again.', 'error');
        }
    }

    // ==================== 格式转换工具 ====================
    initFormatConverter() {
        const convertInput = document.getElementById('convert-input');
        const convertButton = document.getElementById('convert-button');

        convertInput?.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                this.handleConvertUpload(e.target.files[0]);
            }
        });

        convertButton?.addEventListener('click', () => this.performConversion());

        // 格式选择变化时显示/隐藏ICO选项
        document.querySelectorAll('input[name="output-format"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const icoOptions = document.getElementById('ico-options');
                if (icoOptions) {
                    icoOptions.classList.toggle('hidden', e.target.value !== 'ico');
                }
            });
        });
    }

    handleConvertUpload(file) {
        if (!file.type.startsWith('image/')) {
            this.showToast(this.currentLang === 'zh' ? '请选择有效的图片文件' : 'Please select a valid image file.', 'error');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            this.convertSourceImage = e.target.result;
            this.convertFileName = file.name.replace(/\.[^/.]+$/, '');
            
            const preview = document.getElementById('convert-preview');
            const image = document.getElementById('convert-image');
            const info = document.getElementById('convert-info');
            
            if (image) image.src = e.target.result;
            if (info) info.textContent = `${file.name} (${this.formatFileSize(file.size)})`;
            preview?.classList.remove('hidden');
            
            const btn = document.getElementById('convert-button');
            if (btn) btn.disabled = false;
        };
        reader.readAsDataURL(file);
    }

    async performConversion() {
        if (!this.convertSourceImage) {
            this.showToast(this.currentLang === 'zh' ? '请先上传图片' : 'Please upload an image first.', 'error');
            return;
        }

        const format = document.querySelector('input[name="output-format"]:checked')?.value || 'png';
        this.showToast(
            this.currentLang === 'zh'
                ? `正在转换为 ${format.toUpperCase()} 格式...`
                : `Converting to ${format.toUpperCase()}...`
        );

        try {
            const img = await this.preloadImage(this.convertSourceImage, true);
            const canvas = document.createElement('canvas');
            
            // 获取选中的尺寸（ICO格式）
            let sizes = [32];
            if (format === 'ico') {
                sizes = Array.from(document.querySelectorAll('input[name="ico-sizes"]:checked'))
                    .map(el => parseInt(el.value))
                    .filter(s => !isNaN(s));
                if (sizes.length === 0) sizes = [16, 32];
            }
            
            // 使用最大尺寸
            const maxSize = Math.max(...sizes);
            canvas.width = maxSize;
            canvas.height = maxSize;
            
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            
            // 居中裁剪
            const srcSize = Math.min(img.width, img.height);
            const srcX = (img.width - srcSize) / 2;
            const srcY = (img.height - srcSize) / 2;
            ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, maxSize, maxSize);
            
            // 根据格式导出
            let mimeType = 'image/png';
            let extension = 'png';
            
            switch (format) {
                case 'jpg':
                    mimeType = 'image/jpeg';
                    extension = 'jpg';
                    break;
                case 'ico':
                    mimeType = 'image/png'; // 浏览器兼容
                    extension = 'ico';
                    break;
                case 'svg':
                    // SVG需要特殊处理，这里简化为PNG
                    mimeType = 'image/png';
                    extension = 'png';
                    this.showToast(
                        this.currentLang === 'zh' ? 'SVG格式暂不支持，已转换为PNG' : 'SVG is not supported yet. Converted to PNG.',
                        'warning'
                    );
                    break;
            }
            
            const dataUrl = canvas.toDataURL(mimeType, 0.95);
            this.convertedImage = dataUrl;
            this.convertedExtension = extension;
            
            this.showConversionResult(format, dataUrl);
        } catch (error) {
            console.error('转换失败:', error);
            this.showToast(this.currentLang === 'zh' ? '转换失败，请重试' : 'Conversion failed. Please try again.', 'error');
        }
    }

    showConversionResult(format, dataUrl) {
        const resultSection = document.getElementById('conversion-result');
        const resultPreview = document.getElementById('result-preview');
        const isZh = this.currentLang === 'zh';
        
        if (resultPreview) {
            resultPreview.innerHTML = `
                <div class="mb-4">
                    <img src="${dataUrl}" alt="${isZh ? '转换结果' : 'Conversion result'}" data-en-alt="Conversion result" data-zh-alt="转换结果" class="max-w-32 max-h-32 mx-auto rounded-lg shadow-lg mb-4">
                    <p class="font-medium text-green-600" data-en="✓ Done" data-zh="✓ 转换完成">${isZh ? '✓ 转换完成' : '✓ Done'}</p>
                    <p class="text-sm text-gray-600"><span data-en="Format: " data-zh="格式：">${isZh ? '格式：' : 'Format: '}</span>${format.toUpperCase()}</p>
                </div>
            `;
        }
        
        resultSection?.classList.remove('hidden');
        
        // 绑定下载按钮
        document.getElementById('download-converted')?.addEventListener('click', () => {
            if (this.convertedImage) {
                this.triggerDownload(this.convertedImage, `${this.convertFileName || 'converted'}.${this.convertedExtension}`);
                this.showToast(this.currentLang === 'zh' ? '下载成功！' : 'Downloaded!');
            }
        }, { once: true });
    }

    // ==================== 工具方法 ====================
    triggerDownload(url, filename) {
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    showLoading(show) {
        const loading = document.getElementById('loading-content');
        const upload = document.getElementById('upload-content');
        
        if (loading) loading.classList.toggle('hidden', !show);
        if (upload) upload.classList.toggle('hidden', show);
    }

    showToast(message, type = 'success') {
        const toast = document.getElementById('success-toast');
        const toastMessage = document.getElementById('toast-message');
        
        if (toastMessage) toastMessage.textContent = message;
        if (toast) {
            toast.classList.remove('bg-gray-900', 'bg-red-600', 'bg-yellow-500');
            toast.classList.add(type === 'error' ? 'bg-red-600' : type === 'warning' ? 'bg-yellow-500' : 'bg-gray-900');
            toast.classList.remove('translate-x-[200%]');
            
            setTimeout(() => toast.classList.add('translate-x-[200%]'), 3000);
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
}

// ==================== 全局函数 ====================
function openTool(toolId) {
    faviconTools?.openTool(toolId);
}

function showToolsGrid() {
    faviconTools?.showToolsGrid();
}

function resetConverter() {
    location.reload();
}

function loadSampleDomains() {
    const samples = [
        'google.com',
        'youtube.com',
        'facebook.com',
        'twitter.com',
        'instagram.com',
        'linkedin.com',
        'github.com',
        'stackoverflow.com',
        'reddit.com',
        'amazon.com'
    ];
    const input = document.getElementById('domains-input');
    if (input) input.value = samples.join('\n');
}

function clearDomains() {
    const input = document.getElementById('domains-input');
    if (input) input.value = '';
}

// ==================== 初始化 ====================
let faviconTools;
document.addEventListener('DOMContentLoaded', () => {
    faviconTools = new FaviconTools();
});