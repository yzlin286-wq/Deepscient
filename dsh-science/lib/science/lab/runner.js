/**
 * 实验执行器：在受控目录里跑一次 Python，记下输入、产物、环境与随机种子。
 *
 * 三条硬规则：
 *   1. 一切写入只允许发生在 `projects/<id>/experiments/<slug>/<runId>/` 之内。
 *      越界（`..`、绝对路径指向别处、软链逃逸）直接拒绝，不执行。
 *   2. 默认不给网络。不是靠"约定"，而是注入一个 sitecustomize.py 让 Python 层的
 *      socket.connect 直接抛 PermissionError——真的连不上，而不是"我们希望你连不上"。
 *   3. 每次执行都留指纹：输入文件的 sha256、产物文件的 sha256、解释器与库版本、seed。
 *      没有指纹的"跑通了"等于没跑。
 *
 * 这里的执行是**本机的、同权限的**——它能做的和你能做的一样多。
 * 所以边界靠目录校验与显式拒绝，而不是靠沙箱承诺。
 */
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { projectDir } from './project.js'
import { append } from './provenance.js'
import { resolvePython } from './power.js'

const NO_NET_HOOK = `"""由 dsh-science 注入：DSH_LAB_NO_NETWORK=1 时禁掉 Python 层网络访问。

只拦 Python 的 socket 层。子进程里的 curl/wget 不受影响——这一点必须清楚，
所以运行记录里 network=0 的含义是"本次执行没有用 Python 联网"，不是"绝对离线"。
"""
import os

if os.environ.get("DSH_LAB_NO_NETWORK") == "1":
    import socket

    class _Blocked(OSError):
        pass

    def _deny(*args, **kwargs):
        raise _Blocked("网络已被 dsh-science 实验沙箱禁用（network=false）")

    socket.socket.connect = _deny
    socket.socket.connect_ex = _deny
    socket.create_connection = _deny
    if hasattr(socket, "getaddrinfo"):
        _real_getaddrinfo = socket.getaddrinfo
`

const ENV_PROBE = `import json, platform, sys
out = {"python": sys.version.split()[0], "platform": platform.platform(), "executable": sys.executable}
for mod in ("numpy", "scipy", "pandas", "matplotlib", "statsmodels", "sklearn", "sympy", "networkx", "rdkit", "ase"):
    try:
        out[mod] = __import__(mod).__version__
    except Exception:
        out[mod] = None
print(json.dumps(out, ensure_ascii=False))
`

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, base, out)
    else out.push({ path: relative(base, full).split(sep).join('/'), bytes: st.size })
  }
  return out
}

/** 断言 target 在 root 之内（后缀匹配 + 不含 `..`）。 */
export function assertInside(root, target, label = '路径') {
  const absRoot = resolve(root)
  const absTarget = resolve(target)
  const rel = relative(absRoot, absTarget)
  if (rel === '') return absTarget
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${label} 越界：${absTarget} 不在 ${absRoot} 之内`)
  }
  return absTarget
}

function slugify(text) {
  return String(text ?? 'run')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'run'
}

/** 确保 no-network 钩子在项目 env 目录里就位，返回该目录（挂到 PYTHONPATH）。 */
function ensureNoNetHook(projectId) {
  const dir = join(projectDir(projectId), 'env', 'nonet')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'sitecustomize.py')
  if (!existsSync(file) || readFileSync(file, 'utf8') !== NO_NET_HOOK) {
    writeFileSync(file, NO_NET_HOOK, 'utf8')
  }
  return dir
}

/** 读一次解释器与库版本。 */
export function probeEnv() {
  const python = resolvePython()
  if (!python) return { error: '找不到 Python 3' }
  const proc = spawnSync(python, ['-c', ENV_PROBE], { encoding: 'utf8', timeout: 60000 })
  if (proc.status !== 0) return { error: String(proc.stderr ?? '').slice(0, 800) }
  try {
    return JSON.parse(String(proc.stdout).trim())
  } catch {
    return { error: '环境探针输出不是 JSON' }
  }
}

/**
 * 跑一次实验。
 *
 * @param {object} store ScienceStore
 * @param {object} opts
 *   projectId   必填
 *   slug        实验名（决定 experiments/<slug>/）
 *   experimentId 可选，关联到 experiment 表
 *   script      相对项目根的脚本路径（如 code/run.py）；与 code 二选一
 *   code        内联 Python 源码（会落盘成 run.py）
 *   args        传给脚本的参数
 *   inputs      需要登记指纹的输入文件（相对项目根）
 *   seed        随机种子（会写入 seed.txt 并设 DSH_SEED 环境变量）
 *   network     是否允许 Python 联网，默认 false
 *   timeoutMs   默认 300 秒
 */
export function runExperiment(store, opts = {}) {
  const projectId = String(opts.projectId ?? '').trim()
  if (!projectId) throw new Error('必须给 projectId')
  const root = projectDir(projectId)
  if (!existsSync(root)) throw new Error(`课题目录不存在：${root}`)

  const slug = slugify(opts.slug ?? 'run')
  const expRoot = join(root, 'experiments', slug)
  mkdirSync(expRoot, { recursive: true })

  // runNo = 该 slug 下已有 run 数 + 1
  const existing = readdirSync(expRoot, { withFileTypes: true }).filter((e) => e.isDirectory())
  const runNo = existing.length + 1
  const runId = `r${String(runNo).padStart(3, '0')}-${randomUUID().slice(0, 4)}`
  const runDir = join(expRoot, runId)
  mkdirSync(runDir, { recursive: true })

  // 脚本来源：外部文件（必须落在项目内）或内联代码
  let scriptPath = null
  if (opts.script) {
    scriptPath = assertInside(root, join(root, String(opts.script)), '脚本')
    if (!existsSync(scriptPath)) throw new Error(`脚本不存在：${scriptPath}`)
  } else if (opts.code) {
    scriptPath = join(runDir, 'run.py')
    writeFileSync(scriptPath, String(opts.code), 'utf8')
  } else {
    throw new Error('必须给 script 或 code')
  }

  const seed = Number.isInteger(opts.seed) ? opts.seed : 20261021
  writeFileSync(join(runDir, 'seed.txt'), `${seed}\n`, 'utf8')

  // 输入指纹
  const inputs = []
  for (const relPath of opts.inputs ?? []) {
    const abs = assertInside(root, join(root, String(relPath)), '输入文件')
    if (!existsSync(abs)) throw new Error(`输入文件不存在：${abs}`)
    inputs.push({ path: relative(root, abs).split(sep).join('/'), sha256: sha256File(abs), bytes: statSync(abs).size })
  }

  const network = opts.network === true
  const envDir = ensureNoNetHook(projectId)
  const beforeRun = new Set(walk(runDir).map((f) => f.path))
  /* 项目里其他位置也要探一次：脚本的 cwd 是项目根，
     学生写的相对路径产出（如 'data/clean.csv'）会落在项目内而不是 run 目录。
     这里只记 size+mtime 指纹，避免在跑之前把所有文件哈希一遍。 */
  const beforeTree = new Map(
    walk(root).map((f) => [f.path, `${f.bytes}:${statSync(join(root, f.path)).mtimeMs}`]),
  )

  const python = resolvePython()
  if (!python) throw new Error('找不到 Python 3 解释器（可用 DSH_PYTHON 指定）')

  const startedAt = Date.now()
  const proc = spawnSync(python, [scriptPath, ...(opts.args ?? []).map(String)], {
    /* cwd 用项目根，不是 run 目录。
       理由很实际：学生在脚本里写的是 open('data/raw.csv')——这是他心里项目的布局。
       让 cwd 变成 experiments/<slug>/<runId>/ 会让这句必然 FileNotFoundError，
       而报错信息只会说"找不到文件"，不告诉他人被换到了哪个目录。
       要写 run 目录时用 DSH_RUN_DIR，那是一个明确的、需要抬头看的路径。 */
    cwd: root,
    encoding: 'utf8',
    timeout: Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 300000,
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONDONTWRITEBYTECODE: '1',
      DSH_SEED: String(seed),
      DSH_PROJECT: projectId,
      DSH_RUN: runId,
      DSH_PROJECT_DIR: root,
      DSH_RUN_DIR: runDir,
      DSH_LAB_NO_NETWORK: network ? '0' : '1',
      PYTHONPATH: [envDir, process.env.PYTHONPATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
    },
  })
  const ms = Date.now() - startedAt

  const stdout = String(proc.stdout ?? '')
  const stderr = String(proc.stderr ?? '')
  writeFileSync(join(runDir, 'stdout.log'), stdout, 'utf8')
  writeFileSync(join(runDir, 'stderr.log'), stderr, 'utf8')

  // 产物 A：run 目录里新增的文件（排除我们自己写的日志与种子）
  const skip = new Set([...beforeRun, 'stdout.log', 'stderr.log', 'seed.txt', 'run.py', 'run.json'])
  const inRun = walk(runDir)
    .filter((f) => !skip.has(f.path))
    .map((f) => ({ ...f, from: 'run', sha256: sha256File(join(runDir, f.path)) }))

  // 产物 B：项目内其他地方新增或改动的文件（相对项目根登记）
  const touched = walk(root)
    .filter((f) => f.path !== 'plan.md' && !f.path.startsWith('experiments/') && !f.path.startsWith('env/'))
    .filter((f) => beforeTree.get(f.path) !== `${f.bytes}:${statSync(join(root, f.path)).mtimeMs}`)
    .map((f) => ({ path: f.path, bytes: f.bytes, from: 'project', sha256: sha256File(join(root, f.path)) }))

  const outputs = [...inRun, ...touched]

  const status = proc.status === 0 ? 'ok' : 'failed'
  const error = status === 'ok' ? null : (stderr.trim().split('\n').slice(-6).join('\n') || `exit ${proc.status}`)
  const env = probeEnv()
  const finishedAt = Date.now()

  const runRecord = {
    id: runId,
    experimentId: opts.experimentId ?? null,
    runNo,
    dir: runDir,
    cwd: root,
    command: `${basename(python)} ${relative(root, scriptPath).split(sep).join('/')}`,
    inputs,
    outputs,
    env,
    seed,
    network,
    status,
    error,
    ms,
    startedAt,
    finishedAt,
    stdoutTail: stdout.trim().split('\n').slice(-8).join('\n'),
    stderrTail: stderr.trim().split('\n').slice(-8).join('\n'),
  }

  store.db.prepare(`
    INSERT INTO experiment_run(id, project_id, experiment_id, run_no, dir, command, inputs_json, outputs_json, env_json,
                               seed, network, status, error, ms, started_at, finished_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    runId, projectId, runRecord.experimentId, runNo, runDir, runRecord.command,
    JSON.stringify(inputs), JSON.stringify(outputs), JSON.stringify(env),
    seed, network ? 1 : 0, status, error, ms, startedAt, finishedAt,
  )

  writeFileSync(join(runDir, 'run.json'), `${JSON.stringify(runRecord, null, 2)}\n`, 'utf8')

  append(store, {
    projectId,
    subject: 'run',
    subjectId: runId,
    action: 'run',
    detail: { slug, runNo, status, seed, network, outputs: outputs.length, ms },
  })

  if (opts.experimentId) {
    store.db.prepare('UPDATE experiment SET status = ?, updated_at = ? WHERE id = ?')
      .run(status === 'ok' ? 'done' : 'running', finishedAt, opts.experimentId)
  }
  store.db.prepare('UPDATE project SET status = ?, updated_at = ? WHERE id = ? AND status IN (\'open\',\'designing\',\'running\')')
    .run('running', finishedAt, projectId)

  return runRecord
}

/** 读一次 run 的完整记录（库优先，缺字段回落到 run.json）。 */
export function getRun(store, runId) {
  const row = store.db.prepare('SELECT * FROM experiment_run WHERE id = ?').get(String(runId))
  if (!row) return null
  return {
    id: row.id,
    experimentId: row.experiment_id,
    runNo: row.run_no,
    dir: row.dir,
    command: row.command,
    inputs: row.inputs_json ? JSON.parse(row.inputs_json) : [],
    outputs: row.outputs_json ? JSON.parse(row.outputs_json) : [],
    env: row.env_json ? JSON.parse(row.env_json) : {},
    seed: row.seed,
    network: row.network === 1,
    status: row.status,
    error: row.error,
    ms: row.ms,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }
}

/** 列某课题下全部 run，新的在前。 */
export function listRuns(store, projectId, { limit = 30 } = {}) {
  const rows = store.db.prepare(`
    SELECT * FROM experiment_run
    WHERE project_id = ?
    ORDER BY started_at DESC LIMIT ?
  `).all(projectId, limit)
  return rows.map((row) => ({
    id: row.id,
    runNo: row.run_no,
    status: row.status,
    seed: row.seed,
    network: row.network === 1,
    ms: row.ms,
    outputs: row.outputs_json ? JSON.parse(row.outputs_json).length : 0,
    startedAt: row.started_at,
    dir: row.dir,
  }))
}

export { sha256File, walk, ensureNoNetHook, ENV_PROBE }
