/**
 * 分析与作图工具（preset 平面）。
 *
 *   science_stats   跑一个检验：假设检查 + 统计量 + 效应量 + CI + 备选方案
 *   science_figure  按期刊毫米尺寸出图：PDF/SVG/PNG，并自检字号/分辨率/宽度
 *
 * 这一层的立场：只给 p 值的分析算半成品；假设不满足却没提的分析算错。
 * 所以两个工具的返回里，assumptions 与 checks 都是一等字段，不是附注。
 */
import { resolveDshToolsPackage } from './tools.js'
import * as lab from './science/lab/index.js'
import { runStats, renderResultMarkdown, listTestIds, getTest, readProjectCsv } from './science/lab/stats.js'
import { runFigure, listPresets } from './science/lab/figures.js'

const dshTools = resolveDshToolsPackage()
const defineTool = dshTools.defineTool || dshTools.default?.defineTool
if (typeof defineTool !== 'function') throw new Error('dsh-science/analysis-tools: defineTool 不可用')

export const name = 'dsh-science-analysis'
export const inject = ['tools']

function storeOf(ctx) {
  const rt = ctx.get('scienceRuntime')
  if (!rt || !rt.store) throw new Error('科研运行时未就绪：SQLite 初始化失败，先跑 science_preflight 看错误')
  return rt.store
}

const rethrow = (error) => {
  const message = error && error.message ? error.message : String(error)
  throw new Error(`分析工具失败：${message}`)
}

export function apply(ctx) {
  /* ── science_stats ───────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_stats',
    description:
      'Run one statistical test on project data and get back the statistic, degrees of freedom, p, the effect size '
      + 'WITH its confidence interval, and a per-item assumption check. When an assumption fails you get the concrete '
      + 'fallback test id instead of a silent number. Pass either inline arrays or a CSV path inside the project. '
      + 'Use science_discipline_profile or the decision tree to pick testId first; this tool computes, it does not choose.',
    parameters: {
      projectId: { type: 'string', description: 'Project id.' },
      testId: { type: 'string', description: 'Test id from statistics.json, e.g. ttest-welch, anova-oneway, kruskal, mixedlm, ols-robust, logit, chi2, kaplan-meier, logrank, permutation, bootstrap-median, tost, pca.' },
      csvPath: { type: 'string', description: 'CSV inside the project, e.g. "data/exp1.csv". Header row required.' },
      columns: { description: 'Map from the column names the test expects to the real CSV columns. Value is a column name, or {column, where} to slice a long-format table.', type: 'object', additionalProperties: true },
      data: { description: 'Inline data instead of a CSV: {a:[...],b:[...]} or {g1:[...],g2:[...]} or {table:[[..],[..]]}.', type: 'object', additionalProperties: true },
      alpha: { type: 'number', description: 'Alpha for reporting. Defaults to the field default.' },
      tails: { type: 'integer', description: '1 or 2. Defaults to 2.' },
      predictors: { type: 'array', items: { type: 'string' }, description: 'Regression: which columns are predictors. Defaults to every column except y.' },
      bound: { type: 'number', description: 'Equivalence bound for tost. Must be set ex ante.' },
      resamples: { type: 'integer', description: 'Resampling count for permutation / bootstrap. Defaults to 10000 / 5000.' },
      seed: { type: 'integer', description: 'Seed for resampling tests. Recorded with the result.' },
      runId: { type: 'string', description: 'Attach the result to a run from science_exp_run.' },
      listTests: { type: 'boolean', description: 'Set true to list every supported test id and stop.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          id: { type: 'string' },
          testId: { type: 'string' },
          label: { type: 'string' },
          statistic: { type: 'number' },
          df: { type: 'number' },
          p: { type: 'number' },
          effectSize: {
            type: 'object', additionalProperties: false,
            properties: {
              kind: { type: 'string' }, value: { type: 'number' },
              ci: { type: 'array', items: { type: 'number' } },
            },
          },
          n: { type: 'object', additionalProperties: true, description: 'Sample sizes per group or column.' },
          assumptions: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                label: { type: 'string', required: true },
                ok: { type: 'boolean' },
                detail: { type: 'string' },
              },
            },
          },
          warnings: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string' }, message: { type: 'string' },
                fallback: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          coefficients: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string' }, estimate: { type: 'number' }, se: { type: 'number' },
                p: { type: 'number' }, oddsRatio: { type: 'number' }, rateRatio: { type: 'number' },
                ci: { type: 'array', items: { type: 'number' } },
              },
            },
          },
          reportAs: { type: 'string' },
          correction: { type: 'string' },
          uncorrected: {
            type: 'object', additionalProperties: false,
            properties: { statistic: { type: 'number' }, p: { type: 'number' } },
          },
          markdown: { type: 'string' },
          method: { type: 'string' },
          seed: { type: 'integer' },
          error: { type: 'string' },
          hint: { type: 'string' },
          supported: { type: 'array', items: { type: 'string' } },
          tests: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true }, label: { type: 'string' },
                family: { type: 'string' }, outcome: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, v) => {
        if (v.tests) {
          return [{ type: 'text', text: [`可直接执行 ${v.tests.length} 个检验：`, ...v.tests.map((t) => `- ${t.id} · ${t.label}（${t.family}）`)].join('\n') }]
        }
        if (!v.ok) {
          const lines = [`未算出结果：${v.error}`]
          if (v.hint) lines.push(`提示：${v.hint}`)
          if (v.supported?.length) lines.push(`本执行器支持：${v.supported.join(', ')}`)
          return [{ type: 'text', text: lines.join('\n') }]
        }
        return [{ type: 'text', text: v.markdown || v.reportAs || `${v.label}: p = ${v.p}` }]
      },
    },
    async execute(args) {
      try {
        if (args.listTests) {
          const all = listTestIds().map((id) => {
            const t = getTest(id)
            return { id, label: t?.label ?? '', family: t?.family ?? '', outcome: t?.outcome ?? '' }
          })
          return { ok: true, tests: all }
        }
        const store = storeOf(ctx)
        const projectId = String(args.projectId ?? '').trim()
        if (!projectId) throw new Error('必须给 projectId')

        const result = runStats(store, {
          projectId,
          testId: args.testId,
          csvPath: args.csvPath,
          columns: args.columns,
          data: args.data,
          options: {
            predictors: args.predictors,
            bound: args.bound,
            resamples: args.resamples,
            alpha: args.alpha,
            tails: args.tails,
          },
          alpha: args.alpha,
          tails: args.tails,
          seed: args.seed,
          runId: args.runId,
        })

        if (!result.ok) {
          return {
            ok: false,
            testId: result.testId,
            label: result.label,
            error: result.error,
            hint: result.hint,
            supported: result.supported,
            method: result.method,
          }
        }

        return {
          ok: true,
          id: result.id,
          testId: result.testId,
          label: result.label,
          statistic: result.statistic ?? undefined,
          df: typeof result.df === 'number' ? result.df : undefined,
          p: result.p ?? undefined,
          effectSize: result.effectSize ? {
            kind: result.effectSize.kind,
            value: typeof result.effectSize.value === 'number' ? result.effectSize.value : undefined,
            ci: Array.isArray(result.effectSize.ci) && result.effectSize.ci.every((x) => typeof x === 'number') ? result.effectSize.ci : undefined,
          } : undefined,
          n: result.n,
          assumptions: result.assumptions.map((a) => ({ id: a.id, label: a.label, ok: a.ok, detail: a.detail })),
          warnings: result.warnings,
          coefficients: result.coefficients ?? undefined,
          reportAs: result.reportAs,
          correction: result.correction ?? undefined,
          uncorrected: result.uncorrected ?? undefined,
          markdown: renderResultMarkdown(result),
          method: result.method,
          seed: result.seed,
        }
      } catch (error) {
        rethrow(error)
      }
    },
  }))

  /* ── science_figure ──────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_figure',
    description:
      'Draw a journal-ready figure at a physical page size in millimetres and write PDF + SVG + PNG into figures/. '
      + 'Sizing is physical on purpose: 85 mm for a single column and 180 mm for a double column, so the type size survives '
      + 'layout instead of being rescaled. Returns self-checks for font size, resolution and vector output. '
      + 'Error bars require an explicit errorType (sd, sem or ci95) — none is guessed.',
    parameters: {
      projectId: { type: 'string', description: 'Project id.' },
      kind: { type: 'string', description: 'bar | line | scatter | box | violin | hist | heatmap | paired | curve' },
      csvPath: { type: 'string', description: 'CSV inside the project.' },
      columns: { description: 'Map the columns the figure needs to real CSV columns.', type: 'object', additionalProperties: true },
      data: { description: 'Inline data: {y:[...]} or {g1:[...],g2:[...]}.', type: 'object', additionalProperties: true },
      preset: { type: 'string', description: 'single-column (85×60) | double-column (180×120) | square (90×90) | wide-short (180×75) | slide (160×90)' },
      widthMm: { type: 'number', description: 'Override width in millimetres.' },
      heightMm: { type: 'number', description: 'Override height in millimetres.' },
      dpi: { type: 'integer', description: 'Raster resolution. Defaults to 600.' },
      fontSize: { type: 'number', description: 'Base font size in points. Defaults to 7; below 6 is refused.' },
      palette: { type: 'string', description: 'okabe-ito (colour-blind safe, default) | nature | grayscale' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Category tick labels.' },
      xlabel: { type: 'string' }, ylabel: { type: 'string' }, title: { type: 'string' },
      errorType: { type: 'string', description: 'sd | sem | ci95. Required for any error bar; no default.' },
      fitLine: { type: 'boolean', description: 'scatter: add a least-squares line.' },
      boxed: { type: 'boolean', description: 'Keep the top/right spines.' },
      formats: { type: 'array', items: { type: 'string' }, description: 'Defaults to ["pdf","png"].' },
      name: { type: 'string', description: 'Output file stem.' },
      analysisId: { type: 'string', description: 'Link this figure to an analysis result.' },
      listPresets: { type: 'boolean', description: 'Set true to list the size presets and stop.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          id: { type: 'string' },
          kind: { type: 'string' },
          files: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                path: { type: 'string', required: true }, format: { type: 'string' }, bytes: { type: 'integer' },
              },
            },
          },
          skipped: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: { format: { type: 'string' }, reason: { type: 'string' } },
            },
          },
          widthMm: { type: 'number' }, heightMm: { type: 'number' }, dpi: { type: 'integer' },
          fontSize: { type: 'number' }, palette: { type: 'string' }, aspect: { type: 'number' },
          checks: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true }, ok: { type: 'boolean', required: true }, detail: { type: 'string' },
              },
            },
          },
          ready: { type: 'boolean' },
          warning: { type: 'string' },
          note: { type: 'string' },
          error: { type: 'string' },
          supported: { type: 'array', items: { type: 'string' } },
          presets: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                widthMm: { type: 'number' }, heightMm: { type: 'number' }, dpi: { type: 'integer' },
              },
            },
          },
        },
      },
      render: (_args, v) => {
        if (v.presets) {
          return [{ type: 'text', text: ['幅面预设：', ...v.presets.map((p) => `- ${p.id}：${p.widthMm}×${p.heightMm} mm，${p.dpi} dpi`)].join('\n') }]
        }
        if (!v.ok) {
          const lines = [`作图未完成：${v.error}`]
          if (v.supported?.length) lines.push(`支持的类型：${v.supported.join(', ')}`)
          return [{ type: 'text', text: lines.join('\n') }]
        }
        const lines = [`已出图（${v.kind}）：${v.widthMm}×${v.heightMm} mm，${v.dpi} dpi，字号 ${v.fontSize} pt`]
        for (const f of v.files) lines.push(`- ${f.path}（${f.format}，${f.bytes} B）`)
        if (v.skipped?.length) {
          lines.push('', '未生成的格式：')
          for (const s of v.skipped) lines.push(`- ${s.format}：${s.reason}`)
        }
        if (v.checks?.length) {
          lines.push('', `期刊要求自检：${v.ready ? '全部通过' : '有未通过项'}`)
          for (const c of v.checks) lines.push(`- ${c.ok ? '✓' : '✗'} ${c.id}：${c.detail}`)
        }
        if (v.warning) lines.push('', `注意：${v.warning}`)
        if (v.note) lines.push('', v.note)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      try {
        if (args.listPresets) return { ok: true, presets: listPresets() }
        const store = storeOf(ctx)
        const projectId = String(args.projectId ?? '').trim()
        if (!projectId) throw new Error('必须给 projectId')

        const result = runFigure(store, {
          projectId,
          kind: args.kind,
          csvPath: args.csvPath,
          columns: args.columns,
          data: args.data,
          preset: args.preset,
          widthMm: args.widthMm,
          heightMm: args.heightMm,
          dpi: args.dpi,
          fontSize: args.fontSize,
          palette: args.palette,
          labels: args.labels,
          xlabel: args.xlabel,
          ylabel: args.ylabel,
          title: args.title,
          errorType: args.errorType,
          fitLine: args.fitLine,
          boxed: args.boxed,
          formats: args.formats,
          name: args.name,
          analysisId: args.analysisId,
        })

        if (!result.ok) {
          return { ok: false, kind: result.kind, error: result.error, supported: result.supported }
        }
        return {
          ok: true,
          id: result.id,
          kind: result.kind,
          files: result.files,
          skipped: result.skipped,
          widthMm: result.widthMm,
          heightMm: result.heightMm,
          dpi: result.dpi,
          fontSize: result.fontSize,
          palette: result.palette,
          aspect: result.aspect,
          checks: result.checks,
          ready: result.ready,
          warning: result.warning,
          note: result.note,
        }
      } catch (error) {
        rethrow(error)
      }
    },
  }))

  // 让 lab.readProjectCsv 这类辅助函数在别处也能拿到（避免再有重复实现）
  void lab
  void readProjectCsv
}
