window.__ModuleLoader__.load({
  id: '@local/deepscient',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'deepscient'
    const API = '/deepscient/api'
    const PANEL_ID = 'science'

    /* ── 取数 ───────────────────────────────────────────────────────────────
       只看自己的 /deepscient/api。不用 RPC 的原因是：这套数据是「本机研究库的投影」，
       没有会话语义，也不需要经过 connection 的鉴权握手；一个同源 JSON 口就够，
       而且验证脚本可以直接 curl 它。                                          */

    async function getJson(path) {
      const res = await fetch(`${API}${withLocale(path)}`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      const text = await res.text()
      let body = null
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        throw new Error(`返回的不是 JSON（${res.status}）：${text.slice(0, 120)}`)
      }
      if (!res.ok) throw new Error((body && (body.message || body.error)) || `HTTP ${res.status}`)
      return body
    }

    /* ── 文案（中英双语）──────────────────────────────────────────────────────
       字典值就是纯字符串，没有占位符能力，所以插值在这里自己做：{n} {id} {status}。
       语言切换由 locale 服务的 subscribe 通知，组件用 useLocaleRevision() 重渲；
       不订阅的组件在切语言后会留在旧文案上，所以凡是显示文字的地方都要调它一次。 */

    const i18n = { t: (key) => key, ctx: null }

    function tf(key, vars) {
      const raw = String(i18n.t(key) ?? key)
      if (!vars) return raw
      return raw.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole))
    }

    /** 订阅语言快照；切语言或字典补注册都会 bump revision，这里跟着重渲。 */
    function useLocaleRevision() {
      const [, bump] = useState(0)
      useEffect(() => {
        const locale = i18n.ctx?.get?.('locale')
        const off = locale?.subscribe?.(() => bump((n) => n + 1))
        return typeof off === 'function' ? off : undefined
      }, [])
    }

    /** 请求带上当前语言：阶段名、门名、下一步动作由服务端按语言回。 */
    function withLocale(path) {
      if (!path) return path
      let active = 'zh'
      try {
        active = i18n.ctx?.get?.('locale')?.getLocale?.()?.active ?? 'zh'
      } catch {
        active = 'zh'
      }
      if (!active || String(active).startsWith('zh')) return path
      return path + (path.includes('?') ? '&' : '?') + 'locale=' + encodeURIComponent(active)
    }

    function useApi(path, deps = []) {
      const [state, setState] = useState({ status: 'loading', data: null, error: null })
      const [tick, setTick] = useState(0)
      useEffect(() => {
        let alive = true
        if (!path) {
          setState({ status: 'idle', data: null, error: null })
          return () => { alive = false }
        }
        setState((prev) => ({ status: prev.data ? 'refreshing' : 'loading', data: prev.data, error: null }))
        getJson(path).then(
          (data) => { if (alive) setState({ status: 'ready', data, error: null }) },
          (error) => { if (alive) setState({ status: 'error', data: null, error: error.message }) },
        )
        return () => { alive = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [path, tick, ...deps])
      const reload = useCallback(() => setTick((n) => n + 1), [])
      return { ...state, reload }
    }

    /** 写端点：PUT / POST / DELETE 都用它，错误统一成 throw，交给调用方显示。 */
    async function sendJson(method, path, body) {
      const res = await fetch(`${API}${path}`, {
        method,
        credentials: 'same-origin',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      let payload = null
      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        throw new Error(`返回的不是 JSON（${res.status}）`)
      }
      if (!res.ok) throw new Error((payload && (payload.message || payload.error)) || `HTTP ${res.status}`)
      return payload
    }

    /** 读端点（按需触发的那种）：与 sendJson 同一套错误口径。 */
    const fetchJson = (path) => sendJson('GET', path)

    /* ── 一级面板注册表 ────────────────────────────────────────────────────
       6 个页面各占侧栏一个图标，id 与 main 的 key 必须同名：侧栏点下去的 id
       就是主栏要渲染的 key。这张表同时驱动两处注册，不可能对不上。            */

    const PAGES = [
      { key: 'workbench', order: 20, Icon: WorkbenchIcon, Component: WorkbenchPage },
      { key: 'stages', order: 21, Icon: StagesIcon, Component: StagesPage },
      { key: 'tools', order: 22, Icon: ToolsIcon, Component: ToolsPage },
      { key: 'billing', order: 23, Icon: BillingIcon, Component: BillingPage },
      { key: 'sources', order: 24, Icon: SourcesIcon, Component: SourcesPage },
      { key: 'docs', order: 25, Icon: DocsIcon, Component: DocsPage },
    ]

    const panelId = (key) => `science-${key}`

    /* ── 跨面板导航：胶囊、引导、设置里点了「计费」「接入」都要换一级面板 ─────
       拍平之后没有「页签」这个概念了，切面板就是 layout 服务的 selectPanel。   */

    const panelHost = { ctx: null }

    function requestPanel(key) {
      const page = PAGES.find((item) => item.key === key)
      if (!page) return
      try {
        panelHost.ctx?.get?.('layout')?.selectPanel?.(panelId(page.key))
      } catch {
        /* 没有 layout 服务时什么也不做：面板本来就已经在那儿了 */
      }
    }

    /* ── 选中课题：跨面板共享，切换面板不丢选择 ───────────────────────────── */

    const selection = { projectId: '', listeners: new Set() }

    function selectProject(id) {
      selection.projectId = id || ''
      selection.listeners.forEach((fn) => fn())
    }

    function useSelectedProject(projects) {
      const [id, setId] = useState(selection.projectId)
      useEffect(() => {
        const fn = () => setId(selection.projectId)
        selection.listeners.add(fn)
        return () => { selection.listeners.delete(fn) }
      }, [])
      const first = projects.data?.items?.[0]?.id ?? ''
      return [id || first, selectProject]
    }

    /* 「工作台」点阶段梯子上的某一级要展开「流程」里的同一级。
       两个面板是两个独立挂载点，中间只留一个待展开的 id。 */
    const stageJump = { id: '' }

    /** 万级以内给原数，以上给 k/M：底部胶囊位置小，别撑成一行。 */
    function formatTokens(value) {
      const n = Number(value) || 0
      if (n < 1000) return String(n)
      if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)}k`
      return `${(n / 1_000_000).toFixed(2)}M`
    }

    /* ── 视觉 ───────────────────────────────────────────────────────────────
       不引入任何外部 UI 库：ModuleLoader 的基线里只有 React。颜色一律半透明灰，
       深浅色主题都能看；文字用 currentColor 继承宿主。                        */

    const S = {
      panel: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'inherit' },
      header: {
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px',
        borderBottom: '1px solid rgba(127,127,127,0.18)', flexWrap: 'wrap',
      },
      title: { fontSize: 15, fontWeight: 600, letterSpacing: 0.2 },
      sub: { fontSize: 12, opacity: 0.6 },
      spacer: { flex: 1 },
      body: { flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 20px 40px' },
      card: {
        border: '1px solid rgba(127,127,127,0.18)', borderRadius: 10, padding: 14,
        marginBottom: 12, background: 'rgba(127,127,127,0.04)',
      },
      row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
      chip: (tone) => ({
        fontSize: 11, padding: '2px 7px', borderRadius: 999, border: '1px solid',
        borderColor: tone === 'pass' ? 'rgba(31,111,92,0.6)' : tone === 'fail' ? 'rgba(190,70,60,0.6)' : 'rgba(127,127,127,0.45)',
        color: tone === 'pass' ? '#3fa07f' : tone === 'fail' ? '#d06a5f' : 'inherit',
        opacity: tone === 'skip' ? 0.6 : 1,
      }),
      ladder: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
      step: (state) => ({
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 8, fontSize: 12,
        border: '1px dashed rgba(127,127,127,0.35)',
        background: state === 'pass' ? 'rgba(31,111,92,0.14)' : state === 'fail' ? 'rgba(190,70,60,0.12)' : 'transparent',
        borderStyle: state === 'manual' ? 'dotted' : 'solid',
        cursor: state === 'idle' ? 'default' : 'pointer',
      }),
      table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
      th: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid rgba(127,127,127,0.25)', fontWeight: 600, opacity: 0.75 },
      td: { padding: '6px 8px', borderBottom: '1px solid rgba(127,127,127,0.12)', verticalAlign: 'top' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 },
      button: {
        fontSize: 12, padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
        border: '1px solid rgba(127,127,127,0.35)', background: 'rgba(127,127,127,0.08)', color: 'inherit',
      },
      select: {
        fontSize: 12.5, padding: '5px 8px', borderRadius: 7, color: 'inherit',
        border: '1px solid rgba(127,127,127,0.35)', background: 'rgba(127,127,127,0.08)',
      },
      input: {
        fontSize: 12.5, padding: '5px 9px', borderRadius: 7, color: 'inherit', minWidth: 180,
        border: '1px solid rgba(127,127,127,0.35)', background: 'rgba(127,127,127,0.08)',
      },
      notice: { fontSize: 12.5, opacity: 0.75, lineHeight: 1.6 },
      pre: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12,
        padding: 10, borderRadius: 8, background: 'rgba(127,127,127,0.10)', overflow: 'auto',
      },
    }

    const TONE = { pass: 'pass', fail: 'fail', skip: 'skip', manual: 'manual' }
    const REASON_KEY = {
      blocking: 'reason.blocking',
      warning: 'reason.warning',
      unrecorded: 'reason.unrecorded',
      'self-check': 'reason.selfCheck',
    }
    const REASON_TONE = { blocking: 'fail', warning: 'manual', unrecorded: 'skip', 'self-check': 'manual' }
    const reasonLabel = (reason) => tf(REASON_KEY[reason] ?? 'reason.todo')

    function Chip({ status, children }) {
      return h('span', { style: S.chip(TONE[status] ?? 'skip') }, children ?? status)
    }

    function Notice({ children }) {
      return h('div', { style: S.notice }, children)
    }

    function ErrorBox({ error, onRetry }) {
      useLocaleRevision()
      return h(
        'div',
        { style: { ...S.card, borderColor: 'rgba(190,70,60,0.5)' } },
        h('div', { style: { fontSize: 13, marginBottom: 6 } }, tf('common.loadFailed')),
        h('div', { style: { ...S.mono, opacity: 0.8 } }, String(error)),
        onRetry ? h('button', { style: { ...S.button, marginTop: 10 }, onClick: onRetry }, tf('common.retry')) : null,
      )
    }

    function Loading() {
      useLocaleRevision()
      return h('div', { style: { ...S.notice, padding: 8 } }, tf('common.loading'))
    }

    /* ── 品牌 ───────────────────────────────────────────────────────────── */

    function BrandMark({ size = 22 }) {
      // 双层轨道 + 中心点：科研的"复现"母题，原创图形，不复用官方字形。
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block' } },
        h('ellipse', { cx: 12, cy: 12, rx: 10, ry: 4.4, fill: 'none', stroke: 'currentColor', strokeOpacity: 0.5, strokeWidth: 1.4, transform: 'rotate(-28 12 12)' }),
        h('ellipse', { cx: 12, cy: 12, rx: 10, ry: 4.4, fill: 'none', stroke: 'currentColor', strokeOpacity: 0.28, strokeWidth: 1.2, transform: 'rotate(32 12 12)' }),
        h('circle', { cx: 12, cy: 12, r: 2.6, fill: '#1f6f5c' }),
      )
    }

    function BrandName() {
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'baseline', gap: 6, fontWeight: 600, letterSpacing: 0.2 } },
        h('span', null, 'DeepScient'),
        h('span', { style: { fontSize: '0.72em', fontWeight: 400, opacity: 0.55 } }, '科研'),
      )
    }

    /* ── 侧栏一级图标 ──────────────────────────────────────────────────────
       6 个页面 6 个图标，同一套笔画（1.5-1.6，currentColor，未选中降透明度），
       全部内联，不引外部资源。                                               */

    function iconShell(size, active, children) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block', opacity: active ? 1 : 0.75 } },
        children,
      )
    }

    function WorkbenchIcon({ size = 18, active }) {
      return iconShell(size, active, [
        h('rect', { key: 'a', x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { key: 'b', d: 'M7 15.5 L10.2 11.2 L13 13.6 L17 8.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      ])
    }

    function StagesIcon({ size = 18, active }) {
      return iconShell(size, active, [
        h('path', { key: 'a', d: 'M3.5 18.5 h4 v-4 h4 v-4 h4 v-4 h5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('circle', { key: 'b', cx: 5.5, cy: 18.5, r: 1.3, fill: 'currentColor' }),
        h('circle', { key: 'c', cx: 18.5, cy: 6.5, r: 1.3, fill: 'currentColor' }),
      ])
    }

    function ToolsIcon({ size = 18, active }) {
      return iconShell(size, active, [
        h('path', { key: 'a', d: 'M14.8 4.4a4.6 4.6 0 0 0 5.8 6.1l-9.4 9.4a2.3 2.3 0 0 1-3.3-3.3z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('circle', { key: 'b', cx: 16.6, cy: 7.4, r: 1.1, fill: 'currentColor' }),
      ])
    }

    function BillingIcon({ size = 18, active }) {
      return iconShell(size, active, [
        h('circle', { key: 'a', cx: 12, cy: 12, r: 8.3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { key: 'b', d: 'M14.2 9.1c-.6-.7-1.4-1-2.4-1-1.5 0-2.6.7-2.6 1.8 0 2.6 5 1.2 5 3.8 0 1.1-1.1 1.9-2.7 1.9-1 0-1.9-.4-2.5-1.1', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('path', { key: 'c', d: 'M12 6.4v11.2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      ])
    }

    function SourcesIcon({ size = 18, active }) {
      return iconShell(size, active, [
        h('circle', { key: 'a', cx: 6, cy: 6, r: 2.3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('circle', { key: 'b', cx: 18, cy: 6, r: 2.3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('circle', { key: 'c', cx: 12, cy: 18, r: 2.3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { key: 'd', d: 'M8.1 6.7 L10.4 16 M15.9 6.7 L13.6 16 M8.3 6 h7.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      ])
    }

    function DocsIcon({ size = 18, active }) {
      return iconShell(size, active, [
        h('path', { key: 'a', d: 'M5 4.6h9.2L19 9.4v10H5z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' }),
        h('path', { key: 'b', d: 'M13.9 4.9v4.6H19', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }),
        h('path', { key: 'c', d: 'M8 13h7 M8 16h5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      ])
    }

    /* ── 工作台 ─────────────────────────────────────────────────────────── */

    /* ── 总览 ────────────────────────────────────────────────────────────────
       一块屏回答四件事：这是什么课题、走到第几步、产出什么、下一步做什么。
       数据全来自 /projects/:id/overview 一次请求，不再自己拼四个接口——
       以前「当前阶段阻塞几个门」是界面自己数的，现在由服务端回真实值。 */

    const OS = {
      bar: {
        height: 6, borderRadius: 999, overflow: 'hidden', marginTop: 8,
        background: 'rgba(127,127,127,0.22)',
      },
      barFill: (percent) => ({
        height: '100%', width: `${Math.max(0, Math.min(100, Number(percent) || 0))}%`,
        background: '#1f6f5c', borderRadius: 999, transition: 'width 240ms ease',
      }),
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 },
      art: (present) => ({
        display: 'flex', gap: 8, alignItems: 'baseline', padding: '6px 9px', borderRadius: 8,
        cursor: 'pointer', fontSize: 12,
        border: `1px solid ${present ? 'rgba(31,111,92,0.45)' : 'rgba(127,127,127,0.3)'}`,
        background: present ? 'rgba(31,111,92,0.10)' : 'transparent',
        opacity: present ? 1 : 0.72,
      }),
      artStage: { fontFamily: 'ui-monospace, monospace', fontSize: 11, opacity: 0.65, flex: '0 0 auto' },
      action: { padding: '9px 0', borderTop: '1px solid rgba(127,127,127,0.14)' },
      select: { padding: '5px 8px', fontSize: 12, borderRadius: 7, maxWidth: 320,
        border: '1px solid rgba(127,127,127,0.35)', background: 'transparent', color: 'inherit' },
    }

    function Overview({ overview, projects, projectId, onProject, onJump }) {
      useLocaleRevision()
      if (overview.status === 'loading') return h(Loading)
      if (overview.error) return h(ErrorBox, { error: overview.error, onRetry: overview.reload })
      const data = overview.data
      if (!data || !data.project) return h(Notice, null, tf('overview.noProject'))

      const progress = data.progress ?? {}
      const current = progress.current ?? null
      const list = projects.data?.items ?? []
      const counters = [
        ['fail', 'reason.blocking', current?.blocking],
        ['manual', 'reason.warning', current?.warnings],
        ['skip', 'reason.unrecorded', current?.skipped],
        ['manual', 'reason.selfCheck', current?.manual],
      ].filter((item) => Number(item[2]) > 0)

      const artifacts = data.artifacts ?? []
      const produced = artifacts.filter((a) => a.present).length
      const actions = data.next?.actions ?? []

      return h('div', null,
        /* 1. 课题身份 */
        h('div', { style: S.card },
          h('div', { style: { ...S.row, marginBottom: 6 } },
            h('select', {
              style: OS.select,
              value: projectId,
              onChange: (e) => onProject(e.target.value),
            }, list.map((p) => h('option', { key: p.id, value: p.id }, p.title || p.id))),
            data.project.domain ? h(Chip, { status: 'pass' }, data.project.domain) : null,
            data.project.targetJournal ? h(Chip, { status: 'pass' }, data.project.targetJournal) : null,
            h('div', { style: S.spacer }),
            h('button', { style: S.button, onClick: overview.reload }, tf('common.refresh')),
          ),
          data.project.question ? h('div', { style: S.sub }, data.project.question) : null,
          h('div', { style: { ...S.sub, marginTop: 4 } },
            tf('overview.counts', {
              papers: data.counts?.papers ?? 0,
              analyses: data.counts?.analyses ?? 0,
              figures: data.counts?.figures ?? 0,
            })),
        ),

        /* 2. 进度 + 当前阶段 */
        h('div', { style: S.card },
          h('div', { style: { fontSize: 13, fontWeight: 600 } },
            tf('overview.progress', {
              done: progress.done ?? 0,
              total: progress.total ?? 0,
              percent: progress.percent ?? 0,
            })),
          h('div', { style: OS.bar }, h('div', { style: OS.barFill(progress.percent ?? 0) })),
          current
            ? h('div', { style: { marginTop: 10 } },
                h('div', { style: { ...S.row, marginBottom: 4 } },
                  h('div', { style: { fontSize: 13 } }, `${current.id} ${current.label}`),
                  counters.map(([tone, key, n]) => h(Chip, { key, status: tone }, tf(key, { n }))),
                  h('div', { style: S.spacer }),
                  h('button', { style: S.button, onClick: () => onJump(current.id) }, tf('overview.jump')),
                ),
                current.goal ? h('div', { style: S.sub }, current.goal) : null,
              )
            : h('div', { style: { ...S.sub, marginTop: 8 } }, tf('common.done')),
        ),

        /* 3. 产出清单 */
        h('div', { style: S.card },
          h('div', { style: { ...S.row, marginBottom: 8 } },
            h('div', { style: { fontSize: 13, fontWeight: 600 } }, tf('overview.artifacts')),
            h(Chip, { status: 'pass' }, `${tf('overview.present')} ${produced}`),
            h(Chip, { status: 'skip' }, `${tf('overview.missing')} ${artifacts.length - produced}`),
          ),
          artifacts.length === 0
            ? h('div', { style: S.sub }, tf('common.empty'))
            : h('div', { style: OS.grid },
                artifacts.map((a) => h('div', {
                  key: `${a.stageId}:${a.name}`,
                  style: OS.art(a.present),
                  onClick: () => onJump(a.stageId),
                },
                  h('span', { style: OS.artStage }, a.stageId),
                  h('span', null, a.name),
                ))),
        ),

        /* 4. 下一步 */
        h('div', { style: S.card },
          h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, tf('overview.next')),
          actions.length === 0
            ? h('div', { style: S.sub }, tf('common.empty'))
            : actions.map((a, i) => h('div', { key: a.gate ?? i, style: OS.action },
                h('div', { style: S.row },
                  h(Chip, { status: REASON_TONE[a.reason] ?? 'skip' }, reasonLabel(a.reason)),
                  h('div', { style: { fontSize: 13 } }, a.label ?? a.gate ?? ''),
                  h('div', { style: S.spacer }),
                  a.gate ? h('button', { style: S.button, onClick: () => onJump(a.gate) }, tf('overview.jump')) : null,
                ),
                a.fix ? h('div', { style: { ...S.sub, marginTop: 3 } }, a.fix) : null,
              )),
        ),
      )
    }

    function StageList({ stages, initial }) {
      const [open, setOpen] = useState(initial ?? '')
      useEffect(() => { if (initial) setOpen(initial) }, [initial])
      if (stages.status === 'loading') return h(Loading)
      if (stages.status === 'error') return h(ErrorBox, { error: stages.error, onRetry: stages.reload })
      if (stages.data && stages.data.available === false) return h(Notice, null, stages.data.reason)
      const list = stages.data?.stages ?? []
      if (!list.length) return h(Notice, null, tf('stages.noProject'))
      return h(
        'div',
        null,
        h('div', { style: { ...S.sub, marginBottom: 10 } },
          tf('stages.summary', { blocking: stages.data.summary.blocking, warnings: stages.data.summary.warnings, skipped: stages.data.summary.skipped, manual: stages.data.summary.manual })),
        list.map((s) =>
          h(
            'div',
            { key: s.id, style: { ...S.card, padding: 0, overflow: 'hidden' } },
            h(
              'div',
              {
                style: { ...S.row, padding: '10px 14px', cursor: 'pointer' },
                onClick: () => setOpen(open === s.id ? '' : s.id),
              },
              h('span', { style: { ...S.mono, opacity: 0.65, width: 26 } }, s.id),
              h('span', { style: { fontWeight: 600, fontSize: 13 } }, s.label),
              h('div', { style: S.spacer }),
              s.complete ? h(Chip, { status: 'pass' }, tf('common.done')) : h(Chip, { status: s.blocking ? 'fail' : 'skip' }, s.blocking ? tf('stages.blockingCount', { n: s.blocking }) : '未完成'),
              h('span', { style: { opacity: 0.5 } }, open === s.id ? '▾' : '▸'),
            ),
            open === s.id
              ? h('div', { style: { padding: '0 14px 14px' } },
                  h('div', { style: { ...S.sub, marginBottom: 8 } }, s.goal),
                  h(GateTable, { gates: s.gates }))
              : null,
          ),
        ),
      )
    }

    function ToolList({ tools, skills }) {
      const [query, setQuery] = useState('')
      if (tools.status === 'loading') return h(Loading)
      if (tools.status === 'error') return h(ErrorBox, { error: tools.error, onRetry: tools.reload })
      const items = tools.data?.items ?? []
      const q = query.trim().toLowerCase()
      const filtered = q ? items.filter((t) => t.name.toLowerCase().includes(q) || t.stageLabel.includes(query)) : items
      const skillItems = skills.data?.items ?? []
      return h(
        'div',
        null,
        h('div', { style: { ...S.row, marginBottom: 12 } },
          h('input', { style: S.input, placeholder: tf('tools.filter'), value: query, onChange: (e) => setQuery(e.target.value) }),
          h('div', { style: S.sub }, tf('tools.count', { shown: filtered.length, total: items.length })),
        ),
        h('table', { style: S.table },
          h('thead', null, h('tr', null,
            h('th', { style: S.th }, tf('tools.colTool')), h('th', { style: S.th }, tf('tools.colStage')), h('th', { style: S.th }, tf('tools.colArtifact')))),
          h('tbody', null, filtered.map((t) => h('tr', { key: t.name },
            h('td', { style: { ...S.td, ...S.mono } }, t.name),
            h('td', { style: S.td }, `${t.stageId} ${t.stageLabel}`),
            h('td', { style: { ...S.td, opacity: 0.75 } }, (t.artifacts ?? []).join('、') || '—'),
          )))),
        h('div', { style: { ...S.sub, marginTop: 12 } }, tf('tools.note')),

        h('div', { style: { fontSize: 13, fontWeight: 600, margin: '22px 0 8px' } }, tf('tools.skillsHeading', { n: skillItems.length })),
        skillItems.length
          ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
              skillItems.map((s) => h('span', {
                key: s.name,
                title: s.name,
                style: { ...S.chip('skip'), borderStyle: 'solid', padding: '3px 9px', fontSize: 11.5 },
              }, s.title)))
          : h(Notice, null, skills.status === 'error' ? skills.error : tf('tools.skillsEmpty')),
        h('div', { style: { ...S.sub, marginTop: 8 } }, tf('tools.skillsNote')),
      )
    }

    /* ── 说明：足够用的 Markdown ───────────────────────────────────────────
       不引 markdown 库（基线里没有）。只支持说明文档真正用到的语法：标题、列表、
       代码块、表格、粗体、行内代码、链接。渲染不出来就当纯文本，不会崩。       */

    function inline(text) {
      const nodes = []
      let rest = String(text)
      let key = 0
      const push = (node) => nodes.push(node)
      while (rest.length) {
        const m = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/.exec(rest)
        if (!m) { push(rest); break }
        if (m.index > 0) push(rest.slice(0, m.index))
        const token = m[0]
        if (token.startsWith('**')) push(h('strong', { key: key++ }, token.slice(2, -2)))
        else if (token.startsWith('`')) push(h('code', { key: key++, style: S.mono }, token.slice(1, -1)))
        else {
          const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(token)
          push(h('a', { key: key++, href: link[2], target: '_blank', rel: 'noreferrer', style: { color: '#3fa07f' } }, link[1]))
        }
        rest = rest.slice(m.index + token.length)
      }
      return nodes
    }

    function Markdown({ text }) {
      const blocks = useMemo(() => {
        const out = []
        const lines = String(text ?? '').split(/\r?\n/)
        let i = 0
        while (i < lines.length) {
          const line = lines[i]
          if (/^```/.test(line)) {
            const buf = []
            i += 1
            while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i += 1 }
            i += 1
            out.push({ kind: 'code', text: buf.join('\n') })
            continue
          }
          const heading = /^(#{1,4})\s+(.*)$/.exec(line)
          if (heading) {
            const level = heading[1].length
            out.push({ kind: 'heading', level, text: heading[2] })
            i += 1
            continue
          }
          if (/^\s*\|/.test(line) && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1] ?? '')) {
            const rows = []
            while (i < lines.length && /^\s*\|/.test(lines[i])) {
              rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()))
              i += 1
            }
            out.push({ kind: 'table', rows: rows.filter((r) => !r.every((c) => /^:?-+:?$/.test(c))) })
            continue
          }
          if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
            const items = []
            while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
              items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))
              i += 1
            }
            out.push({ kind: 'list', items })
            continue
          }
          if (!line.trim()) { i += 1; continue }
          const buf = []
          while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*\||\s*([-*]|\d+\.)\s)/.test(lines[i])) {
            buf.push(lines[i]); i += 1
          }
          out.push({ kind: 'para', text: buf.join(' ') })
        }
        return out
      }, [text])

      return h('div', { style: { fontSize: 13, lineHeight: 1.75, maxWidth: 820 } },
        blocks.map((b, idx) => {
          if (b.kind === 'heading') {
            const size = b.level === 1 ? 19 : b.level === 2 ? 16 : 14
            return h('div', { key: idx, style: { fontSize: size, fontWeight: 650, margin: '18px 0 8px' } }, inline(b.text))
          }
          if (b.kind === 'code') return h('pre', { key: idx, style: S.pre }, b.text)
          if (b.kind === 'list') {
            return h('ul', { key: idx, style: { margin: '6px 0 6px 20px' } },
              b.items.map((it, j) => h('li', { key: j, style: { marginBottom: 4 } }, inline(it))))
          }
          if (b.kind === 'table') {
            const [head, ...rows] = b.rows
            return h('table', { key: idx, style: { ...S.table, margin: '8px 0 14px' } },
              head ? h('thead', null, h('tr', null, head.map((c, j) => h('th', { key: j, style: S.th }, inline(c))))) : null,
              h('tbody', null, rows.map((r, j) => h('tr', { key: j }, r.map((c, k) => h('td', { key: k, style: S.td }, inline(c)))))))
          }
          return h('p', { key: idx, style: { margin: '8px 0' } }, inline(b.text))
        }))
    }

    function Docs({ docs }) {
      const [active, setActive] = useState('')
      const current = active || docs.data?.items?.[0]?.id || ''
      const doc = useApi(current ? `/docs/${current}` : null, [current])
      if (docs.status === 'loading') return h(Loading)
      if (docs.status === 'error') return h(ErrorBox, { error: docs.error, onRetry: docs.reload })
      const items = docs.data?.items ?? []
      if (!items.length) return h(Notice, null, tf('docs.notPacked'))
      return h(
        'div',
        { style: { display: 'flex', gap: 18, alignItems: 'flex-start' } },
        h('div', { style: { minWidth: 148, position: 'sticky', top: 0 } },
          items.map((d) => h('div', {
            key: d.id,
            onClick: () => setActive(d.id),
            style: {
              fontSize: 12.5, padding: '6px 9px', borderRadius: 7, cursor: 'pointer', marginBottom: 4,
              background: d.id === current ? 'rgba(31,111,92,0.14)' : 'transparent',
              opacity: d.id === current ? 1 : 0.72,
            },
          }, d.title))),
        h('div', { style: { flex: 1, minWidth: 0 } },
          doc.status === 'loading' ? h(Loading) : doc.status === 'error' ? h(ErrorBox, { error: doc.error, onRetry: doc.reload }) : h(Markdown, { text: doc.data?.markdown })),
      )
    }

    /* ── 计费 ───────────────────────────────────────────────────────────────
       数字全部来自 /deepscient/api/usage：它把会话日志里 provider 给的 usage 汇总起来。
       钱是按「价目 × token」算的预估——真值在中转站账单上，页面上必须写清楚。      */

    const rangeLabel = (range) => tf(`billing.range.${range}`)

    function Stat({ label, value, hint }) {
      return h('div', { style: { minWidth: 120, padding: '10px 12px', borderRadius: 10, background: 'rgba(127,127,127,0.07)' } },
        h('div', { style: { fontSize: 11.5, opacity: 0.65, marginBottom: 4 } }, label),
        h('div', { style: { fontSize: 17, fontWeight: 600, ...S.mono } }, value),
        hint ? h('div', { style: { fontSize: 11, opacity: 0.55, marginTop: 3 } }, hint) : null)
    }

    /** 扣费主体表：每把 key 一行，只有掩码。 */
    function keyTable(keys) {
      const head = h('thead', null, h('tr', null,
        h('th', { style: S.th }, tf('billing.colSource')),
        h('th', { style: S.th }, 'provider'),
        h('th', { style: S.th }, tf('billing.colMask')),
        h('th', { style: S.th }, tf('billing.colNote'))))

      const rows = keys.map((k, i) => h('tr', { key: i },
        h('td', { style: S.td }, k.source ?? '—'),
        h('td', { style: { ...S.td, ...S.mono } }, k.provider ?? '—'),
        h('td', { style: { ...S.td, ...S.mono } }, k.masked || '—'),
        h('td', { style: { ...S.td, opacity: 0.75 } }, k.note ?? '—')))

      return h('div', { style: { marginTop: 10 } },
        h('div', { style: { fontSize: 12.5, opacity: 0.75, marginBottom: 4 } }, tf('billing.payers')),
        h('table', { style: S.table }, head, h('tbody', null, rows)))
    }


    /** 按模型表。 */
    function modelTable(rows) {
      const head = h('thead', null, h('tr', null,
        h('th', { style: S.th }, 'provider'),
        h('th', { style: S.th }, tf('billing.colModel')),
        h('th', { style: S.th }, tf('billing.colInput')),
        h('th', { style: S.th }, tf('billing.colCache')),
        h('th', { style: S.th }, tf('billing.colOutput')),
        h('th', { style: S.th }, tf('billing.colTotal')),
        h('th', { style: S.th }, tf('billing.colEstimate'))))

      const body = rows.map((row, i) => h('tr', { key: i },
        h('td', { style: { ...S.td, ...S.mono } }, row.provider),
        h('td', { style: { ...S.td, ...S.mono } }, row.model),
        h('td', { style: S.td }, formatTokens(row.inputTokens)),
        h('td', { style: S.td }, formatTokens(row.cacheReadTokens)),
        h('td', { style: S.td }, formatTokens(row.outputTokens)),
        h('td', { style: S.td }, formatTokens(row.totalTokens)),
        h('td', { style: S.td }, row.cost === null ? '—' : row.cost.toFixed(4))))

      return h('div', { style: S.card },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, tf('billing.byModel')),
        h('table', { style: S.table }, head, h('tbody', null, body)))
    }

    /** 按会话表（最多 20 行，最近的在前）。 */
    function sessionTable(rows) {
      const head = h('thead', null, h('tr', null,
        h('th', { style: S.th }, tf('billing.colSession')),
        h('th', { style: S.th }, tf('billing.colPreset')),
        h('th', { style: S.th }, tf('billing.colTotal')),
        h('th', { style: S.th }, tf('billing.colEstimate')),
        h('th', { style: S.th }, tf('billing.colLastWrite'))))

      const body = rows.slice(0, 20).map((row, i) => h('tr', { key: i },
        h('td', { style: { ...S.td, ...S.mono } }, row.title || row.sessionId),
        h('td', { style: S.td }, row.agentPreset ?? '—'),
        h('td', { style: S.td }, formatTokens(row.totalTokens)),
        h('td', { style: S.td }, row.cost === null ? '—' : row.cost.toFixed(4)),
        h('td', { style: { ...S.td, opacity: 0.7 } }, String(row.updatedAt ?? '').slice(0, 16).replace('T', ' '))))

      return h('div', { style: S.card },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, tf('billing.bySession')),
        h('table', { style: S.table }, head, h('tbody', null, body)))
    }

    function BillingPanel({ usage, range, onRange, onRefresh }) {
      if (usage.status === 'loading') return h(Loading)
      if (usage.status === 'error') return h(ErrorBox, { error: usage.error, onRetry: usage.reload })
      const data = usage.data ?? {}
      const totals = data.totals ?? {}
      const billing = data.billing ?? {}
      const cost = data.cost
      const configured = Boolean(billing.consoleUrl) || Boolean(billing.baseUrl)

      return h('div', null,
        h('div', { style: { ...S.row, marginBottom: 12 } },
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, tf('billing.title')),
          h('div', { style: S.spacer }),
          Object.keys(RANGE_LABEL).map((key) =>
            h('button', { key, style: { ...S.button, opacity: range === key ? 1 : 0.55, borderColor: range === key ? 'rgba(31,111,92,0.7)' : undefined }, onClick: () => onRange(key) }, rangeLabel(key))),
          h('button', { style: S.button, onClick: onRefresh }, tf('common.refresh')),
        ),

        h('div', { style: S.card },
          h('div', { style: S.row },
            h(Stat, { label: tf('billing.statTotal'), value: formatTokens(totals.totalTokens), hint: tf('billing.statTotalHint', { n: totals.messages ?? 0 }) }),
            h(Stat, { label: tf('billing.statInput'), value: formatTokens(totals.inputTokens) }),
            h(Stat, { label: tf('billing.statCache'), value: formatTokens(totals.cacheReadTokens) }),
            h(Stat, { label: tf('billing.statOutput'), value: formatTokens(totals.outputTokens) }),
            h(Stat, { label: tf('billing.statCost', { currency: data.currency ?? 'CNY' }), value: cost ? cost.amount.toFixed(4) : '—', hint: cost ? tf('billing.statCostHint') : tf('billing.statCostNoTable') }),
          ),
        ),

        h('div', { style: S.card },
          h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, tf('billing.basis')),
          h(Notice, null,
            h('div', null, billing.note ?? tf('billing.noteFallback')),
            h('div', { style: { marginTop: 6, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
              configured && billing.consoleUrl
                ? h('a', { href: billing.consoleUrl, target: '_blank', rel: 'noreferrer', style: { color: '#3fa07f' } }, tf('billing.openBill'))
                : configured && billing.baseUrl
                  ? h('a', { href: billing.baseUrl, target: '_blank', rel: 'noreferrer', style: { color: '#3fa07f' } }, tf('billing.openRelay'))
                  : h('span', { style: { ...S.chip('skip'), padding: '2px 8px' } }, tf('billing.linkPending', { url: billing.linkPlaceholder ?? 'https://<relay>' })),
              h('span', { style: S.sub }, tf('billing.linkHint')),
            ),
          ),
          (data.keys ?? []).length > 0
            ? keyTable(data.keys)
            : h('div', { style: { ...S.sub, marginTop: 8 } }, tf('billing.noKeySource')),
          h('div', { style: { ...S.sub, marginTop: 8 } }, tf('billing.attribution')),
        ),

        (data.byModel ?? []).length > 0
          ? modelTable(data.byModel)
          : h(Notice, null, data.source === 'unavailable' ? tf('billing.noZstd') : tf('billing.emptyRange')),

        (data.bySession ?? []).length > 0 ? sessionTable(data.bySession) : null,

        (data.warnings ?? []).length
          ? h('div', { style: { ...S.card, borderColor: 'rgba(190,70,60,0.4)' } },
              h('div', { style: { fontSize: 12.5, fontWeight: 600, marginBottom: 6 } }, tf('billing.skipped')),
              h('ul', { style: { margin: '0 0 0 18px', fontSize: 12 } }, data.warnings.map((w, i) =>
                h('li', { key: i }, h('code', { style: S.mono }, w.file || '—'), ` ${w.reason}`))))
          : null,

        h('div', { style: { ...S.sub, marginTop: 8 } },
          tf('billing.indexLine', { files: data.index?.files ?? 0, parsed: data.index?.parsed ?? 0, reused: data.index?.reused ?? 0, at: String(data.generatedAt ?? '').slice(11, 19) })),
      )
    }

    /* ── 接入 ───────────────────────────────────────────────────────────── */

    const wiredLabel = (wired) => tf(`sources.wired.${wired}`)

    function sourceStatusCell(item) {
      const nodes = [
        h(Chip, { key: 'state', status: item.configured ? 'pass' : 'skip' }, item.configured ? tf('sources.configured') : tf('sources.notConfigured')),
        h('div', { key: 'wired', style: { fontSize: 11, opacity: 0.6, marginTop: 4 } }, wiredLabel(item.wired) ?? item.wired),
      ]
      if (item.from === 'env') nodes.push(h('div', { key: 'env', style: { fontSize: 11, opacity: 0.6 } }, tf('sources.fromEnv') + item.envName))
      return h('div', null, nodes)
    }

    function sourceInputCell(item, draft, setDraft) {
      if (!item.path) return h('span', { style: { opacity: 0.5 } }, tf('sources.noCredential'))
      return h('input', {
        style: { ...S.input, minWidth: 150 },
        type: item.kind === 'email' ? 'email' : 'password',
        placeholder: item.kind === 'email' ? 'pi@lab.example' : tf('sources.pasteKey'),
        value: draft[item.id] ?? '',
        onChange: (e) => setDraft((prev) => ({ ...prev, [item.id]: e.target.value })),
      })
    }

    function verifyChip(result) {
      if (!result || !result.status || result.status === 'busy') return null
      const good = result.status === 'ok' || result.status === 'ready'
      const text = result.status === 'ok'
        ? `通 ${result.ms ?? '?'}ms`
        : result.status === 'ready'
          ? tf('sources.hasCredential')
          : result.status === 'no-credential'
            ? tf('sources.missingCredential')
            : tf('sources.failed')
      return h(Chip, { status: good ? 'pass' : 'fail' }, text)
    }

    function sourceActionCell(item, onSave, onTest, result) {
      const nodes = []
      if (item.path) nodes.push(h('button', { key: 'save', style: S.button, onClick: () => onSave(item.id) }, tf('common.save')))
      nodes.push(h('button', { key: 'test', style: S.button, onClick: () => onTest(item.id) }, tf('sources.test')))
      const chip = verifyChip(result)
      if (chip) nodes.push(h('span', { key: 'chip' }, chip))
      if (result && result.hint) nodes.push(h('div', { key: 'hint', style: { fontSize: 11, opacity: 0.65, width: '100%' } }, result.hint))
      return h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } }, nodes)
    }

    function sourceRow(item, draft, setDraft, onSave, onTest, result) {
      return h('tr', { key: item.id },
        h('td', { style: S.td },
          h('a', { href: item.applyUrl, target: '_blank', rel: 'noreferrer', style: { color: '#3fa07f' } }, item.name),
          item.hint ? h('div', { style: { fontSize: 11, opacity: 0.6, marginTop: 2 } }, item.hint) : null),
        h('td', { style: S.td }, item.kind === 'none' ? tf('sources.kindNone') : item.kind === 'email' ? tf('sources.kindEmail') : 'Key'),
        h('td', { style: S.td }, sourceStatusCell(item)),
        h('td', { style: { ...S.td, ...S.mono, opacity: 0.8 } }, item.masked || '—'),
        h('td', { style: S.td }, sourceInputCell(item, draft, setDraft)),
        h('td', { style: S.td }, sourceActionCell(item, onSave, onTest, result)))
    }

    function SourcesPanel({ sources }) {
      const [draft, setDraft] = useState({})
      const [result, setResult] = useState({})
      const [saved, setSaved] = useState('')
      const [error, setError] = useState('')

      if (sources.status === 'loading') return h(Loading)
      if (sources.status === 'error') return h(ErrorBox, { error: sources.error, onRetry: sources.reload })

      const data = sources.data ?? {}
      const items = data.items ?? []

      const save = async (id) => {
        setError('')
        try {
          const payload = await sendJson('PUT', '/sources', { items: { [id]: draft[id] ?? '' } })
          if ((payload.rejected ?? []).length) throw new Error(payload.rejected.map((r) => r.reason).join('；'))
          setDraft((prev) => ({ ...prev, [id]: '' }))
          setSaved(tf('sources.savedAt', { id, at: new Date().toLocaleTimeString() }))
          sources.reload()
        } catch (e) {
          setError(e.message)
        }
      }

      const test = async (id) => {
        setResult((prev) => ({ ...prev, [id]: { status: 'busy' } }))
        try {
          const payload = await sendJson('POST', '/sources/verify', { id })
          setResult((prev) => ({ ...prev, [id]: payload }))
        } catch (e) {
          setResult((prev) => ({ ...prev, [id]: { status: 'fail', hint: e.message } }))
        }
      }

      const head = h('thead', null, h('tr', null,
        h('th', { style: S.th }, tf('sources.colSource')),
        h('th', { style: S.th }, tf('sources.colCredential')),
        h('th', { style: S.th }, tf('sources.colStatus')),
        h('th', { style: S.th }, tf('sources.colValue')),
        h('th', { style: S.th }, tf('sources.colFill')),
        h('th', { style: S.th }, tf('sources.colVerify'))))

      const rows = items.map((item) => sourceRow(item, draft, setDraft, save, test, result[item.id]))
      const configured = items.filter((item) => item.configured).length

      return h('div', null,
        h('div', { key: 'title', style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, tf('sources.heading')),
        h(Notice, { key: 'note' },
          h('div', null, data.note ?? '密钥只写入本机 science/config.json。'),
          h('div', { style: { ...S.mono, opacity: 0.7, marginTop: 4 } }, data.path ?? '')),
        h('div', { key: 'count', style: { ...S.sub, margin: '10px 0' } }, `已配置 ${configured}/${items.length}。留空保存即清除。`),
        h('table', { key: 'table', style: S.table }, head, h('tbody', null, rows)),
        error ? h(ErrorBox, { key: 'error', error }) : null,
        saved ? h('div', { key: 'saved', style: { ...S.sub, marginTop: 8 } }, saved) : null,
        h('div', { key: 'foot', style: { ...S.sub, marginTop: 12 } },
          '标「已保存·工具侧尚未读取」的字段：本页可以保存与连通性测试，但当前 dsh-science 版本的检索运行时还没消费它 —— 不是这里没存进去。'))
    }

    /* ── 底部胶囊：只报 token 消耗量 ─────────────────────────────────────────
       出厂的用量胶囊（总 token · 缓存命中 x%）已被首屏样式摘掉；这里补一个只讲 token 的，
       点了就打开「计费」页。数据来自本机日志的汇总，不额外请求模型。               */

    /* ── 科研需求向导 ─────────────────────────────────────────────────────
       新建会话时点开，十组字段一次问完；生成的是一条给科研合伙人的任务书，
       不是替用户做决定。字段留空就不写进任务书——空着比编一个更有用。
       缺口判定不在这里：那是 science_requirement_brief 的活，前端再算一遍必然漂移。 */

    const WZ = {
      wrap: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
      trigger: {
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '5px 10px', borderRadius: '8px', cursor: 'pointer',
        border: '1px solid var(--dsh-border, #d8d8d8)', background: 'transparent',
        fontSize: '12px', lineHeight: 1.2, whiteSpace: 'nowrap',
      },
      triggerOn: { borderColor: '#1f6f5c', color: '#1f6f5c' },
      panel: {
        position: 'absolute', bottom: 'calc(100% + 10px)', left: 0, zIndex: 60,
        width: 'min(560px, 92vw)', maxHeight: '70vh', overflowY: 'auto',
        padding: '16px', borderRadius: '12px', background: 'var(--dsh-bg, #fff)',
        border: '1px solid var(--dsh-border, #d8d8d8)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.14)', textAlign: 'left',
      },
      title: { fontSize: '14px', fontWeight: 600, marginBottom: '4px' },
      hint: { fontSize: '12px', opacity: 0.65, lineHeight: 1.5, marginBottom: '12px' },
      row: { marginBottom: '10px' },
      label: { display: 'block', fontSize: '12px', fontWeight: 500, marginBottom: '3px' },
      sub: { fontSize: '11px', opacity: 0.6, marginBottom: '4px', lineHeight: 1.45 },
      input: {
        width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: '12px',
        borderRadius: '7px', border: '1px solid var(--dsh-border, #d8d8d8)',
        background: 'transparent', color: 'inherit', fontFamily: 'inherit', lineHeight: 1.5,
      },
      foot: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' },
      btn: {
        padding: '6px 12px', borderRadius: '8px', fontSize: '12px', cursor: 'pointer',
        border: '1px solid var(--dsh-border, #d8d8d8)', background: 'transparent', color: 'inherit',
      },
      btnPrimary: { borderColor: '#1f6f5c', background: '#1f6f5c', color: '#fff' },
      btnOff: { opacity: 0.4, cursor: 'not-allowed' },
    }

    // id 拼字典 key；hint 是给人看的一句解释，回答「为什么问这个」；rows 走多行输入。
    const WZ_FIELDS = [
      { id: 'question', rows: 2, hint: true },
      { id: 'domain' },
      { id: 'data', rows: 2 },
      { id: 'subjects' },
      { id: 'equipment' },
      { id: 'deadline' },
      { id: 'people' },
      { id: 'deliverables' },
      { id: 'ethics' },
      { id: 'license' },
    ]

    function makeRequirementWizard() {
      return function RequirementWizard(props) {
        const [open, setOpen] = useState(false)
        const [form, setForm] = useState({})
        const onActiveChange = props?.onActiveChange
        const inputActions = props?.inputActions

        // 展开时占满工具栏宽度：不在展开状态释放，别的附件控件会被挤没。
        useEffect(() => {
          onActiveChange?.(open)
          return () => { if (open) onActiveChange?.(false) }
        }, [open])

        const set = (id) => (event) => setForm((prev) => ({ ...prev, [id]: event.target.value }))

        // 任务书：只写填了的字段，并显式点名下一步该调哪个工具。
        const compose = () => {
          const lines = [tf('wizard.mandate.intro'), '']
          for (const field of WZ_FIELDS) {
            const value = String(form[field.id] ?? '').trim()
            if (!value) continue
            lines.push('- ' + tf('wizard.field.' + field.id) + '：' + value)
          }
          lines.push('', tf('wizard.mandate.ask'))
          return lines.join('\n')
        }

        const filled = Boolean(String(form.question ?? '').trim())

        const writeDraft = () => {
          inputActions?.setDraft?.(compose())
          setOpen(false)
        }
        const startNow = () => {
          if (!inputActions?.setDraft) return
          inputActions.setDraft(compose())
          inputActions.submit?.()
          setOpen(false)
        }

        return h('div', { style: WZ.wrap },
          h('button', {
            type: 'button',
            title: tf('wizard.openHint'),
            style: open ? { ...WZ.trigger, ...WZ.triggerOn } : WZ.trigger,
            onClick: () => setOpen((v) => !v),
          }, tf('wizard.open')),
          open
            ? h('div', { style: WZ.panel },
                h('div', { style: WZ.title }, tf('wizard.title')),
                h('div', { style: WZ.hint }, tf('wizard.hint')),
                ...WZ_FIELDS.map((field) => h('div', { key: field.id, style: WZ.row },
                  h('label', { style: WZ.label }, tf('wizard.' + field.id)),
                  field.hint ? h('div', { style: WZ.sub }, tf('wizard.hint.' + field.id)) : null,
                  field.rows
                    ? h('textarea', {
                        rows: field.rows,
                        style: WZ.input,
                        placeholder: tf('wizard.ph.' + field.id),
                        value: form[field.id] ?? '',
                        onChange: set(field.id),
                      })
                    : h('input', {
                        type: 'text',
                        style: WZ.input,
                        placeholder: tf('wizard.ph.' + field.id),
                        value: form[field.id] ?? '',
                        onChange: set(field.id),
                      }),
                )),
                h('div', { style: WZ.foot },
                  h('button', { type: 'button', style: WZ.btn, onClick: () => setOpen(false) }, tf('wizard.cancel')),
                  h('button', {
                    type: 'button',
                    style: filled ? WZ.btn : { ...WZ.btn, ...WZ.btnOff },
                    disabled: !filled,
                    onClick: writeDraft,
                  }, tf('wizard.fill')),
                  h('button', {
                    type: 'button',
                    style: filled ? { ...WZ.btn, ...WZ.btnPrimary } : { ...WZ.btn, ...WZ.btnOff },
                    disabled: !filled,
                    onClick: startNow,
                  }, tf('wizard.start')),
                ),
                filled ? null : h('div', { style: { ...WZ.sub, marginTop: '8px' } }, tf('wizard.needQuestion')),
              )
            : null,
        )
      }
    }

    function makeUsagePill(ctx) {
      return function UsageDockPill() {
        const [state, setState] = useState({ status: 'loading', data: null })
        const [hover, setHover] = useState(false)

        useEffect(() => {
          let alive = true
          const load = () => {
            getJson('/usage?range=today').then(
              (data) => { if (alive) setState({ status: 'ready', data }) },
              () => { if (alive) setState({ status: 'error', data: null }) },
            )
          }
          load()
          const timer = setInterval(load, 30_000)
          return () => { alive = false; clearInterval(timer) }
        }, [])

        const totals = state.data?.totals
        // 底部只报消耗量：缓存命中率与金额都不入座，金额留给「计费」页。
        const label = state.status === 'ready' && totals
          ? `今日 ${formatTokens(totals.totalTokens)} tokens`
          : state.status === 'error' ? 'tokens —' : 'tokens …'

        const open = () => requestPanel('billing')

        return h('button',
          {
            type: 'button',
            onClick: open,
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            title: '只统计今天消耗的 token；金额与明细在「计费」页，真值在 New API 中转站',
            style: {
              display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none',
              color: 'inherit', opacity: hover ? 0.92 : 0.6, cursor: 'pointer', fontSize: 11.5, padding: '2px 4px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            },
          },
          h('span', { key: 'dot', 'aria-hidden': true, style: { fontSize: 11 } }, '◇'),
          label)
      }
    }

    /* ── 首次打开的使用引导 ─────────────────────────────────────────────────
       装完之后人最需要的是「下一步做什么」，不是一张功能清单。六步，每步一个能按的按钮，
       进度写回 ui-settings.json（onboardingDone / onboardingStep）。               */

    const GUIDE_TOTAL = 6
    // 模板里写的工具名必须是真实存在的：写错名字，模型会安静地什么都不调，人以为「跑过了」。
    const PROMPT_TEMPLATES = [
      ['选题定位', '我在做「<方向>」。先用 science_frontier_scan 扫近两年的前沿锚点，再用 science_novelty 给三个候选选题打新颖性分，最后只告诉我哪一个值得做成一篇、为什么。'],
      ['文献地图', '围绕「<研究问题>」建一张文献地图：用 science_lit_query 取核心 15 篇，用 science_gap_matrix 标出未被覆盖的空白；每条结论都给出出处、证据强度、是否可复现。'],
      ['假设与样本量', '把「<现象>」写成可检验的假设：H1 明确自变量、因变量与预期方向；用 science_exp_plan 给出最小可复现的样本量、实验步骤，用 science_statistics_choice 指定主分析模型，并列出预注册要点。'],
    ]

    function guideCheckStep(health) {
      const science = health.data?.science
      const preset = health.data?.preset
      const model = health.data?.model
      const keyText = model?.keyPresent === true ? tf('sources.configured') : model?.keyPresent === false ? '未配置（设置 → 模型）' : '未读到'
      return [
        h('p', { key: 'p', style: { margin: '0 0 8px' } }, '先确认这套东西真的起来了。下面五项都对，就可以往下走。'),
        h('ul', { key: 'ul', style: { margin: '0 0 8px 18px', lineHeight: 1.8 } },
          h('li', null, `产品：${health.data?.product ?? 'DeepScient'} ${health.data?.version ?? ''}`),
          h('li', null, `科研库：${science?.available ? `已装载（${science.source === 'runtime' ? '运行中' : '包直读'}）` : `未就绪 — ${science?.reason ?? '等待读取'}`}`),
          // 预设和模型这两行才是「点了开会话却失败」的真正起因，放在自检里而不是等报错。
          h('li', null, `预设：${preset?.id ? `${preset.name ?? preset.id}（${preset.id}）${preset.broken ? ` — 激活失败：${preset.broken}` : ''}` : '未读到'}`),
          h('li', null, `模型：${model?.provider ? `${model.provider}${model.model ? ' / ' + model.model : ''}` : '未读到'} — key ${keyText}`),
          h('li', null, `数据根：${health.data?.dataRoot ?? '—'}`)),
        h('div', { key: 'sub', style: S.sub }, `偏好文件：${health.data?.settingsPath ?? '—'}`),
      ]
    }

    function guideModelStep(usage, openPanel) {
      const keys = usage.data?.keys ?? []
      const nodes = [h('p', { key: 'p', style: { margin: '0 0 8px' } }, '模型和它的 key 决定你能干活、以及账记在谁头上。')]
      if (keys.length) {
        nodes.push(h('ul', { key: 'ul', style: { margin: '0 0 8px 18px', lineHeight: 1.8 } },
          keys.map((k, i) => h('li', { key: i }, `${k.provider ?? '—'}${k.model ? ' / ' + k.model : ''} — ${k.masked || k.source || ''}`))))
      } else {
        nodes.push(h(Notice, { key: 'notice' }, '还没读到凭据来源。启动器用环境变量注入 key，或在「设置 → 模型」里填。'))
      }
      nodes.push(h('div', { key: 'row', style: S.row },
        h('button', { style: S.button, onClick: () => openPanel('billing') }, '看计费与 key 归属')))
      nodes.push(h('div', { key: 'foot', style: { ...S.sub, marginTop: 8 } },
        '每个 provider 的 key 就是计费主体；账单在中转站，本页只做同口径统计。'))
      return nodes
    }

    function guideSourceStep(sources, openPanel) {
      const items = sources.data?.items ?? []
      const ready = items.filter((item) => item.configured).length
      return [
        h('p', { key: 'p', style: { margin: '0 0 8px' } }, `文献/检索 API：已配置 ${ready}/${items.length || 8}。全部可以不填，先用公开池也能跑。`),
        h('ul', { key: 'ul', style: { margin: '0 0 8px 18px', lineHeight: 1.8 } },
          h('li', null, 'OpenAlex / Unpaywall / Crossref：填邮箱即可进 polite pool，最省事的三个。'),
          h('li', null, 'Semantic Scholar / CORE / Zotero / Exa：有 key 更稳，没有也能用。'),
          h('li', null, '密钥只写到本机 science/config.json，不上传、不回显。')),
        h('div', { key: 'row', style: S.row },
          h('button', { style: S.button, onClick: () => openPanel('sources') }, '去填 API')),
        h('div', { key: 'foot', style: { ...S.sub, marginTop: 8 } }, '填完关掉面板页就能回到这里，再点下一步。'),
      ]
    }

    function guideProjectStep(form, setForm, created, createProject) {
      const nodes = [
        h('p', { key: 'p', style: { margin: '0 0 8px' } }, '一个课题 = 一个能写完的故事。先给它一个题目，学科和目标刊可以以后改。'),
        h('div', { key: 'form', style: { display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 460 } },
          h('input', { style: S.input, placeholder: '题目，例如：睡眠时长与工作记忆的剂量效应', value: form.title, onChange: (e) => setForm({ ...form, title: e.target.value }) }),
          h('input', { style: S.input, placeholder: '学科/领域（可空，例：认知神经科学）', value: form.domain, onChange: (e) => setForm({ ...form, domain: e.target.value }) }),
          h('input', { style: S.input, placeholder: '目标刊（可空，例：Nature Human Behaviour）', value: form.journal, onChange: (e) => setForm({ ...form, journal: e.target.value }) })),
        h('div', { key: 'row', style: { ...S.row, marginTop: 10 } },
          h('button', { style: S.button, onClick: createProject, disabled: !form.title.trim() }, '建这个课题')),
      ]
      if (created) {
        nodes.push(h('div', { key: 'done', style: { ...S.card, marginTop: 10 } },
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, `已建好：${created.title}`),
          h('div', { style: S.sub }, `id ${created.id}；进度 ${created.progress ? `${created.progress.done}/${created.progress.total}` : '—'}`)))
      }
      return nodes
    }

    /**
     * 第五步：点一条模板，直接开好会话并把这句话放进输入框。
     *
     * 不做「复制 → 自己新建 → 粘贴」：那是三步，而且中间任何一步失败用户都只能看到
     * 一句「新建会话失败」。这里把预设、工作区、失败原因三件事摊在同一张卡上。
     */
    function guideSessionStep(view) {
      const { templates, preset, sessionState, copy, copied } = view
      const presetBroken = Boolean(preset?.broken)
      const nodes = [
        h('p', { key: 'p', style: { margin: '0 0 8px' } }, '选一条，点「用这条开会话」：会话会开好，这句话已经在输入框里，你确认后按回车就开跑。'),
        h('div', { key: 'preset', style: { ...S.sub, marginBottom: 8 } },
          preset
            ? presetBroken
              ? `预设「${preset.name ?? preset.id}」激活失败：${preset.broken}`
              : `预设：${preset.name ?? preset.id}`
            : '预设：等注册表回报'),
      ]
      nodes.push(h('div', { key: 'templates', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        templates.map(([tag, text]) => {
          const state = sessionState.tag === tag ? sessionState.status : 'idle'
          const busy = state === 'starting'
          return h('div', { key: tag, style: { ...S.card, marginBottom: 0 } },
            h('div', { style: S.row },
              h('span', { style: { fontSize: 12.5, fontWeight: 600 } }, tag),
              h('div', { style: S.spacer }),
              h('button', { style: { ...S.button, border: 'none', background: 'none', opacity: 0.7 }, onClick: () => copy(text, tag) }, copied === tag ? '已复制' : '复制'),
              h('button', {
                style: { ...S.button, borderColor: 'rgba(31,111,92,0.7)', opacity: busy || presetBroken ? 0.55 : 1 },
                disabled: busy || presetBroken,
                onClick: () => view.start(text, tag),
              }, state === 'starting' ? '正在开会话…' : state === 'started' ? '已开好' : '用这条开会话')),
            h('div', { style: { ...S.mono, fontSize: 11.5, opacity: 0.8, marginTop: 6, lineHeight: 1.6 } }, text))
        })))
      if (sessionState.detail) {
        nodes.push(h('div', { key: 'detail', style: { ...S.sub, marginTop: 10 } }, sessionState.detail))
      }
      return nodes
    }

    function guideRulesStep() {
      return [
        h('p', { key: 'p', style: { margin: '0 0 8px' } }, '十二条流程、55 道门。记住三条就够开工：'),
        h('ol', { key: 'ol', style: { margin: '0 0 10px 18px', lineHeight: 1.9 } },
          h('li', null, '每个结论都要能在原文里指出来 —— 没有出处的断言算阻塞，不算「差不多」。'),
          h('li', null, '数据、代码、图、环境指纹都留痕；重跑要能复现同一张图。'),
          h('li', null, '阶段没过是门没开，不是模型偷懒：去「流程」看是哪一道，它会告诉你补什么。')),
        h(Notice, { key: 'notice' }, '随时可以重开这份引导：设置 → 科研工作台 → 重新打开使用引导。'),
      ]
    }

    function makeOnboarding(ctx) {
      return function OnboardingOverlay(props) {
        const settings = useApi('/settings')
        const health = useApi('/health')
        const sources = useApi('/sources')
        const usage = useApi('/usage?range=today')
        const presets = useApi('/presets')
        const [step, setStep] = useState(null)
        const [error, setError] = useState('')
        const [form, setForm] = useState({ title: '', domain: '', journal: '' })
        const [created, setCreated] = useState(null)
        const [copied, setCopied] = useState('')
        const [sessionState, setSessionState] = useState({ tag: '', status: 'idle', detail: '' })

        // shell.overlay 的 standardProps 里有 useWorkspaces；桩测试传空 props，所以要能缺。
        const useWorkspacesHook = typeof props?.useWorkspaces === 'function' ? props.useWorkspaces : null
        const snapshot = useWorkspacesHook ? useWorkspacesHook((state) => state) : null
        const snapshotRef = useRef(snapshot)
        snapshotRef.current = snapshot

        useEffect(() => {
          if (step === null && settings.data?.values) setStep(Number(settings.data.values.onboardingStep) || 0)
        }, [settings.data, step])

        if (settings.status !== 'ready' && settings.status !== 'refreshing') return null
        if (!settings.data?.values || settings.data.values.onboardingDone === true) return null

        const current = Math.min(Math.max(step ?? 0, 0), GUIDE_TOTAL - 1)

        const persist = async (patch) => {
          try {
            await sendJson('PUT', '/settings', patch)
            settings.reload()
          } catch (e) {
            setError(e.message)
          }
        }
        const go = (next) => {
          setError('')
          setStep(next)
          persist({ onboardingStep: next })
        }
        const finish = () => {
          setError('')
          persist({ onboardingDone: true, onboardingStep: GUIDE_TOTAL })
        }
        const openPanel = (key) => requestPanel(key)
        const copy = (text, tag) => {
          try {
            navigator.clipboard?.writeText(text)
            setCopied(tag)
          } catch {
            setCopied('')
          }
        }
        const createProject = async () => {
          setError('')
          try {
            const payload = await sendJson('POST', '/projects', form)
            if (!payload.ok) throw new Error(payload.message || payload.error || '建课题失败')
            setCreated(payload.project)
            openPanel('workbench')
          } catch (e) {
            setError(e.message)
          }
        }
        /** 当前工作区：优先刚建课题的目录，其次最近一个。 */
        const workspaceIdFor = (snap) => {
          const items = Array.isArray(snap?.items) ? snap.items : []
          if (items.length === 0) return null
          const wanted = created?.dir
          const match = wanted ? items.find((w) => w?.path === wanted) : null
          return (match ?? items[items.length - 1])?.workspaceId ?? null
        }
        const sessionCountOf = (snap, workspaceId) => {
          const items = Array.isArray(snap?.items) ? snap.items : []
          if (workspaceId) return items.find((w) => w?.workspaceId === workspaceId)?.sessionIds?.length ?? 0
          return items.reduce((sum, w) => sum + (w?.sessionIds?.length ?? 0), 0)
        }
        /** 等一个新会话出现：startSession 不返回 id 也不抛错，只能用「多了一个」当证据。 */
        const waitForSession = (workspaceId, before, timeoutMs = 2500) =>
          new Promise((resolve) => {
            const started = Date.now()
            const tick = () => {
              const now = sessionCountOf(snapshotRef.current, workspaceId)
              if (now > before) return resolve({ ok: true, total: now })
              if (Date.now() - started >= timeoutMs) return resolve({ ok: false, total: now })
              setTimeout(tick, 120)
            }
            tick()
          })

        /**
         * 开一个会话并把模板放进输入框。
         *
         * 失败必须说得出原因：预设坏了说预设、key 没配说 key、工作区拿不到说工作区。
         * 这三句都能落到卡上，用户才知道下一步该点哪儿。
         */
        const startWithTemplate = async (text, tag) => {
          setError('')
          setSessionState({ tag, status: 'starting', detail: '' })
          try {
            const preset = presets.data?.items?.[0] ?? null
            if (preset?.broken) throw new Error(`预设「${preset.name ?? preset.id}」激活失败：${preset.broken}`)
            const presetId = preset?.id ?? null

            const ui = ctx.get?.('uiWorkspace')
            if (!ui?.startSession) throw new Error('当前界面没有 uiWorkspace 服务，没法开会话')

            let workspaceId = workspaceIdFor(snapshotRef.current)
            if (!workspaceId) {
              const service = ctx.get?.('workspaces')
              const path = created?.dir ?? health.data?.dataRoot
              if (!service?.create || !path) throw new Error('既没有现成工作区，也拿不到课题目录，没法建工作区')
              const view = await service.create({ path })
              workspaceId = view?.workspaceId ?? null
              if (!workspaceId) throw new Error(`建工作区没有返回 id（${path}）`)
            }

            const before = sessionCountOf(snapshotRef.current, workspaceId)
            ui.startSession(workspaceId, {
              ...(presetId ? { agentPreset: presetId } : {}),
              prompt: text,
              clearPreviousDraft: true,
            })
            const outcome = await waitForSession(workspaceId, before)
            if (!outcome.ok) {
              const keyMissing = health.data?.model?.keyPresent === false
              throw new Error(
                keyMissing
                  ? '会话没建起来：模型 key 未配置（设置 → 模型），配好再回来点一次'
                  : '会话没建起来：界面只说「新建会话失败」，真实原因在 设置 → 科研 → 预设体检（/presets/inspect）',
              )
            }
            setSessionState({ tag, status: 'started', detail: '会话已开好，提示词已放进输入框；按回车就开跑。' })
            try {
              ctx.get?.('layout')?.selectPanel?.(null)
            } catch {
              /* 没有布局服务就不切页 */
            }
            persist({ onboardingDone: true, onboardingStep: GUIDE_TOTAL })
          } catch (e) {
            setSessionState({ tag, status: 'failed', detail: e?.message ?? String(e) })
            setError(e?.message ?? String(e))
          }
        }

        let body
        if (current === 0) body = guideCheckStep(health)
        else if (current === 1) body = guideModelStep(usage, openPanel)
        else if (current === 2) body = guideSourceStep(sources, openPanel)
        else if (current === 3) body = guideProjectStep(form, setForm, created, createProject)
        else if (current === 4) {
          body = guideSessionStep({
            templates: PROMPT_TEMPLATES,
            preset: presets.data?.items?.[0] ?? null,
            sessionState,
            copy,
            copied,
            start: startWithTemplate,
          })
        } else body = guideRulesStep()

        const progress = Array.from({ length: GUIDE_TOTAL }).map((_, i) => h('div', {
          key: i,
          style: { height: 3, flex: 1, borderRadius: 999, background: i <= current ? '#1f6f5c' : 'rgba(127,127,127,0.28)' },
        }))

        const card = h('div', {
          role: 'dialog',
          'aria-label': 'DeepScient 使用引导',
          style: {
            width: 'min(620px, 100%)', maxHeight: '86vh', overflow: 'auto', borderRadius: 14, padding: '20px 22px',
            background: 'Canvas', color: 'CanvasText', border: '1px solid rgba(127,127,127,0.35)',
            boxShadow: '0 18px 48px rgba(0,0,0,0.35)',
          },
        },
        h('div', { style: S.row },
          h('div', { style: { fontSize: 15, fontWeight: 600 } }, '开始你的第一个课题'),
          h('div', { style: S.spacer }),
          h('div', { style: S.sub }, `${current + 1} / ${GUIDE_TOTAL}`)),
        h('div', { style: { display: 'flex', gap: 6, margin: '12px 0 16px' } }, progress),
        h('div', { style: { fontSize: 13, lineHeight: 1.75, minHeight: 150 } }, body),
        error ? h(ErrorBox, { error }) : null,
        h('div', { style: { ...S.row, marginTop: 16 } },
          current > 0 ? h('button', { style: S.button, onClick: () => go(current - 1) }, '上一步') : null,
          h('div', { style: S.spacer }),
          h('button', { style: { ...S.button, border: 'none', background: 'none', opacity: 0.6 }, onClick: finish }, '跳过引导'),
          current < GUIDE_TOTAL - 1
            ? h('button', { style: { ...S.button, borderColor: 'rgba(31,111,92,0.7)' }, onClick: () => go(current + 1) }, '下一步')
            : h('button', { style: { ...S.button, borderColor: 'rgba(31,111,92,0.7)' }, onClick: finish }, '开始科研')))

        return h('div', {
          // shell.overlay 这一层本身是 click-through，入场者要点回指针事件，否则点不动。
          style: {
            position: 'fixed', inset: 0, zIndex: 9000, display: 'grid', placeItems: 'center',
            background: 'rgba(0,0,0,0.42)', padding: 20, pointerEvents: 'auto',
          },
        }, card)
      }
    }


    /* ── 六个一级页面 ──────────────────────────────────────────────────────
       每个页面是 main 上独立的挂载点，只有当前这个在发请求；切走即卸载。
       页面之间不共享取数结果，只共享「选中了哪个课题」这一件事。             */

    function Page({ title, projectId, children }) {
      useLocaleRevision()
      return h(
        'div',
        { style: S.panel },
        h('div', { style: S.header },
          h('div', { style: S.title }, tf('app.title')),
          h('div', { style: S.sub }, title),
          h('div', { style: S.spacer }),
          h('div', { style: S.sub }, projectId ? tf('app.project', { id: projectId }) : tf('app.localData')),
        ),
        h('div', { style: S.body }, children),
      )
    }

    function WorkbenchPage() {
      const projects = useApi('/projects')
      const [projectId, onProject] = useSelectedProject(projects)
      const overview = useApi(projectId ? `/projects/${encodeURIComponent(projectId)}/overview` : null, [projectId])
      const jump = (id) => { stageJump.id = id; requestPanel('stages') }
      return h(
        Page,
        { title: tf('page.workbench'), projectId },
        h(Overview, { overview, projects, projectId, onProject, onJump: jump }),
      )
    }

    function StagesPage() {
      const projects = useApi('/projects')
      const [projectId] = useSelectedProject(projects)
      const stages = useApi(projectId ? `/projects/${encodeURIComponent(projectId)}/stages` : null, [projectId])
      // 从工作台跳过来时要展开同一级；读过一次就清掉，免得下次进来又自动展开
      const initial = useRef(stageJump.id)
      useEffect(() => { stageJump.id = '' }, [])
      return h(Page, { title: tf('page.stages'), projectId },
        h(StageList, { stages, initial: initial.current }))
    }

    function ToolsPage() {
      const tools = useApi('/tools')
      const skills = useApi('/skills')
      return h(Page, { title: tf('page.tools') },
        h(ToolList, { tools, skills }))
    }

    function BillingPage() {
      const [range, setRange] = useState('today')
      const usage = useApi(`/usage?range=${range}`, [range])
      return h(Page, { title: tf('page.billing') },
        h(BillingPanel, { usage, range, onRange: setRange, onRefresh: usage.reload }))
    }

    function SourcesPage() {
      const sources = useApi('/sources')
      return h(Page, { title: tf('page.sources') },
        h(SourcesPanel, { sources }))
    }

    function DocsPage() {
      const docs = useApi('/docs')
      return h(Page, { title: tf('page.docs') },
        h(Docs, { docs }))
    }

    /* ── 设置页 ─────────────────────────────────────────────────────────── */

    const FIELDS = [
      ['defaultDiscipline', '默认学科包', 'text'],
      ['defaultJournal', '默认目标刊', 'text'],
      ['evidenceStrictness', '证据链严格度', ['strict', 'normal']],
      ['networkForSearch', '检索是否允许联网', 'bool'],
      ['alpha', '显著性水平 α', 'number'],
      ['effectSize', '默认效应量', ['cohen-d', 'hedges-g', 'eta-squared', 'odds-ratio']],
      ['correction', '多重比较校正', ['holm', 'bonferroni', 'fdr-bh', 'none']],
      ['figureUnits', '出图单位', ['mm', 'inch']],
      ['locale', '界面语言', ['zh', 'en']],
      ['billingProvider', '计费口径来源', ['newapi', 'none']],
      ['billingBaseUrl', 'New API 中转站地址', 'url'],
      ['billingConsoleUrl', '账单 / 余额页', 'url'],
      ['billingCurrency', '币种', ['CNY', 'USD']],
    ]

    function fieldRow(draft, setDraft, key, label, kind) {
      const value = draft[key]
      let control
      if (kind === 'bool') {
        control = h('input', { type: 'checkbox', checked: Boolean(value), onChange: (e) => setDraft({ ...draft, [key]: e.target.checked }) })
      } else if (Array.isArray(kind)) {
        control = h('select', { style: S.select, value: value ?? '', onChange: (e) => setDraft({ ...draft, [key]: e.target.value }) },
          kind.map((v) => h('option', { key: v, value: v }, v)))
      } else if (kind === 'number') {
        control = h('input', { style: { ...S.input, minWidth: 100 }, type: 'number', step: 0.01, min: 0.001, max: 0.5, value: value ?? '', onChange: (e) => setDraft({ ...draft, [key]: Number(e.target.value) }) })
      } else if (kind === 'url') {
        control = h('input', {
          style: { ...S.input, minWidth: 260 },
          type: 'url',
          placeholder: key === 'billingBaseUrl' ? 'https://<你的 New API 中转站地址>' : 'https://<中转站>/panel/token',
          value: value ?? '',
          onChange: (e) => setDraft({ ...draft, [key]: e.target.value }),
        })
      } else {
        control = h('input', { style: S.input, value: value ?? '', onChange: (e) => setDraft({ ...draft, [key]: e.target.value }) })
      }
      return h('div', { key, style: { display: 'flex', alignItems: 'center', gap: 12 } },
        h('div', { style: { width: 150, fontSize: 12.5, opacity: 0.8 } }, label),
        control)
    }

    function makeSettingsSection(ctx) {
      return function SettingsSection() {
        const state = useApi('/settings')
        const presets = useApi('/presets')
        const [draft, setDraft] = useState(null)
        const [saved, setSaved] = useState('')
        const [rejected, setRejected] = useState([])
        const [error, setError] = useState('')
        const [inspect, setInspect] = useState(null)
        const [skillCat, setSkillCat] = useState(null)
        const [skillCheck, setSkillCheck] = useState(null)
        const busy = useRef(false)

        useEffect(() => { if (state.data?.values) setDraft(state.data.values) }, [state.data])

        const save = useCallback(async () => {
          if (!draft || busy.current) return
          busy.current = true
          setError('')
          try {
            const body = await sendJson('PUT', '/settings', draft)
            setDraft(body.values)
            setRejected(body.rejected ?? [])
            setSaved('已保存 ' + new Date().toLocaleTimeString())
            state.reload()
          } catch (e) {
            setError(e.message)
          } finally {
            busy.current = false
          }
        }, [draft, state])

        const reopenGuide = useCallback(async () => {
          try {
            await sendJson('PUT', '/settings', { onboardingDone: false, onboardingStep: 0 })
            state.reload()
            setSaved('使用引导已重新打开：切回对话或刷新页面就能看到')
          } catch (e) {
            setError(e.message)
          }
        }, [state])

        if (state.status === 'loading') return h(Loading)
        if (state.status === 'error') return h(ErrorBox, { error: state.error, onRetry: state.reload })
        if (!draft) return h(Loading)

        const rows = Array.isArray(draft.billingPriceTable) ? draft.billingPriceTable : []
        const patchRow = (index, patch) => setDraft({ ...draft, billingPriceTable: rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) })
        const addRow = () => setDraft({ ...draft, billingPriceTable: [...rows, { provider: '', model: '', inputPerM: 0, cacheReadPerM: 0, outputPerM: 0 }] })
        const removeRow = (index) => setDraft({ ...draft, billingPriceTable: rows.filter((_, i) => i !== index) })

        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 } },
          h('div', { style: { fontSize: 13, opacity: 0.75, lineHeight: 1.6 } },
            '这些是偏好，不是能力开关。改完立刻生效，落在本实例自己的数据根里（',
            h('code', { style: S.mono }, state.data?.path ?? ''),
            '）。'),
          FIELDS.map(([key, label, kind]) => fieldRow(draft, setDraft, key, label, kind)),

          h('div', { style: { ...S.card, marginTop: 6 } },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, '计费价目（每百万 token 单价）'),
            h('div', { style: { ...S.sub, marginBottom: 8 } },
              '填了价目，计费页和底部胶囊才会出现「≈金额」。命中缓存的输入与未命中的输入分开算：缓存通常便宜一个数量级，混在一起会虚高。'),
            rows.length
              ? h('table', { style: S.table },
                  h('thead', null, h('tr', null,
                    h('th', { style: S.th }, 'provider'), h('th', { style: S.th }, tf('billing.colModel')),
                    h('th', { style: S.th }, '输入/M'), h('th', { style: S.th }, '缓存命中/M'),
                    h('th', { style: S.th }, '输出/M'), h('th', { style: S.th }, ''))),
                  h('tbody', null, rows.map((row, index) =>
                    h('tr', { key: index },
                      h('td', { style: S.td }, h('input', { style: { ...S.input, minWidth: 90 }, value: row.provider ?? '', placeholder: 'tree 或 *', onChange: (e) => patchRow(index, { provider: e.target.value }) })),
                      h('td', { style: S.td }, h('input', { style: { ...S.input, minWidth: 120 }, value: row.model ?? '', placeholder: '模型名或 *', onChange: (e) => patchRow(index, { model: e.target.value }) })),
                      h('td', { style: S.td }, h('input', { style: { ...S.input, minWidth: 70 }, type: 'number', step: '0.01', value: row.inputPerM ?? 0, onChange: (e) => patchRow(index, { inputPerM: Number(e.target.value) }) })),
                      h('td', { style: S.td }, h('input', { style: { ...S.input, minWidth: 70 }, type: 'number', step: '0.01', value: row.cacheReadPerM ?? 0, onChange: (e) => patchRow(index, { cacheReadPerM: Number(e.target.value) }) })),
                      h('td', { style: S.td }, h('input', { style: { ...S.input, minWidth: 70 }, type: 'number', step: '0.01', value: row.outputPerM ?? 0, onChange: (e) => patchRow(index, { outputPerM: Number(e.target.value) }) })),
                      h('td', { style: S.td }, h('button', { style: S.button, onClick: () => removeRow(index) }, '删除'))))))
              : h('div', { style: S.sub }, '还没有价目行。'),
            h('div', { style: { ...S.row, marginTop: 8 } },
              h('button', { style: S.button, onClick: addRow }, '添加一行'),
              h('span', { style: S.sub }, 'provider / 模型填 * 表示通配。')),
          ),

          h('div', { style: { ...S.card } },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '使用引导与接入'),            h('div', { style: { ...S.row } },
              h('button', { style: S.button, onClick: reopenGuide }, '重新打开使用引导'),
              h('button', {
                style: S.button,
                onClick: () => requestPanel('sources'),
              }, '去填文献 / 检索 API')),
            h('div', { style: { ...S.sub, marginTop: 8 } },
              '引导在新建的浏览器里第一次打开时自动出现；重开后立刻会再出现一次。')),

          // 预设体检：开会话失败时先来这里看是哪一行插件没起来，而不是靠猜。
          h('div', { style: { ...S.card } },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '预设体检'),
            h('div', { style: { ...S.sub, marginBottom: 8 } },
              (presets.data?.items ?? []).length
                ? `当前预设：${(presets.data.items ?? []).map((p) => `${p.name ?? p.id}${p.broken ? '（激活失败）' : ''}`).join('、')}`
                : '还没读到预设注册表。'),
            h('div', { style: S.row },
              h('button', {
                style: S.button,
                onClick: async () => {
                  setError('')
                  try {
                    setInspect(await fetchJson('/presets/inspect'))
                  } catch (e) {
                    setError(e.message)
                  }
                },
              }, '看每一行插件的状态')),
            inspect
              ? h('div', { style: { marginTop: 8 } },
                  inspect.available === false
                    ? h('div', { style: S.sub }, `读不到：${inspect.reason ?? '未知原因'}`)
                    : (inspect.presets ?? []).map((p) => h('div', { key: p.id, style: { marginTop: 6 } },
                        h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, `${p.name ?? p.id}${p.isDefault ? '（默认）' : ''}${p.broken ? ` — 激活失败：${p.broken}` : ''}`),
                        h('div', { style: { ...S.mono, fontSize: 11.5, opacity: 0.85, marginTop: 4, lineHeight: 1.6 } },
                          (p.rows ?? []).map((r) => `${r.fiberState ?? '?'}  ${r.moduleName}${r.entryId ? `#${r.entryId}` : ''}`).join('\n')))))
              : null),

          // 技能目录：磁盘上有几条、模型真能看见几条 —— 这两件事必须分开看。
          h('div', { style: { ...S.card } },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '技能目录'),
            h('div', { style: { ...S.sub, marginBottom: 8 } },
              '随包科研技能 + 第三方 vendor 技能。vendor 由 scripts/install-skills.mjs 按 manifest 装，装在 $DSH_HOME/science/skills-vendor。'),
            h('div', { style: S.row },
              h('button', {
                style: S.button,
                onClick: async () => {
                  setError('')
                  try {
                    setSkillCat(await fetchJson('/skills'))
                  } catch (e) {
                    setError(e.message)
                  }
                },
              }, '看装了哪些技能'),
              h('button', {
                style: S.button,
                onClick: async () => {
                  setError('')
                  try {
                    setSkillCheck(await sendJson('POST', '/skills/check'))
                  } catch (e) {
                    setError(e.message)
                  }
                },
              }, '检查已装技能')),
            skillCat
              ? h('div', { style: { marginTop: 8 } },
                  h('div', { style: { fontSize: 12.5, fontWeight: 600 } },
                    `随包 ${skillCat.counts?.bundled ?? 0} 条 · vendor ${skillCat.counts?.vendor ?? 0} 条 · 自己的 ${skillCat.counts?.user ?? 0} 条 · 会话里应有 ${skillCat.counts?.sessionExpect ?? 0} 条`),
                  h('div', { style: S.sub },
                    `目录进系统提示约 ${skillCat.catalog?.session?.approxTokens ?? '?'} tokens（描述按 260 字截断）。`
                    + `host 平面视图 ${skillCat.counts?.hostCatalog ?? '?'} 条 —— 会话跑在科研预设里，以「会话里应有」为准。`),
                  (skillCat.items ?? []).filter((row) => row.source === 'vendor').length
                    ? h('div', { style: { ...S.mono, fontSize: 11, opacity: 0.85, marginTop: 6, maxHeight: 220, overflow: 'auto', lineHeight: 1.7 } },
                        (skillCat.items ?? [])
                          .filter((row) => row.source === 'vendor')
                          .map((row) => `${row.name}${row.vendor?.license ? `  [${row.vendor.license}]` : ''}${row.vendor?.repo ? `  ${row.vendor.repo.split('/').pop()}@${String(row.vendor.ref ?? '').slice(0, 7)}` : ''}`)
                          .join('\n'))
                    : h('div', { style: S.sub }, '还没有 vendor 技能：跑 node scripts/install-skills.mjs --apply'),
                  h('div', { style: { ...S.sub, marginTop: 6 } }, `根：${skillCat.roots?.vendor ?? ''}`))
              : null,
            skillCheck
              ? h('div', { style: { marginTop: 8 } },
                  h('div', { style: { fontSize: 12.5, fontWeight: 600 } },
                    skillCheck.ok
                      ? `全部通过：${skillCheck.passed}/${skillCheck.checked} 条，manifest ${skillCheck.manifest?.pinned ?? 0}/${skillCheck.manifest?.rows ?? 0} 条已 pin`
                      : `有 ${(skillCheck.failed?.length ?? 0) + (skillCheck.problems?.length ?? 0)} 处问题`),
                  (skillCheck.failed ?? []).map((row) => h('div', { key: row.name, style: { ...S.sub, color: '#d06a5f' } }, `${row.name}：${row.reason}`)),
                  (skillCheck.problems ?? []).map((line, i) => h('div', { key: `p${i}`, style: { ...S.sub, color: '#d06a5f' } }, line)))
              : null),

          h('div', { style: { ...S.row, marginTop: 6 } },
            h('button', { style: S.button, onClick: save }, tf('common.save')),
            h('button', { style: S.button, onClick: () => setDraft(state.data?.values ?? draft) }, '还原'),
            saved ? h('span', { style: S.sub }, saved) : null),
          rejected.length
            ? h('div', { style: { ...S.sub, color: '#d06a5f' } }, '未接受：' + rejected.join('、'))
            : null,
          error ? h(ErrorBox, { error }) : null,
        )
      }
    }


    /* ── 注册 ───────────────────────────────────────────────────────────────
       id 与 key 必须是同一个字符串：侧栏图标点下去就是把 main 切到同名 key。      */

    /* ── 浏览器标签 ────────────────────────────────────────────────────────
       外壳的静态 index.html 写着自家名字，这里改成产品名；路由切换时外壳可能
       把 title 写回去，所以盯着 head 变化重设。只在值不同时写，避免自触发。   */

    function applyDocumentTitle(ctx) {
      if (typeof document === 'undefined' || !document.head) return
      // 标签跟着语言走：切到英文时浏览器标签也要是英文
      const want = () => tf('app.title')
      const set = () => {
        const title = want()
        if (document.title !== title) document.title = title
      }
      set()
      if (typeof MutationObserver === 'undefined') return
      const observer = new MutationObserver(set)
      observer.observe(document.head, { childList: true, subtree: true, characterData: true })
      const offLocale = ctx.locale?.subscribe?.(set)
      const stop = () => {
        observer.disconnect()
        if (typeof offLocale === 'function') offLocale()
      }
      if (typeof ctx.effect === 'function') ctx.effect(() => stop)
      else if (typeof ctx.on === 'function') ctx.on('dispose', stop)
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      // 胶囊、引导、设置页要换一级面板，先把 ctx 交出去给 requestPanel
      panelHost.ctx = ctx
      // 文案与语言切换：tf() 读 i18n.t，useLocaleRevision() 从 i18n.ctx 拿订阅口
      i18n.t = t
      i18n.ctx = ctx

      const SettingsSection = makeSettingsSection(ctx)
      const UsageDockPill = makeUsagePill(ctx)
      const Onboarding = makeOnboarding(ctx)

      applyDocumentTitle(ctx)

      ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.register({ name: 'sidebar.brand.mark', locale: NS }, BrandMark))

      ctx.slots.inject('sidebar.brand.name', () =>
        ctx.slots.register({ name: 'sidebar.brand.name', locale: NS }, BrandName))

      // 空白会话欢迎页的品牌位。不接这里，第一屏大字标还是外壳自己的。
      ctx.slots.inject('conversation.hero.brand.mark', () =>
        ctx.slots.register({ name: 'conversation.hero.brand.mark', locale: NS }, () => h(BrandMark, { size: 30 })))

      // 六个一级面板：侧栏 id 与 main 的 key 出自同一张 PAGES 表
      for (const page of PAGES) {
        const id = panelId(page.key)
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id, order: page.order, locale: NS, label: () => t(`panel.${page.key}`) },
            page.Icon,
          ))

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: id, locale: NS }, page.Component))
      }

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register({ name: 'settings.section', id: PANEL_ID, order: 40, locale: NS, label: () => t('settings') }, SettingsSection))

      // 底部：只报 token 消耗。出厂那颗（含缓存命中率）已被首屏样式摘掉，这里补一颗只讲 token 的。
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register({ name: 'conversation.composer.dock', id: 'deepscient-usage', order: 1, locale: NS }, UsageDockPill))

        // 科研需求向导：挂在 composer 工具栏（模型选择器之后）。single 槽，实测空着，
        // 且它是唯一同时提供 inputActions（写草稿/提交）与 onActiveChange（展开时让出宽度）的位置。
        // 本实例（DeepScient）的预设就是科研模式，不额外做开关——多一个开关就多一处会漂的状态。
        const RequirementWizard = makeRequirementWizard()
        ctx.slots.inject('conversation.input.activity', () =>
          ctx.slots.register({ name: 'conversation.input.activity', locale: NS }, RequirementWizard))

      // 首次打开的分步引导：只在 onboardingDone 不为 true 时渲染。
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'deepscient-onboarding', order: 900, locale: NS }, Onboarding))
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
