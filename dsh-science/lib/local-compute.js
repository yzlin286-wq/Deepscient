/**
 * @local/dsh-science —— 本地科学计算工具（preset 平面）。
 *
 * 三件事，全部在本机做，不联网：
 *   1. `local_compute_devices`：探测 python / numpy / scipy / sympy / torch，
 *      按 CUDA → MPS（仅 macOS）→ CPU 给出推荐后端与实际可用后端；
 *   2. `local_numeric`：线代、特征值、线性求解、积分、优化、FFT、描述统计；
 *   3. `local_symbolic`：化简、求导、积分、解方程、级数展开、LaTeX。
 *
 * 实现取「写临时脚本 + 传 args.json」，而不是 `python -c`：
 * Windows 命令行引号会把跨行代码撕碎，临时文件没有这个问题；脚本目录用完即删。
 * 依赖缺失（没装 python / 没装 sympy）返回可读的缺项，不抛栈。
 */
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const PREAMBLE = `import json, os, sys, math, time
HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(HERE, 'args.json'), encoding='utf-8') as fh:
    ARGS = json.load(fh)
def emit(value):
    print(json.dumps(value, ensure_ascii=False, default=str))
`

/** 解析运行中的 dsh 提供的 defineTool（与 tools.js 同一套兜底策略）。 */
function loadDefineTool() {
  const { resolveDshToolsPackage } = createRequire(import.meta.url)('./tools.js')
  const mod = resolveDshToolsPackage()
  const fn = mod && (mod.defineTool || (mod.default && mod.default.defineTool))
  if (typeof fn !== 'function') throw new Error('dsh-science/local-compute: @deepseek-ai/dsh-tools has no defineTool export')
  return fn
}

/* defineTool 延迟到 apply 里解析：这样本模块可以被测试脚本直接 import 而不依赖 dsh 运行时。 */
const defineToolLazy = () => loadDefineTool()

export const name = 'dsh-science-local-compute'

export const inject = ['tools']

/** python 解释器：允许用 DEEPSCIENT_PYTHON 指定，默认 PATH 上的 python。 */
export function pythonBin() {
  const custom = String(process.env.DEEPSCIENT_PYTHON ?? '').trim()
  return custom || 'python'
}

/**
 * 跑一段 python：脚本与 args.json 落在同一个临时目录，stdout 必须是单行 JSON。
 * @param script - python 源码（应包含 PREAMBLE）。
 * @param args - 传给脚本的参数对象。
 * @param timeoutMs - 超时。
 * @returns `{ ok, value?, error?, stderr? }`
 */
export async function runPython(script, args = {}, timeoutMs = 60000) {
  const dir = mkdtempSync(join(tmpdir(), 'ds-compute-'))
  const file = join(dir, 'run.py')
  writeFileSync(file, script, 'utf8')
  writeFileSync(join(dir, 'args.json'), JSON.stringify(args), 'utf8')
  const started = Date.now()
  try {
    const { stdout, stderr } = await execFileAsync(pythonBin(), ['-u', file], {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
    })
    const line = String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '{}'
    let value = null
    try { value = JSON.parse(line) } catch { return { ok: false, error: 'python 输出不是 JSON：' + line.slice(0, 200), elapsedMs: Date.now() - started } }
    if (value && value.error) return { ok: false, error: String(value.error), value, elapsedMs: Date.now() - started }
    return { ok: true, value, stderr: String(stderr || '').slice(-400), elapsedMs: Date.now() - started }
  } catch (error) {
    const stderr = String(error?.stderr ?? '').trim()
    const message = error?.killed || error?.signal ? 'python 超时或被杀（' + (error.signal ?? 'timeout') + '）'
      : (stderr || error?.message || 'python 调用失败')
    return { ok: false, error: message.split('\n').slice(-4).join(' ').slice(0, 600), elapsedMs: Date.now() - started }
  } finally {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

export const DEVICE_SCRIPT = PREAMBLE + `
def main():
    import platform
    out = {"python": sys.version.split()[0], "platform": platform.platform(), "packages": {}, "backends": {}}
    for mod in ("numpy", "scipy", "sympy", "torch"):
        try:
            m = __import__(mod)
            out["packages"][mod] = getattr(m, "__version__", "unknown")
        except Exception as exc:
            out["packages"][mod] = None
    cuda = False
    mps = False
    if out["packages"].get("torch"):
        try:
            import torch
            cuda = bool(torch.cuda.is_available())
            backend = getattr(torch.backends, "mps", None)
            mps = bool(backend is not None and backend.is_available())
            out["torch"] = {"cuda": cuda, "mps": mps, "devices": [str(d) for d in range(torch.cuda.device_count())]}
        except Exception as exc:
            out["torch"] = {"error": str(exc)}
    out["backends"] = {"cuda": cuda, "mps": mps, "cpu": True}
    out["recommended"] = "cuda" if cuda else ("mps" if mps else "cpu")
    return out

try:
    emit(main())
except Exception as exc:
    emit({"error": type(exc).__name__ + ": " + str(exc)})
`

export const NUMERIC_SCRIPT = PREAMBLE + `
def main():
    import numpy as np
    op = ARGS.get("op")
    data = ARGS.get("data") or {}
    out = {"op": op, "numpy": np.__version__}
    if op == "describe":
        values = [float(v) for v in (data.get("values") or [])]
        if not values:
            raise ValueError("values 不能为空")
        a = np.asarray(values, dtype=float)
        from scipy import stats as st
        out.update({
            "n": int(a.size), "mean": float(a.mean()), "sd": float(a.std(ddof=1)) if a.size > 1 else None,
            "sem": float(st.sem(a)) if a.size > 1 else None,
            "min": float(a.min()), "median": float(np.median(a)), "max": float(a.max()),
            "skew": float(st.skew(a, bias=False)) if a.size > 2 else None,
            "kurtosis": float(st.kurtosis(a, bias=False)) if a.size > 3 else None,
        })
        if a.size > 1:
            t = st.t.interval(0.95, a.size - 1, loc=a.mean(), scale=st.sem(a))
            out["ci95"] = [float(t[0]), float(t[1])]
        return out
    if op == "matrix":
        a = np.asarray(data.get("a"), dtype=float)
        out["shape"] = list(a.shape)
        if a.shape[0] == a.shape[1]:
            out["det"] = float(np.linalg.det(a))
            out["rank"] = int(np.linalg.matrix_rank(a))
            if abs(out["det"]) > 1e-12:
                out["inverse"] = np.linalg.inv(a).round(10).tolist()
        b = data.get("b")
        if b is not None:
            b = np.asarray(b, dtype=float)
            out["product"] = (a @ b).round(10).tolist()
        return out
    if op == "eigen":
        a = np.asarray(data.get("a"), dtype=float)
        w, v = np.linalg.eig(a)
        order = np.argsort(-np.abs(w))
        out["eigenvalues"] = [complex(w[i]).__repr__() for i in order]
        out["eigenvectors"] = np.real(v[:, order]).round(10).tolist()
        return out
    if op == "solve":
        a = np.asarray(data.get("a"), dtype=float)
        b = np.asarray(data.get("b"), dtype=float)
        x = np.linalg.solve(a, b)
        out["x"] = x.round(10).tolist()
        out["residual"] = float(np.linalg.norm(a @ x - b))
        return out
    if op == "fft":
        values = [float(v) for v in (data.get("values") or [])]
        a = np.asarray(values, dtype=float)
        spec = np.abs(np.fft.rfft(a)) / max(a.size, 1)
        out["bins"] = int(spec.size)
        out["amplitude"] = spec[:32].round(8).tolist()
        out["dominantIndex"] = int(np.argmax(spec))
        return out
    if op == "integrate":
        from scipy import integrate
        expr = data.get("expr") or "exp(-x*x)"
        a = float(data.get("a", 0.0))
        b = float(data.get("b", 1.0))
        fn = eval("lambda x: " + expr, {"np": np, "numpy": np, "math": math, "exp": np.exp, "sin": np.sin, "cos": np.cos, "sqrt": np.sqrt, "log": np.log, "pi": np.pi})
        value, err = integrate.quad(fn, a, b)
        out.update({"value": float(value), "absError": float(err), "interval": [a, b], "expr": expr})
        return out
    if op == "optimize":
        from scipy import optimize
        expr = data.get("expr") or "(x-1)**2"
        x0 = [float(v) for v in (data.get("x0") or [0.0])]
        if len(x0) == 1:
            f = eval("lambda x: " + expr, {"np": np, "numpy": np, "math": math, "exp": np.exp, "sin": np.sin, "cos": np.cos, "sqrt": np.sqrt, "log": np.log, "pi": np.pi})
        else:
            def f(xs):
                env = {"np": np, "numpy": np, "math": math, "exp": np.exp, "sin": np.sin, "cos": np.cos, "sqrt": np.sqrt, "log": np.log, "pi": np.pi}
                for i, v in enumerate(xs):
                    env["x" + str(i + 1)] = v
                return eval(expr, env)
        result = optimize.minimize(f, x0)
        out.update({"x": [float(v) for v in np.atleast_1d(result.x)], "fun": float(result.fun), "success": bool(result.success), "message": str(result.message)})
        return out
    raise ValueError("未知 op: " + str(op))

try:
    emit(main())
except Exception as exc:
    emit({"error": type(exc).__name__ + ": " + str(exc)})
`

export const SYMBOLIC_SCRIPT = PREAMBLE + `
def main():
    import sympy as sp
    op = ARGS.get("op")
    expr_text = ARGS.get("expr") or "x"
    symbol_name = ARGS.get("symbol") or "x"
    x = sp.Symbol(symbol_name)
    env = {symbol_name: x}
    expr = sp.sympify(expr_text, locals=env)
    out = {"op": op, "sympy": sp.__version__, "input": expr_text}
    if op == "simplify":
        value = sp.simplify(expr)
    elif op == "diff":
        value = sp.diff(expr, x, int(ARGS.get("order") or 1))
    elif op == "integrate":
        if ARGS.get("lower") is not None and ARGS.get("upper") is not None:
            value = sp.integrate(expr, (x, sp.sympify(ARGS["lower"]), sp.sympify(ARGS["upper"])))
        else:
            value = sp.integrate(expr, x)
    elif op == "solve":
        value = sp.solve(sp.Eq(expr, 0), x)
    elif op == "series":
        value = sp.series(expr, x, 0, int(ARGS.get("order") or 6)).removeO()
    elif op == "latex":
        value = expr
    else:
        raise ValueError("未知 op: " + str(op))
    out["result"] = str(value)
    out["latex"] = sp.latex(value if not isinstance(value, list) else sp.Tuple(*value))
    return out

try:
    emit(main())
except Exception as exc:
    emit({"error": type(exc).__name__ + ": " + str(exc)})
`

const DEVICES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    python: { type: 'string' },
    platform: { type: 'string' },
    packages: { type: 'object', additionalProperties: true },
    backends: { type: 'object', additionalProperties: true },
    recommended: { type: 'string' },
    ok: { type: 'boolean', required: true },
    error: { type: 'string' },
  },
}

/** 统一输出 schema：结果主体用 object 承载，避免每个 op 一份巨型 schema。 */
const GENERIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    op: { type: 'string' },
    backend: { type: 'string' },
    elapsedMs: { type: 'integer' },
    result: { type: 'object', additionalProperties: true },
    error: { type: 'string' },
  },
}

const renderJson = (title) => (_args, value) => {
  const lines = [title]
  if (value.error) lines.push('失败：' + value.error)
  if (value.backend) lines.push('后端：' + value.backend)
  if (value.result) lines.push(JSON.stringify(value.result, null, 2))
  return [{ type: 'text', text: lines.join('\n') }]
}

export function apply(ctx) {
  const defineTool = defineToolLazy()
  ctx.tools.register(defineTool({
    name: 'local_compute_devices',
    description:
      'Probe the local compute stack: python version, numpy / scipy / sympy / torch, and which '
      + 'accelerator backends are actually available (CUDA, MPS on macOS, CPU). Returns the '
      + 'recommended backend in the order CUDA -> MPS -> CPU. Run this before heavy local numerics.',
    parameters: {},
    output: { schema: DEVICES_SCHEMA, render: (_args, value) => {
      const lines = ['本机算力探测']
      if (value.error) lines.push('失败：' + value.error)
      lines.push('python ' + (value.python ?? '?') + ' · ' + (value.platform ?? ''))
      const pkgs = value.packages || {}
      lines.push('包：' + Object.entries(pkgs).map(([k, v]) => k + '=' + (v ?? '缺失')).join(' | '))
      const b = value.backends || {}
      lines.push('后端：CUDA=' + Boolean(b.cuda) + ' MPS=' + Boolean(b.mps) + ' CPU=' + Boolean(b.cpu))
      lines.push('推荐：' + (value.recommended ?? 'cpu'))
      return [{ type: 'text', text: lines.join('\n') }]
    } },
    async execute() {
      const result = await runPython(DEVICE_SCRIPT, {}, 30000)
      if (!result.ok) return { ok: false, error: result.error, recommended: 'cpu' }
      const value = result.value || {}
      return { ok: true, python: value.python, platform: value.platform, packages: value.packages, backends: value.backends, recommended: value.recommended }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'local_numeric',
    description:
      'Run local numeric computation with numpy/scipy: describe (descriptive stats + 95% CI), '
      + 'matrix (shape/det/rank/inverse/product), eigen, solve (linear system), integrate '
      + '(scipy.quad over a python expression in x), optimize (scipy.minimize), fft. Everything '
      + 'runs on this machine, no network.',
    parameters: {
      op: { type: 'string', required: true, enum: ['describe', 'matrix', 'eigen', 'solve', 'integrate', 'optimize', 'fft'], description: 'Operation to run.' },
      values: { type: 'array', items: { type: 'number' }, description: 'Input values for describe / fft.' },
      a: { type: 'array', items: { type: 'array', items: { type: 'number' } }, description: 'Matrix for matrix / eigen / solve.' },
      b: { type: 'array', items: { type: 'number' }, description: 'Vector for solve, or second matrix rows for matrix.' },
      expr: { type: 'string', description: 'Python expression in x for integrate / optimize, e.g. exp(-x*x) or (x-1)**2.' },
      lower: { type: 'string', description: 'Lower bound for integrate.' },
      upper: { type: 'string', description: 'Upper bound for integrate.' },
      x0: { type: 'array', items: { type: 'number' }, description: 'Initial guess for optimize.' },
    },
    output: { schema: GENERIC_SCHEMA, render: renderJson('本地数值计算') },
    async execute(args) {
      const op = String(args.op ?? '')
      const data = {
        values: args.values, a: args.a, b: args.b, expr: args.expr,
        a_bound: args.lower, b_bound: args.upper, x0: args.x0,
      }
      /* integrate / optimize 的边界与初值都用同一套 data 字段，避免 python 侧分叉 */
      if (op === 'integrate') { data.a = Number(args.lower ?? 0); data.b = Number(args.upper ?? 1) }
      if (op === 'optimize') { data.x0 = args.x0 || [0] }
      const result = await runPython(NUMERIC_SCRIPT, { op, data }, 90000)
      if (!result.ok) return { ok: false, op, error: result.error, elapsedMs: result.elapsedMs }
      const { error, ...rest } = result.value || {}
      return { ok: true, op, backend: 'cpu', elapsedMs: result.elapsedMs, result: rest }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'local_symbolic',
    description:
      'Run local symbolic math with sympy: simplify, diff (nth order), integrate (indefinite or '
      + 'with lower/upper), solve (expr == 0), series (expansion at 0), or latex. Returns both plain '
      + 'text and LaTeX for pasting into a manuscript.',
    parameters: {
      op: { type: 'string', required: true, enum: ['simplify', 'diff', 'integrate', 'solve', 'series', 'latex'] },
      expr: { type: 'string', required: true, description: 'Sympy expression, e.g. sin(x)**2 + cos(x)**2.' },
      symbol: { type: 'string', description: 'Variable name, defaults to x.' },
      order: { type: 'integer', description: 'Derivative order or series terms.' },
      lower: { type: 'string', description: 'Definite integral lower bound.' },
      upper: { type: 'string', description: 'Definite integral upper bound.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          op: { type: 'string' },
          result: { type: 'object', additionalProperties: true },
          error: { type: 'string' },
          elapsedMs: { type: 'integer' },
        },
      },
      render: (args, value) => {
        const lines = ['符号计算 · ' + (value.op ?? args.op)]
        if (value.error) lines.push('失败：' + value.error)
        if (value.result?.result !== undefined) lines.push('结果：' + value.result.result)
        if (value.result?.latex) lines.push('LaTeX：' + value.result.latex)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const result = await runPython(SYMBOLIC_SCRIPT, {
        op: args.op, expr: args.expr, symbol: args.symbol, order: args.order,
        lower: args.lower, upper: args.upper,
      }, 60000)
      if (!result.ok) return { ok: false, op: args.op, error: result.error, elapsedMs: result.elapsedMs }
      const { error, ...rest } = result.value || {}
      return { ok: true, op: args.op, elapsedMs: result.elapsedMs, result: rest }
    },
  }))

  console.log('science: 本地科学计算工具已注册（devices / numeric / symbolic）')
}

export default { name, inject, apply }
