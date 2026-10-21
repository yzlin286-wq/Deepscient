#!/usr/bin/env node
/**
 * 把本地提交推到 GitHub。两条路，按网络情况自动选：
 *
 *   1) git push（默认）—— 走 credential helper 或 GITHUB_TOKEN。
 *      本机这台机器的 ~/.npmrc 与 git 全局配置里都留着指向没在监听的端口的代理，
 *      所以脚本会显式清掉 http.proxy / https.proxy 再推。
 *
 *   2) Git Data API（--api，或 git push 失败时自动兜底）——
 *      只用到 api.github.com，不需要 github.com 可达。适合 github.com 被墙/抖动、
 *      但 api.github.com 通的网络。需要 GITHUB_TOKEN。
 *
 * 用法：
 *   node tools/publish-github.mjs                 # 推当前分支到 origin
 *   node tools/publish-github.mjs --api           # 强制走 API
 *   node tools/publish-github.mjs --dry           # 只说要做什么
 *   node tools/publish-github.mjs --branch main --message "…"   # --api 时的提交信息
 *
 * token 只从环境变量读，不进命令行、不进 .git/config、进 reflog 前就被清掉；
 * 所有输出都会把 token 替换成 ***。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}

const TOKEN = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? ''
const branch = value('branch', 'main')
const dry = flag('dry')
const forceApi = flag('api')
const remoteUrl = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
const match = /github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/.exec(remoteUrl)
if (!match) {
  console.error(`origin 不是 GitHub 仓库：${remoteUrl}`)
  process.exit(2)
}
const [, owner, repo] = match

/** 输出前先擦掉 token，避免意外写进日志。 */
const scrub = (text) => (TOKEN ? String(text).split(TOKEN).join('***') : String(text))
const log = (message) => console.log(scrub(message))
const git = (args, options = {}) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options })

/** 本机全局配置里塞了死代理，逐次清掉再联网。 */
const NO_PROXY_ARGS = ['-c', 'http.proxy=', '-c', 'https.proxy=']

if (dry) {
  log(`将要推送：origin ${owner}/${repo}，分支 ${branch}`)
  log(`本地 HEAD：${git(['rev-parse', '--short', 'HEAD']).trim()}`)
  log(`认证：${TOKEN ? 'GITHUB_TOKEN（走 extraHeader，不落盘）' : 'credential helper'}`)
  log(`方式：${forceApi ? 'Git Data API' : 'git push（失败自动切 API）'}`)
  process.exit(0)
}

/** 路线 1：git push。 */
const pushViaGit = () => {
  const args = [...NO_PROXY_ARGS, 'push', 'origin', `${branch}:${branch}`]
  if (TOKEN) {
    const basic = Buffer.from(`x-access-token:${TOKEN}`).toString('base64')
    args.splice(0, 0, '-c', `http.extraHeader=AUTHORIZATION: basic ${basic}`)
  }
  log('→ git push …')
  const output = git(args)
  log(output.trim())
}

/** 路线 2：Git Data API。只在 api.github.com 可达时才有意义。 */
const api = async (path, init = {}, attempt = 1) => {
  try {
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${TOKEN}`,
        'user-agent': 'deepscient-publish',
        'x-github-api-version': '2022-11-28',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      signal: AbortSignal.timeout(60000),
    })
    const text = await response.text()
    let body
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    if (!response.ok) {
      // 5xx / 429 可重试；4xx（权限、校验）重试也没用
      const retryable = response.status >= 500 || response.status === 429
      if (retryable && attempt < 4) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500))
        return api(path, init, attempt + 1)
      }
      throw new Error(`API ${init.method ?? 'GET'} ${path} → ${response.status} ${scrub(text).slice(0, 300)}`)
    }
    return body
  } catch (error) {
    // 网络层抖动（fetch failed / 连接重置）同样重试
    if (attempt < 4 && !/→ 4\d\d/.test(String(error.message))) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500))
      return api(path, init, attempt + 1)
    }
    throw error
  }
}

const pushViaApi = async () => {
  if (!TOKEN) {
    console.error('--api 需要 GITHUB_TOKEN（api.github.com 必须带认证才能写）')
    process.exit(2)
  }

  const user = await api('/user')
  log(`身份：${user.login}`)

  const repoInfo = await api(`/repos/${owner}/${repo}`)
  const target = branch || repoInfo.default_branch
  log(`仓库：${repoInfo.full_name}（默认分支 ${repoInfo.default_branch}，大小 ${repoInfo.size} KB）`)

  // 远端当前 HEAD（空仓库时不存在）
  let parentSha = null
  try {
    parentSha = (await api(`/repos/${owner}/${repo}/git/ref/heads/${target}`)).object.sha
  } catch (error) {
    if (!/→ 404/.test(String(error.message))) throw error
    log('远端还没有这个分支，将创建')
  }

  // 本地索引：mode / blob sha / path
  const entries = git(['ls-files', '-s', '-z']).split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t')
    const [mode, sha] = line.slice(0, tab).split(' ')
    return { mode, sha, path: line.slice(tab + 1) }
  })
  log(`本地文件：${entries.length} 个（parent ${parentSha ? parentSha.slice(0, 7) : '无'}）`)

  // 远端已有树的 blob 映射：内容相同的文件不必重传（省时间也省配额）
  const remoteBlobs = new Map()
  if (parentSha) {
    const tree = await api(`/repos/${owner}/${repo}/git/trees/${parentSha}?recursive=1`)
    for (const node of tree.tree ?? []) if (node.type === 'blob') remoteBlobs.set(node.path, node.sha)
  }

  const same = entries.filter((entry) => remoteBlobs.get(entry.path) === entry.sha)
  const todo = entries.filter((entry) => remoteBlobs.get(entry.path) !== entry.sha)
  log(`复用远端 blob：${same.length} 个；需要上传：${todo.length} 个`)

  // 断点续传：网络抖动时重跑不必从头再传。键是「路径 + 本地 blob sha」，内容变了就不会误用。
  const CACHE = '.git/deepscient-publish-cache.json'
  let cache = {}
  try {
    cache = JSON.parse(readFileSync(CACHE, 'utf8'))
  } catch {
    cache = {}
  }
  const uploaded = new Map(same.map((entry) => [entry.path, entry.sha]))
  const pending = []
  let reused = 0
  for (const entry of todo) {
    const key = `${entry.path}@${entry.sha}`
    if (cache[key]) {
      uploaded.set(entry.path, cache[key])
      reused += 1
    } else {
      pending.push(entry)
    }
  }
  if (reused) log(`从上次中断处续传：${reused} 个已传过`)

  let done = 0
  const CONCURRENCY = 2
  const queue = [...pending]
  const flush = () => {
    const snapshot = {}
    for (const [path, sha] of uploaded) {
      const entry = entries.find((item) => item.path === path)
      if (entry) snapshot[`${path}@${entry.sha}`] = sha
    }
    writeFileSync(CACHE, JSON.stringify(snapshot))
  }
  const worker = async () => {
    for (;;) {
      const entry = queue.shift()
      if (!entry) return
      const content = execFileSync('git', ['cat-file', 'blob', entry.sha], { maxBuffer: 64 * 1024 * 1024 })
      const blob = await api(`/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
      })
      uploaded.set(entry.path, blob.sha)
      done += 1
      if (done % 20 === 0 || done === pending.length) {
        flush()
        log(`  上传 ${done}/${pending.length}`)
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  flush()

  const tree = await api(`/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      tree: entries.map((entry) => ({
        path: entry.path,
        mode: entry.mode === '100755' ? '100755' : '100644',
        type: 'blob',
        sha: uploaded.get(entry.path),
      })),
    }),
  })
  log(`远端树：${tree.sha.slice(0, 7)}（${entries.length} 个条目）`)

  const message = value('message') ?? git(['log', '-1', '--pretty=%B']).trim()
  const commit = await api(`/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: tree.sha,
      parents: parentSha ? [parentSha] : [],
      author: { name: git(['log', '-1', '--pretty=%an']).trim(), email: git(['log', '-1', '--pretty=%ae']).trim() },
    }),
  })
  log(`远端提交：${commit.sha.slice(0, 7)}`)

  if (parentSha) {
    await api(`/repos/${owner}/${repo}/git/refs/heads/${target}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    })
  } else {
    await api(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${target}`, sha: commit.sha }),
    })
  }
  log(`✓ ${owner}/${repo} 的 ${target} 已更新：https://github.com/${owner}/${repo}/commit/${commit.sha}`)
  log('本地 git 与远端已分叉（远端多了这条 API 提交），下次用 git 前先 fetch + reset。')
}

const main = async () => {
  if (!existsSync('.git')) {
    console.error('当前目录不是 git 仓库')
    process.exit(2)
  }

  if (forceApi) {
    await pushViaApi()
    return
  }

  try {
    pushViaGit()
    return
  } catch (error) {
    log(`git push 失败：${scrub(error.stderr || error.message).split('\n')[0]}`)
    if (!TOKEN) {
      log('没有 GITHUB_TOKEN，无法切 API 兜底。设置环境变量后重试：')
      log('  $env:GITHUB_TOKEN=\'…\'; node tools/publish-github.mjs --api')
      process.exit(1)
    }
    log('切到 Git Data API …')
    await pushViaApi()
  }
}

main().catch((error) => {
  console.error(scrub(error.message))
  process.exit(1)
})
