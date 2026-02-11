/**
 * Vercel Edge Middleware — 浏览器语言自动检测
 * 仅在用户首次访问根路径 "/" 时生效
 * 根据 Accept-Language 头自动重定向到对应语言版本
 */

const SUPPORTED_LANGS = ['zh', 'ja', 'ko', 'es'];
const COOKIE_NAME = 'preferred_lang';

export default function middleware(request) {
  const url = new URL(request.url);

  // 仅对根路径 "/" 进行语言检测
  if (url.pathname !== '/' && url.pathname !== '/index.html') {
    return;
  }

  // 如果用户已经有语言偏好 cookie，不再自动重定向
  const cookie = request.headers.get('cookie') || '';
  if (cookie.includes(`${COOKIE_NAME}=`)) {
    return;
  }

  // 解析 Accept-Language 头
  const acceptLang = request.headers.get('accept-language') || '';
  const preferred = parseAcceptLanguage(acceptLang);

  // 找到第一个匹配的支持语言
  for (const lang of preferred) {
    const code = lang.split('-')[0].toLowerCase();
    if (SUPPORTED_LANGS.includes(code)) {
      // 重定向到对应语言页面，并设置 cookie 避免循环
      const response = new Response(null, {
        status: 302,
        headers: {
          Location: `/${code}/`,
          'Set-Cookie': `${COOKIE_NAME}=${code}; Path=/; Max-Age=31536000; SameSite=Lax`,
        },
      });
      return response;
    }
  }

  // 默认英文，不重定向
  return;
}

/**
 * 解析 Accept-Language 头，按权重排序返回语言代码列表
 * 例如: "zh-CN,zh;q=0.9,en;q=0.8" → ["zh-CN", "zh", "en"]
 */
function parseAcceptLanguage(header) {
  return header
    .split(',')
    .map((part) => {
      const [lang, q] = part.trim().split(';q=');
      return { lang: lang.trim(), q: q ? parseFloat(q) : 1.0 };
    })
    .sort((a, b) => b.q - a.q)
    .map((item) => item.lang);
}

export const config = {
  matcher: ['/', '/index.html'],
};
