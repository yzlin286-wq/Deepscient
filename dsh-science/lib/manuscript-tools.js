/**
 * M5 排版导出层工具（preset 平面）。
 *
 * 这四个工具是「一篇稿子从零到能投」的机械流程，刻意不碰论证判断：
 *   science_manuscript_new    建稿：写入带 YAML 头的 paper.md 骨架 + references.yml
 *   science_manuscript_lint   查要件：字数/图表/引文/结构/交叉引用对着目标期刊量一遍
 *   science_manuscript_build  出件：PDF / DOCX / JATS / HTML 一次全出
 *   science_format_check      查环境：TeX 引擎、宏包类、python-docx、期刊族一览
 *
 * 与 M2 的 science_paper_audit 分工：那套查「论证站不站得住」，这套查「投稿要件齐不齐」。
 * 稿件以文件形式存在 $DSH_HOME/science/manuscripts/<id>/，不进数据库——文本资产用文件管，
 * 版本交给 git，比塞进 SQLite 更像研究者的习惯。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { resolveDshToolsPackage } from './tools.js'
import {
  loadSource,
  scaffoldSource,
  parseSource,
  resolveFormat,
  lintManuscript,
  buildManuscript,
  checkToolchain,
  listFamilies,
  SOURCE_FILE,
  REFERENCES_FILE,
} from './science/format/index.js'

const dshTools = resolveDshToolsPackage()
const defineTool = dshTools.defineTool || dshTools.default?.defineTool
if (typeof defineTool !== 'function') throw new Error('dsh-science/manuscript-tools: defineTool 不可用')

export const name = 'dsh-science-manuscript'
export const inject = ['tools']

const MANUSCRIPT_ROOT = () => {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'science', 'manuscripts')
}

/** 传 id → 走 manuscripts 根；传绝对/相对路径 → 直接用。 */
function resolveDir(input) {
  const raw = String(input ?? '').trim()
  if (raw === '') throw new Error('必须给 id 或 dir')
  if (isAbsolute(raw) || raw.includes('/') || raw.includes('\\')) return resolve(raw)
  return join(MANUSCRIPT_ROOT(), raw)
}

const rethrow = (error) => {
  const message = error && error.message ? error.message : String(error)
  throw new Error(`排版工具失败：${message}`)
}

function listManuscriptDirs() {
  const root = MANUSCRIPT_ROOT()
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(root, entry.name)
      const source = join(dir, SOURCE_FILE)
      return {
        id: entry.name,
        dir,
        hasSource: existsSync(source),
        mtime: existsSync(source) ? statSync(source).mtimeMs : null,
      }
    })
    .sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
}

function findingSchema() {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      code: { type: 'string', required: true },
      severity: { type: 'string', required: true },
      message: { type: 'string', required: true },
      detail: { type: 'string' },
    },
  }
}

function artifactSchema() {
  return {
    type: 'object', additionalProperties: false,
    properties: {
      kind: { type: 'string', required: true },
      path: { type: 'string' },
      bytes: { type: 'integer' },
      hint: { type: 'string' },
      engine: { type: 'string' },
    },
  }
}

const SEVERITY_ICON = { block: '✗', warn: '!', info: '·', pass: '✓' }

export function apply(ctx) {
  const logger = ctx.get('logger') || console

  /* ── 1. 建稿 ─────────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_manuscript_new',
    description:
      'Create a manuscript workspace: paper.md with YAML front matter (title, journal, authors, keywords, abstract), '
      + 'references.yml, figures/ and build/. The scaffold is a real journal-formatted skeleton, not lorem ipsum: sections are '
      + 'already named per the target journal family, and every placeholder is marked TODO so lint can find it later. '
      + 'After creating, edit paper.md and run science_manuscript_build to get PDF/DOCX/JATS/HTML.',
    parameters: {
      id: { type: 'string', description: 'Manuscript id; becomes the folder name under $DSH_HOME/science/manuscripts.' },
      title: { type: 'string', description: 'Working title. Defaults to a TODO placeholder the lint step will flag.' },
      journal: { type: 'string', description: 'Target journal id from journals.json, e.g. "nature", "plos-one". Drives LaTeX class, DOCX layout and citation style.' },
      publisher: { type: 'string', description: 'Use a publisher family instead of a specific journal, e.g. "Elsevier", "IEEE", "Springer".' },
      design: { type: 'string', description: 'Study design, e.g. "theory", "benchmark", "empirical-law". Chooses the section skeleton.' },
      keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords, 3-8 recommended.' },
      authorName: { type: 'string', description: 'First author name. Add more by editing paper.md.' },
      abstract: { type: 'string', description: 'Abstract text. Omit to get a structured TODO abstract.' },
      projectId: {
        type: 'string',
        description: 'Bind this manuscript to a lab project (from science_project_open). Records an index row in the manuscript table '
          + 'and a provenance entry so the S9 gate and the audit trail can see it. The text itself still lives as files.',
      },
      overwrite: { type: 'boolean', description: 'Replace an existing paper.md. Defaults to false and refuses instead of silently destroying work.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          dir: { type: 'string', required: true },
          sourcePath: { type: 'string', required: true },
          referencesPath: { type: 'string', required: true },
          journalId: { type: 'string' },
          familyId: { type: 'string', required: true },
          latexClass: { type: 'string', required: true },
          citationStyle: { type: 'string', required: true },
          sections: { type: 'array', items: { type: 'string' } },
          words: { type: 'integer' },
          todoCount: { type: 'integer' },
          note: { type: 'string' },
          projectId: { type: 'string' },
          linked: { type: 'boolean' },
          linkNote: { type: 'string' },
        },
      },
      render: (_args, v) => [{
        type: 'text',
        text: [
          `已建稿：${v.id}`,
          `目录：${v.dir}`,
          `目标刊：${v.journalId || '（未指定，走通用族）'} → 族 ${v.familyId} · LaTeX \\documentclass{${v.latexClass}} · 引文 ${v.citationStyle}`,
          `结构：${v.sections.join(' / ')}`,
          `字数：约 ${v.words} 词（骨架里的 TODO 占位）`,
          v.todoCount > 0 ? `还有 ${v.todoCount} 处 TODO 待填——填完跑 science_manuscript_lint 会逐条指出来。` : '',
          v.projectId ? (v.linked ? `已挂到课题 ${v.projectId}，S9 的门看得到这篇。` : `课题 ${v.projectId} 未挂上：${v.linkNote || '原因未知'}`) : '',
          '',
          `下一步：编辑 ${v.sourcePath}`,
          `然后：science_manuscript_build { id: "${v.id}", targets: ["all"] }`,
          v.note || '',
        ].filter(Boolean).join('\n'),
      }],
    },
    async execute(args) {
      const id = String(args.id || '').trim()
      if (!id) throw new Error('必须给 id')
      const dir = resolveDir(id)
      mkdirSync(dir, { recursive: true })
      mkdirSync(join(dir, 'figures'), { recursive: true })
      mkdirSync(join(dir, 'build'), { recursive: true })

      const sourcePath = join(dir, SOURCE_FILE)
      if (existsSync(sourcePath) && !args.overwrite) {
        throw new Error(`${sourcePath} 已存在。改 overwrite=true 才会覆盖（会丢现有内容）`)
      }

      const format = resolveFormat({ journal: args.journal || null, publisher: args.publisher || null })
      const scaffold = scaffoldSource({
        title: args.title || 'TODO: 标题（≤ 20 词，说清楚结论而不是"关于 X 的研究"）',
        journal: args.journal || null,
        band: null,
        design: args.design || 'benchmark',
        keywords: Array.isArray(args.keywords) && args.keywords.length > 0 ? args.keywords : ['TODO-keyword'],
        authors: args.authorName
          ? [{ name: args.authorName, affiliation: 1, corresponding: true }]
          : [{ name: 'TODO 作者', affiliation: 1, corresponding: true }],
        abstract: args.abstract || '',
      })

      const banner = [
        `<!-- 目标刊：${format.journal?.name || format.familyId} · LaTeX \\documentclass{${format.latex.class}} · 引文 ${format.citation} -->`,
        `<!-- 参考文献写在 ${REFERENCES_FILE}，正文用 [@key] 或 @key 引用 -->`,
        '<!-- TODO: 标题写结论而不是话题，≤ 20 词 -->',
        '<!-- TODO: 摘要按 背景 → 缺口 → 做法 → 结果(带数字) → 意义 五句写，150–250 词 -->',
        '<!-- TODO: 作者与单位填全；通讯作者保留 corresponding: true 并填 email -->',
        `<!-- TODO: 在 ${REFERENCES_FILE} 补参考文献，正文用 [@key] 引用；没被引用的条目会在检查里报出来 -->`,
        '<!-- TODO: 图放 figures/，用 ![图注](figures/x.png){#fig:name} 插入，正文写 \\ref{fig:name} 引用 -->',
        '',
        '',
      ].join('\n')
      const source = scaffold.replace(/^---\n[\s\S]*?\n---\n\n/, (match) => match + banner)
      writeFileSync(sourcePath, source, 'utf8')

      const referencesPath = join(dir, REFERENCES_FILE)
      if (!existsSync(referencesPath)) {
        writeFileSync(referencesPath, renderReferenceStub(), 'utf8')
      }

      const doc = parseSource(readFileSync(sourcePath, 'utf8'), { baseDir: dir })
      const todoCount = (readFileSync(sourcePath, 'utf8').match(/TODO/g) || []).length

      logger.info?.(`manuscript ${id} created at ${dir}`)

      /* 挂到课题：稿件正文继续用文件管，但库里记一条索引行。
         没有这一行，S9 的门（"稿子已建"）永远判 skip，教练就会一直把人扣在写作前一步；
         反过来，索引行只记 id / 题目 / 目标刊 / 字数，不复制正文，避免两处真相。 */
      let linked = false
      let linkNote = ''
      const projectId = String(args.projectId || '').trim()
      if (projectId) {
        try {
          const rt = ctx.get('scienceRuntime')
          if (!rt || !rt.store) {
            linkNote = '科研运行时未就绪（SQLite 不可用）'
          } else {
            const now = Date.now()
            const title = String(args.title || '').trim() || null
            rt.store.db.prepare(
              `INSERT INTO manuscript(id, project_id, title, abstract, keywords_json, target_journal, design, status, version, words, figures, refs, created_at, updated_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, title=COALESCE(excluded.title, manuscript.title),
                 target_journal=COALESCE(excluded.target_journal, manuscript.target_journal),
                 words=excluded.words, updated_at=excluded.updated_at`,
            ).run(
              id, projectId, title, String(args.abstract || '') || null,
              JSON.stringify(Array.isArray(args.keywords) ? args.keywords : []),
              format.journalId || null, String(args.design || '') || null, 'draft', 1,
              0, 0, 0, now, now,
            )
            const { append } = await import('./science/lab/provenance.js')
            append(rt.store, {
              projectId,
              subject: 'manuscript',
              subjectId: id,
              action: 'create',
              detail: { journal: format.journalId || null, family: format.familyId, dir },
            })
            /* 课题还没定目标刊时，用第一个建稿的目标刊补上——
               顺序上这是必然发生的：很多人是先建稿再想刊，或者建稿时就选定了。 */
            if (format.journalId) {
              rt.store.db.prepare('UPDATE project SET target_journal = ?, updated_at = ? WHERE id = ? AND (target_journal IS NULL OR target_journal = ?)')
                .run(format.journalId, now, projectId, '')
            }
            linked = true
          }
        } catch (error) {
          linkNote = error?.message ? String(error.message) : String(error)
          logger.warn?.(`manuscript ${id} 未能挂到课题 ${projectId}：${linkNote}`)
        }
      }

      return {
        id,
        dir,
        sourcePath,
        referencesPath,
        journalId: format.journalId,
        familyId: format.familyId,
        latexClass: format.latex.class,
        citationStyle: format.citation,
        sections: doc.headings.map((heading) => `${'#'.repeat(heading.level)} ${heading.text}`),
        words: doc.blocks.reduce((sum, block) => sum + (block.type === 'para' ? 12 : 0), 0),
        todoCount,
        note: format.warning || '',
        projectId: projectId || undefined,
        linked: projectId ? linked : undefined,
        linkNote: linkNote || undefined,
      }
    },
  }))

  /* ── 2. 要件检查 ─────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_manuscript_lint',
    description:
      'Check a manuscript against its target journal\'s hard requirements: word count, figure/reference caps, abstract length, '
      + 'citation integrity (undefined keys, uncited references), cross-reference targets, missing sections, keywords, '
      + 'corresponding author. Every finding is code + severity, so you can fix them one by one. '
      + 'This is the submission checklist, not a quality review — use science_paper_audit for whether the argument holds.',
    parameters: {
      id: { type: 'string', description: 'Manuscript id under $DSH_HOME/science/manuscripts.' },
      dir: { type: 'string', description: 'Explicit manuscript directory; overrides id.' },
      journal: { type: 'string', description: 'Override the journal recorded in the front matter.' },
      severity: { type: 'string', description: 'Only return findings at or above this level: block, warn, info. Defaults to info (everything).' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          blocking: { type: 'integer', required: true },
          warning: { type: 'integer', required: true },
          info: { type: 'integer', required: true },
          pass: { type: 'integer', required: true },
          dir: { type: 'string', required: true },
          journalId: { type: 'string' },
          familyId: { type: 'string', required: true },
          citationStyle: { type: 'string', required: true },
          metrics: {
            type: 'object', additionalProperties: false,
            properties: {
              words: { type: 'integer' }, abstractWords: { type: 'integer' },
              figures: { type: 'integer' }, tables: { type: 'integer' },
              equations: { type: 'integer' }, references: { type: 'integer' },
              keywords: { type: 'integer' }, titleWords: { type: 'integer' },
              titleChars: { type: 'integer' },
              wordsLimit: { type: 'integer' }, figuresLimit: { type: 'integer' }, refsLimit: { type: 'integer' },
            },
          },
          findings: { type: 'array', required: true, items: findingSchema() },
        },
      },
      render: (_args, v) => {
        const order = { block: 0, warn: 1, info: 2, pass: 3 }
        const sorted = [...v.findings].sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9))
        const m = v.metrics || {}
        const lines = [
          `${v.ok ? '✓' : '✗'} 要件检查 ${v.dir}`,
          `目标：${v.journalId || '未指定'} → 族 ${v.familyId} · 引文 ${v.citationStyle}`,
          `正文 ${m.words ?? '?'} 词${m.wordsLimit ? ` / 上限 ${m.wordsLimit}` : ''} · 摘要 ${m.abstractWords ?? '?'} 词 · 图 ${m.figures ?? 0}${m.figuresLimit ? `/${m.figuresLimit}` : ''} · 表 ${m.tables ?? 0} · 公式 ${m.equations ?? 0} · 文献 ${m.references ?? 0}${m.refsLimit ? `/${m.refsLimit}` : ''} · 关键词 ${m.keywords ?? 0}`,
          `结果：${v.blocking} 阻断 · ${v.warning} 警告 · ${v.info} 提示 · ${v.pass} 通过`,
          '',
        ]
        for (const item of sorted) {
          lines.push(`${SEVERITY_ICON[item.severity] || '·'} [${item.severity}] ${item.message}`)
          if (item.detail) lines.push(`    → ${item.detail}`)
        }
        if (v.findings.length === 0) lines.push('（没有发现问题）')
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      try {
        const dir = resolveDir(args.dir || args.id)
        const loaded = loadSource(dir)
        const format = resolveFormat({
          journal: args.journal || loaded.doc.meta.journal || null,
        })
        const lint = lintManuscript(loaded.doc, format, { baseDir: dir })

        /* 把这次 lint 的结论落一份 lint.json 到稿件目录。
           理由：S9 的门（"稿件 lint 无 block 级问题"）必须能对着真实状态判，
           而工具之间不共享内存。文件是唯一在两次会话之间还活着的地方。 */
        try {
          writeFileSync(join(dir, 'lint.json'), `${JSON.stringify({
            id: String(args.id || ''),
            at: Date.now(),
            ok: lint.ok,
            blocking: lint.blocking,
            warning: lint.warning,
            info: lint.info,
            pass: lint.pass,
            familyId: format.familyId,
            journalId: format.journalId ?? null,
            codes: [...new Set(lint.findings.filter((f) => f.severity === 'block').map((f) => f.code))],
          }, null, 2)}\n`, 'utf8')
        } catch (error) {
          logger.warn?.(`lint.json 未写出：${error.message}`)
        }

        const ranks = { block: 0, warn: 1, info: 2, pass: 3 }
        const floor = ranks[args.severity] ?? 2
        const findings = lint.findings.filter((item) => (ranks[item.severity] ?? 9) <= floor)

        return {
          ok: lint.ok,
          blocking: lint.blocking,
          warning: lint.warning,
          info: lint.info,
          pass: lint.pass,
          dir,
          journalId: format.journalId,
          familyId: format.familyId,
          citationStyle: format.citation,
          metrics: {
            ...lint.metrics,
            wordsLimit: format.limits?.words ?? null,
            figuresLimit: format.limits?.figures ?? null,
            refsLimit: format.limits?.refs ?? null,
            limits: undefined,
            journalKnown: undefined,
          },
          findings,
        }
      } catch (error) {
        rethrow(error)
      }
    },
  }))

  /* ── 3. 出件 ─────────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_manuscript_build',
    description:
      'Build a manuscript into submission artifacts from one source file. Targets: pdf (xelatex, retries on missing packages and '
      + 'falls back to the article class), docx (python-docx with the journal page size, margins, font, line spacing, continuous '
      + 'line numbers and three-rule tables), jats (NISO JATS XML for submission systems), html (self-contained preview styled to '
      + 'the journal layout). Change only the journal in the front matter to retarget everything. Citations are resolved once and '
      + 'written as literal text, so PDF/DOCX/JATS/HTML always agree.',
    parameters: {
      id: { type: 'string', description: 'Manuscript id under $DSH_HOME/science/manuscripts.' },
      dir: { type: 'string', description: 'Explicit manuscript directory; overrides id.' },
      targets: { type: 'array', items: { type: 'string' }, description: 'Any of pdf, latex, docx, jats, html, all. Defaults to ["pdf"].' },
      journal: { type: 'string', description: 'Override the journal in the front matter.' },
      publisher: { type: 'string', description: 'Use a publisher family instead of a journal.' },
      outDir: { type: 'string', description: 'Output directory. Defaults to <manuscript>/build.' },
      engine: { type: 'string', description: 'TeX engine: xelatex (default), lualatex, pdflatex.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          id: { type: 'string', required: true },
          dir: { type: 'string', required: true },
          outDir: { type: 'string', required: true },
          journalId: { type: 'string' },
          familyId: { type: 'string', required: true },
          citationStyle: { type: 'string', required: true },
          artifacts: { type: 'array', required: true, items: artifactSchema() },
          warnings: { type: 'array', items: { type: 'string' } },
          blocking: { type: 'integer' },
          warningCount: { type: 'integer' },
          words: { type: 'integer' },
          ms: { type: 'integer', required: true },
        },
      },
      render: (_args, v) => {
        const lines = [
          `${v.ok ? '✓' : '✗'} 构建完成 ${v.ms}ms`,
          `目标：${v.journalId || '未指定'} → 族 ${v.familyId} · 引文 ${v.citationStyle}`,
          `输出：${v.outDir}`,
          '',
        ]
        for (const item of v.artifacts) {
          if (item.path) {
            lines.push(`  ✓ ${item.kind.padEnd(6)} ${item.bytes} bytes  ${item.path}${item.engine ? `  (${item.engine})` : ''}`)
          } else {
            lines.push(`  ✗ ${item.kind.replace('-failed', '')} 失败${item.hint ? `：${item.hint}` : ''}`)
          }
        }
        if (v.warnings.length > 0) {
          lines.push('', '提示：')
          for (const item of v.warnings) lines.push(`  · ${item}`)
        }
        if (v.blocking > 0) lines.push('', `要件检查还有 ${v.blocking} 个阻断项——跑 science_manuscript_lint 看清单`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      try {
        const dir = resolveDir(args.dir || args.id)
        const loaded = loadSource(dir)
        const targets = Array.isArray(args.targets) && args.targets.length > 0 ? args.targets : ['pdf']
        const built = buildManuscript({
          dir,
          targets,
          journal: args.journal || loaded.doc.meta.journal || null,
          publisher: args.publisher || null,
          outDir: args.outDir || null,
          engine: args.engine || 'xelatex',
        })

        /* 同 lint：出件结果也落文件，S11 的门才有东西可查。 */
        try {
          writeFileSync(join(dir, 'build.json'), `${JSON.stringify({
            id: String(args.id || ''),
            at: Date.now(),
            journalId: built.journalId ?? null,
            familyId: built.familyId ?? null,
            artifacts: (built.artifacts ?? []).map((a) => ({
              kind: a.kind,
              ok: !String(a.kind).endsWith('-failed'),
              path: a.path ?? null,
            })),
            okCount: (built.artifacts ?? []).filter((a) => !String(a.kind).endsWith('-failed')).length,
          }, null, 2)}\n`, 'utf8')
        } catch (error) {
          logger.warn?.(`build.json 未写出：${error.message}`)
        }
        return {
          ...built,
          id: String(args.id || ''),
          citationStyle: built.citation,
          blocking: built.lint?.blocking ?? 0,
          warningCount: built.lint?.warning ?? 0,
          words: built.lint?.metrics?.words ?? 0,
        }
      } catch (error) {
        rethrow(error)
      }
    },
  }))

  /* ── 4. 环境自检 ─────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_format_check',
    description:
      'Report the formatting toolchain: which TeX engines exist, whether the journal classes are installed (elsarticle, IEEEtran, '
      + 'revtex4-2, achemso, sn-jnl...), whether python-docx is importable, and the full journal-family table (LaTeX class, page '
      + 'size, body size, citation style). Run this before blaming the build, and to see which targets are reachable right now.',
    parameters: {
      deep: { type: 'boolean', description: 'Also run one real xelatex compile of a minimal document. Defaults to true.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          latexAvailable: { type: 'boolean', required: true },
          docxAvailable: { type: 'boolean', required: true },
          engines: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                ok: { type: 'boolean', required: true },
                version: { type: 'string' },
              },
            },
          },
          python: { type: 'string' },
          classes: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                available: { type: 'boolean', required: true },
                note: { type: 'string' },
              },
            },
          },
          families: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                latexClass: { type: 'string', required: true },
                pageSize: { type: 'string', required: true },
                bodyPt: { type: 'number', required: true },
                lineSpacing: { type: 'number' },
                lineNumbers: { type: 'boolean' },
                citation: { type: 'string', required: true },
              },
            },
          },
          manuscripts: { type: 'array', items: { type: 'string' } },
          reachable: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = [
          '排版工具链',
          `  LaTeX：${v.latexAvailable ? '可用' : '不可用'}　DOCX：${v.docxAvailable ? '可用' : '不可用'}`,
          `  引擎：${v.engines.map((e) => `${e.name}${e.ok ? '✓' : '✗'}`).join(' ')}`,
          `  python-docx：${v.python || '未检出'}`,
          '',
          '宏包类：',
          `  ${v.classes.map((c) => `${c.name}${c.available ? '✓' : '✗'}`).join('  ')}`,
          '',
          '期刊族（改 front matter 的 journal 字段即可切换）：',
        ]
        for (const row of v.families) {
          lines.push(`  ${row.id.padEnd(16)} ${row.latexClass.padEnd(11)} ${row.pageSize.padEnd(7)} ${String(row.bodyPt).padStart(2)}pt  行距${row.lineSpacing ?? 1}${row.lineNumbers ? ' 行号' : '    '}  ${row.citation}`)
        }
        if (v.manuscripts.length > 0) {
          lines.push('', `本地稿子（${v.manuscripts.length}）：${v.manuscripts.join(', ')}`)
        }
        lines.push('', `当前可出：${v.reachable.join(' / ')}`)
        if (v.note) lines.push('', v.note)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      try {
        const toolchain = checkToolchain()
        const families = listFamilies().map((row) => ({
          id: row.id,
          latexClass: row.latexClass,
          pageSize: row.pageSize,
          bodyPt: row.bodyPt,
          lineSpacing: row.lineSpacing ?? 1,
          lineNumbers: Boolean(row.lineNumbers),
          citation: row.citation,
        }))

        const reachable = []
        if (toolchain.latexAvailable) reachable.push('pdf')
        if (toolchain.docxAvailable) reachable.push('docx')
        reachable.push('jats', 'html')

        const classes = Object.entries(toolchain.classes).map(([name, info]) => ({
          name,
          available: info.available,
          ...(info.available ? {} : { note: '可用 `mpm --install=' + name + '.cls` 尝试补装；装不上会自动降级到 article' }),
        }))

        const manuscripts = listManuscriptDirs().map((entry) => entry.id)
        const missing = classes.filter((item) => !item.available).map((item) => item.name)

        let note = ''
        if (!toolchain.latexAvailable) note = '没有 TeX 引擎：PDF 出不了，但 docx/jats/html 仍然可用。'
        else if (missing.length > 0) note = `缺类：${missing.join(', ')}。用到这些族的刊会自动降级到 article，版式细节会丢，投稿前建议补装。`

        return {
          latexAvailable: toolchain.latexAvailable,
          docxAvailable: toolchain.docxAvailable,
          engines: Object.entries(toolchain.engines).map(([name, info]) => ({
            name,
            ok: info.ok,
            ...(info.version ? { version: info.version } : {}),
          })),
          python: toolchain.python.version || toolchain.python.error || '',
          classes,
          families,
          manuscripts,
          reachable,
          note,
        }
      } catch (error) {
        rethrow(error)
      }
    },
  }))
}

const YAML_ESCAPE = (text) => String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"')

function renderReferenceStub() {
  return [
    '# 参考文献：正文用 [@key] 引用，build 时按目标刊的引文风格重排。',
    '# 支持的 type：article-journal / book / chapter / conference / thesis / preprint / dataset / software / misc',
    '',
    '# - key: author2024short',
    '#   type: article-journal',
    '#   title: "完整标题"',
    '#   authors:',
    '#     - {family: 姓, given: 名}',
    '#   year: 2024',
    '#   journal: 期刊名',
    '#   volume: "12"',
    '#   issue: "3"',
    '#   pages: "45-67"',
    '#   doi: 10.xxxx/yyyy',
    '',
  ].join('\n')
}
