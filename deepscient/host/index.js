/**
 * DeepScient 的主机半边：改名 + 开数据口。
 *
 * 改名为什么走 `webServer.tapIndex` 而不是改前端 dist：
 *   - dist 在安装目录里，dsh 一升级就被覆盖，改名会静默回退；
 *   - tap 是服务端在每次渲染 index.html 时跑的纯函数，升级不影响，也不改别人的文件。
 * 代价是首屏 HTML 之外还有两处要管：`manifest.webmanifest` 是静态文件，得自己接管；
 * 浏览器标签页标题由 index.html 的 <title> 决定，tap 换掉即可。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { handleApi } from './api.js'
import { handleAuth } from './auth.js'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..')

export const name = 'deepscient'
export const inject = ['webServer']

const PRODUCT = 'DeepScient'
const TAGLINE = '科研工作台'

/* 前端 dist 里的 index.html 是别人构建的产物，只认它现有的标记。 */
const TITLE_RE = /<title>[\s\S]*?<\/title>/i

/**
 * 首屏改名的同时顺手摘掉出厂的那个用量胶囊。
 *
 * 为什么用 CSS 而不是换掉那个槽：出厂用量胶囊注册在列表槽 `conversation.composer.dock`
 * 的 `id: "usage"` 上，它把「总 token · 缓存命中 x%」拼成同一个文本节点里的裸字符串，
 * 没有任何子元素可以只删一半；跨包重注册同 id 又要赌加载顺序。选择器挂在它自己的
 * `data-composer-stat="usage"` 属性上，只遮这一个元素，其余（轮/步/速度）照旧。
 * 取而代之的是我们自己的胶囊，只报 token 消耗量。
 *
 * 幂等：两个标记各查各的，重复渲染不会插两遍。
 */
export function brandIndex(html) {
  if (typeof html !== 'string') return html
  let out = html

  if (!out.includes('data-deepscient="brand"')) {
    out = out.replace(TITLE_RE, `<title>${PRODUCT} · ${TAGLINE}</title>`)
    const head = [
      `<meta name="application-name" content="${PRODUCT}" data-deepscient="brand">`,
      `<meta name="apple-mobile-web-app-title" content="${PRODUCT}">`,
      `<meta name="description" content="${PRODUCT} ${TAGLINE}：从选题到投稿的研究工作台">`,
      `<meta name="theme-color" content="#1f6f5c">`,
    ].join('')
    if (/<head(\s[^>]*)?>/i.test(out)) {
      out = out.replace(/<head(\s[^>]*)?>/i, (open) => `${open}${head}`)
    } else {
      out = `${head}${out}`
    }
  }

  if (!out.includes('data-deepscient="composer-stats"')) {
    const style = `<style data-deepscient="composer-stats">[data-composer-stat="usage"]{display:none!important}</style>`
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, `${style}</head>`)
    else out = `${style}${out}`
  }

  return out
}

/**
 * manifest 是静态文件，SPA 服务器会直接吐原字节；这里接管成我们自己的。
 *
 * 不读原文件再改写：原文件在安装目录的 dist 里，路径随版本变，猜路径迟早猜错。
 * manifest 的字段少且稳定，整份自己写反而更可靠。
 */
function manifest(res) {
  const body = JSON.stringify(
    {
      name: `${PRODUCT} ${TAGLINE}`,
      short_name: PRODUCT,
      description: `${PRODUCT}：科研版 Harness`,
      start_url: './',
      scope: './',
      display: 'fullscreen',
      background_color: '#0f1512',
      theme_color: '#1f6f5c',
      icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    },
    null,
    2,
  )
  res.writeHead(200, {
    'content-type': 'application/manifest+json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** 数据口只面对本机浏览器。回环之外一律 403：这里没有鉴权，就不该被外部访问。 */
function isLoopback(req) {
  const addr = req.socket?.remoteAddress ?? ''
  return LOOPBACK.has(addr) || addr.startsWith('127.') || addr === ''
}

function forbidden(res) {
  res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('DeepScient API 只对本机开放')
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.tapIndex(brandIndex), 'deepscient: brand')

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/manifest.webmanifest',
        handler: (req, res) => {
          if (!isLoopback(req)) return forbidden(res)
          manifest(res)
        },
      }),
    'deepscient: manifest',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/deepscient',
        handler: async (req, res) => {
          if (!isLoopback(req)) return forbidden(res)
          // 账号路由先过：登录页要在没有会话的情况下也能把话说清楚。
          if (await handleAuth(req, res)) return
          const handled = await handleApi(req, res, ctx)
          if (handled) return
          // /deepscient 下没有页面，其余路径明确 404，别掉进 SPA 回退。
          res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'not-found', path: req.url }))
        },
      }),
    'deepscient: api',
  )

  ctx.logger?.info?.(`deepscient: ${PRODUCT} 已挂载（品牌 tap + /deepscient/api）`)
}

export { pkgDir }
