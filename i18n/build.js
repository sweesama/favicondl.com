#!/usr/bin/env node
/**
 * i18n Build Script — 从英文源页面生成多语言版本
 * 用法: cd i18n && npm install && npm run build
 *
 * 输出: /{lang}/index.html, /{lang}/tools.html 等
 * 同时给英文根页面注入 hreflang 标签和多语言切换器
 */

import { load } from 'cheerio';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ─── 配置 ───────────────────────────────────────────────
const DOMAIN = 'https://favicondl.com';
const LANGUAGES = ['zh', 'ja', 'ko', 'es'];
const ALL_LANGS = ['en', ...LANGUAGES];
const PAGES = [
  'index.html',
  'tools.html',
  'documentation.html',
  'privacy.html',
  '404.html',
];

const ARTICLE_LANG_SUFFIX = {
  en: 'En',
  zh: 'Zh',
  ja: 'Ja',
  ko: 'Ko',
  es: 'Es',
};

const SCHEMA_LANG = {
  en: 'en',
  zh: 'zh-CN',
  ja: 'ja',
  ko: 'ko',
  es: 'es',
};

const BLOG_INDEX_META = {
  en: {
    title: 'Favicon Blog - Guides, Tutorials & Best Practices | Mzu favicondl',
    description: 'Favicon guides, tutorials, and best practices. Learn about favicon sizes, formats, HTML implementation, PWA icons, and troubleshooting tips.',
  },
  zh: {
    title: 'Favicon 指南与教程：尺寸、格式及故障排查 | Mzu favicondl',
    description: '面向开发者和站长的 Favicon 中文指南，涵盖尺寸、格式、HTML 配置、PWA 图标与常见故障排查。',
  },
  ja: {
    title: 'Favicon ガイド・チュートリアル・トラブル対策 | Mzu favicondl',
    description: 'Favicon のサイズ、形式、HTML 設定、PWA アイコン、表示トラブルの解決方法を解説します。',
  },
  ko: {
    title: 'Favicon 가이드: 크기, 형식 및 문제 해결 | Mzu favicondl',
    description: '개발자를 위한 Favicon 가이드입니다. 아이콘 크기, 파일 형식, HTML 설정, PWA와 오류 해결 방법을 다룹니다.',
  },
  es: {
    title: 'Guías de favicon: tamaños, formatos y soluciones | Mzu favicondl',
    description: 'Guías prácticas sobre favicon: tamaños, formatos, implementación HTML, iconos PWA y solución de errores comunes.',
  },
};

const articlesPath = path.join(ROOT, 'blog', 'articles.json');
const articleRecords = fs.existsSync(articlesPath)
  ? JSON.parse(fs.readFileSync(articlesPath, 'utf-8'))
  : [];
const articlesBySlug = new Map(articleRecords.map((article) => [article.slug, article]));
const NOINDEX_ARTICLE_SLUGS = new Set();

const FLAGS = {
  en: { svg: '1f1fa-1f1f8', name: 'English' },
  zh: { svg: '1f1e8-1f1f3', name: '中文' },
  ja: { svg: '1f1ef-1f1f5', name: '日本語' },
  ko: { svg: '1f1f0-1f1f7', name: '한국어' },
  es: { svg: '1f1ea-1f1f8', name: 'Español' },
};

const flagUrl = (code) =>
  `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${FLAGS[code].svg}.svg`;

// ─── 翻译加载 ───────────────────────────────────────────
function loadTranslations() {
  const t = {};
  for (const lang of LANGUAGES) {
    t[lang] = JSON.parse(
      fs.readFileSync(path.join(__dirname, `${lang}.json`), 'utf-8')
    );
  }
  return t;
}

// ─── hreflang 标签生成 ──────────────────────────────
// page 可以是 'index.html' 或 'blog/index.html' 等子目录路径
function hreflangTags(page) {
  // 将 page 转换为 URL 路径：'index.html' -> '/', 'blog/index.html' -> '/blog/', 'tools.html' -> '/tools.html'
  let pagePath;
  if (page.endsWith('/index.html')) {
    pagePath = '/' + page.replace('/index.html', '/'); // 'blog/index.html' -> '/blog/'
  } else if (page === 'index.html') {
    pagePath = '/';
  } else {
    pagePath = '/' + page;
  }
  const tags = [];
  tags.push(`<link rel="alternate" hreflang="en" href="${DOMAIN}${pagePath}">`);
  tags.push(`<link rel="alternate" hreflang="x-default" href="${DOMAIN}${pagePath}">`);
  for (const lang of LANGUAGES) {
    tags.push(
      `<link rel="alternate" hreflang="${lang}" href="${DOMAIN}/${lang}${pagePath}">`
    );
  }
  return '\n    ' + tags.join('\n    ');
}

// ─── 语言切换器 HTML ──────────────────────────────
function pageToPath(page) {
  if (page.endsWith('/index.html')) return '/' + page.replace('/index.html', '/');
  if (page === 'index.html') return '/';
  return '/' + page;
}

function getArticleRecord(page) {
  const match = page.match(/^blog\/([^/]+)\.html$/);
  if (!match || match[1] === 'index') return null;
  return articlesBySlug.get(match[1]) || null;
}

function applyArticleIndexingPolicy($, article) {
  if (!article || !NOINDEX_ARTICLE_SLUGS.has(article.slug)) return;
  $('meta[name="robots"]').attr('content', 'noindex, follow');
}

function getArticleText(article, field, lang) {
  if (!article) return '';
  const suffix = ARTICLE_LANG_SUFFIX[lang] || 'En';
  return article[`${field}${suffix}`] || article[`${field}En`] || '';
}

function updateArticleJsonLd($, article, lang, pagePath) {
  if (!article) return;
  let node = $('script[type="application/ld+json"]').first();
  const canonical = `${DOMAIN}${lang === 'en' ? '' : `/${lang}`}${pagePath}`;

  if (!node.length) {
    const data = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: getArticleText(article, 'title', lang),
      description: getArticleText(article, 'desc', lang),
      datePublished: article.publishDate,
      dateModified: article.publishDate,
      author: { '@type': 'Organization', name: 'Mzu favicondl' },
      publisher: { '@type': 'Organization', name: 'Mzu favicondl' },
      mainEntityOfPage: canonical,
      inLanguage: SCHEMA_LANG[lang] || lang,
    };
    $('head').append(`<script type="application/ld+json">${JSON.stringify(data, null, 2)}</script>`);
    node = $('script[type="application/ld+json"]').first();
    return;
  }

  try {
    const data = JSON.parse(node.html());
    data.headline = getArticleText(article, 'title', lang);
    data.description = getArticleText(article, 'desc', lang);
    data.mainEntityOfPage = canonical;
    data.inLanguage = SCHEMA_LANG[lang] || lang;
    node.text(JSON.stringify(data, null, 2));
  } catch (error) {
    console.warn(`⚠️  无法更新 ${pagePath} 的 JSON-LD: ${error.message}`);
  }
}

function findArticleBodyHtml($, lang) {
  const direct = $(`.article-body[data-lang="${lang}"]`).first();
  if (direct.length) return direct.html() || '';

  const template = $(`template[data-article-lang="${lang}"]`).first();
  if (template.length) return template.html() || '';

  if (lang !== 'en') return findArticleBodyHtml($, 'en');
  return '';
}

function localizeArticlePage($, article, lang, page) {
  if (!article) return;

  const selectedBody = findArticleBodyHtml($, lang);
  const anchor = $('.article-body').first();
  if (anchor.length) {
    anchor.before(`<div class="article-body">${selectedBody}</div>`);
  } else {
    $('article').append(`<div class="article-body">${selectedBody}</div>`);
  }
  $('.article-body[data-lang], template[data-article-lang]').remove();

  const title = getArticleText(article, 'title', lang);
  $('article h1').first().text(title);
  $('article nav span.text-gray-600').first().text(title);

  updateArticleJsonLd($, article, lang, pageToPath(page));
}

function storeTranslationsAsTemplates($) {
  const englishBody = $('.article-body[data-lang="en"]').first();
  if (!englishBody.length) return;

  for (const lang of LANGUAGES) {
    const body = $(`.article-body[data-lang="${lang}"]`).first();
    const existingTemplate = $(`template[data-article-lang="${lang}"]`).first();
    if (body.length && !existingTemplate.length) {
      englishBody.after(`<template data-article-lang="${lang}">${body.html() || ''}</template>`);
    }
    body.remove();
  }

  englishBody.removeAttr('style');
}

function updateEnglishArticleLabels($, article) {
  if (!article) return;
  const titleByLanguage = Object.fromEntries(
    ALL_LANGS.map((lang) => [lang, getArticleText(article, 'title', lang)])
  );
  const labels = $('article h1, article nav span.text-gray-600');
  labels.each(function () {
    $(this).text(titleByLanguage.en);
    for (const lang of ALL_LANGS) $(this).attr(`data-${lang}`, titleByLanguage[lang]);
  });
}

function stripTranslationAttributes($) {
  $('[data-en], [data-zh], [data-ja], [data-ko], [data-es]').each(function () {
    for (const lang of ALL_LANGS) $(this).removeAttr(`data-${lang}`);
  });
}

function switcherDropdown(currentLang, page) {
  const pagePath = pageToPath(page);
  const options = ALL_LANGS.map((lang) => {
    const href = lang === 'en' ? pagePath : `/${lang}${pagePath}`;
    const active = lang === currentLang ? ' active' : '';
    return `<a href="${href}" class="lang-option${active}" style="text-decoration:none;"><img src="${flagUrl(lang)}" alt="${FLAGS[lang].name}" style="width:18px;height:18px;"><span>${FLAGS[lang].name}</span></a>`;
  }).join('\n                        ');

  return `<div class="lang-dropdown">
                    <button id="lang-toggle" class="lang-btn">
                        <img class="lang-flag" src="${flagUrl(currentLang)}" alt="${FLAGS[currentLang].name}" style="width:20px;height:20px;">
                        <svg class="w-3 h-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                    </button>
                    <div id="lang-menu" class="lang-menu">
                        ${options}
                    </div>
                </div>`;
}

// ─── 移动端语言切换器 ─────────────────────────────
function switcherMobile(currentLang, page) {
  const pagePath = pageToPath(page);
  return ALL_LANGS.map((lang) => {
    const href = lang === 'en' ? pagePath : `/${lang}${pagePath}`;
    const active = lang === currentLang ? ' active' : '';
    return `<a href="${href}" class="lang-mobile-btn${active}" style="text-decoration:none;"><img src="${flagUrl(lang)}" alt="${FLAGS[lang].name}" style="width:18px;height:18px;"><span>${FLAGS[lang].name}</span></a>`;
  }).join('\n                    ');
}

// ─── JS/CSS 相对路径改为绝对路径 ───────────────────────
function absolutifyScripts($) {
  $('script[src]').each(function () {
    const src = $(this).attr('src');
    if (!src) return;
    // 跳过已经是绝对路径或外部 CDN
    if (src.startsWith('/') || src.startsWith('http')) return;
    // 相对路径改为绝对路径（如 main.js?v=xxx → /main.js?v=xxx）
    $(this).attr('src', '/' + src);
  });
  $('link[rel="stylesheet"][href]').each(function () {
    const href = $(this).attr('href');
    if (!href) return;
    if (href.startsWith('/') || href.startsWith('http')) return;
    $(this).attr('href', '/' + href);
  });
}

// ─── 内部链接前缀 ──────────────────────────────────────
function prefixLinks($, lang) {
  $('a[href]').each(function () {
    let href = $(this).attr('href');
    if (!href) return;
    // 跳过外部链接、锚点、javascript、mailto
    if (/^(https?:|mailto:|javascript:|#)/i.test(href)) return;
    // 构建可重复执行：先移除已有语言前缀，避免 /ja/zh/blog/... 这类路径。
    href = href.replace(/^\/(zh|ja|ko|es)(?=\/)/, '');
    // 对 .html 链接和目录链接加语言前缀
    if (href.endsWith('.html') || href === '/' || href.endsWith('/')) {
      const prefix = href.startsWith('/') ? `/${lang}` : `/${lang}/`;
      $(this).attr('href', prefix + href);
    }
  });
}

// ─── 替换文本内容 ───────────────────────────────────────
function translateContent($, lang, strings) {
  $('[data-en]').each(function () {
    const enText = $(this).attr('data-en');
    const inlineTranslation = $(this).attr(`data-${lang}`);
    const translated = inlineTranslation || strings[enText];

    if (translated && $(this).children().length === 0) {
      $(this).text(translated);
    }
  });
}

// ─── 替换 meta 标签 ────────────────────────────────────
function translateMeta($, lang, pageMeta, page, article) {
  // lang 属性
  $('html').attr('lang', lang);

  const blogIndexMeta = page === 'blog/index.html' ? BLOG_INDEX_META[lang] : null;
  const articleTitle = getArticleText(article, 'title', lang);
  const articleDescription = getArticleText(article, 'desc', lang);
  const resolvedMeta = article
    ? {
        title: `${articleTitle} - Mzu favicondl`,
        description: articleDescription,
        ogTitle: articleTitle,
        ogDescription: articleDescription,
      }
    : (blogIndexMeta || pageMeta);

  // title
  if (resolvedMeta?.title) $('head title').first().text(resolvedMeta.title);

  // meta description
  if (resolvedMeta?.description)
    $('meta[name="description"]').attr('content', resolvedMeta.description);

  // OG
  if (resolvedMeta?.ogTitle || resolvedMeta?.title) {
    const socialTitle = resolvedMeta.ogTitle || resolvedMeta.title;
    $('meta[property="og:title"]').attr('content', socialTitle);
    $('meta[name="twitter:title"]').attr('content', socialTitle);
  }
  if (resolvedMeta?.ogDescription || resolvedMeta?.description) {
    const socialDescription = resolvedMeta.ogDescription || resolvedMeta.description;
    $('meta[property="og:description"]').attr('content', socialDescription);
    $('meta[name="twitter:description"]').attr('content', socialDescription);
  }

  // Canonical + OG URL
  const pagePath = pageToPath(page);
  const langPrefix = lang === 'en' ? '' : `/${lang}`;
  const pageUrl = `${DOMAIN}${langPrefix}${pagePath}`;

  if (page === '404.html') {
    let robots = $('meta[name="robots"]').first();
    if (!robots.length) {
      $('head').append('<meta name="robots" content="noindex, follow">');
      robots = $('meta[name="robots"]').first();
    }
    robots.attr('content', 'noindex, follow');
    $('link[rel="canonical"], link[rel="alternate"][hreflang]').remove();
  } else {
    let canonical = $('link[rel="canonical"]').first();
    if (!canonical.length) {
      $('head').append(`<link rel="canonical" href="${pageUrl}">`);
      canonical = $('link[rel="canonical"]').first();
    }
    canonical.attr('href', pageUrl);
  }

  let ogUrl = $('meta[property="og:url"]').first();
  if (!ogUrl.length) {
    $('head').append(`<meta property="og:url" content="${pageUrl}">`);
    ogUrl = $('meta[property="og:url"]').first();
  }
  ogUrl.attr('content', pageUrl);
}

// ─── 替换语言切换器 ────────────────────────────────────
function replaceSwitcher($, lang, page) {
  // 桌面端：替换 .lang-dropdown
  const desktopDropdown = $('.lang-dropdown').first();
  if (desktopDropdown.length) {
    desktopDropdown.replaceWith(switcherDropdown(lang, page));
  }

  // 移动端：替换 .lang-mobile-group
  const mobileGroup = $('.lang-mobile-group');
  if (mobileGroup.length) {
    mobileGroup.html(switcherMobile(lang, page));
  }
}

// ─── 构建单个语言页面 ──────────────────────────────────
function buildPage(html, lang, page, translations) {
  const $ = load(html, { decodeEntities: false });
  const t = translations[lang];
  const pageName = page.replace('.html', '');
  const article = getArticleRecord(page);

  // 1. Meta 标签
  translateMeta($, lang, t._pages?.[pageName], page, article);
  applyArticleIndexingPolicy($, article);

  // 2. 文本内容替换
  translateContent($, lang, t._strings || {});

  // 每个语言 URL 只输出对应语言正文，避免五份正文同时进入索引。
  localizeArticlePage($, article, lang, page);

  // 3. hreflang（先移除已有的，保证幂等）
  $('link[rel="alternate"][hreflang]').remove();
  if (page !== '404.html') $('link[rel="canonical"]').after(hreflangTags(page));

  // 4. JS/CSS 相对路径改绝对路径
  absolutifyScripts($);

  // 5. 内部链接加前缀（必须在替换切换器之前执行）
  prefixLinks($, lang);

  // 6. 语言切换器（在 prefixLinks 之后，避免切换器链接被二次加前缀）
  replaceSwitcher($, lang, page);

  // 输出页不再携带其他语言的 data-* 文案，减少重复文本与错误抓取。
  stripTranslationAttributes($);

  // 输出（支持子目录如 blog/index.html）
  const outFile = path.join(ROOT, lang, page);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, normalizeHtmlOutput($.html()), 'utf-8');
}

function normalizeHtmlOutput(html) {
  const protectedBlocks = [];
  const masked = html.replace(/<(pre|template|textarea)\b[\s\S]*?<\/\1>/gi, (block) => {
    const token = `\uE000FAVICONDL_BLOCK_${protectedBlocks.length}\uE001`;
    protectedBlocks.push(block.replace(/[ \t]+(?=\r?\n|$)/g, ''));
    return token;
  });

  const normalized = masked
    .replace(/[ \t]+(?=\r?\n|$)/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();

  const restored = normalized.replace(/\uE000FAVICONDL_BLOCK_(\d+)\uE001/g, (_, index) => (
    protectedBlocks[Number(index)]
  ));

  return `${restored}\n`;
}

// ─── 给英文根页面注入 hreflang + 多语言切换器 ─────────
function patchEnglishPage(html, page) {
  const $ = load(html, { decodeEntities: false });
  const article = getArticleRecord(page);

  // 如果已经有 hreflang，先移除（幂等）
  $('link[rel="alternate"][hreflang]').remove();

  // 先补齐 canonical / OG URL，404 则保持 noindex 且不设 canonical。
  translateMeta($, 'en', null, page, article);

  // 注入 hreflang
  if (page !== '404.html') $('link[rel="canonical"]').after(hreflangTags(page));

  // 替换语言切换器
  replaceSwitcher($, 'en', page);

  // 英文源页保留英文正文；其他语言译文放入 template，供后续构建使用但不渲染。
  if (article) {
    storeTranslationsAsTemplates($);
    updateEnglishArticleLabels($, article);
    updateArticleJsonLd($, article, 'en', pageToPath(page));
    applyArticleIndexingPolicy($, article);
  }

  return normalizeHtmlOutput($.html());
}

// ─── 复制静态资源软链接 ────────────────────────────────
function ensureSharedAssets(lang) {
  // 各语言目录需要能访问到 /favicons/、/blog/ 等资源
  // 因为 Vercel 是静态服务，语言目录下的页面用的是绝对路径 /favicons/...
  // 所以不需要复制资源，绝对路径直接指向根目录
}

// ─── 清理语言目录中的过期 JS 文件 ─────────────────────────
function cleanOldJsFiles(lang) {
  const jsFiles = ['main.js', 'tools.js'];
  const outDir = path.join(ROOT, lang);
  for (const file of jsFiles) {
    const dest = path.join(outDir, file);
    if (fs.existsSync(dest)) {
      fs.unlinkSync(dest);
    }
  }
}

// ─── 主流程 ─────────────────────────────────────────────
async function main() {
  console.log('🌐 i18n Build — 开始生成多语言页面\n');
  console.log(`   语言: ${ALL_LANGS.join(', ')}`);
  console.log(`   页面: ${PAGES.join(', ')}\n`);

  const translations = loadTranslations();
  let totalPages = 0;

  for (const page of PAGES) {
    const srcPath = path.join(ROOT, page);
    if (!fs.existsSync(srcPath)) {
      console.log(`⚠️  跳过 ${page}（文件不存在）`);
      continue;
    }
    // Strip BOM if present, so cheerio parses <head> correctly
    const rawBuf = fs.readFileSync(srcPath);
    const html = rawBuf[0] === 0xEF && rawBuf[1] === 0xBB && rawBuf[2] === 0xBF
      ? rawBuf.slice(3).toString('utf-8')
      : rawBuf.toString('utf-8');

    // 为每种目标语言生成页面
    for (const lang of LANGUAGES) {
      buildPage(html, lang, page, translations);
      totalPages++;
    }

    // 更新英文根页面（注入 hreflang + 多语言切换器）
    const patchedEnglish = patchEnglishPage(html, page);
    fs.writeFileSync(srcPath, patchedEnglish, { encoding: 'utf-8' });

    console.log(`✅ ${page} → en(patched), ${LANGUAGES.join(', ')}`);
  }

  // 清理旧的 JS 重定向文件（不再需要）
  for (const lang of LANGUAGES) {
    ensureSharedAssets(lang);
    cleanOldJsFiles(lang);
  }

  // ─── 博客页面 ────────────────────────────────
  const blogDir = path.join(ROOT, 'blog');
  if (fs.existsSync(blogDir)) {
    const blogFiles = fs.readdirSync(blogDir)
      .filter(f => f.endsWith('.html'));
    console.log(`\n   博客页面: ${blogFiles.join(', ')}\n`);

    for (const file of blogFiles) {
      const blogPage = `blog/${file}`;  // 如 'blog/index.html'
      const srcPath = path.join(ROOT, blogPage);
      const rawBlogBuf = fs.readFileSync(srcPath);
      const html = rawBlogBuf[0] === 0xEF && rawBlogBuf[1] === 0xBB && rawBlogBuf[2] === 0xBF
        ? rawBlogBuf.slice(3).toString('utf-8')
        : rawBlogBuf.toString('utf-8');

      for (const lang of LANGUAGES) {
        buildPage(html, lang, blogPage, translations);
        totalPages++;
      }

      // 给英文博客页注入 hreflang + 切换器
      const patchedBlog = patchEnglishPage(html, blogPage);
      fs.writeFileSync(srcPath, patchedBlog, { encoding: 'utf-8' });

      console.log(`✅ ${blogPage} → en(patched), ${LANGUAGES.join(', ')}`);
    }
  }

  console.log(`\n🎉 完成！共生成 ${totalPages} 个多语言页面`);
  console.log('   目录:', LANGUAGES.map((l) => `/${l}/`).join(', '));
}

main().catch((err) => {
  console.error('❌ 构建失败:', err);
  process.exit(1);
});
