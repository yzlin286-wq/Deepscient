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
      const res = await fetch(`${API}${path}`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
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

    /* ── 面板导航：胶囊/引导要能把主面板切到指定页签 ───────────────────────
       主面板是按需挂载的，模块级的一个待办位就够了；挂载后先读它再清掉。      */

    const panelNav = { pending: null, listeners: new Set() }

    function requestPanel(tab) {
      panelNav.pending = tab
      panelNav.listeners.forEach((fn) => fn(tab))
    }

    function subscribePanel(fn) {
      panelNav.listeners.add(fn)
      return () => panelNav.listeners.delete(fn)
    }

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
      tabs: { display: 'flex', gap: 4, padding: '0 20px', borderBottom: '1px solid rgba(127,127,127,0.18)' },
      tab: (active) => ({
        padding: '9px 12px', fontSize: 13, cursor: 'pointer', background: 'none', border: 'none',
        color: 'inherit', opacity: active ? 1 : 0.55, borderBottom: active ? '2px solid #1f6f5c' : '2px solid transparent',
      }),
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
    const REASON_LABEL = { blocking: '阻塞', warning: '警告', unrecorded: '未留记录', 'self-check': '自查' }
    const REASON_TONE = { blocking: 'fail', warning: 'manual', unrecorded: 'skip', 'self-check': 'manual' }

    function Chip({ status, children }) {
      return h('span', { style: S.chip(TONE[status] ?? 'skip') }, children ?? status)
    }

    function Notice({ children }) {
      return h('div', { style: S.notice }, children)
    }

    function ErrorBox({ error, onRetry }) {
      return h(
        'div',
        { style: { ...S.card, borderColor: 'rgba(190,70,60,0.5)' } },
        h('div', { style: { fontSize: 13, marginBottom: 6 } }, '读不到数据'),
        h('div', { style: { ...S.mono, opacity: 0.8 } }, String(error)),
        onRetry ? h('button', { style: { ...S.button, marginTop: 10 }, onClick: onRetry }, '重试') : null,
      )
    }

    function Loading() {
      return h('div', { style: { ...S.notice, padding: 8 } }, '读取中…')
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

    function PanelIcon({ size = 18, active }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block', opacity: active ? 1 : 0.75 } },
        h('rect', { x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { d: 'M7 15.5 L10.2 11.2 L13 13.6 L17 8.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      )
    }

    /* ── 工作台 ─────────────────────────────────────────────────────────── */

    function StageLadder({ stages, selected, onSelect }) {
      return h(
        'div',
        { style: S.ladder },
        stages.map((s) => {
          const state = s.complete ? 'pass' : s.blocking > 0 ? 'fail' : 'manual'
          return h(
            'button',
            {
              key: s.id,
              style: { ...S.step(state), color: 'inherit', outline: selected === s.id ? '2px solid rgba(31,111,92,0.5)' : 'none' },
              onClick: () => onSelect(s.id),
              title: s.goal,
            },
            h('strong', { style: { fontWeight: 600 } }, s.id),
            h('span', { style: { opacity: 0.85 } }, s.label),
            s.complete ? h('span', { style: { opacity: 0.7 } }, '✓') : s.blocking > 0 ? h('span', { style: { opacity: 0.7 } }, `✗${s.blocking}`) : null,
          )
        }),
      )
    }

    function GateTable({ gates }) {
      if (!gates || !gates.length) return h(Notice, null, '这个阶段没有门。')
      return h(
        'table',
        { style: S.table },
        h('thead', null, h('tr', null, h('th', { style: S.th }, '门'), h('th', { style: S.th }, '等级'), h('th', { style: S.th }, '状态'), h('th', { style: S.th }, '详情'), h('th', { style: S.th }, '怎么过'))),
        h(
          'tbody',
          null,
          gates.map((g) =>
            h(
              'tr',
              { key: g.id },
              h('td', { style: S.td }, g.label),
              h('td', { style: S.td }, h(Chip, { status: g.severity === 'blocking' ? 'fail' : g.severity === 'warning' ? 'manual' : 'skip' }, g.severity === 'blocking' ? '阻塞' : g.severity === 'warning' ? '警告' : '自查')),
              h('td', { style: S.td }, h(Chip, { status: g.status })),
              h('td', { style: { ...S.td, opacity: 0.8 } }, g.detail ?? '—'),
              h('td', { style: { ...S.td, opacity: 0.8 } }, g.fix ?? '—'),
            ),
          ),
        ),
      )
    }

    function Workbench({ projects, projectId, onProject, stages, next, onJump }) {
      if (projects.status === 'error') return h(ErrorBox, { error: projects.error, onRetry: projects.reload })
      if (projects.status === 'loading') return h(Loading)

      const list = projects.data?.items ?? []
      if (!projects.data?.available && projects.data) {
        return h(
          'div',
          { style: S.card },
          h('div', { style: { fontSize: 13, marginBottom: 6 } }, '科研库未就绪'),
          h(Notice, null, projects.data.reason ?? '没找到 dsh-science 的数据根。'),
        )
      }
      if (!list.length) {
        return h(
          'div',
          { style: S.card },
          h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, '还没有课题'),
          h(
            Notice,
            null,
            h('div', null, '三步开始：'),
            h('ol', { style: { margin: '6px 0 0 18px' } },
              h('li', null, '建课题：让助手调 science_project_open（带 domain / question / ethics）'),
              h('li', null, '定样本量：science_exp_plan 给 effect 算 n，或给 n 算 MDE'),
              h('li', null, '写数据、跑清洗：science_exp_run，然后 science_stats'),
            ),
          ),
        )
      }

      const current = list.find((p) => p.id === projectId) ?? list[0]
      const stage = stages.data?.stages ?? []
      // advise() 只给 id/label/goal；计数要回到 stages 那一份上取，别在这里编。
      const currentRow = stage.find((s) => s.id === (next.data?.stage?.id ?? '')) ?? null

      return h(
        'div',
        null,
        h(
          'div',
          { style: S.card },
          h(
            'div',
            { style: S.row },
            h('select', {
              style: S.select,
              value: current.id,
              onChange: (e) => onProject(e.target.value),
            }, list.map((p) => h('option', { key: p.id, value: p.id }, `${p.title}（${p.progress.done}/${p.progress.total}）`))),
            h('div', { style: S.sub }, current.domain ?? '未标学科'),
            current.targetJournal ? h(Chip, { status: 'pass' }, current.targetJournal) : null,
            current.preregRef ? h(Chip, { status: 'pass' }, `预注册 ${current.preregRef}`) : h(Chip, { status: 'skip' }, '无预注册编号'),
            h('div', { style: S.spacer }),
            stages.status === 'refreshing' ? h('span', { style: S.sub }, '刷新中…') : null,
            h('button', { style: S.button, onClick: () => { stages.reload(); projects.reload(); next.reload() } }, '刷新'),
          ),
          h('div', { style: { ...S.sub, marginTop: 8 } }, current.question ?? '（方案里还没写研究问题）'),
        ),
        stages.status === 'error' ? h(ErrorBox, { error: stages.error, onRetry: stages.reload }) : null,
        stages.status === 'loading' ? h(Loading) : null,
        stage.length
          ? h(StageLadder, { stages: stage, selected: next.data?.stage?.id ?? '', onSelect: onJump })
          : null,
        next.status === 'error' ? h(ErrorBox, { error: next.error, onRetry: next.reload }) : null,
        next.data?.done
          ? h('div', { style: S.card }, h('div', { style: { fontSize: 13, fontWeight: 600 } }, '十二个阶段都过了'), h(Notice, null, '这说明机器能查的都齐了。剩下的自查项（伦理、作者贡献、cover letter）仍然要你自己过一遍。'))
          : next.data?.stage
            ? h(
                'div',
                { style: S.card },
                h('div', { style: S.row },
                  h('div', { style: { fontSize: 13, fontWeight: 600 } }, `${next.data.stage.id} ${next.data.stage.label}`),
                  currentRow && currentRow.blocking > 0 ? h(Chip, { status: 'fail' }, `阻塞 ${currentRow.blocking}`) : null,
                  currentRow && currentRow.warnings > 0 ? h(Chip, { status: 'manual' }, `警告 ${currentRow.warnings}`) : null,
                  currentRow && currentRow.skipped > 0 ? h(Chip, { status: 'skip' }, `未留记录 ${currentRow.skipped}`) : null,
                ),
                h('div', { style: { ...S.sub, margin: '6px 0 10px' } }, next.data.stage.goal),
                (next.data.nextActions ?? []).length
                  ? h('ul', { style: { margin: '0 0 0 18px' } },
                      next.data.nextActions.map((a, i) =>
                        h('li', { key: `${a.gate ?? i}-${i}`, style: { marginBottom: 6 } },
                          h(Chip, { status: REASON_TONE[a.reason] ?? 'skip' }, REASON_LABEL[a.reason] ?? '待办'),
                          ' ',
                          h('span', { style: { fontWeight: 600 } }, a.label ?? a.gate),
                          a.detail ? h('span', { style: { opacity: 0.8 } }, ` — ${a.detail}`) : null,
                          a.fix ? h('div', { style: { ...S.mono, opacity: 0.75, marginTop: 2 } }, a.fix) : null,
                        ),
                      ))
                  : h(Notice, null, '这一步没有可执行动作：剩下的都是自查项，去「流程」看清单。'),
                (next.data.failureModes ?? []).length
                  ? h('div', { style: { ...S.sub, marginTop: 10 } },
                      h('div', { style: { fontWeight: 600, marginBottom: 4 } }, '这一步最常见的翻车方式'),
                      h('ul', { style: { margin: '0 0 0 18px' } },
                        next.data.failureModes.map((m, i) => h('li', { key: i }, m))))
                  : null,
                h('div', { style: { ...S.sub, marginTop: 10 } },
                  `阶段进度：${(stage.filter((s) => s.complete).length)}/${stage.length}；下一步取法：${next.data.reason ?? '—'}`),
              )
            : null,
      )
    }

    function StageList({ stages, initial }) {
      const [open, setOpen] = useState(initial ?? '')
      useEffect(() => { if (initial) setOpen(initial) }, [initial])
      if (stages.status === 'loading') return h(Loading)
      if (stages.status === 'error') return h(ErrorBox, { error: stages.error, onRetry: stages.reload })
      if (stages.data && stages.data.available === false) return h(Notice, null, stages.data.reason)
      const list = stages.data?.stages ?? []
      if (!list.length) return h(Notice, null, '还没有课题，先在工作台建一个。')
      return h(
        'div',
        null,
        h('div', { style: { ...S.sub, marginBottom: 10 } },
          `阻塞 ${stages.data.summary.blocking} · 警告 ${stages.data.summary.warnings} · 未留记录 ${stages.data.summary.skipped} · 自查 ${stages.data.summary.manual}`),
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
              s.complete ? h(Chip, { status: 'pass' }, '完成') : h(Chip, { status: s.blocking ? 'fail' : 'skip' }, s.blocking ? `${s.blocking} 阻塞` : '未完成'),
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
          h('input', { style: S.input, placeholder: '按工具名或阶段过滤', value: query, onChange: (e) => setQuery(e.target.value) }),
          h('div', { style: S.sub }, `${filtered.length}/${items.length} 个工具`),
        ),
        h('table', { style: S.table },
          h('thead', null, h('tr', null,
            h('th', { style: S.th }, '工具'), h('th', { style: S.th }, '阶段'), h('th', { style: S.th }, '这一步的产物'))),
          h('tbody', null, filtered.map((t) => h('tr', { key: t.name },
            h('td', { style: { ...S.td, ...S.mono } }, t.name),
            h('td', { style: S.td }, `${t.stageId} ${t.stageLabel}`),
            h('td', { style: { ...S.td, opacity: 0.75 } }, (t.artifacts ?? []).join('、') || '—'),
          )))),
        h('div', { style: { ...S.sub, marginTop: 12 } }, '工具只在「科研模式」预设的会话里可调；这里列的是它们各自属于哪一步。'),

        h('div', { style: { fontSize: 13, fontWeight: 600, margin: '22px 0 8px' } }, `随包技能（${skillItems.length}）`),
        skillItems.length
          ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
              skillItems.map((s) => h('span', {
                key: s.name,
                title: s.name,
                style: { ...S.chip('skip'), borderStyle: 'solid', padding: '3px 9px', fontSize: 11.5 },
              }, s.title)))
          : h(Notice, null, skills.status === 'error' ? skills.error : '没读到技能目录。'),
        h('div', { style: { ...S.sub, marginTop: 8 } }, '技能是「怎么干活」的方法笔记，助手在做对应任务时会自己读；你点不开它们，但可以据此要求它按哪本手册做。'),
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
      if (!items.length) return h(Notice, null, '说明文档还没打包进来（deepscient/docs/*.md）。')
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

    const RANGE_LABEL = { today: '今天', '7d': '7 天', '30d': '30 天', all: '全部' }

    function Stat({ label, value, hint }) {
      return h('div', { style: { minWidth: 120, padding: '10px 12px', borderRadius: 10, background: 'rgba(127,127,127,0.07)' } },
        h('div', { style: { fontSize: 11.5, opacity: 0.65, marginBottom: 4 } }, label),
        h('div', { style: { fontSize: 17, fontWeight: 600, ...S.mono } }, value),
        hint ? h('div', { style: { fontSize: 11, opacity: 0.55, marginTop: 3 } }, hint) : null)
    }

    /** 扣费主体表：每把 key 一行，只有掩码。 */
    function keyTable(keys) {
      const head = h('thead', null, h('tr', null,
        h('th', { style: S.th }, '来源'),
        h('th', { style: S.th }, 'provider'),
        h('th', { style: S.th }, '掩码'),
        h('th', { style: S.th }, '说明')))

      const rows = keys.map((k, i) => h('tr', { key: i },
        h('td', { style: S.td }, k.source ?? '—'),
        h('td', { style: { ...S.td, ...S.mono } }, k.provider ?? '—'),
        h('td', { style: { ...S.td, ...S.mono } }, k.masked || '—'),
        h('td', { style: { ...S.td, opacity: 0.75 } }, k.note ?? '—')))

      return h('div', { style: { marginTop: 10 } },
        h('div', { style: { fontSize: 12.5, opacity: 0.75, marginBottom: 4 } }, '扣费主体（每个 key 各自计费）'),
        h('table', { style: S.table }, head, h('tbody', null, rows)))
    }


    /** 按模型表。 */
    function modelTable(rows) {
      const head = h('thead', null, h('tr', null,
        h('th', { style: S.th }, 'provider'),
        h('th', { style: S.th }, '模型'),
        h('th', { style: S.th }, '输入'),
        h('th', { style: S.th }, '缓存命中'),
        h('th', { style: S.th }, '输出'),
        h('th', { style: S.th }, '合计'),
        h('th', { style: S.th }, '预估')))

      const body = rows.map((row, i) => h('tr', { key: i },
        h('td', { style: { ...S.td, ...S.mono } }, row.provider),
        h('td', { style: { ...S.td, ...S.mono } }, row.model),
        h('td', { style: S.td }, formatTokens(row.inputTokens)),
        h('td', { style: S.td }, formatTokens(row.cacheReadTokens)),
        h('td', { style: S.td }, formatTokens(row.outputTokens)),
        h('td', { style: S.td }, formatTokens(row.totalTokens)),
        h('td', { style: S.td }, row.cost === null ? '—' : row.cost.toFixed(4))))

      return h('div', { style: S.card },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, '按模型'),
        h('table', { style: S.table }, head, h('tbody', null, body)))
    }

    /** 按会话表（最多 20 行，最近的在前）。 */
    function sessionTable(rows) {
      const head = h('thead', null, h('tr', null,
        h('th', { style: S.th }, '会话'),
        h('th', { style: S.th }, '预设'),
        h('th', { style: S.th }, '合计'),
        h('th', { style: S.th }, '预估'),
        h('th', { style: S.th }, '最后写入')))

      const body = rows.slice(0, 20).map((row, i) => h('tr', { key: i },
        h('td', { style: { ...S.td, ...S.mono } }, row.title || row.sessionId),
        h('td', { style: S.td }, row.agentPreset ?? '—'),
        h('td', { style: S.td }, formatTokens(row.totalTokens)),
        h('td', { style: S.td }, row.cost === null ? '—' : row.cost.toFixed(4)),
        h('td', { style: { ...S.td, opacity: 0.7 } }, String(row.updatedAt ?? '').slice(0, 16).replace('T', ' '))))

      return h('div', { style: S.card },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, '按会话'),
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
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, 'token 计费'),
          h('div', { style: S.spacer }),
          Object.keys(RANGE_LABEL).map((key) =>
            h('button', { key, style: { ...S.button, opacity: range === key ? 1 : 0.55, borderColor: range === key ? 'rgba(31,111,92,0.7)' : undefined }, onClick: () => onRange(key) }, RANGE_LABEL[key])),
          h('button', { style: S.button, onClick: onRefresh }, '刷新'),
        ),

        h('div', { style: S.card },
          h('div', { style: S.row },
            h(Stat, { label: '总消耗', value: formatTokens(totals.totalTokens), hint: `${totals.messages ?? 0} 条模型回复` }),
            h(Stat, { label: '未命中输入', value: formatTokens(totals.inputTokens) }),
            h(Stat, { label: '命中缓存输入', value: formatTokens(totals.cacheReadTokens) }),
            h(Stat, { label: '输出', value: formatTokens(totals.outputTokens) }),
            h(Stat, { label: `预估费用（${data.currency ?? 'CNY'}）`, value: cost ? cost.amount.toFixed(4) : '—', hint: cost ? '按设置里的价目估算' : '未配置价目' }),
          ),
        ),

        h('div', { style: S.card },
          h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '计费口径'),
          h(Notice, null,
            h('div', null, billing.note ?? '计费数据来源于 New API 中转站。'),
            h('div', { style: { marginTop: 6, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
              configured && billing.consoleUrl
                ? h('a', { href: billing.consoleUrl, target: '_blank', rel: 'noreferrer', style: { color: '#3fa07f' } }, '打开 New API 账单页')
                : configured && billing.baseUrl
                  ? h('a', { href: billing.baseUrl, target: '_blank', rel: 'noreferrer', style: { color: '#3fa07f' } }, '打开 New API 中转站')
                  : h('span', { style: { ...S.chip('skip'), padding: '2px 8px' } }, `链接待填：${billing.linkPlaceholder ?? 'https://<中转站地址>'}`),
              h('span', { style: S.sub }, '在「设置 → 科研工作台」里填中转站地址与账单页，链接就会亮起来。'),
            ),
          ),
          (data.keys ?? []).length > 0
            ? keyTable(data.keys)
            : h('div', { style: { ...S.sub, marginTop: 8 } }, '没读到凭据来源：启动器用环境变量注入 key 时会显示在这里。'),
          h('div', { style: { ...S.sub, marginTop: 8 } }, '你的实际用量在这把 key 上扣费；本页的 token 是本机日志的同口径汇总，金额是按价目算的预估，账单以中转站为准。'),
        ),

        (data.byModel ?? []).length > 0
          ? modelTable(data.byModel)
          : h(Notice, null, data.source === 'unavailable' ? '这台机器的 Node 没有 zstd 解压能力，读不了会话日志。' : '这个区间还没有用量记录。'),

        (data.bySession ?? []).length > 0 ? sessionTable(data.bySession) : null,

        (data.warnings ?? []).length
          ? h('div', { style: { ...S.card, borderColor: 'rgba(190,70,60,0.4)' } },
              h('div', { style: { fontSize: 12.5, fontWeight: 600, marginBottom: 6 } }, '统计时跳过的部分'),
              h('ul', { style: { margin: '0 0 0 18px', fontSize: 12 } }, data.warnings.map((w, i) =>
                h('li', { key: i }, h('code', { style: S.mono }, w.file || '—'), ` ${w.reason}`))))
          : null,

        h('div', { style: { ...S.sub, marginTop: 8 } },
          `索引：${data.index?.files ?? 0} 份日志，本次解析 ${data.index?.parsed ?? 0}，复用 ${data.index?.reused ?? 0}；生成于 ${String(data.generatedAt ?? '').slice(11, 19)}。`),
      )
    }

    /* ── 接入 ───────────────────────────────────────────────────────────── */

    const WIRED_LABEL = { runtime: '已接入工具', declared: '已保存·工具侧尚未读取', none: '免凭据' }

    function sourceStatusCell(item) {
      const nodes = [
        h(Chip, { key: 'state', status: item.configured ? 'pass' : 'skip' }, item.configured ? '已配置' : '未配置'),
        h('div', { key: 'wired', style: { fontSize: 11, opacity: 0.6, marginTop: 4 } }, WIRED_LABEL[item.wired] ?? item.wired),
      ]
      if (item.from === 'env') nodes.push(h('div', { key: 'env', style: { fontSize: 11, opacity: 0.6 } }, '来自环境变量 ' + item.envName))
      return h('div', null, nodes)
    }

    function sourceInputCell(item, draft, setDraft) {
      if (!item.path) return h('span', { style: { opacity: 0.5 } }, '无需凭据')
      return h('input', {
        style: { ...S.input, minWidth: 150 },
        type: item.kind === 'email' ? 'email' : 'password',
        placeholder: item.kind === 'email' ? 'pi@lab.example' : '粘贴 key 后保存',
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
          ? '有凭据'
          : result.status === 'no-credential'
            ? '缺凭据'
            : '失败'
      return h(Chip, { status: good ? 'pass' : 'fail' }, text)
    }

    function sourceActionCell(item, onSave, onTest, result) {
      const nodes = []
      if (item.path) nodes.push(h('button', { key: 'save', style: S.button, onClick: () => onSave(item.id) }, '保存'))
      nodes.push(h('button', { key: 'test', style: S.button, onClick: () => onTest(item.id) }, '测试'))
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
        h('td', { style: S.td }, item.kind === 'none' ? '免填' : item.kind === 'email' ? '邮箱' : 'Key'),
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
          setSaved('已保存 ' + id + ' ' + new Date().toLocaleTimeString())
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
        h('th', { style: S.th }, '数据源'),
        h('th', { style: S.th }, '凭据'),
        h('th', { style: S.th }, '状态'),
        h('th', { style: S.th }, '当前值'),
        h('th', { style: S.th }, '填写'),
        h('th', { style: S.th }, '验证')))

      const rows = items.map((item) => sourceRow(item, draft, setDraft, save, test, result[item.id]))
      const configured = items.filter((item) => item.configured).length

      return h('div', null,
        h('div', { key: 'title', style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '科研 / 文献 / 检索 API'),
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

        const open = () => {
          requestPanel('billing')
          try {
            ctx.get?.('layout')?.selectPanel?.(PANEL_ID)
          } catch {
            /* 没有 layout 服务时只记待办页签 */
          }
        }

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
      const keyText = model?.keyPresent === true ? '已配置' : model?.keyPresent === false ? '未配置（设置 → 模型）' : '未读到'
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
        const openPanel = (tab) => {
          requestPanel(tab)
          try {
            ctx.get?.('layout')?.selectPanel?.(PANEL_ID)
          } catch {
            /* 没有布局服务时只记待办页签 */
          }
        }
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


    function Panel() {
      const [tab, setTab] = useState('workbench')
      const [projectId, setProjectId] = useState('')
      const [jump, setJump] = useState('')
      const projects = useApi('/projects')
      const first = projects.data?.items?.[0]?.id ?? ''
      const activeId = projectId || first
      const stages = useApi(activeId ? `/projects/${encodeURIComponent(activeId)}/stages` : null, [activeId])
      const next = useApi(activeId ? `/projects/${encodeURIComponent(activeId)}/next` : null, [activeId])
      const tools = useApi(tab === 'tools' ? '/tools' : null)
      const skills = useApi(tab === 'tools' ? '/skills' : null)
      const docs = useApi(tab === 'docs' ? '/docs' : null)
      const [range, setRange] = useState('today')
      const usage = useApi(tab === 'billing' ? `/usage?range=${range}` : null, [range])
      const sources = useApi(tab === 'sources' ? '/sources' : null)

      // 胶囊/引导点了「计费」「接入」时，主面板可能还没挂载：挂载后先把待办页签吃掉。
      useEffect(() => {
        const consume = (value) => {
          if (!value) return
          setTab(value)
          panelNav.pending = null
        }
        consume(panelNav.pending)
        return subscribePanel(consume)
      }, [])

      const tabs = [
        ['workbench', '工作台'],
        ['stages', '流程'],
        ['tools', '工具'],
        ['billing', '计费'],
        ['sources', '接入'],
        ['docs', '说明'],
      ]

      return h(
        'div',
        { style: S.panel },
        h('div', { style: S.header },
          h('div', { style: S.title }, 'DeepScient 科研工作台'),
          h('div', { style: S.sub }, activeId ? `课题 ${activeId}` : '未选课题'),
          h('div', { style: S.spacer }),
          h('div', { style: S.sub }, '数据来自本机研究库，阶段判定与助手说的是同一套门'),
        ),
        h('div', { style: S.tabs },
          tabs.map(([id, label]) => h('button', { key: id, style: S.tab(tab === id), onClick: () => setTab(id) }, label))),
        h('div', { style: S.body },
          tab === 'workbench' ? h(Workbench, { projects, projectId: activeId, onProject: setProjectId, stages, next, onJump: (id) => { setJump(id); setTab('stages') } }) : null,
          tab === 'stages' ? h(StageList, { stages, initial: jump }) : null,
          tab === 'tools' ? h(ToolList, { tools, skills }) : null,
          tab === 'billing' ? h(BillingPanel, { usage, range, onRange: setRange, onRefresh: usage.reload }) : null,
          tab === 'sources' ? h(SourcesPanel, { sources }) : null,
          tab === 'docs' ? h(Docs, { docs }) : null,
        ),
      )
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
                    h('th', { style: S.th }, 'provider'), h('th', { style: S.th }, '模型'),
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
                onClick: () => {
                  requestPanel('sources')
                  try { ctx.get?.('layout')?.selectPanel?.(PANEL_ID) } catch { /* 没有布局服务就只记待办 */ }
                },
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
            h('button', { style: S.button, onClick: save }, '保存'),
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

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      const SettingsSection = makeSettingsSection(ctx)
      const UsageDockPill = makeUsagePill(ctx)
      const Onboarding = makeOnboarding(ctx)

      ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.register({ name: 'sidebar.brand.mark', locale: NS }, BrandMark))

      ctx.slots.inject('sidebar.brand.name', () =>
        ctx.slots.register({ name: 'sidebar.brand.name', locale: NS }, BrandName))

      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, locale: NS, label: () => t('panel') }, PanelIcon))

      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, Panel))

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register({ name: 'settings.section', id: PANEL_ID, order: 40, locale: NS, label: () => t('settings') }, SettingsSection))

      // 底部：只报 token 消耗。出厂那颗（含缓存命中率）已被首屏样式摘掉，这里补一颗只讲 token 的。
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register({ name: 'conversation.composer.dock', id: 'deepscient-usage', order: 1, locale: NS }, UsageDockPill))

      // 首次打开的分步引导：只在 onboardingDone 不为 true 时渲染。
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'deepscient-onboarding', order: 900, locale: NS }, Onboarding))
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
