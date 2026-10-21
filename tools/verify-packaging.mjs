#!/usr/bin/env node
/**
 * 打包面校验：一个脚本回答「这个仓库现在推上去，别人 clone 下来能看懂、能装、能验吗」。
 *
 * 为什么要有它：GitHub Actions 里装不起 dsh 运行时（那是本机私有环境），所以
 * `deepscient/scripts/verify-deepscient.mjs` 那种「打活实例验接口」的断言进不了 CI。
 * 这个脚本只做**零依赖、纯静态**的检查，CI 与本地跑的是同一份：
 *
 *   node tools/verify-packaging.mjs
 *
 * 它守的六类东西：
 *   1. 语法：所有 .js / .mjs 都能被 node 解析
 *   2. 打包：两个 package.json 的 files 里列的路径（含 glob）都真实存在
 *   3. 清单：skills-vendor/manifest.json 的 schema、40 位 commit pin、sha256、许可
 *   4. 字节：.ps1 带 BOM 且能被 PowerShell 解析器接受（5.1 会因缺 BOM 把中文读乱）
 *   5. 隐私：发布面不出现本机绝对路径、运行时配置里不出现本机私有插件、无凭据字面量
 *   6. 文档：Markdown 里的相对链接都指向真实文件
 *
 * 退出码 0 = 全过；1 = 有失败项（CI 会因此变红，这是设计意图）。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')

/** 只有这些目录属于本仓库；工作目录里其余东西（别的项目）一律不参与校验。 */
const PUBLISH_ROOTS = ['deepscient', 'dsh-science', 'docs', 'tools', 'scripts', '.github']
const TOP_FILES = [
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'ROADMAP.md',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
]

/** 机器相关或可重建、已被 .gitignore 排除的文件：不参与隐私判定。 */
const MACHINE_LOCAL = new Set(['deepscient/local.patch.yml', 'dsh-science/data/journal-intel-cache.json'])

const results = []
const check = (name, fn) => {
  try {
    results.push({ name, ok: true, detail: fn() })
  } catch (error) {
    results.push({ name, ok: false, detail: error.message })
  }
}
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const walk = (dir, filter, acc = []) => {
  if (!existsSync(dir)) return acc
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) walk(full, filter, acc)
    else if (filter(full)) acc.push(full)
  }
  return acc
}

/** 发布面上所有文本文件（绝对路径）。 */
const publishFiles = () => {
  const files = []
  for (const dir of PUBLISH_ROOTS) walk(join(root, dir), () => true, files)
  for (const name of TOP_FILES) {
    const full = join(root, name)
    if (existsSync(full)) files.push(full)
  }
  return files.filter((file) => statSync(file).isFile() && !MACHINE_LOCAL.has(relative(root, file).replace(/\\/g, '/')))
}

const read = (path) => readFileSync(join(root, path), 'utf8')
const json = (path) => JSON.parse(read(path))
const posix = (file) => relative(root, file).replace(/\\/g, '/')
const textFiles = (files) => files.filter((file) => /\.(md|js|mjs|json|ya?ml|ps1|cmd|txt|editorconfig|gitignore|gitattributes)$/.test(file))

// ── 1. 语法 ────────────────────────────────────────────────────────────
const codeFiles = textFiles(publishFiles()).filter((file) => /\.(mjs|js)$/.test(file))

check('全部 JS 模块语法正确', () => {
  const broken = []
  for (const file of codeFiles) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
    } catch (error) {
      broken.push(`${posix(file)}: ${String(error.stderr ?? error.message).split('\n')[0]}`)
    }
  }
  assert(broken.length === 0, broken.join('\n'))
  return `${codeFiles.length} 个文件`
})

check('dsh-science/lib 全是 ESM（没有混进 CJS）', () => {
  const suspect = walk(join(root, 'dsh-science', 'lib'), (file) => file.endsWith('.js')).filter((file) => {
    const text = readFileSync(file, 'utf8')
    return !/\b(import|export)\b/.test(text) && /require\(/.test(text)
  })
  assert(suspect.length === 0, suspect.map(posix).join(', '))
  return 'ok'
})

// ── 2. 打包 ────────────────────────────────────────────────────────────
/** package.json 的 files 支持 glob（如 `docs/*.md`），按条判断真假。 */
const filesEntryExists = (base, entry) => {
  if (!entry.includes('*')) return existsSync(join(base, entry))
  const [head, tail] = [entry.slice(0, entry.indexOf('*')), entry.slice(entry.lastIndexOf('*') + 1)]
  const dir = join(base, dirname(head + 'x'))
  if (!existsSync(dir)) return false
  return readdirSync(dir).some((name) => name.endsWith(tail.replace(/^\/?/, '')) || tail === '')
}

for (const pkgPath of ['deepscient/package.json', 'dsh-science/package.json']) {
  check(`${pkgPath} 的 files 每条都真实存在`, () => {
    const pkg = json(pkgPath)
    const base = dirname(join(root, pkgPath))
    const missing = (pkg.files ?? []).filter((entry) => !filesEntryExists(base, entry))
    assert(missing.length === 0, `缺：${missing.join('、')}`)
    return `${pkg.files.length} 条`
  })
}

check('dsh-science 的清单随包发布（skills-vendor 在 files 里）', () => {
  const pkg = json('dsh-science/package.json')
  assert(pkg.files.includes('skills-vendor'), 'files 少了 skills-vendor')
  assert(existsSync(join(root, 'dsh-science/skills-vendor/manifest.json')), 'manifest.json 不存在')
  return 'ok'
})

check('技能清单只留元数据，没有第三方正文', () => {
  const entries = readdirSync(join(root, 'dsh-science/skills-vendor'))
  const unexpected = entries.filter((name) => !['README.md', 'manifest.json'].includes(name))
  assert(unexpected.length === 0, `多出来的条目：${unexpected.join('、')}`)
  return 'README.md + manifest.json'
})

// ── 3. 清单 ────────────────────────────────────────────────────────────
const manifestSkills = () => {
  const manifest = json('dsh-science/skills-vendor/manifest.json')
  const skills = Array.isArray(manifest) ? manifest : manifest.skills
  assert(Array.isArray(skills), '找不到 skills 数组')
  return skills
}

check('技能清单 schema 与 pin 正确', () => {
  const skills = manifestSkills()
  const ids = new Set()
  const problems = []
  for (const skill of skills) {
    if (ids.has(skill.id)) problems.push(`重复 id：${skill.id}`)
    ids.add(skill.id)
    if (!/^[0-9a-f]{40}$/.test(skill.ref ?? '')) problems.push(`${skill.id} 的 ref 不是 40 位 commit`)
    if (!/^[0-9a-f]{64}$/.test(skill.sha256 ?? '')) problems.push(`${skill.id} 的 sha256 不是 64 位`)
    if (!/^[\w.-]+\/[\w.-]+$/.test(skill.repo ?? '')) problems.push(`${skill.id} 的 repo 格式不对`)
    if (typeof skill.name !== 'string' || skill.name.length === 0) problems.push(`${skill.id} 缺 name`)
    // 许可字段写法有差异（例如「per-skill MIT（各技能目录内 LICENSE.txt）」），判关键词而非逐字相等
    if (!/MIT|Apache|BSD|ISC/i.test(skill.license ?? '')) problems.push(`${skill.id} 不是宽松许可：${skill.license}`)
    if (/(^|\s)(A?GPL|LGPL|MPL|UNLICENSED|NOASSERTION|CC-BY-NC)/i.test(skill.license ?? '')) {
      problems.push(`${skill.id} 许可有传染性或未声明：${skill.license}`)
    }
  }
  assert(problems.length === 0, problems.join('；'))
  assert(skills.length >= 80, `只有 ${skills.length} 条，期望 ≥80`)
  return `${skills.length} 条，全部 pin 到 commit`
})

check('技能来源仓库不重复且数量合理', () => {
  const repos = new Set(manifestSkills().map((skill) => skill.repo))
  assert(repos.size >= 5, `只有 ${repos.size} 个来源仓库`)
  return `${repos.size} 个来源仓库`
})

// ── 4. 字节 / PowerShell ───────────────────────────────────────────────
const ps1Files = publishFiles().filter((file) => file.endsWith('.ps1'))

check('.ps1 带 UTF-8 BOM（5.1 才不会把中文读成乱码）', () => {
  const problems = []
  for (const file of ps1Files) {
    const head = readFileSync(file).subarray(0, 3)
    if (!(head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf)) problems.push(posix(file))
  }
  assert(problems.length === 0, `缺 BOM：${problems.join('、')}`)
  return `${ps1Files.length} 个文件`
})

check('.ps1 能被 PowerShell 解析器接受', () => {
  if (process.platform !== 'win32') return '跳过（非 Windows）'
  const problems = []
  for (const file of ps1Files) {
    const command = `$errors = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}', [ref]$null, [ref]$errors); if ($errors.Count) { $errors[0].Message }`
    try {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim()
      if (out) problems.push(`${posix(file)}: ${out}`)
    } catch (error) {
      problems.push(`${posix(file)}: ${String(error.stderr ?? error.message).split('\n')[0]}`)
    }
  }
  assert(problems.length === 0, problems.join('\n'))
  return `${ps1Files.length} 个文件`
})

// ── 5. 隐私 ────────────────────────────────────────────────────────────
// 拼出来而不是写整串：否则本文件自己会被下面的检查抓到
const BS = '\\'
const WIN_HOME = 'C:' + BS + 'Users' + BS
const POSIX_HOME = '/' + 'home' + '/'
const MAC_HOME = '/' + 'Users' + '/'

check('发布面不含本机绝对路径', () => {
  // 两个检查器必须包含这些路径形态才能工作，豁免它们自己
  const SELF_EXEMPT = new Set(['tools/verify-packaging.mjs', 'dsh-science/scripts/verify-portability.mjs'])
  const hits = []
  for (const file of textFiles(publishFiles())) {
    if (SELF_EXEMPT.has(posix(file))) continue
    const text = readFileSync(file, 'utf8')
    for (const head of [WIN_HOME, POSIX_HOME, MAC_HOME]) {
      let index = text.indexOf(head)
      while (index >= 0) {
        const rest = text.slice(index + head.length).match(/^[^\\\s"'`)]*/)?.[0] ?? ''
        // 「C:\Users\…」「/home/<user>」这类占位写法也算命中：发布面不该出现用户目录
        hits.push(`${posix(file)}: ${head}${rest}`)
        index = text.indexOf(head, index + head.length)
        if (hits.length > 12) break
      }
    }
  }
  assert(hits.length === 0, hits.slice(0, 8).join('；'))
  return `${textFiles(publishFiles()).length} 个文件干净`
})

check('运行时配置与代码里没有本机私有插件或未注册提示词变量', () => {
  // 只查「会被 dsh 真加载或真执行」的面；文档里解释这些词为什么不用，是正常的
  const runtime = [
    'deepscient/cordis.patch.yml',
    'deepscient/mcp.patch.yml',
    'deepscient/local.patch.example.yml',
    'dsh-science/cordis.patch.yml',
    'dsh-science/presets/science.patch.yml',
    ...walk(join(root, 'dsh-science', 'lib'), (file) => /\.js$/.test(file)).map(posix),
    ...walk(join(root, 'dsh-science', 'presets'), (file) => /\.(ya?ml)$/.test(file)).map(posix),
    ...walk(join(root, 'deepscient', 'host'), (file) => /\.js$/.test(file)).map(posix),
    ...walk(join(root, 'deepscient', 'client'), (file) => /\.js$/.test(file)).map(posix),
  ].filter((file) => existsSync(join(root, file)))

  const privatePlugins = ['dsh' + '-purge', 'cwd' + '-variable']
  const offenders = []
  for (const file of runtime) {
    const text = readFileSync(join(root, file), 'utf8')
    for (const name of privatePlugins) if (text.includes(name)) offenders.push(`${file}: ${name}`)
    if (/\{\{\s*[\w.]+\s*\}\}/.test(text)) offenders.push(`${file}: 提示词变量`)
  }
  assert(offenders.length === 0, offenders.slice(0, 8).join('；'))
  return `${runtime.length} 个运行时文件`
})

check('发布面不含凭据字面量', () => {
  const patterns = [/sk-[A-Za-z0-9]{20,}/, /ghp_[A-Za-z0-9]{20,}/, /github_pat_[A-Za-z0-9_]{20,}/, /AKIA[0-9A-Z]{12,}/]
  const hits = []
  for (const file of textFiles(publishFiles())) {
    const text = readFileSync(file, 'utf8')
    for (const pattern of patterns) if (pattern.test(text)) hits.push(posix(file))
  }
  assert(hits.length === 0, hits.join('、'))
  return 'ok'
})

// ── 6. 文档 ────────────────────────────────────────────────────────────
const markdownFiles = publishFiles().filter((file) => file.endsWith('.md'))

check('Markdown 里的相对链接都指向真实文件', () => {
  const broken = []
  for (const file of markdownFiles) {
    // 随包技能正文里的链接是给模型看的模板（例如 `![cap](path){#fig:x}`），不是仓库文档
    if (posix(file).startsWith('dsh-science/skills/')) continue
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/\]\(([^)#\s][^)\s]*)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '').split('#')[0]
      if (!target || /^(https?:|mailto:)/.test(target)) continue
      // 只校验看起来是路径的链接：含 / 或有扩展名；`](path)` 这类语法占位跳过
      if (!target.includes('/') && !/\.\w{2,5}$/.test(target)) continue
      if (!existsSync(resolve(dirname(file), decodeURI(target)))) broken.push(`${posix(file)} → ${target}`)
    }
  }
  assert(broken.length === 0, broken.slice(0, 10).join('；'))
  return `${markdownFiles.length} 篇文档`
})

check('顶层 README 说了四件必要的事', () => {
  const text = read('README.md')
  const missing = [
    ['它是什么', /DeepScient/],
    ['怎么装', /安装|快速开始/],
    ['怎么验', /verify/],
    ['许可', /MIT/],
  ]
    .filter(([, pattern]) => !pattern.test(text))
    .map(([label]) => label)
  assert(missing.length === 0, `README 缺：${missing.join('、')}`)
  return `${text.length} 字符`
})

check('docs/README.md 是文档索引且覆盖两个包', () => {
  const text = read('docs/README.md')
  assert(/deepscient\/docs/.test(text) && /dsh-science\/docs/.test(text), '索引没覆盖两个包的 docs')
  return 'ok'
})

check('CI 工作流声明的脚本都真实存在', () => {
  const workflow = read('.github/workflows/ci.yml')
  const commands = [...workflow.matchAll(/node\s+([\w./-]+\.mjs)/g)].map((match) => match[1])
  const missing = commands.filter((command) => !existsSync(join(root, command)))
  assert(missing.length === 0, `CI 引用了不存在的脚本：${missing.join('、')}`)
  return `${commands.length} 条命令`
})

/* 凭据不许进仓库这件事，靠 .gitignore 兜不住所有路径：
   真正拦得住的是「文件里没有凭据」+「凭据文件名被忽略」两条一起成立。 */
check('.gitignore 挡住了凭据与机器本地文件', () => {
  const text = read('.gitignore')
  const required = [
    ['凭据文件', /\.credentials/],
    ['私钥', /\*\.pem|\*\.key/],
    ['机器本地的供应商层', /local\.patch\.yml/],
    ['第三方技能正文', /skills-vendor/],
  ]
  const missing = required.filter(([, pattern]) => !pattern.test(text)).map(([label]) => label)
  assert(missing.length === 0, `.gitignore 漏了：${missing.join('、')}`)
  return `${required.length} 类`
})

check('稿件与统计脚本里没有硬编码的密钥形态', () => {
  const files = [
    'dsh-science/lib/manuscript-tools.js',
    'dsh-science/scripts/py/stats_run.py',
    'dsh-science/lib/science/format/source.js',
    'deepscient/scripts/e2e-paper-run.mjs',
  ].filter((file) => existsSync(join(root, file)))
  const pattern = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,})/
  const hits = files.filter((file) => pattern.test(read(file)))
  assert(hits.length === 0, `疑似凭据：${hits.join('、')}`)
  return `${files.length} 个文件`
})

// ── 汇总 ───────────────────────────────────────────────────────────────
let failed = 0
for (const result of results) {
  if (!result.ok) failed += 1
  console.log(`${result.ok ? '✓' : '✗'} ${result.name}${result.detail ? `（${result.detail}）` : ''}`)
}
console.log('')
console.log(failed === 0 ? `打包面校验：${results.length} 项全部通过` : `打包面校验：${results.length - failed} 项通过，${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
