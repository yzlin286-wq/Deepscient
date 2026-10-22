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
  --ds-font:"IBM Plex Sans SC","IBM Plex Sans","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif;
  --ds-font-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --ds-bg:var(--dsw-alias-bg-base,#ffffff);
  --ds-surface:var(--dsw-alias-bg-layer-1,#ffffff);
  --ds-surface-2:var(--dsw-alias-bg-layer-2,#f4f8fe);
  --ds-surface-3:var(--dsw-alias-bg-layer-3,#eef4ff);
  --ds-fg:var(--dsw-alias-label-primary,#071426);
  --ds-fg-2:var(--dsw-alias-label-secondary,#58698a);
  --ds-fg-3:var(--dsw-alias-label-tertiary,#7c8cab);
  --ds-border:var(--dsw-alias-border-l2,#dee7f5);
  --ds-border-strong:var(--dsw-alias-border-l3,#cfddf1);
  --ds-brand:#1d44dc;
  --ds-brand-hover:#1734ae;
  --ds-brand-press:#1734ae;
  --ds-on-brand:#ffffff;
  --ds-brand-soft:#eff4ff;
  --ds-cobalt:#1d44dc;
  --ds-cobalt-700:#1734ae;
  --ds-cobalt-50:#eff4ff;
  --ds-mint:#0e8f66;
  --ds-mint-soft:rgba(47,220,164,.08);
  --ds-ink:#071426;
  --ds-muted:#58698a;
  --ds-line:#dee7f5;
  --ds-mist:#f4f8fe;
  --ds-ok:#0e8f66;
  --ds-ok-soft:rgba(47,220,164,.10);
  --ds-warn:#b45309;
  --ds-warn-soft:rgba(245,158,11,.12);
  --ds-err:#c2410c;
  --ds-err-soft:rgba(239,68,68,.10);
  --ds-info:#1d44dc;
  --ds-info-soft:#eff4ff;
  --ds-focus:#1d44dc;
  --ds-radius-sm:8px;
  --ds-radius-md:12px;
  --ds-radius-lg:16px;
  --ds-radius-xl:22px;
  --ds-radius-pill:999px;
  --ds-space-1:4px;
  --ds-space-2:8px;
  --ds-space-3:12px;
  --ds-space-4:16px;
  --ds-space-5:24px;
  --ds-space-6:32px;
  --ds-text-xs:11px;
  --ds-text-sm:12.5px;
  --ds-text-md:14px;
  --ds-text-lg:16px;
  --ds-text-xl:22px;
  --ds-text-2xl:30px;
  --ds-shadow-1:0 1px 2px rgba(7,20,38,.05),0 14px 34px -16px rgba(7,20,38,.22);
  --ds-shadow-2:0 24px 70px -24px rgba(7,20,38,.38);
  --ds-shadow-brand:0 10px 24px -10px rgba(29,68,220,.62);
  --ds-dur:160ms;
}
body[data-ds-dark-theme]{
  --ds-bg:#071426;
  --ds-surface:#0c1b33;
  --ds-surface-2:#10233f;
  --ds-surface-3:#152a49;
  --ds-fg:#eaf0ff;
  --ds-fg-2:#a9b8d4;
  --ds-fg-3:#7f90af;
  --ds-border:rgba(222,231,245,.14);
  --ds-border-strong:rgba(222,231,245,.22);
  --ds-brand:#6f8cff;
  --ds-brand-hover:#8aa1ff;
  --ds-brand-press:#8aa1ff;
  --ds-on-brand:#06122a;
  --ds-brand-soft:rgba(111,140,255,.14);
  --ds-cobalt:#6f8cff;
  --ds-cobalt-700:#8aa1ff;
  --ds-cobalt-50:rgba(111,140,255,.12);
  --ds-mint:#3ddca4;
  --ds-mint-soft:rgba(61,220,164,.10);
  --ds-ink:#eaf0ff;
  --ds-muted:#a9b8d4;
  --ds-line:rgba(222,231,245,.14);
  --ds-mist:#0c1b33;
  --ds-ok:#3ddca4;
  --ds-ok-soft:rgba(61,220,164,.12);
  --ds-warn:#f5c26b;
  --ds-warn-soft:rgba(245,194,107,.12);
  --ds-err:#ff8f7a;
  --ds-err-soft:rgba(255,143,122,.12);
  --ds-info:#8aa1ff;
  --ds-info-soft:rgba(138,161,255,.14);
  --ds-focus:#8aa1ff;
  --ds-shadow-1:0 1px 2px rgba(0,0,0,.45),0 18px 40px -18px rgba(0,0,0,.65);
  --ds-shadow-2:0 30px 80px -24px rgba(0,0,0,.7);
  --ds-shadow-brand:0 10px 24px -10px rgba(111,140,255,.45);
}
.ds-page{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--ds-fg);font-family:var(--ds-font);background:var(--ds-bg)}
.ds-page__header{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:12px;padding:14px 22px;background:var(--ds-surface);border-bottom:1px solid var(--ds-border);flex-wrap:wrap}
.ds-page__header::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;background:linear-gradient(90deg,var(--ds-brand),#2fdca4);opacity:.9;pointer-events:none}
.ds-page__body{flex:1;min-height:0;overflow:auto;padding:18px 22px 44px}
.ds-page__inner{width:100%;max-width:1120px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.ds-h1{font-size:var(--ds-text-lg);font-weight:600;letter-spacing:-.02em;margin:0}
.ds-h2{font-size:var(--ds-text-md);font-weight:600;letter-spacing:-.01em;margin:0}
.ds-sub{font-size:var(--ds-text-sm);color:var(--ds-fg-2);line-height:1.6}
.ds-mono{font-family:var(--ds-font-mono);font-variant-numeric:tabular-nums}
.ds-num{font-family:var(--ds-font-mono);font-variant-numeric:tabular-nums;text-align:right}
.ds-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.ds-spacer{flex:1}
.ds-page__heading{display:flex;flex-direction:column;gap:2px;min-width:0}
.ds-card{background:var(--ds-bg);border:1px solid var(--ds-border);border-radius:var(--ds-radius-lg);padding:18px;display:flex;flex-direction:column;gap:12px;box-shadow:0 1px 2px rgba(7,20,38,.04)}
.ds-card--flat{background:transparent;border:none;box-shadow:none}
.ds-stage__head{width:100%;display:flex;align-items:center;gap:10px;padding:10px 14px;background:transparent;border:none;color:inherit;font:inherit;cursor:pointer;text-align:left}
.ds-stage__head:hover{background:var(--dsw-alias-interactive-bg-hover,var(--ds-mist))}
.ds-stage__head:focus-visible{outline:2px solid var(--ds-focus);outline-offset:-2px}
.ds-stat{display:flex;flex-direction:column;gap:3px;padding:12px 14px;border:1px solid var(--ds-line);border-radius:var(--ds-radius-md);background:var(--ds-mist)}
.ds-stat__label{font-size:var(--ds-text-xs);color:var(--ds-fg-3)}
.ds-stat__value{font-family:var(--ds-font-mono);font-variant-numeric:tabular-nums;font-size:var(--ds-text-xl);font-weight:600;line-height:1.2;letter-spacing:-.02em}
.ds-stat__hint{font-size:var(--ds-text-xs);color:var(--ds-fg-3);line-height:1.5}
.ds-section__head{display:flex;align-items:center;gap:8px}
.ds-grid-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
.ds-chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 10px;border-radius:var(--ds-radius-pill);font-size:var(--ds-text-xs);line-height:1;border:1px solid transparent;background:var(--ds-mist);color:var(--ds-fg-2);white-space:nowrap}
.ds-chip--pass{background:var(--ds-ok-soft);color:var(--ds-ok);border-color:transparent}
.ds-chip--fail{background:var(--ds-err-soft);color:var(--ds-err)}
.ds-chip--warn,.ds-chip--manual{background:var(--ds-warn-soft);color:var(--ds-warn)}
.ds-chip--skip{background:transparent;color:var(--ds-fg-3);border-color:var(--ds-border)}
.ds-chip--info{background:var(--ds-brand-soft);color:var(--ds-brand)}
.ds-chip__dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.ds-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 14px;border-radius:var(--ds-radius-pill);border:1px solid var(--ds-line);background:var(--ds-bg);color:var(--ds-fg);font-size:var(--ds-text-sm);font-weight:500;font-family:inherit;cursor:pointer;transition:background var(--ds-dur) ease,border-color var(--ds-dur) ease,box-shadow var(--ds-dur) ease,transform var(--ds-dur) ease}
.ds-btn:hover:not(:disabled){background:var(--ds-mist);border-color:var(--ds-border-strong);color:var(--ds-fg)}
.ds-btn:active:not(:disabled){transform:translateY(1px)}
.ds-btn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(29,68,220,.18);border-color:var(--ds-brand)}
.ds-btn:disabled{opacity:.5;cursor:not-allowed}
.ds-btn--primary{background:var(--ds-brand);border-color:var(--ds-brand);color:var(--ds-on-brand);font-weight:600;box-shadow:var(--ds-shadow-brand)}
.ds-btn--primary:hover:not(:disabled){background:var(--ds-brand-hover);border-color:var(--ds-brand-hover);color:var(--ds-on-brand)}
.ds-btn--secondary{background:var(--ds-bg);border-color:var(--ds-line);color:var(--ds-fg)}
.ds-btn--ghost{background:transparent;border-color:transparent;color:var(--ds-fg-2)}
.ds-btn--ghost:hover:not(:disabled){background:var(--ds-mist);color:var(--ds-brand)}
.ds-btn--danger{color:var(--ds-err);border-color:rgba(194,65,12,.35);background:transparent}
.ds-btn--sm{height:28px;padding:0 11px;font-size:11.5px}
.ds-iconbtn{width:30px;height:30px;padding:0;display:grid;place-items:center;border-radius:var(--ds-radius-pill);border:1px solid transparent;background:transparent;color:var(--ds-fg-2);cursor:pointer;transition:background var(--ds-dur) ease,color var(--ds-dur) ease,box-shadow var(--ds-dur) ease}
.ds-iconbtn:hover:not(:disabled){background:var(--ds-mist);color:var(--ds-fg)}
.ds-iconbtn:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(29,68,220,.18);border-color:var(--ds-brand)}
.ds-iconbtn:disabled{opacity:.5;cursor:not-allowed}
.ds-input,.ds-select,.ds-textarea{min-height:38px;padding:9px 14px;border-radius:var(--ds-radius-lg);border:1px solid var(--ds-line);background:var(--ds-bg);color:var(--ds-fg);font-family:inherit;font-size:var(--ds-text-sm);transition:border-color var(--ds-dur) ease,box-shadow var(--ds-dur) ease}
.ds-input::placeholder,.ds-select::placeholder,.ds-textarea::placeholder{color:var(--ds-fg-3)}
.ds-input:focus,.ds-select:focus,.ds-textarea:focus,.ds-input:focus-visible,.ds-select:focus-visible,.ds-textarea:focus-visible{outline:none;border-color:var(--ds-brand);box-shadow:0 0 0 3px rgba(29,68,220,.16)}
.ds-input:disabled,.ds-select:disabled,.ds-textarea:disabled{opacity:.5}
.ds-scroll{max-width:100%;overflow-x:auto;overscroll-behavior-x:contain}
.ds-table{width:100%;border-collapse:collapse;font-size:var(--ds-text-sm)}
.ds-table th{position:sticky;top:0;z-index:1;background:var(--ds-mist);text-align:left;padding:8px 10px;border-bottom:1px solid var(--ds-border);font-weight:600;color:var(--ds-fg-2);font-size:var(--ds-text-xs);letter-spacing:.04em;white-space:nowrap}
.ds-table td{padding:8px 10px;border-bottom:1px solid var(--ds-border);vertical-align:top;line-height:1.5}
.ds-table tbody tr:hover{background:var(--ds-brand-soft)}
.ds-table tr:last-child td{border-bottom:none}
.ds-link{color:var(--ds-brand);text-decoration:none;border-bottom:1px solid transparent}
.ds-link:hover{text-decoration:underline}
.ds-link:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(29,68,220,.18);border-radius:var(--ds-radius-sm)}
.ds-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:26px 18px;border:1px dashed var(--ds-border-strong);border-radius:var(--ds-radius-lg);background:var(--ds-mist);color:var(--ds-fg-2);font-size:var(--ds-text-sm);text-align:center}
.ds-skeleton{background:linear-gradient(90deg,var(--ds-mist),var(--ds-surface-3),var(--ds-mist));background-size:200% 100%;animation:ds-shimmer 1.4s ease infinite;border-radius:var(--ds-radius-sm);min-height:12px}
@keyframes ds-shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
.ds-dialog{background:var(--ds-bg);border:1px solid var(--ds-line);border-radius:var(--ds-radius-xl);box-shadow:var(--ds-shadow-2);max-height:min(86vh,760px);overflow:auto}
.ds-backdrop{position:fixed;inset:0;display:grid;place-items:center;background:rgba(7,20,38,.45);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);padding:20px;z-index:9000}
.ds-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.ds-live{font-size:var(--ds-text-sm);color:var(--ds-fg-2)}
.ds-live--error{color:var(--ds-err)}
.ds-divider{height:1px;background:var(--ds-border);margin:4px 0}
.ds-note{font-size:var(--ds-text-sm);color:var(--ds-fg-2);line-height:1.65}
.ds-kbd{display:inline-block;padding:1px 6px;border-radius:var(--ds-radius-sm);border:1px solid var(--ds-line);background:var(--ds-mist);color:var(--ds-fg-2);font-family:var(--ds-font-mono);font-size:var(--ds-text-xs);line-height:1.5}
@media (max-width:720px){
  .ds-page__header{padding:12px 16px}
  .ds-page__body{padding:14px 16px 36px}
  .ds-grid-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ds-hide-sm{display:none!important}
  .ds-dialog{width:100%!important}
}
@media (max-width:480px){
  .ds-grid-stats{grid-template-columns:1fr}
  .ds-page__header{gap:8px}
  .ds-auth{padding:14px}
  .ds-auth__card{padding:22px}
  .ds-auth__title{font-size:22px}
}
@media (prefers-reduced-motion:reduce){
  .ds-skeleton,.ds-spinner{animation:none}
  .ds-btn,.ds-iconbtn,.ds-input,.ds-select,.ds-textarea,.ds-auth__submit,.ds-auth__secondary{transition:none}
}
.ds-artifact{display:flex;gap:8px;align-items:baseline;padding:8px 12px;border-radius:var(--ds-radius-md);border:1px solid var(--ds-line);background:transparent;color:inherit;font:inherit;font-size:var(--ds-text-sm);cursor:pointer;text-align:left;transition:background var(--ds-dur) ease,border-color var(--ds-dur) ease}
.ds-artifact:hover{background:var(--ds-mist)}
.ds-artifact:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(29,68,220,.18);border-color:var(--ds-brand)}
.ds-artifact.is-present{border-color:var(--ds-brand);background:var(--ds-brand-soft)}
.ds-docs{display:flex;gap:18px;align-items:flex-start}
.ds-docs__nav{min-width:148px;position:sticky;top:0;display:flex;flex-direction:column;gap:2px}
.ds-docs__item{border:none;background:transparent;color:inherit;font:inherit;font-size:var(--ds-text-sm);text-align:left;padding:6px 9px;border-radius:var(--ds-radius-sm);cursor:pointer}
.ds-docs__item:hover{background:var(--ds-mist)}
.ds-docs__item.is-active{background:var(--ds-brand-soft);color:var(--ds-brand);font-weight:600}
.ds-docs__item:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(29,68,220,.18)}
@media(max-width:720px){ .ds-docs{flex-direction:column;align-items:stretch} .ds-docs__nav{position:static;min-width:0;width:100%;flex-direction:row;flex-wrap:wrap} }
.ds-page__body{overflow-wrap:anywhere}
.ds-page__body code{overflow-wrap:anywhere;word-break:break-word}
.ds-page__body pre{max-width:100%}
.ds-page__body ul,.ds-page__body ol{max-width:100%}
.ds-page__body li{min-width:0;overflow-wrap:anywhere}
.ds-veil{position:relative;background-color:var(--ds-bg);background-image:radial-gradient(900px 520px at 50% -12%,rgba(29,68,220,.12),transparent 62%),linear-gradient(rgba(29,68,220,.045) 1px,transparent 1px),linear-gradient(90deg,rgba(29,68,220,.045) 1px,transparent 1px);background-size:auto,64px 64px,64px 64px;background-position:center top,-1px -1px,-1px -1px;background-repeat:no-repeat,repeat,repeat}
.ds-eyebrow{display:inline-flex;align-items:center;gap:8px;font-family:var(--ds-font-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--ds-brand);font-weight:500}
.ds-eyebrow::before{content:"";width:22px;height:1px;background:currentColor;flex:none}
.ds-gradient-line{height:2px;background:linear-gradient(90deg,var(--ds-brand),#2fdca4)}
.ds-wordmark{font-weight:600;letter-spacing:-.02em;color:var(--ds-fg)}
.ds-wordmark__dot{color:var(--ds-brand)}
.ds-spinner{width:14px;height:14px;border-radius:50%;border:2px solid rgba(29,68,220,.18);border-top-color:var(--ds-brand);animation:ds-spin .8s linear infinite;flex:none}
@keyframes ds-spin{to{transform:rotate(360deg)}}
.ds-auth{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:24px;overflow:auto}
.ds-auth__card{width:min(430px,100%);background:var(--ds-bg);border:1px solid var(--ds-line);border-radius:var(--ds-radius-xl);padding:28px;box-shadow:var(--ds-shadow-1)}
.ds-auth__head{display:flex;flex-direction:column;gap:8px}
.ds-auth__title{font-size:24px;font-weight:600;letter-spacing:-.03em;line-height:1.2;margin:0}
.ds-auth__intro{font-size:var(--ds-text-sm);color:var(--ds-fg-2);line-height:1.65;margin:0}
.ds-auth__badge{display:inline-flex;align-self:flex-start;align-items:center;gap:6px;padding:5px 10px;border-radius:var(--ds-radius-pill);background:var(--ds-ok-soft);color:var(--ds-ok);font-size:11.5px;font-weight:500}
.ds-auth__badge::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.ds-auth__steps{display:flex;flex-direction:column;gap:2px;padding:14px;border-radius:var(--ds-radius-lg);background:var(--ds-surface-2);border:1px solid var(--ds-border)}
.ds-auth__step{display:flex;gap:10px;align-items:flex-start;padding:7px 0}
.ds-auth__num{width:22px;height:22px;flex:none;display:grid;place-items:center;border-radius:var(--ds-radius-pill);background:var(--ds-bg);border:1px solid var(--ds-border);color:var(--ds-brand);font-family:var(--ds-font-mono);font-size:11px}
.ds-auth__stepTitle{font-size:12.5px;font-weight:600;color:var(--ds-fg)}
.ds-auth__stepDesc{font-size:12px;color:var(--ds-fg-2);line-height:1.5}
.ds-auth__submit{width:100%;height:44px;border-radius:var(--ds-radius-pill);background:var(--ds-brand);color:var(--ds-on-brand);border:1px solid var(--ds-brand);font-family:inherit;font-size:var(--ds-text-md);font-weight:500;box-shadow:var(--ds-shadow-brand);cursor:pointer;transition:background var(--ds-dur) ease,border-color var(--ds-dur) ease,box-shadow var(--ds-dur) ease}
.ds-auth__submit:hover:not(:disabled){background:var(--ds-brand-hover);border-color:var(--ds-brand-hover)}
.ds-auth__submit:focus-visible{outline:none;box-shadow:0 0 0 3px rgba(29,68,220,.18),var(--ds-shadow-brand)}
.ds-auth__submit:disabled{opacity:.7;cursor:not-allowed}
.ds-auth__secondary{width:100%;height:40px;border-radius:var(--ds-radius-pill);background:transparent;border:1px solid var(--ds-line);color:var(--ds-fg-2);font-family:inherit;font-size:var(--ds-text-sm);cursor:pointer;transition:background var(--ds-dur) ease,color var(--ds-dur) ease,border-color var(--ds-dur) ease}
.ds-auth__secondary:hover:not(:disabled){background:var(--ds-mist);color:var(--ds-brand);border-color:var(--ds-border-strong)}
.ds-auth__foot{font-size:11.5px;color:var(--ds-fg-3);line-height:1.6}
.ds-auth__error{font-size:12px;color:var(--ds-err);line-height:1.5}
.ds-auth__wait{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--ds-fg-2)}
body[data-ds-dark-theme] .ds-card{box-shadow:0 1px 2px rgba(0,0,0,.25)}
body[data-ds-dark-theme] .ds-table tbody tr:hover{background:rgba(111,140,255,.08)}
body[data-ds-dark-theme] .ds-veil{background-image:radial-gradient(900px 520px at 50% -12%,rgba(111,140,255,.14),transparent 62%),linear-gradient(rgba(111,140,255,.07) 1px,transparent 1px),linear-gradient(90deg,rgba(111,140,255,.07) 1px,transparent 1px)}
body[data-ds-dark-theme] .ds-spinner{border-color:rgba(111,140,255,.2);border-top-color:var(--ds-brand)}
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
      `<meta name="theme-color" content="#1d44dc">`,
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
      background_color: '#071426',
      theme_color: '#1d44dc',
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

  // 视觉层单独出一份 CSS：桌面壳从本地 dist 出首屏，tapIndex 的 <style> 注入不生效，
  // 客户端发现没有 style[data-deepscient="ui"] 时链接到这里，两种形态看到同一份样式。
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'exact',
        path: '/deepscient/ui.css',
        handler: (req, res) => {
          if (!isLoopback(req)) return forbidden(res)
          res.writeHead(200, {
            'content-type': 'text/css; charset=utf-8',
            'cache-control': 'no-cache',
            'content-length': Buffer.byteLength(UI_CSS),
          })
          res.end(UI_CSS)
        },
      }),
    'deepscient: ui css',
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
