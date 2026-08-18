import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BLOG_DIR = path.resolve(__dirname, '..');
const ARTICLES_PATH = path.join(BLOG_DIR, 'articles.json');
const SITEMAP_PATH = path.resolve(BLOG_DIR, '..', 'sitemap.xml');
const HOST = 'favicondl.com';

const INDEXNOW_KEY = '8894b846bf144cbdb509ce481d85f7d9';
const INDEXNOW_URL = 'https://api.indexnow.org/indexnow';

async function pingIndexNow() {
    console.log(`🚀 开始向 IndexNow 提交新URL...`);

    if (!fs.existsSync(ARTICLES_PATH)) {
        console.log('⚠️ articles.json 不存在，跳过 IndexNow 提交。');
        return;
    }

    const articles = JSON.parse(fs.readFileSync(ARTICLES_PATH, 'utf-8'));
    const requestedSlugs = [...new Set(process.argv.slice(2))]
        .filter(slug => /^[a-z0-9-]+$/.test(slug));
    const today = new Date().toISOString().split('T')[0];
    const sitemap = fs.existsSync(SITEMAP_PATH)
        ? fs.readFileSync(SITEMAP_PATH, 'utf-8')
        : '';

    // 发布工作流会显式传入本次合并的 slug；本地手动运行时才回退到当天文章。
    const newArticles = articles.filter(article => {
        const selected = requestedSlugs.length > 0
            ? requestedSlugs.includes(article.slug)
            : article.publishDate === today;
        const isIndexable = sitemap.includes(`https://${HOST}/blog/${article.slug}.html`);
        return selected && isIndexable;
    });

    if (newArticles.length === 0) {
        console.log('✅ 没有已发布且可索引的新文章，无需提交。');
        return;
    }

    const urlList = [];

    // 构建每篇文章及其对应多语言版本的 URL
    for (const article of newArticles) {
        const slug = article.slug;
        urlList.push(`https://${HOST}/blog/${slug}.html`);
        urlList.push(`https://${HOST}/zh/blog/${slug}.html`);
        urlList.push(`https://${HOST}/ja/blog/${slug}.html`);
        urlList.push(`https://${HOST}/ko/blog/${slug}.html`);
        urlList.push(`https://${HOST}/es/blog/${slug}.html`);
    }

    console.log(`📝 收集到 ${urlList.length} 个新 URL 需要提交。`);

    const payload = {
        host: HOST,
        key: INDEXNOW_KEY,
        keyLocation: `https://${HOST}/${INDEXNOW_KEY}.txt`,
        urlList: urlList
    };

    try {
        const response = await fetch(INDEXNOW_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
            },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            console.log(`✅ 成功向 IndexNow 提交了批量 URL。HTTP ${response.status}`);
        } else {
            const errorText = await response.text();
            console.error(`❌ 提交 IndexNow 失败。HTTP ${response.status}: ${errorText}`);
            process.exit(1);
        }
    } catch (error) {
        console.error(`❌ 请求 IndexNow API 出错: ${error.message}`);
        process.exit(1);
    }
}

pingIndexNow();
