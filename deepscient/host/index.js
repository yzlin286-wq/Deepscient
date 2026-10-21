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
import { gateUpgrade, handleAuth, handleCallback } from './auth.js'
import { handlePartnerPublic } from './relay.js'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..')

export const name = 'deepscient'
export const inject = ['webServer']

const PRODUCT = 'DeepScient'
const TAGLINE = '科研工作台'

/* 前端 dist 里的 index.html 是别人构建的产物，只认它现有的标记。 */
const TITLE_RE = /<title>[\s\S]*?<\/title>/i

/**
 * 一份自带的视觉层：宿主定制属性优先，拿不到时退回我们自己的取色。
 *
 * 为什么跟着首屏一起注入而不是打进客户端包：
 *   - 样式先于脚本生效，首屏不会闪一下未上色的原生控件；
 *   - 客户端的行内样式只引用变量，改配色不用重新编译整包；
 *   - 变量全带 --dsw- 前缀的兜底，宿主的深浅色主题一换，这边自动跟上。
 * 全是 --ds- 前缀的类，不碰裸标签选择器，避免溢出到宿主自己的界面。
 */
const UI_CSS = `
:root{
  --ds-font:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;
  --ds-font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --ds-bg:var(--dsw-alias-bg-base,#ffffff);
  --ds-surface:var(--dsw-alias-bg-layer-1,#f7f8f8);
  --ds-surface-2:var(--dsw-alias-bg-layer-2,#f1f3f3);
  --ds-surface-3:var(--dsw-alias-bg-layer-3,#ebeeee);
  --ds-fg:var(--dsw-alias-label-primary,#101413);
  --ds-fg-2:var(--dsw-alias-label-secondary,#5c6360);
  --ds-fg-3:var(--dsw-alias-label-tertiary,#858c89);
  --ds-border:var(--dsw-alias-border-l2,rgba(16,20,19,.12));
  --ds-border-strong:var(--dsw-alias-border-l3,rgba(16,20,19,.2));
  --ds-brand:#1f6f5c;
  --ds-brand-hover:#1a5d4e;
  --ds-on-brand:#ffffff;
  --ds-brand-soft:rgba(31,111,92,.10);
  --ds-ok:var(--dsw-alias-state-success-primary,#2f7d63);
  --ds-ok-soft:rgba(47,125,99,.12);
  --ds-warn:var(--dsw-alias-state-warn-primary,#9a6a00);
  --ds-warn-soft:rgba(154,106,0,.13);
  --ds-err:var(--dsw-alias-state-error-primary,#b3261e);
  --ds-err-soft:rgba(179,38,30,.11);
  --ds-info:var(--dsw-alias-link,#2b6cb0);
  --ds-info-soft:rgba(43,108,176,.10);
  --ds-focus:#2f8f74;
  --ds-radius-sm:6px;
  --ds-radius-md:10px;
  --ds-radius-lg:14px;
  --ds-radius-pill:999px;
  --ds-space-1:4px;
  --ds-space-2:8px;
  --ds-space-3:12px;
  --ds-space-4:16px;
  --ds-space-5:24px;
  --ds-space-6:32px;
  --ds-text-xs:11px;
  --ds-text-sm:12px;
  --ds-text-md:13px;
  --ds-text-lg:15px;
  --ds-text-xl:20px;
  --ds-shadow-1:0 1px 2px rgba(0,0,0,.04),0 4px 16px rgba(0,0,0,.06);
  --ds-shadow-2:0 18px 48px rgba(0,0,0,.22);
  --ds-dur:140ms;
}
body[data-ds-dark-theme]{
  --ds-bg:var(--dsw-alias-bg-base,#0f1512);
  --ds-surface:var(--dsw-alias-bg-layer-1,#151d19);
  --ds-surface-2:var(--dsw-alias-bg-layer-2,#1b2521);
  --ds-surface-3:var(--dsw-alias-bg-layer-3,#212c27);
  --ds-fg:var(--dsw-alias-label-primary,#e8eeeb);
  --ds-fg-2:var(--dsw-alias-label-secondary,#a9b5b0);
  --ds-fg-3:var(--dsw-alias-label-tertiary,#7f8c87);
  --ds-border:var(--dsw-alias-border-l2,rgba(255,255,255,.12));
  --ds-border-strong:var(--dsw-alias-border-l3,rgba(255,255,255,.2));
  --ds-brand:#58b89a;
  --ds-brand-hover:#6ac4a7;
  --ds-on-brand:#08120e;
  --ds-brand-soft:rgba(88,184,154,.14);
  --ds-ok:var(--dsw-alias-state-success-primary,#58b89a);
  --ds-ok-soft:rgba(88,184,154,.14);
  --ds-warn:var(--dsw-alias-state-warn-primary,#e0b05a);
  --ds-warn-soft:rgba(224,176,90,.14);
  --ds-err:var(--dsw-alias-state-error-primary,#f08a80);
  --ds-err-soft:rgba(240,138,128,.14);
  --ds-info:var(--dsw-alias-link,#7fb3e8);
  --ds-info-soft:rgba(127,179,232,.14);
  --ds-focus:#8fd6bf;
  --ds-shadow-1:0 1px 2px rgba(0,0,0,.4),0 4px 16px rgba(0,0,0,.45);
  --ds-shadow-2:0 18px 48px rgba(0,0,0,.6);
}
.ds-page{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--ds-fg);font-family:var(--ds-font)}
.ds-page__header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;padding:14px 20px;background:var(--ds-bg);border-bottom:1px solid var(--ds-border);backdrop-filter:none;flex-wrap:wrap}
.ds-page__body{flex:1;min-height:0;overflow:auto;padding:16px 20px 40px}
.ds-page__inner{width:100%;max-width:1080px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.ds-h1{font-size:var(--ds-text-lg);font-weight:650;letter-spacing:.2px;margin:0}
.ds-h2{font-size:var(--ds-text-md);font-weight:650;margin:0}
.ds-sub{font-size:var(--ds-text-sm);color:var(--ds-fg-2);line-height:1.6}
.ds-mono{font-family:var(--ds-font-mono);font-variant-numeric:tabular-nums}
.ds-num{font-family:var(--ds-font-mono);font-variant-numeric:tabular-nums;text-align:right}
.ds-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ds-spacer{flex:1}
.ds-page__heading{display:flex;flex-direction:column;gap:2px;min-width:0}
.ds-card{background:var(--ds-surface);border:1px solid var(--ds-border);border-radius:var(--ds-radius-lg);padding:16px;display:flex;flex-direction:column;gap:10px}
.ds-card--flat{background:transparent}
.ds-stage__head{width:100%;display:flex;align-items:center;gap:10px;padding:10px 14px;background:transparent;border:none;color:inherit;font:inherit;cursor:pointer;text-align:left}
.ds-stage__head:hover{background:var(--dsw-alias-interactive-bg-hover,var(--ds-surface-2))}
.ds-stage__head:focus-visible{outline:2px solid var(--ds-focus);outline-offset:-2px}
.ds-stat{display:flex;flex-direction:column;gap:3px;padding:10px 12px;border:1px solid var(--ds-border);border-radius:var(--ds-radius-md);background:var(--ds-surface-2)}
.ds-stat__label{font-size:var(--ds-text-xs);color:var(--ds-fg-3)}
.ds-stat__value{font-family:var(--ds-font-mono);font-variant-numeric:tabular-nums;font-size:var(--ds-text-xl);font-weight:650;line-height:1.2}
.ds-stat__hint{font-size:var(--ds-text-xs);color:var(--ds-fg-3);line-height:1.5}
.ds-section__head{display:flex;align-items:center;gap:8px}
.ds-grid-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
.ds-chip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:var(--ds-radius-pill);font-size:var(--ds-text-xs);line-height:1;border:1px solid transparent;background:var(--ds-surface-3);color:var(--ds-fg-2);white-space:nowrap}
.ds-chip--pass{background:var(--ds-ok-soft);color:var(--ds-ok);border-color:transparent}
.ds-chip--fail{background:var(--ds-err-soft);color:var(--ds-err)}
.ds-chip--warn,.ds-chip--manual{background:var(--ds-warn-soft);color:var(--ds-warn)}
.ds-chip--skip{background:transparent;color:var(--ds-fg-3);border-color:var(--ds-border)}
.ds-chip--info{background:var(--ds-info-soft);color:var(--ds-info)}
.ds-chip__dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.ds-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border-radius:var(--ds-radius-md);border:1px solid var(--ds-border-strong);background:var(--ds-surface);color:var(--ds-fg);font-size:var(--ds-text-sm);font-family:inherit;cursor:pointer;transition:background var(--ds-dur) ease,border-color var(--ds-dur) ease,transform var(--ds-dur) ease}
.ds-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--ds-surface-2));border-color:var(--ds-border-strong)}
.ds-btn:active:not(:disabled){transform:translateY(1px)}
.ds-btn:focus-visible{outline:2px solid var(--ds-focus);outline-offset:2px}
.ds-btn:disabled{opacity:.45;cursor:not-allowed}
.ds-btn--primary{background:var(--ds-brand);border-color:var(--ds-brand);color:var(--ds-on-brand);font-weight:600}
.ds-btn--primary:hover:not(:disabled){background:var(--ds-brand-hover);border-color:var(--ds-brand-hover)}
.ds-btn--ghost{background:transparent;border-color:transparent}
.ds-btn--ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--ds-surface-2))}
.ds-btn--danger{color:var(--ds-err);border-color:var(--ds-err);background:transparent}
.ds-btn--sm{height:26px;padding:0 9px;font-size:var(--ds-text-xs)}
.ds-iconbtn{width:28px;height:28px;padding:0;display:grid;place-items:center;border-radius:var(--ds-radius-md);border:1px solid transparent;background:transparent;color:var(--ds-fg-2);cursor:pointer;transition:background var(--ds-dur) ease,color var(--ds-dur) ease}
.ds-iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,var(--ds-surface-2));color:var(--ds-fg)}
.ds-iconbtn:focus-visible{outline:2px solid var(--ds-focus);outline-offset:2px}
.ds-iconbtn:disabled{opacity:.45;cursor:not-allowed}
.ds-input,.ds-select,.ds-textarea{min-height:30px;padding:5px 9px;border-radius:var(--ds-radius-md);border:1px solid var(--ds-border-strong);background:var(--ds-surface);color:var(--ds-fg);font-family:inherit;font-size:var(--ds-text-sm);transition:border-color var(--ds-dur) ease,box-shadow var(--ds-dur) ease}
.ds-input::placeholder,.ds-select::placeholder,.ds-textarea::placeholder{color:var(--ds-fg-3)}
.ds-input:focus-visible,.ds-select:focus-visible,.ds-textarea:focus-visible{outline:2px solid var(--ds-focus);outline-offset:1px}
.ds-input:disabled,.ds-select:disabled,.ds-textarea:disabled{opacity:.5}
.ds-scroll{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain}
.ds-table{width:100%;border-collapse:collapse;font-size:var(--ds-text-sm)}
.ds-table th{position:sticky;top:0;z-index:1;background:var(--ds-surface);text-align:left;padding:7px 9px;border-bottom:1px solid var(--ds-border-strong);font-weight:600;color:var(--ds-fg-2);font-size:var(--ds-text-xs);letter-spacing:.02em;white-space:nowrap}
.ds-table td{padding:7px 9px;border-bottom:1px solid var(--ds-border);vertical-align:top;line-height:1.5}
.ds-table tbody tr:hover{background:var(--dsw-alias-interactive-bg-hover,var(--ds-surface-2))}
.ds-table tr:last-child td{border-bottom:none}
.ds-link{color:var(--ds-info);text-decoration:none;border-bottom:1px solid transparent}
.ds-link:hover{text-decoration:underline}
.ds-link:focus-visible{outline:2px solid var(--ds-focus);outline-offset:2px}
.ds-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:24px 16px;border:1px dashed var(--ds-border-strong);border-radius:var(--ds-radius-md);color:var(--ds-fg-2);font-size:var(--ds-text-sm);text-align:center}
.ds-skeleton{background:linear-gradient(90deg,var(--ds-surface-2),var(--ds-surface-3),var(--ds-surface-2));background-size:200% 100%;animation:ds-shimmer 1.4s ease infinite;border-radius:var(--ds-radius-sm);min-height:12px}
@keyframes ds-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.ds-dialog{background:var(--ds-bg);border:1px solid var(--ds-border-strong);border-radius:var(--ds-radius-lg);box-shadow:var(--ds-shadow-2);max-height:min(86vh,760px);overflow:auto}
.ds-backdrop{position:fixed;inset:0;display:grid;place-items:center;background:rgba(0,0,0,.42);padding:20px;z-index:9000}
.ds-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.ds-live{font-size:var(--ds-text-sm);color:var(--ds-fg-2)}
.ds-live--error{color:var(--ds-err)}
.ds-divider{height:1px;background:var(--ds-border);margin:4px 0}
.ds-note{font-size:var(--ds-text-sm);color:var(--ds-fg-2);line-height:1.65}
.ds-kbd{display:inline-block;padding:1px 5px;border-radius:var(--ds-radius-sm);border:1px solid var(--ds-border-strong);background:var(--ds-surface-2);color:var(--ds-fg-2);font-family:var(--ds-font-mono);font-size:var(--ds-text-xs);line-height:1.5}
@media (max-width:720px){
  .ds-page__header{padding:10px 14px}
  .ds-page__body{padding:12px 14px 32px}
  .ds-grid-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ds-hide-sm{display:none!important}
  .ds-dialog{width:100%!important}
}
@media (max-width:480px){
  .ds-grid-stats{grid-template-columns:1fr}
  .ds-page__header{gap:8px}
}
@media (prefers-reduced-motion:reduce){
  .ds-skeleton{animation:none}
  .ds-btn,.ds-iconbtn,.ds-input,.ds-select,.ds-textarea{transition:none}
}
.ds-artifact{display:flex;gap:8px;align-items:baseline;padding:7px 10px;border-radius:var(--ds-radius-md);border:1px solid var(--ds-border-strong);background:transparent;color:inherit;font:inherit;font-size:var(--ds-text-sm);cursor:pointer;text-align:left;transition:background var(--ds-dur) ease,border-color var(--ds-dur) ease}
.ds-artifact:hover{background:var(--dsw-alias-interactive-bg-hover,var(--ds-surface-2))}
.ds-artifact:focus-visible{outline:2px solid var(--ds-focus);outline-offset:2px}
.ds-artifact.is-present{border-color:var(--ds-brand);background:var(--ds-brand-soft)}
.ds-docs{display:flex;gap:18px;align-items:flex-start}
.ds-docs__nav{min-width:148px;position:sticky;top:0;display:flex;flex-direction:column;gap:2px}
.ds-docs__item{border:none;background:transparent;color:inherit;font:inherit;font-size:var(--ds-text-sm);text-align:left;padding:6px 9px;border-radius:var(--ds-radius-sm);cursor:pointer}
.ds-docs__item:hover{background:var(--dsw-alias-interactive-bg-hover,var(--ds-surface-2))}
.ds-docs__item.is-active{background:var(--ds-brand-soft);color:var(--ds-brand);font-weight:600}
.ds-docs__item:focus-visible{outline:2px solid var(--ds-focus);outline-offset:-2px}
@media(max-width:720px){ .ds-docs{flex-direction:column} .ds-docs__nav{position:static;min-width:0;flex-direction:row;flex-wrap:wrap} }
`

/**
 * 首屏改名的同时顺手摘掉出厂的那个用量胶囊。
 *
 * 为什么用 CSS 而不是换掉那个槽：出厂用量胶囊注册在列表槽 `conversation.composer.dock`
 * 的 `id: "usage"` 上，它把「总 token · 缓存命中 x%」拼成同一个文本节点里的裸字符串，
 * 没有任何子元素可以只删一半；跨包重注册同 id 又要赌加载顺序。选择器挂在它自己的
 * `data-composer-stat="usage"` 属性上，只遮这一个元素，其余（轮/步/速度）照旧。
 * 取而代之的是我们自己的胶囊，只报 token 消耗量。
 *
 * 幂等：三个标记各查各的，重复渲染不会插两遍。
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

  // 视觉层单独一个标记：老版本渲染过的 HTML 没有它，升级后补一次；有了就不动。
  if (!out.includes('data-deepscient="ui"')) {
    const style = `<style data-deepscient="ui">${UI_CSS}</style>`
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

const WS_GATE_ENV = 'DEEPSCIENT_WS_GATE'

function wsGateEnabled() {
  return String(process.env[WS_GATE_ENV] ?? '1').trim() !== '0'
}

/**
 * 给已有的 WebSocket 升级口加一道人级门。
 *
 * 为什么是包一层，而不是注册自己的路由：
 *   - `webServer.registerUpgrade` 是精确路径独占的，重复注册同一路径直接抛错；
 *   - `/api/remote.mux` 由 api-gateway 持有，抢注等于把它整条 handler 换掉；
 *   - `connection/request` 那个 waterfall 只覆盖 /api 的普通 HTTP，升级请求不经过它。
 * 也就是说没有受支持的扩展点能插进这条链路，唯一同时覆盖浏览器与程序化客户端的位置，
 * 就是 `admitConnection` 本身。
 *
 * 这层很薄也很脆：上游改签名就失效。所以先核对形状，形状不对就明确告警，
 * 而不是悄悄放行——静默失败在这里等于没有门。
 */
function installWsGate(ctx) {
  if (!wsGateEnabled()) {
    ctx.logger?.warn?.('deepscient: DEEPSCIENT_WS_GATE=0，WebSocket 只受设备级准入保护')
    return
  }
  const conn = ctx.connection
  if (!conn || typeof conn.admitConnection !== 'function') {
    ctx.logger?.warn?.('deepscient: connection.admitConnection 不可用，WebSocket 用户级门未装上')
    return
  }
  if (conn.__deepscientGate === true) return

  const original = conn.admitConnection.bind(conn)
  const gated = (req) => {
    const admission = original(req)
    if ('rejection' in admission) return admission
    let verdict = 'deny'
    try {
      verdict = gateUpgrade(req)
    } catch (error) {
      ctx.logger?.warn?.(error)
      verdict = 'deny'
    }
    if (verdict !== 'deny') return admission
    // 设备级已经认过了，人级没过：把刚占的 socket 所有权还回去，否则重连会撞 409。
    try {
      Promise.resolve(admission.release?.()).catch(() => {})
    } catch {}
    return { rejection: 401 }
  }
  conn.admitConnection = gated
  conn.__deepscientGate = true
  ctx.effect(
    () => () => {
      if (conn.admitConnection === gated) conn.admitConnection = original
      delete conn.__deepscientGate
    },
    'deepscient: ws gate',
  )
  ctx.logger?.info?.('deepscient: WebSocket 用户级门已装上（未登录的连接 401 挡回）')
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

  // 官网授权回调：路径由 OAuth 契约固定，挂在站点根上而不是 /deepscient 下。
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/auth/callback',
        handler: async (req, res) => {
          if (!isLoopback(req)) return forbidden(res)
          await handleCallback(req, res, ctx)
        },
      }),
    'deepscient: oauth callback',
  )

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: '/deepscient',
        handler: async (req, res) => {
          if (!isLoopback(req)) return forbidden(res)
          // Webhook / 浏览器回跳不要求登录：中转站带着签名来，认的是签名而不是 cookie。
          if (await handlePartnerPublic(req, res, { logger: ctx.logger })) return
          // 账号路由先过：登录页要在没有会话的情况下也能把话说清楚。
          if (await handleAuth(req, res, ctx)) return
          const handled = await handleApi(req, res, ctx)
          if (handled) return
          // /deepscient 下没有页面，其余路径明确 404，别掉进 SPA 回退。
          res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: 'not-found', path: req.url }))
        },
      }),
    'deepscient: api',
  )

  // 用 ctx.inject 而不是顶层 inject：connection 万一没装，只是少一道门，
  // 不该让整个 DeepScient 起不来。
  ctx.inject(['connection'], (inner) => installWsGate(inner))

  ctx.logger?.info?.(`deepscient: ${PRODUCT} 已挂载（品牌 tap + /deepscient/api + WS 人级门）`)
}

export { pkgDir }
