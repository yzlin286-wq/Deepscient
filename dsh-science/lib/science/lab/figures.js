/**
 * 作图：把 spec 变成期刊尺寸的图，并把 spec 与产物都记下来。
 *
 * spec 与产物分开存是刻意的——图会重画（换调色板、换尺寸、审稿人要求改字号），
 * 但「当时用哪份数据、哪个参数画的」必须能复原。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { runPy, resolvePython } from './power.js'
import { projectDir } from './project.js'
import { append } from './provenance.js'
import { parseCsv, pickSeries } from './stats.js'

const FIGURE_SCRIPT = fileURLToPath(new URL('../../../scripts/py/figure_run.py', import.meta.url))

/** 常见期刊幅面：直接给名字，省得每次算毫米。 */
export const PRESETS = {
  'single-column': { widthMm: 85, heightMm: 60, dpi: 600 },
  'double-column': { widthMm: 180, heightMm: 120, dpi: 600 },
  'square': { widthMm: 90, heightMm: 90, dpi: 600 },
  'wide-short': { widthMm: 180, heightMm: 75, dpi: 600 },
  'slide': { widthMm: 160, heightMm: 90, dpi: 300 },
}

export function listPresets() {
  return Object.entries(PRESETS).map(([id, v]) => ({ id, ...v }))
}

/**
 * 画一张图。
 *
 * @param {object} store
 * @param {object} input
 *   projectId  必填
 *   kind       bar | line | scatter | box | violin | hist | heatmap | paired | curve
 *   data       {列名: [值...]}
 *   csvPath    项目内 CSV；与 data 二选一
 *   columns    从 CSV 挑列并重命名
 *   preset     single-column | double-column | square | wide-short | slide
 *   widthMm/heightMm/dpi/fontSize/palette 覆盖 preset
 *   label/xlabel/ylabel/title/errorType/fitLine/boxed
 *   formats    默认 ['pdf','png']
 *   name       输出文件名（不含扩展名）
 *   analysisId 关联到某条统计结果
 *   save       默认 true
 */
export function runFigure(store, input = {}) {
  const projectId = String(input.projectId ?? '').trim()
  if (!projectId) throw new Error('必须给 projectId')
  const dir = projectDir(projectId)
  if (!dir) throw new Error(`课题不存在：${projectId}`)

  const kind = String(input.kind ?? '').trim()
  if (!kind) throw new Error('必须给 kind（bar / line / scatter / box / violin / hist / heatmap / paired / curve）')

  let data = input.data ?? null
  let source = 'inline'
  if (!data) {
    if (!input.csvPath) throw new Error('必须给 data 或 csvPath')
    const full = resolve(dir, input.csvPath)
    if (!full.startsWith(resolve(dir))) throw new Error(`路径越界：${input.csvPath}`)
    if (!existsSync(full)) throw new Error(`文件不存在：${input.csvPath}`)
    const parsed = parseCsv(readFileSync(full, 'utf8'))
    data = input.columns ? remap(parsed.columns, input.columns) : parsed.columns
    source = input.csvPath
  } else if (input.columns) {
    data = remap(data, input.columns)
  }

  const preset = PRESETS[input.preset ?? 'single-column'] ?? PRESETS['single-column']
  const style = {
    widthMm: input.widthMm ?? preset.widthMm,
    heightMm: input.heightMm ?? preset.heightMm,
    dpi: input.dpi ?? preset.dpi,
    fontSize: input.fontSize ?? 7,
    palette: input.palette ?? 'okabe-ito',
    labels: input.labels,
    xlabel: input.xlabel,
    ylabel: input.ylabel,
    title: input.title,
    errorType: input.errorType,
    fitLine: input.fitLine,
    boxed: input.boxed,
  }

  const name = String(input.name ?? `${kind}-${randomUUID().slice(0, 6)}`)
  const outDir = join(dir, 'figures')
  const request = {
    kind,
    data,
    style,
    out: { name, formats: input.formats ?? ['pdf', 'png'], dir: outDir },
  }

  const raw = runPy(FIGURE_SCRIPT, request)
  if (!raw || raw.ok !== true) {
    return {
      ok: false,
      kind,
      error: raw?.error ?? '作图执行器没有返回结果',
      supported: raw?.supported,
      style,
    }
  }

  // 记录相对路径，避免把本机绝对路径写进论文仓库
  const files = raw.files.map((f) => ({
    ...f,
    path: f.path.replace(`${dir}\\`, '').replace(`${dir}/`, '').replace(/\\/g, '/'),
    abs: f.path,
  }))

  const id = `fig_${randomUUID().slice(0, 8)}`
  const primary = files[0]
  const now = Date.now()

  if (input.save !== false) {
    store.db.prepare(`
      INSERT INTO figure_spec(id, project_id, analysis_id, kind, spec_json, path, width_mm, height_mm, dpi, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, projectId, input.analysisId ?? null, kind,
      JSON.stringify({ source, style, formats: request.out.formats }),
      primary ? primary.path : null,
      style.widthMm, style.heightMm, style.dpi, now,
    )
    append(store, {
      projectId,
      subject: 'figure',
      subjectId: id,
      action: 'figure',
      detail: { kind, files: files.map((f) => f.path), dpi: style.dpi },
    })
  }

  return {
    ok: true,
    id,
    kind,
    files: files.map((f) => ({ path: f.path, format: f.format, bytes: f.bytes })),
    skipped: raw.skipped ?? [],
    widthMm: raw.widthMm,
    heightMm: raw.heightMm,
    dpi: raw.dpi,
    fontSize: raw.fontSize,
    palette: raw.palette,
    aspect: raw.aspect,
    checks: raw.checks ?? [],
    ready: raw.ready === true,
    warning: raw.warning,
    note: raw.note,
  }
}

function remap(columns, map) {
  const out = {}
  for (const [alias, spec] of Object.entries(map)) {
    out[alias] = pickSeries(columns, spec)
  }
  return out
}

export { resolvePython, basename }
