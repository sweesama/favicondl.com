# Mzu favicondl - 即时网站图标获取器

> **https://favicondl.com** — 免费、快速、零成本的网站图标工具

输入网址/域名 → 抓取并下载 favicon，也可当作网站 logo 图标使用。附带图片转 favicon 工具、SEO 博客自动发布系统，支持 5 种语言。

## 🌟 功能特点

### 主页 - Favicon Extractor / Downloader
- ✅ 输入任意域名/网址，即时预览网站图标
- ✅ 支持多尺寸预览与下载（16/32/48/64/128）
- ✅ 一键复制 Direct URL 与 HTML 代码片段
- ✅ 支持下载 PNG，并可选"透明化处理"（实验）
- ✅ 对强保护站点支持"图标覆盖表"秒出（用于 chatgpt.com 等）
- ✅ 默认启用 Cloudflare Worker：更稳定的 HTML 解析与图标发现（含 manifest / apple-touch-icon）

### 工具页面 - 图片转 Favicon
- ✅ 拖拽上传图片（支持 PNG、JPG、SVG、GIF、WebP）
- ✅ 自动生成多种标准尺寸（16×16 ~ 512×512）
- ✅ ZIP 打包下载（包含所有尺寸 + manifest.json + HTML 代码）
- ✅ 单个尺寸独立下载
- ✅ 批量获取多网站 Favicon（最多 100 个域名）
- ✅ PNG / JPG / ICO 格式互转 + 自定义尺寸

### 🌐 多语言支持（i18n）
- ✅ **5 种语言**：English、中文、日本語、한국어、Español
- ✅ URL 路径路由（`/zh/`、`/ja/`、`/ko/`、`/es/`）
- ✅ 语言切换下拉菜单 + Twemoji 国旗图标
- ✅ hreflang SEO 标签（所有页面自动生成）
- ✅ `i18n/build.js` 一键构建所有语言版本

### 📝 博客自动发布系统
- ✅ **AI 生成文章**：Gemini API 单次调用生成 5 语言元数据（标题/描述/CTA）+ 英文和中文正文
- ✅ **GitHub Actions 自动化**：每天 UTC 00:00 自动生成 + i18n 构建 + commit & push
- ✅ **关键词队列**：`blog/queue.json` 管理待发布关键词
- ✅ **质量检查**：词数/字符比例/SEO 位置/AI 套话检测/禁止标签
- ✅ **多模型降级**：Gemini 3 Flash → 2.5 Flash → 2.5 Pro

### 📊 数据分析
- ✅ Google Analytics（G-7QLC8QV609）全站部署

## 🛠️ 技术栈

| 类别 | 技术 |
|------|------|
| **前端** | HTML5 + CSS3 + JavaScript (ES6+) |
| **样式** | Tailwind CSS (CDN) |
| **动画** | Anime.js |
| **图片处理** | Canvas API（纯前端） |
| **ZIP 打包** | JSZip（按需加载） |
| **图标发现/代理** | Cloudflare Worker |
| **兜底来源** | Google Favicon / DuckDuckGo / gstatic |
| **i18n 构建** | Node.js + Cheerio |
| **博客生成** | Google Gemini API（@google/genai） |
| **CI/CD** | GitHub Actions |
| **数据分析** | Google Analytics 4 |

## 💰 成本分析

| 项目 | 方案 | 成本 |
|------|------|------|
| 托管 | Netlify / GitHub Pages | **$0** |
| Favicon API | Google Favicon Service | **$0** |
| 图片处理 | 前端 Canvas | **$0** |
| CDN/代理 | Cloudflare Worker (免费额度) | **$0** |
| AI 文章 | Gemini API (免费额度 20 RPD) | **$0** |
| 数据分析 | Google Analytics 4 | **$0** |
| **总计** | | **$0/月** |

## 📁 项目结构

```
favicon/
├── index.html                  # 主页 - Favicon 获取器
├── tools.html                  # 工具页面（图片转换/批量处理）
├── documentation.html          # API 文档页面
├── privacy.html                # 隐私政策
├── 404.html                    # 404 错误页面
├── main.js                     # 主页 JavaScript
├── tools.js                    # 工具页 JavaScript
├── cloudflare-worker.js        # Cloudflare Worker 源码（单独部署）
├── sitemap.xml                 # 站点地图
├── robots.txt                  # 爬虫指引
│
├── i18n/                       # 多语言构建系统
│   ├── build.js                # i18n 构建脚本（生成 zh/ja/ko/es 页面）
│   ├── translations.js         # 翻译字典（5 语言）
│   └── package.json
│
├── blog/                       # 博客系统
│   ├── index.html              # 博客首页
│   ├── blog.css                # 博客样式
│   ├── blog.js                 # 博客 JS（语言切换/下拉菜单）
│   ├── *.html                  # 各篇博客文章（英文源文件）
│   ├── articles.json           # 文章索引（标题/描述/日期，5 语言）
│   ├── queue.json              # 关键词发布队列
│   └── scripts/
│       ├── generate-article.js # AI 文章生成脚本（Gemini API）
│       └── package.json
│
├── zh/                         # 中文页面（i18n build 自动生成）
├── ja/                         # 日本語页面
├── ko/                         # 한국어页面
├── es/                         # Español 页面
│
├── .github/workflows/
│   └── daily-blog.yml          # GitHub Actions：每日自动生成博客
│
└── favicons/                   # 网站自身的 favicon 资源
```

## 🚀 部署方式

### 方式 1: Netlify（推荐）
1. 将项目上传到 GitHub
2. 登录 [Netlify](https://netlify.com) → "New site from Git"
3. 选择仓库，自动部署

### 方式 2: GitHub Pages
1. 仓库 Settings → Pages → 选择 main 分支

### 方式 3: 本地运行
```bash
npx serve .
# 或
python -m http.server 8080
```

## 📖 使用说明

### 获取网站 Favicon
1. 在主页输入框输入域名（如 `google.com`）
2. 系统自动获取并显示图标预览
3. 点击"复制"获取 URL 或 HTML 代码
4. 点击"下载图标"保存到本地

### 图片转 Favicon
1. 进入"工具"页面 → "图片转 Favicon"
2. 拖拽或选择图片上传
3. 选择需要的尺寸
4. 点击"下载 ZIP 包"获取所有文件

### i18n 多语言构建
```bash
cd i18n
npm install
node build.js
```
会读取英文源文件 + `translations.js` 字典，自动生成 `/zh/`、`/ja/`、`/ko/`、`/es/` 下的所有页面（含博客）。

### 博客文章生成
```bash
cd blog/scripts
npm install
GEMINI_API_KEY=your_key node generate-article.js
```
从 `queue.json` 取下一个关键词，调用 Gemini API 生成 5 语言文章，输出 HTML + 更新 `articles.json` + `sitemap.xml`。

GitHub Actions 每天 UTC 00:00 自动执行上述流程 + i18n 构建 + commit & push。

## 🔧 API 说明

### 默认模式（推荐）：Cloudflare Worker
Worker 会抓取网站 HTML 并解析 `<link rel="icon">`、`apple-touch-icon`、`manifest.webmanifest` 等，返回 `iconUrl`（真实候选）与 `proxyUrl`（绕过 CORS）。

### 兜底模式：Google Favicon Service
当站点无法解析时，回退到聚合源。URL 模板：
```
https://www.google.com/s2/favicons?domain={域名}&sz={尺寸}
```

## 📝 更新日志

### v1.3.0 (2026-02-12)
- ✅ **5 语言支持**：新增日本語、한국어、Español（URL 路径路由）
- ✅ **i18n 构建系统**：`i18n/build.js` 一键生成 80+ 多语言页面
- ✅ **博客 AI 生成扩展**：单次 Gemini API 调用输出 5 语言元数据
- ✅ **GitHub Actions 优化**：生成文章后自动运行 i18n build
- ✅ **Google Analytics 全站部署**（G-7QLC8QV609）
- ✅ 博客语言切换器修复（CSS/JS + 缓存版本号 v=20260211）
- ✅ hreflang 标签去重（build 幂等性）
- ✅ 图标加载 Bug 修复（未定义变量 toTry/fallbackSources）

### v1.2.0 (2026-02)
- ✅ 语言切换 UI 产品化：下拉菜单 + Twemoji 国旗图片
- ✅ 修复语言跨页面持久化（全局 click 拦截器 + localStorage/URL 双通道）
- ✅ 缓存破除机制（JS 文件加版本参数）
- ✅ 新增 SEO：OG 标签、Twitter Card、canonical URL、robots.txt、sitemap.xml
- ✅ 新增网站 favicon（SVG）
- ✅ 新增隐私政策页 + 404 错误页

### v1.1.0 (2026-01)
- ✅ Cloudflare Worker 图标发现优化（候选上限 + 提前停止策略）
- ✅ 修复批量 ZIP 下载 CORS 问题（通过 Worker 代理）
- ✅ 图标卡片垂直居中优化
- ✅ 批量处理命名模式（域名 / 索引）

### v1.0.0 (2024-12)
- ✅ 完成主页 Favicon 获取功能
- ✅ 完成图片转 Favicon 工具
- ✅ 完成批量处理 + ZIP 打包
- ✅ 完成 manifest.json / HTML 代码生成

## 📄 许可证

MIT License

## 🙏 致谢

- [Google Favicon Service](https://www.google.com/s2/favicons) - Favicon API
- [Google Gemini API](https://ai.google.dev/) - AI 文章生成
- [Tailwind CSS](https://tailwindcss.com) - CSS 框架
- [Anime.js](https://animejs.com) - 动画库
- [JSZip](https://stuk.github.io/jszip/) - ZIP 生成库
- [Cheerio](https://cheerio.js.org/) - HTML 解析（i18n 构建）
- [Twemoji](https://github.com/twitter/twemoji) - 国旗表情图标
