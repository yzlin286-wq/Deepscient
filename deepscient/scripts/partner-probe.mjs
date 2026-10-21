/**
 * 中转站联调探针：在终端里逐条走「ping → 套餐 → 同步 → 购买 → 额度 → 订单」。
 *
 * 为什么不另写一份签名：签名算法抄错一次，表现只是「偶发 401」，排查成本极高。
 * 这里直接 import host/relay.js，跑通的签名就是服务端在用的那份。
 *
 * 两条纪律：不打印明文 api_key / app_secret / 签名头；失败只给业务码与消息。
 */
import { join } from 'node:path'

import {
  PartnerError,
  createAccountUrl,
  createBuyUrl,
  getOrder,
  listPlans,
  ping,
  syncUser,
} from '../host/relay.js'

// 与 verify-deepscient.mjs 同一种做法：不指定数据根时钉到本实例，
// 否则开发 shell 里的 $DSH_HOME 可能指着另一个实例，读不到 secret 文件。
if (!process.env.DSH_HOME) {
  process.env.DSH_HOME = join(process.env.USERPROFILE || process.env.HOME, '.deepscient')
}

const USAGE = `用法：node deepscient/scripts/partner-probe.mjs <动作> [选项]

动作（一次只跑一个）：
  --ping                      连通自检：打印 app_id、ts、耗时
  --plans                     在售套餐表：plan_id、标题、实付价、时长、折合额度、分组
  --sync <external_uid>       同步账号，可加 --name <display_name>
  --buy <external_uid>        换取一次性购买页地址，可加 --plan <plan_id>
  --account <external_uid>    换取一次性「我的额度」页地址
  --order <trade_no>          查订单：状态、金额、套餐、生效/到期、webhook.status

通用选项：
  --home <dir>  指定 DSH_HOME（读 secret 与本地订单库用），默认 ~/.deepscient
  --help        打印这段用法

示例：
  node deepscient/scripts/partner-probe.mjs --ping
  node deepscient/scripts/partner-probe.mjs --sync u_probe_001 --name 联调用户
  node deepscient/scripts/partner-probe.mjs --buy u_probe_001 --plan 1
  node deepscient/scripts/partner-probe.mjs --order <trade_no>

注意：
  - 不打印明文 api_key，只给掩码；需要核对 Key 就比对掩码。
  - --buy / --account 给出的链接 300 秒内一次性有效，别长期保存。
  - 失败时输出 "[业务码] 消息" 并以退出码 1 结束；业务码为空表示网络层失败。
`

/** 逐项取参数。值必须紧跟开关，且不能是另一个开关——少写一个 uid 时应该报错而不是静默跑 --ping。 */
function parseArgs(argv) {
  const options = { action: '', value: '', plan: null, name: '', home: '', help: false }
  let action = ''

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }

    const takeValue = () => {
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) return ''
      i += 1
      return next
    }

    if (arg === '--home') {
      options.home = takeValue()
      if (!options.home) throw new Error('--home 需要一个目录')
      continue
    }
    if (arg === '--name') {
      options.name = takeValue()
      if (!options.name) throw new Error('--name 需要一个展示名')
      continue
    }
    if (arg === '--plan') {
      const raw = takeValue()
      // 只认正整数：把 NaN 发给中转站只会换回一个看不懂的 40001。
      const plan = Number(raw)
      if (!raw || !Number.isInteger(plan) || plan <= 0) throw new Error('--plan 需要一个正整数 plan_id')
      options.plan = plan
      continue
    }

    const key = arg.replace(/^--/, '')
    if (['ping', 'plans', 'sync', 'buy', 'account', 'order'].includes(key)) {
      if (action && action !== key) throw new Error('一次只跑一个动作，请去掉多余参数')
      action = key
      options.action = key
      if (key !== 'ping' && key !== 'plans') options.value = takeValue()
      continue
    }

    throw new Error(`不认识的参数：${arg}`)
  }

  return options
}

/** 按显示宽度补齐：中文占两格，否则表格会歪。 */
function displayWidth(text) {
  let width = 0
  for (const ch of String(text)) {
    width += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 2 : 1
  }
  return width
}

function padCell(text, width) {
  const value = String(text ?? '')
  return value + ' '.repeat(Math.max(0, width - displayWidth(value)))
}

function printTable(headers, rows) {
  const widths = headers.map((header, index) =>
    Math.max(displayWidth(header), ...rows.map((row) => displayWidth(row[index] ?? ''))),
  )
  const line = (cells) => cells.map((cell, index) => padCell(cell, widths[index])).join('  ').trimEnd()
  console.log(line(headers))
  console.log(widths.map((width) => '-'.repeat(width)).join('  '))
  for (const row of rows) console.log(line(row))
}

/** 秒级时间戳转本地时间；0 / 空值给 —，不渲染 1970 年那种假时间。 */
function formatTime(value) {
  return Number(value) > 0 ? new Date(Number(value) * 1000).toLocaleString() : '—'
}

function formatDuration(plan) {
  const value = plan.duration_value ?? ''
  const unit = plan.duration_unit ?? ''
  return value === '' && !unit ? '—' : `${value} ${unit}`.trim()
}

function printBinding(binding) {
  console.log(`externalUid   ${binding.externalUid || '—'}`)
  console.log(`userId        ${binding.userId ?? '—'}`)
  console.log(`username      ${binding.username || '—'}`)
  console.log(`apiBaseUrl    ${binding.apiBaseUrl || '—'}`)
  console.log(`apiKeyMasked  ${binding.apiKeyMasked || '—'}`)
  console.log(`syncedAt      ${binding.syncedAt || '—'}`)
}

async function run(options) {
  if (options.action === 'ping') {
    const startedAt = Date.now()
    const data = await ping()
    // 耗时在本地量：客户端不知道请求何时离开网卡，只能给一个「能感觉到的往返」。
    console.log(`app_id  ${data?.app_id ?? '—'}`)
    console.log(`ts      ${data?.ts ?? '—'}（${formatTime(data?.ts)}）`)
    console.log(`耗时    ${Date.now() - startedAt}ms`)
    return
  }

  if (options.action === 'plans') {
    const plans = await listPlans()
    if (plans.length === 0) {
      console.log('没有读到套餐：检查 secret、网络与 CCAGENT_PARTNER_BASE。')
      return
    }
    printTable(
      ['plan_id', '标题', '实付价', '时长', '折合额度', '分组'],
      plans.map((plan) => [
        plan.plan_id ?? '—',
        plan.title ?? '—',
        plan.price ? `${plan.price} ${plan.currency ?? 'CNY'}` : '—',
        formatDuration(plan),
        plan.quota_value ?? '—',
        plan.group ?? '—',
      ]),
    )
    return
  }

  if (options.action === 'sync') {
    if (!options.value) throw new Error('--sync 需要一个 external_uid')
    const binding = await syncUser(options.value, { displayName: options.name || undefined })
    console.log('同步完成（中转站幂等：同一 uid 不会换 Key）')
    printBinding(binding)
    return
  }

  if (options.action === 'buy') {
    if (!options.value) throw new Error('--buy 需要一个 external_uid')
    const data = await createBuyUrl({ externalUid: options.value, planId: options.plan })
    console.log(`url         ${data?.url ?? '—'}`)
    console.log(`ticket      ${data?.ticket ?? '—'}`)
    console.log(`expires_in  ${data?.expires_in ?? '—'} 秒（一次性，打开后即失效）`)
    return
  }

  if (options.action === 'account') {
    if (!options.value) throw new Error('--account 需要一个 external_uid')
    const data = await createAccountUrl(options.value)
    console.log(`url  ${data?.url ?? '—'}`)
    return
  }

  if (options.action === 'order') {
    if (!options.value) throw new Error('--order 需要一个 trade_no')
    const order = await getOrder(options.value)
    console.log(`trade_no    ${order?.trade_no ?? '—'}`)
    console.log(`status      ${order?.status ?? '—'}`)
    console.log(`金额        ${order?.amount ?? '—'} ${order?.currency ?? 'CNY'}`)
    console.log(`套餐        ${order?.plan_title ?? '—'}${order?.plan_id ? `（plan_id ${order.plan_id}）` : ''}`)
    console.log(`生效        ${formatTime(order?.start_time)}`)
    console.log(`到期        ${formatTime(order?.end_time)}`)
    // webhook.status 是排查推送失败的关键：delivered / dead 比订单状态更能说明「我们为什么没收到」。
    console.log(`webhook     ${order?.webhook?.status ?? '—'}`)
    if (order?.webhook?.event_id) console.log(`event_id    ${order.webhook.event_id}`)
    if (order?.webhook?.attempts !== undefined) console.log(`attempts    ${order.webhook.attempts}`)
    return
  }

  console.log(USAGE)
}

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`[参数] ${error.message}\n`)
    console.log(USAGE)
    process.exitCode = 1
    return
  }

  if (options.home) process.env.DSH_HOME = options.home
  if (options.help || !options.action) {
    console.log(USAGE)
    return
  }

  try {
    await run(options)
  } catch (error) {
    // 只报业务码与消息：上游 message 里没有 secret，堆栈里也没有。
    // status 0 是「请求根本没发出去」（通常是没配 secret），不能印成 [0]——那会和成功码 0 混。
    if (error instanceof PartnerError) {
      const tag = error.code ?? (error.status === 0 ? 'config' : `http ${error.status}`)
      console.error(`[${tag}] ${error.message}`)
    } else {
      console.error(`[error] ${error?.message || String(error)}`)
    }
    process.exitCode = 1
  }
}

await main()
