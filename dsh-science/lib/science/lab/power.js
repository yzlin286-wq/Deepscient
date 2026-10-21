/**
 * 样本量 / MDE：把请求交给 scripts/py/power_run.py（statsmodels），拿回结构化结果。
 *
 * 为什么走 Python 而不是在 JS 里手搓公式：功效计算有一堆边界情形（单双侧、分配比、
 * 非中心分布），statsmodels 是这些公式的事实标准。手搓一遍等于自己造一套数值，
 * 而数值错了不会报错，只会给出一个看起来合理的错误样本量——这是最坏的失败方式。
 *
 * 铁律：功效是**事前**算的。这里不提供 observed power，因为后者的信息量等于 p 值本身。
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const SCRIPT = fileURLToPath(new URL('../../../scripts/py/power_run.py', import.meta.url))

/** 找 Python 解释器：环境变量优先，其次平台默认。 */
export function resolvePython() {
  const explicit = process.env.DSH_PYTHON
  if (explicit && existsSync(explicit)) return explicit
  const candidates = process.platform === 'win32' ? ['python', 'py', 'python3'] : ['python3', 'python']
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['-c', 'import sys; print(sys.version_info[0])'], { encoding: 'utf8', timeout: 20000 })
    if (probe.status === 0 && String(probe.stdout).trim() === '3') return candidate
  }
  return null
}

/** 跑一次 Python 脚本，stdin 传 JSON，stdout 解析 JSON。 */
export function runPy(scriptPath, request, { timeoutMs = 180000, cwd } = {}) {
  const python = resolvePython()
  if (!python) return { ok: false, error: '找不到 Python 3 解释器（可用 DSH_PYTHON 指定）' }
  if (!existsSync(scriptPath)) return { ok: false, error: `脚本不存在：${scriptPath}` }
  const proc = spawnSync(python, [scriptPath], {
    input: JSON.stringify(request ?? {}),
    encoding: 'utf8',
    timeout: timeoutMs,
    cwd: cwd ?? undefined,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
  })
  if (proc.error) return { ok: false, error: `Python 启动失败：${proc.error.message}` }
  const stdout = String(proc.stdout ?? '').trim()
  const stderr = String(proc.stderr ?? '').trim()
  if (!stdout) {
    return { ok: false, error: `Python 没有输出（exit ${proc.status}）`, stderr: stderr.slice(0, 1200) }
  }
  try {
    const parsed = JSON.parse(stdout)
    if (parsed.ok === false && stderr) parsed.stderr = stderr.slice(0, 1200)
    return parsed
  } catch {
    return { ok: false, error: 'Python 输出不是 JSON', stdout: stdout.slice(0, 1200), stderr: stderr.slice(0, 1200) }
  }
}

/**
 * 计算样本量。
 * @param {object} req {kind, alpha, power, effect, ratio, kGroups, designEffect, tails}
 */
export function sampleSize(req = {}) {
  const request = {
    kind: req.kind ?? 'ttest',
    alpha: req.alpha ?? 0.05,
    power: req.power ?? 0.8,
    effect: req.effect,
    ratio: req.ratio ?? 1,
    k_groups: req.kGroups ?? 2,
    design_effect: req.designEffect ?? 1,
    tails: req.tails ?? 2,
  }
  const out = runPy(SCRIPT, request)
  if (!out.ok) return out
  return {
    ...out,
    designEffect: out.design_effect ?? 1,
    nPerGroup: out.n_per_group ?? null,
    nTotal: out.n_total ?? null,
    effectKind: out.effect_kind ?? null,
  }
}

/** 给定 n，算能检测到的最小效应。 */
export function minimumDetectableEffect({ n, alpha = 0.05, power = 0.8, kind = 'ttest', kGroups = 2, ratio = 1, tails = 2 } = {}) {
  const out = runPy(SCRIPT, { kind: 'mde', probe: kind, n, alpha, power, k_groups: kGroups, ratio, tails })
  if (!out.ok) return out
  return { ...out, nPerGroup: out.n_per_group, effectKind: out.effect_kind }
}

/**
 * 聚类设计效应：1 + (m-1)·ρ。
 * 用来把「个体数」换算成「有效样本量」，或反过来放大所需人数。
 */
export function designEffect({ clusterSize, icc }) {
  const m = Number(clusterSize)
  const rho = Number(icc)
  if (!Number.isFinite(m) || m < 1) throw new Error('clusterSize 必须 ≥1')
  if (!Number.isFinite(rho) || rho < 0 || rho > 1) throw new Error('icc 必须在 [0,1] 内')
  return {
    designEffect: 1 + (m - 1) * rho,
    icc: rho,
    clusterSize: m,
    note: 'rho=0 时等于 1（无聚类）；班级内常见 ρ≈0.1，此时 30 人的班设计效应约 3.9',
  }
}
