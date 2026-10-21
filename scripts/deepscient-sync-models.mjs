#!/usr/bin/env node
/**
 * 从现有 profile 的补丁层抽出「模型供应商 + 默认模型」两类行，写成 DeepScient 自己的
 * local.patch.yml，供启动器用 `--patch` 叠加。
 *
 * 为什么是抽取而不是复制整个 patch：那份 patch 里还有别人加的设置（欢迎语版本、别的
 * 插件开关），一并搬进 DeepScient 会把它变成另一个东西的副本。只搬实例跑起来所必需的
 * 两类行，其余留给 DeepScient 自己的层。
 *
 * 为什么不是复制凭据：这些行里只有 `apiKeyEnv` 这种「变量名」，真正的密钥在环境变量和
 * 凭据文件里；新 home 不共享凭据，也不会被这个脚本带走。
 *
 * 用法：
 *   node scripts/deepscient-sync-models.mjs                # 从 ~/.dsh/profiles/web 抽
 *   node scripts/deepscient-sync-models.mjs --from <file>  # 指定源 patch
 *   node scripts/deepscient-sync-models.mjs --check        # 只报告，不写文件
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const PRODUCT = 'DeepScient'
const WANT = [/^llm-/, /^agent-default-model$/]

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : (argv[i + 1] ?? true)
}
const checkOnly = argv.includes('--check')

const sourceDefault = join(
  process.env.DSH_HOME_SOURCE || join(homedir(), '.dsh'),
  'profiles',
  'web',
  'cordis.patch.yml',
)
const source = resolve(String(flag('from') || sourceDefault))
const target = resolve(
  String(flag('to') || join(process.cwd(), 'deepscient', 'local.patch.yml')),
)

if (!existsSync(source)) {
  console.error(`源 patch 不存在：${source}`)
  console.error('用 --from <file> 指定一份含 llm-* / agent-default-model 行的 patch，或在 DeepScient 的设置里手填供应商。')
  process.exit(2)
}

/**
 * 按顶层 `- ` 切块。YAML 顶层列表里，每一块的续行都有缩进，所以「第 0 列以 - 开头」
 * 就是块边界 —— 不需要完整 YAML 解析，也就不需要往产品包里塞依赖。
 */
function splitBlocks(text) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  let current = null
  let preamble = []
  for (const line of lines) {
    if (/^-\s/.test(line)) {
      if (current) blocks.push(current)
      current = { head: line, body: [] }
    } else if (current) {
      current.body.push(line)
    } else {
      preamble.push(line)
    }
  }
  if (current) blocks.push(current)
  return { preamble, blocks }
}

const idOf = (block) => {
  const m = /^-\s*id:\s*(\S+)/.exec(block.head)
  return m ? m[1].replace(/^["']|["']$/g, '') : ''
}

const { preamble, blocks } = splitBlocks(readFileSync(source, 'utf8'))
const picked = blocks.filter((b) => WANT.some((re) => re.test(idOf(b))))

if (picked.length === 0) {
  console.error(`源 patch 里没有 llm-* / agent-default-model 行：${source}`)
  process.exit(3)
}

const ids = picked.map(idOf)
const header = [
  `# ${PRODUCT} 本地供应商层 —— 由 scripts/deepscient-sync-models.mjs 生成，不要手改。`,
  `# 源：${source}`,
  `# 生成：${new Date().toISOString()}`,
  `# 行：${ids.join(', ')}`,
  '# 只含 apiKeyEnv 之类的变量名，不含凭据本身。换机器请重新生成，或在设置里填。',
].join('\n')

const body = picked
  .map((b) => {
    // 去掉块尾多余空行，保留内部结构
    const trimmed = [...b.body]
    while (trimmed.length && trimmed[trimmed.length - 1].trim() === '') trimmed.pop()
    return [b.head, ...trimmed].join('\n')
  })
  .join('\n')

const text = `${header}\n${body}\n`

if (checkOnly) {
  console.log(`可抽取 ${picked.length} 行：${ids.join(', ')}`)
  console.log(picked.map((b) => b.head).join('\n'))
  process.exit(0)
}

mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, text, 'utf8')
console.log(`${PRODUCT}: 写入 ${target}`)
console.log(`  行数 ${picked.length}：${ids.join(', ')}`)
const unused = preamble.filter((l) => l.trim() && !l.trim().startsWith('#')).length
if (unused) console.log(`  源文件里有 ${unused} 行非注释前言未搬运（与本实例无关）。`)
