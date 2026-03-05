# 自动化独立站全语种博客生成方案 (Automated SEO Blog SOP)

本文档是成熟的“自动化多语言 SEO 博客系统”标准操作程序 (SOP)。这套系统集成了防 AI 八股文提示词、多语言独立适配（非机翻）、自动化发布工作流以及标准化的 Hreflang 国际化 SEO 架构。

在未来开发任何新出海独立站或工具网站时，按照以下步骤即可快速为新项目复刻这套强大的自然流量获取系统。

---

## 第一步：构建核心目录结构

在你的新项目根目录下，创建以下基础目录和核心文件空壳：

```text
├── .github/
│   └── workflows/
│       └── daily-blog.yml       # 自动生成和发布的定时任务脚本
├── blog/
│   ├── articles.json            # 数据库：记录已生成的文章元数据 (初始为 [])
│   ├── queue.json               # 任务队列：等待生成的关键词及意图 (包含多篇带 pending 状态文章的 JSON)
│   └── scripts/
│       ├── generate-article.js  # 核心生成引擎，调用 Gemini API
│       ├── ping-indexnow.js     # IndexNow 搜索引擎主动推送脚本
│       └── package.json         # 博客脚本依赖
├── i18n/
│   ├── build.js                 # 多语言静态页面生成器 (注入 hreflang)
│   ├── es.json                  # 西班牙文本地化词典
│   ├── ja.json                  # 日文本地化词典
│   ├── ko.json                  # 韩文本地化词典
│   ├── zh.json                  # 中文本地化词典
│   └── package.json             # 编译脚本依赖 (cheerio 等)
└── sitemap.xml                  # 站点地图，每次生成文章后脚本会自动向其中追加 URL
```

---

## 第二步：安装必要的依赖

你需要进入对应的脚本目录，初始化 npm 并安装必须的包。注意：两个目录的 `package.json` 都必须配置 `"type": "module"` 以支持 ES6 Import 语法。

```bash
# 1. 配置博客生成环境
cd blog/scripts
npm init -y
npm install @google/genai

# 2. 配置多语言编译环境
cd ../../i18n
npm init -y
npm install cheerio
```

---

## 第三步：迁移并修改核心脚本

你需要从以前成功的项目（如 favicondl）中把以下三个核心文件复制过来，并做针对性修改：

### 1. 自动生成引擎 `blog/scripts/generate-article.js`
这是整个系统的心脏。复制过来后，你需要**全局搜索并替换**以下与旧项目强绑定的信息：
- 替换 `favicondl.com` 为你的**新项目域名**。
- 修改 `buildHTML` 函数：这里面写死了生成的博客网页 HTML 骨架。你需要把头部的 Meta 标签、导航栏菜单、CSS 链接、Google Analytics ID、Favicon 图标全换成新站点的代码。

**核心：修改“黄金 Prompt (提示词)”**
找到 `buildPrompt` 函数。未来的新项目，你只需要替换 prompt 顶部的**第一句话**：
```javascript
// 旧项目 (FaviconDL)：
// You write for Mzu favicondl (https://favicondl.com), a favicon download and conversion tool.

// 新项目演示 (如：在线 PDF 工具)：
// You write for EzPDF (https://ezpdf.com), an online tool to merge, split, and compress PDF files fast and securely.
```
**千万不能删掉以下防雷指令，这是 SEO 制胜关键：**
- **ANTI-AI RULES**: 禁止由于 `In today's digital landscape...` 等套话。要求第一人称视角叙事并举真实案例。
- **MULTI-LANGUAGE**: 明确警告 AI `"DO NOT provide literal word-for-word translations... MUST provide hyper-localized, culturally adapted content..."`。这是防止你几百个小语种页面被 Google 判定为批量复制内容（Duplicate Content）而降权的核心法宝。

### 2. 多语言编译系统 `i18n/build.js`
这不仅仅是个翻译文本替换器，它最强大的功能在于**自动化注入完美的 `hreflang` 标签**防重。
- 复制旧项目的 `build.js`。
- 修改顶部常量：`const DOMAIN = 'https://你的新域名.com';`
- 确保 `LANGUAGES` 数组符合你的新项目（例如 `['zh', 'ja', 'ko', 'es']`）。
- **工作原理**：每次运行 `node i18n/build.js` 时，它会抓取根目录和 `/blog` 目录下的所有原版英文 `.html`，用 Cheerio 匹配 `data-en` 属性并替换为目标语言文本。**最重要的是**，它会自动向每个页面的 `<head>` 里写入全语种互指的 `<link rel="alternate" hreflang="xx">` 标签，极大地讨好 Google 爬虫。

### 3. Git 自动化工作流 `.github/workflows/daily-blog.yml`
新项目复制此 YAML 文件后，检查以下步骤：
1. **触发条件**：可以保留 `cron` 定时任务（如每天运行一次）和 `workflow_dispatch`（支持在 GitHub 网页端手动点击一键运行）。
2. **Secrets 设置**：务必在 GitHub 新仓库的 Settings -> Secrets and variables -> Actions 中添加：
   - `GEMINI_API_KEY`: 填入你的 Google Gemini API 密钥。

工作流的逻辑应该是这样串联的：
1. 检出（Checkout）最新代码
2. `npm install` (分别安装 blog/scripts 和 i18n 两个目录的依赖)
3. `node generate-article.js` (读取 queue 并生成一篇新文章)
4. `node build.js` (更新多语言站点的文件和 hreflang)
5. `git push` (把生成的 html 文件、更新后的 json 数据库提交回主分支，这会自动触发 Vercel 等平台的发版)
6. `node ping-indexnow.js` (唤醒 Bing 服务器，强制秒级抓取新页面)

---

## 第四步：任务准备与内容排期

核心架构搭建完毕后，日常的运营工作非常简单。

### `blog/queue.json` 配置示例
这是一个任务调度中心。你需要用传统的 SEO 工具查好长尾词，并将它们放入这个 JSON 数组中排队：

```json
[
  {
    "keyword": "how to compress pdf without losing quality",
    "slug": "compress-pdf-no-quality-loss",
    "tags": ["tutorial", "pdf"],
    "intent": "how-to",
    "depth": "standard",
    "status": "pending"
  },
  {
    "keyword": "what is a vector pdf",
    "slug": "what-is-vector-pdf",
    "tags": ["guide"],
    "intent": "informational",
    "depth": "brief",
    "status": "pending"
  }
]
```
`status` 字段说明：
- `"pending"`：等待脚本抓取生成。每次运行 GitHub Action，系统只会挑出**第一个 status 为 pending** 的文章去写，以控制 API 预算和保证质量稳定。
- `"done"`：脚本成功生成并发布文章后，会自动把这篇的 `status` 写回为 `done`。

### `blog/articles.json` (防撞车与内链网)
这是一个只读+自动写入的“轻型数据库”（初始为 `[]`）。
随着文章越生越多，脚本会自动把已发布文章的标题和描述录入这里。下次 AI 再写新文章时，脚本会把这个数据库倒喂给 AI，**强制 AI 避开已经被讲过的论点**，并在新文章中自然插入指向老文章的相对链接 `/blog/old-article.html`，自动搭建网站的网状内链。

---

## 第五步：新项目本地跑通测试

在把完全配好的代码推上 GitHub 托管全自动运行前，务必在本地环境完整模拟执行一次：

```bash
# 1. 本地设置环境变量
export GEMINI_API_KEY="你的真实API_KEY" # ⚠️ macOS/Linux
# Windows (PowerShell) 用户请用: $env:GEMINI_API_KEY="你的真实API_KEY"

# 2. 预设排期
# 在 queue.json 中预留至少 1 篇 pending 状态的测试文章。

# 3. 运行生成引擎
cd blog/scripts
node generate-article.js
# 观察终端控制台打点：
# - 是否成功拦截了 AI 套话？
# - 中文/外语翻译质量是否达标？
# - 是否在 /blog 目录下成功生成了 .html 文件？
# - 是否自动修改了 queue.json、articles.json 和根目录的 sitemap.xml？

# 4. 运行多语言编译
cd ../../i18n
node build.js
# 检查：
# - 根目录下是否自动生成了对应的 /zh、/ja 文件夹？
# - 任意点开一个生成好的含有博客网页的目录，检查 HTML 里的 hreflang 标签群是否指向严谨。
```

一切本地验证无误后，提交并 Push 到 GitHub。自此，你就能见证一套全权由 AI 自主防范重复惩罚、独立撰写多语种超本地化长文，并每天定时发版的现代顶尖出海工业流！
