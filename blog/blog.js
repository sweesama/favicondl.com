// Shared blog article JS — 5 语言支持 + URL 路径检测 + 下拉菜单
(function() {
    const LANG_KEY = 'mzu_favicondl_lang';
    const SUPPORTED = ['en', 'zh', 'ja', 'ko', 'es'];
    const FLAGS = {
        en: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1fa-1f1f8.svg',
        zh: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1e8-1f1f3.svg',
        ja: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1ef-1f1f5.svg',
        ko: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1f0-1f1f7.svg',
        es: 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1ea-1f1f8.svg',
    };

    // 检测语言：URL路径 > 查询参数 > localStorage > 默认en
    function detectLang() {
        try {
            const m = location.pathname.match(/^\/(zh|ja|ko|es)(\/|$)/);
            if (m) return m[1];
        } catch {}
        const q = new URLSearchParams(location.search).get('lang');
        if (q && SUPPORTED.includes(q)) return q;
        const s = localStorage.getItem(LANG_KEY);
        if (s && SUPPORTED.includes(s)) return s;
        return 'en';
    }
    const lang = detectLang();

    function applyLang() {
        // 对 ja/ko/es 页面，文本已由构建脚本翻译，跳过覆盖
        if (!['ja', 'ko', 'es'].includes(lang)) {
            document.querySelectorAll('[data-en]').forEach(el => {
                el.textContent = lang === 'zh' ? el.dataset.zh : el.dataset.en;
            });
        }

        // Toggle article body language blocks
        document.querySelectorAll('.article-body[data-lang]').forEach(el => {
            // 对 ja/ko/es 页面，显示 en 版本（文章内容未翻译）
            const showLang = ['ja', 'ko', 'es'].includes(lang) ? 'en' : lang;
            el.style.display = el.dataset.lang === showLang ? '' : 'none';
        });

        // 更新国旗图标
        const flag = document.querySelector('.lang-flag');
        if (flag) {
            flag.src = FLAGS[lang] || FLAGS.en;
            flag.alt = lang.toUpperCase();
        }
    }

    // 语言下拉菜单交互
    const toggle = document.getElementById('lang-toggle');
    const menu = document.getElementById('lang-menu');
    if (toggle && menu) {
        toggle.addEventListener('click', function(e) {
            e.stopPropagation();
            menu.classList.toggle('show');
        });
        document.addEventListener('click', function() {
            menu.classList.remove('show');
        });
        menu.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }

    applyLang();
})();
