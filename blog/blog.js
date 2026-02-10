// Shared blog article JS — language toggle + content switching
(function() {
    const LANG_KEY = 'mzu_favicondl_lang';
    let lang = localStorage.getItem(LANG_KEY) || new URLSearchParams(location.search).get('lang') || 'en';

    function applyLang() {
        // Update text elements with data-en/data-zh attributes
        document.querySelectorAll('[data-en]').forEach(el => {
            el.textContent = lang === 'zh' ? el.dataset.zh : el.dataset.en;
        });

        // Toggle article body language blocks
        document.querySelectorAll('.article-body[data-lang]').forEach(el => {
            el.style.display = el.dataset.lang === lang ? '' : 'none';
        });

        // Update flag icon
        const flag = document.querySelector('.lang-flag');
        if (flag) {
            flag.src = lang === 'zh'
                ? 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1e8-1f1f3.svg'
                : 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f1fa-1f1f8.svg';
            flag.alt = lang === 'zh' ? 'ZH' : 'EN';
        }
    }

    const toggle = document.getElementById('lang-toggle');
    if (toggle) {
        toggle.addEventListener('click', () => {
            lang = lang === 'en' ? 'zh' : 'en';
            localStorage.setItem(LANG_KEY, lang);
            applyLang();
        });
    }

    applyLang();
})();
