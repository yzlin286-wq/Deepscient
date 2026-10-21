/**
 * 构建编排：源文件 → 目标产物（PDF / DOCX / JATS / HTML）。
 *
 * 一次构建只做一件事，但把该做的事都做完：
 *   选族 → 检查类是否装得上 → 渲染 → 编译 → 回读校验 → 记录产物清单。
 * 失败时返回**可行动的诊断**（缺哪个宏包、哪一行出的错、备选命令），
 * 而不是一个 exit code。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { loadSource } from './source.js'
import { resolveFormat } from './formats.js'
import { renderLatex } from './latex.js'
import { renderDocx } from './docx.js'
import { renderJats } from './jats.js'
import { renderHtml } from './html.js'
import { lintManuscript } from './lint.js'

const run = (command, args, options = {}) => spawnSync(command, args, {
  encoding: 'utf8',
  timeout: options.timeout ?? 180000,
  maxBuffer: 16 * 1024 * 1024,
  ...options,
})

/** 探测排版工具链；结果进 preflight 与 build 的前置检查。 */
export function checkToolchain({ python = 'python' } = {}) {
  const probe = (command, args) => {
    const result = run(command, args, { timeout: 30000 })
    if (result.error) return { ok: false, error: result.error.message }
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim().split('\n')[0]
    return { ok: result.status === 0, version: output.slice(0, 120) }
  }

  const engines = {}
  for (const engine of ['xelatex', 'pdflatex', 'lualatex', 'latexmk']) {
    engines[engine] = probe(engine, ['--version'])
  }

  const pythonProbe = probe(python, ['-c', 'import docx; print("python-docx", docx.__version__ if hasattr(docx, "__version__") else "ok")'])

  const classes = {}
  for (const name of ['elsarticle', 'IEEEtran', 'revtex4-2', 'achemso', 'sn-jnl', 'bmcart', 'article']) {
    const result = run('kpsewhich', [`${name}.cls`], { timeout: 30000 })
    const found = result.status === 0 && String(result.stdout || '').trim() !== ''
    classes[name] = { available: found, path: found ? String(result.stdout).trim() : null }
  }

  return {
    engines,
    python: pythonProbe,
    classes,
    latexAvailable: Object.values(engines).some((entry) => entry.ok),
    docxAvailable: pythonProbe.ok,
  }
}

/** 让 MiKTeX 尝试补装缺的宏包类；装不上就返回 false，由调用方回退。 */
export function ensureClass(className) {
  const check = run('kpsewhich', [`${className}.cls`], { timeout: 30000 })
  if (check.status === 0 && String(check.stdout || '').trim() !== '') {
    return { available: true, installed: false, path: String(check.stdout).trim() }
  }
  const install = run('mpm', [`--install=${className}.cls`], { timeout: 180000 })
  const recheck = run('kpsewhich', [`${className}.cls`], { timeout: 30000 })
  const available = recheck.status === 0 && String(recheck.stdout || '').trim() !== ''
  return {
    available,
    installed: available,
    path: available ? String(recheck.stdout).trim() : null,
    error: available ? null : `${String(install.stderr || install.stdout || '').trim().slice(-300) || 'mpm 未能安装该宏包'}`,
  }
}

const ERROR_LINE = /^!\s*(.+)$/
const CONTEXT_LINE = /^l\.(\d+)\s*(.*)$/
const MISSING_FILE = /File `([^']+)' not found/

/** 从 .log 里抽出人看得懂的失败原因。 */
export function readLatexLog(logPath) {
  if (!existsSync(logPath)) return { errors: [], missingFiles: [], overfull: 0, firstErrorLine: null }
  const text = readFileSync(logPath, 'utf8')
  const lines = text.split('\n')
  const errors = []
  const missingFiles = []
  let overfull = 0
  let firstErrorLine = null

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (/^Overfull \\hbox/.test(line)) overfull += 1
    const missing = line.match(MISSING_FILE)
    if (missing) missingFiles.push(missing[1])
    const error = line.match(ERROR_LINE)
    if (error) {
      let context = null
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j += 1) {
        const found = lines[j].match(CONTEXT_LINE)
        if (found) { context = { line: Number(found[1]), text: found[2].trim().slice(0, 160) }; break }
      }
      errors.push({ message: error[1].trim(), ...(context ? { context } : {}) })
      if (firstErrorLine === null && context) firstErrorLine = context.line
    }
  }

  return { errors, missingFiles: [...new Set(missingFiles)], overfull, firstErrorLine }
}

/**
 * 编译 .tex。失败时按「先补宏包、再降级到 article」的顺序重试。
 */
export function compileLatex({ texPath, workDir, engine = 'xelatex', format, doc, attempts = 2 }) {
  const attemptsLog = []
  let currentTex = readFileSync(texPath, 'utf8')
  let currentEngine = engine
  let lastLog = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const args = ['-interaction=nonstopmode', '-file-line-error', basename(texPath)]
    if (attempt > 0) args.unshift('-halt-on-error')
    const result = run(currentEngine, args, { cwd: workDir, timeout: 300000 })
    const logPath = texPath.replace(/\.tex$/, '.log')
    lastLog = readLatexLog(logPath)

    const pdfPath = texPath.replace(/\.tex$/, '.pdf')
    const produced = existsSync(pdfPath)

    attemptsLog.push({
      attempt: attempt + 1,
      engine: currentEngine,
      status: result.status,
      errors: lastLog.errors.length,
      produced,
    })

    if (result.status === 0 && produced) {
      // 第二遍解决交叉引用与页码
      if (lastLog.errors.length === 0) {
        run(currentEngine, ['-interaction=nonstopmode', basename(texPath)], { cwd: workDir, timeout: 300000 })
      }
      return {
        ok: true,
        pdf: pdfPath,
        bytes: statSync(pdfPath).size,
        engine: currentEngine,
        overfull: lastLog.overfull,
        attempts: attemptsLog,
      }
    }

    // 失败诊断与补救
    if (lastLog.missingFiles.length > 0) {
      for (const file of lastLog.missingFiles) {
        const base = basename(file).replace(/\.[^.]+$/, '')
        if (base && /^[A-Za-z]/.test(base)) ensureClass(base)
      }
      continue
    }

    const undefinedClass = lastLog.errors.some((error) => /File .*\.cls' not found|Unknown option/.test(error.message))
    if (undefinedClass && format && doc) {
      const fallback = renderLatex(doc, format, { className: 'article' })
      currentTex = fallback.tex
      writeFileSync(texPath, currentTex, 'utf8')
      continue
    }

    break
  }

  return {
    ok: false,
    pdf: null,
    engine: currentEngine,
    errors: lastLog?.errors ?? [],
    missingFiles: lastLog?.missingFiles ?? [],
    firstErrorLine: lastLog?.firstErrorLine ?? null,
    attempts: attemptsLog,
    hint: buildFailureHint(lastLog),
  }
}

function buildFailureHint(log) {
  if (!log) return '没有生成 .log，检查 TeX 引擎是否可用（先跑 format_check）'
  if (log.missingFiles.length > 0) {
    return `缺文件：${log.missingFiles.join(', ')}。在 MiKTeX Console 里安装对应宏包，或跑 \`mpm --install=<包名>\``
  }
  if (log.errors.length === 0) return 'LaTeX 退出码非零但没有记录错误，通常是字体或编码问题'
  const first = log.errors[0]
  if (/Undefined control sequence/.test(first.message)) {
    return `第 ${first.context?.line ?? '?'} 行有不认识的命令：${first.context?.text ?? ''}。检查数学环境是否闭合`
  }
  if (/Missing \$ inserted/.test(first.message)) {
    return `第 ${first.context?.line ?? '?'} 行有数学符号落在正文里：${first.context?.text ?? ''}。用 $...$ 包起来`
  }
  return `首次错误：${first.message}（第 ${first.context?.line ?? '?'} 行）`
}

/**
 * 一次构建多个目标。
 * @param {{dir: string, targets?: string[], journal?: string, publisher?: string, outDir?: string, engine?: string, python?: string}} options
 */
export function buildManuscript({
  dir,
  targets = ['pdf'],
  journal = null,
  publisher = null,
  outDir = null,
  engine = 'xelatex',
  python = 'python',
} = {}) {
  const started = Date.now()
  const loaded = loadSource(dir)
  const doc = loaded.doc
  const effectiveJournal = journal ?? doc.meta.journal ?? null
  const format = resolveFormat({ journal: effectiveJournal, publisher })

  const targetDir = outDir ? resolve(outDir) : join(resolve(dir), 'build')
  mkdirSync(targetDir, { recursive: true })

  const slug = (format.journalId || format.familyId || 'draft').replace(/[^\w.-]+/g, '-')
  const artifacts = []
  const warnings = [...doc.warnings]
  if (format.warning) warnings.push(format.warning)

  const requested = targets.includes('all')
    ? ['pdf', 'docx', 'jats', 'html']
    : targets

  for (const target of requested) {
    try {
      if (target === 'pdf' || target === 'latex') {
        const rendered = renderLatex(doc, format)
        const texPath = join(targetDir, `${slug}.tex`)
        writeFileSync(texPath, rendered.tex, 'utf8')

        // 图路径相对 .tex 所在目录，构建目录不同层级时要复制或改写
        const figureDirMissing = doc.blocks
          .filter((block) => block.type === 'figure')
          .some((block) => !existsSync(resolve(targetDir, block.src)) && existsSync(resolve(dir, block.src)))
        const graphicsPath = figureDirMissing ? `\\graphicspath{{${resolve(dir).replace(/\\/g, '/')}/}}` : ''
        if (graphicsPath) {
          writeFileSync(texPath, rendered.tex.replace('\\begin{document}', `${graphicsPath}\n\\begin{document}`), 'utf8')
        }

        artifacts.push({ kind: 'latex', path: texPath, bytes: statSync(texPath).size })

        if (target === 'pdf') {
          const compiled = compileLatex({ texPath, workDir: targetDir, engine, format, doc })
          if (compiled.ok) {
            artifacts.push({ kind: 'pdf', path: compiled.pdf, bytes: compiled.bytes, engine: compiled.engine })
            if (compiled.overfull > 0) {
              warnings.push(`${compiled.overfull} 处 Overfull \\hbox（内容超出页宽，交稿前建议处理）`)
            }
          } else {
            artifacts.push({
              kind: 'pdf-failed',
              path: null,
              errors: compiled.errors,
              hint: compiled.hint,
            })
          }
        }
      } else if (target === 'docx') {
        const outPath = join(targetDir, `${slug}.docx`)
        const result = renderDocx(doc, format, { outPath, baseDir: resolve(dir), python })
        artifacts.push({ kind: 'docx', path: result.path, bytes: result.bytes })
        if (result.unconverted.length > 0) {
          warnings.push(`DOCX 里 ${result.unconverted.length} 个 TeX 命令没能转成 Unicode：${result.unconverted.join(', ')}（在 Word 里手工改成公式）`)
        }
      } else if (target === 'jats') {
        const rendered = renderJats(doc, format)
        const outPath = join(targetDir, `${slug}.jats.xml`)
        writeFileSync(outPath, rendered.xml, 'utf8')
        artifacts.push({ kind: 'jats', path: outPath, bytes: statSync(outPath).size })
      } else if (target === 'html') {
        const rendered = renderHtml(doc, format)
        const outPath = join(targetDir, `${slug}.html`)
        writeFileSync(outPath, rendered.html, 'utf8')
        artifacts.push({ kind: 'html', path: outPath, bytes: statSync(outPath).size })
      } else {
        warnings.push(`未知目标 ${target}，跳过`)
      }
    } catch (error) {
      artifacts.push({ kind: `${target}-failed`, path: null, errors: [{ message: error.message }] })
    }
  }

  const lint = lintManuscript(doc, format, { baseDir: resolve(dir) })
  const ok = artifacts.every((item) => !String(item.kind).endsWith('-failed'))

  return {
    ok,
    dir: resolve(dir),
    outDir: targetDir,
    journalId: format.journalId,
    familyId: format.familyId,
    citation: format.citation,
    artifacts,
    lint: { ok: lint.ok, blocking: lint.blocking, warning: lint.warning, metrics: lint.metrics },
    warnings: [...new Set(warnings)],
    ms: Date.now() - started,
  }
}

export { loadSource, resolveFormat, renderLatex, renderDocx, renderJats, renderHtml, lintManuscript }
