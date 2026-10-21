window.__ModuleLoader__.load({
  id: '@local/deepscient',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    const NS = 'deepscient'
    const API = '/deepscient/api'
    const PANEL_ID = 'science'

    /* 词典：locale/*.json 是宿主读的嵌套结构，语言服务查的是扁平点号键（dict['auth.username']）。
       所以这里放拍平后的字面量；改 JSON 要同步这里，verify-deepscient 会比对两边。 */
    const DICT_ZH = {
      "app.localData": "数据来自本机研究库",
      "app.project": "课题 {id}",
      "app.title": "DeepScient 科研工作台",
      "auth.accountHint": "在「设置 → 账号」里查看与刷新额度。",
      "auth.accountMenu": "账号",
      "auth.balanceLabel": "API 额度",
      "auth.balanceUnknown": "未知",
      "auth.canceled": "已取消授权。",
      "auth.close": "关闭",
      "auth.email": "邮箱",
      "auth.expired": "登录已过期，请重新登录。",
      "auth.expiresAt": "登录有效期至",
      "auth.failed": "没能完成，再试一次。",
      "auth.gateHint": "登录会打开官网授权页；没有账号先去官网注册。密码不经过本机。",
      "auth.gateIntro": "账号由官网 deepscient.com 管理。这里不注册、不存密码；登录只为读取你的 API 额度与充值入口。",
      "auth.gateTitle": "登录 DeepScient",
      "auth.loading": "读取中…",
      "auth.loginWith": "通过 DeepScient 登录",
      "auth.logout": "登出",
      "auth.manage": "去官网管理额度",
      "auth.notLoggedIn": "还没有登录。",
      "auth.openSettings": "账号设置",
      "auth.opening": "正在打开官网…",
      "auth.refresh": "刷新额度",
      "auth.refreshed": "额度已更新。",
      "auth.refreshing": "刷新中…",
      "auth.role": "角色",
      "auth.settings": "账号",
      "auth.stateMismatch": "这次登录已失效，请重新发起。",
      "auth.unreachable": "连不上账号服务，检查网络或实例是否还在运行。",
      "auth.updatedAt": "更新于",
      "auth.waiting": "等待官网确认授权…完成后会自动进入。",
      "auth.website": "打开官网（注册 · 额度 · 充值）",
      "billing.attribution": "你的实际用量在这把 key 上扣费；本页的 token 是本机日志的同口径汇总，金额是按价目算的预估，账单以中转站为准。",
      "billing.basis": "计费口径",
      "billing.byModel": "按模型",
      "billing.bySession": "按会话",
      "billing.colCache": "缓存命中",
      "billing.colEstimate": "预估",
      "billing.colInput": "输入",
      "billing.colLastWrite": "最后写入",
      "billing.colMask": "掩码",
      "billing.colModel": "模型",
      "billing.colNote": "说明",
      "billing.colOutput": "输出",
      "billing.colPreset": "预设",
      "billing.colSession": "会话",
      "billing.colSource": "来源",
      "billing.colTotal": "合计",
      "billing.emptyRange": "这个区间还没有用量记录。",
      "billing.indexLine": "索引：{files} 份日志，本次解析 {parsed}，复用 {reused}；生成于 {at}。",
      "billing.linkHint": "在「设置 → 科研工作台」里填中转站地址与账单页，链接就会亮起来。",
      "billing.linkPending": "链接待填：{url}",
      "billing.noKeySource": "没读到凭据来源：启动器用环境变量注入 key 时会显示在这里。",
      "billing.noZstd": "这台机器的 Node 没有 zstd 解压能力，读不了会话日志。",
      "billing.noteFallback": "计费数据来源于 New API 中转站。",
      "billing.openBill": "打开 New API 账单页",
      "billing.openRelay": "打开 New API 中转站",
      "billing.payers": "扣费主体（每个 key 各自计费）",
      "billing.range.30d": "30 天",
      "billing.range.7d": "7 天",
      "billing.range.all": "全部",
      "billing.range.today": "今天",
      "billing.skipped": "统计时跳过的部分",
      "billing.statCache": "命中缓存输入",
      "billing.statCost": "预估费用（{currency}）",
      "billing.statCostHint": "按设置里的价目估算",
      "billing.statCostNoTable": "未配置价目",
      "billing.statInput": "未命中输入",
      "billing.statOutput": "输出",
      "billing.statTotal": "总消耗",
      "billing.statTotalHint": "{n} 条模型回复",
      "billing.title": "token 计费",
      "common.cancel": "取消",
      "common.copied": "已复制",
      "common.copy": "复制",
      "common.done": "完成",
      "common.empty": "还没有数据",
      "common.loadFailed": "读不到数据",
      "common.loading": "读取中…",
      "common.no": "否",
      "common.refresh": "刷新",
      "common.retry": "重试",
      "common.save": "保存",
      "common.yes": "是",
      "docs.notPacked": "说明文档还没打包进来（deepscient/docs/*.md）。",
      "gate.status.fail": "未通过",
      "gate.status.manual": "自查",
      "gate.status.pass": "通过",
      "gate.status.skip": "未留记录",
      "gate.status.unknown": "未判定",
      "meta.description": "把选题、检索、样本量、清洗、统计、作图、写作、内审、投稿串成一条有门的流程，并在侧栏给出可直接看的研究状态面板。",
      "meta.title": "DeepScient 科研工作台",
      "overview.artifacts": "产出",
      "overview.counts": "文献 {papers} · 分析 {analyses} · 图 {figures}",
      "overview.current": "当前阶段",
      "overview.jump": "跳到流程",
      "overview.missing": "待产出",
      "overview.next": "下一步",
      "overview.noProject": "还没有课题",
      "overview.present": "已产出",
      "overview.progress": "进度 {done}/{total}（{percent}%）",
      "overview.project": "课题",
      "page.billing": "计费 · token 是真值，金额是估算",
      "page.docs": "说明 · 这套系统怎么用、边界在哪",
      "page.sources": "接入 · 文献源与检索 API 的凭据只写一个文件",
      "page.stages": "流程 · 十二个阶段与每个门凭什么通过",
      "page.tools": "工具 · 这一步会用到的后端能力与第三方技能",
      "page.workbench": "工作台 · 阶段判定与助手说的是同一套门",
      "panel.billing": "计费",
      "panel.docs": "说明",
      "panel.root": "科研工作台",
      "panel.sources": "接入",
      "panel.stages": "流程",
      "panel.tools": "工具",
      "panel.workbench": "工作台",
      "relay.account": "我的额度",
      "relay.apiBase": "模型调用基址",
      "relay.apiKey": "API Key（脱敏）",
      "relay.appId": "应用 ID",
      "relay.base": "接口基址",
      "relay.binding": "绑定账号",
      "relay.bindingNone": "尚未同步：点「同步账号」在中转站静默建号。",
      "relay.buy": "购买",
      "relay.colAction": "操作",
      "relay.colAmount": "金额",
      "relay.colPaidAt": "生效时间",
      "relay.colPlan": "套餐",
      "relay.colStatus": "状态",
      "relay.colTradeNo": "订单号",
      "relay.configured": "已配置",
      "relay.externalUid": "外部用户标识",
      "relay.noOrders": "还没有订单记录。",
      "relay.noPlans": "没有读到套餐（检查密钥、网络或中转站配置）。",
      "relay.noUrl": "中转站没有返回跳转地址",
      "relay.notConfigured": "未配置",
      "relay.notConfiguredHint": "服务端还没有读到中转站密钥。设置环境变量 CCAGENT_PARTNER_APP_SECRET，或写入下面这个本地密钥文件（权限 0600），然后刷新本页。密钥只在服务端读取，不会下发到浏览器。",
      "relay.orderStatus": "订单 {tradeNo}：{status}",
      "relay.orders": "最近订单",
      "relay.pingOk": "连通正常，延迟 {ms}ms",
      "relay.planDuration": "时长",
      "relay.planGroup": "购买后分组",
      "relay.planNote": "套餐与价格为活动价，以中转站接口实时返回为准，本页不硬编码。",
      "relay.planPrice": "实付价",
      "relay.planQuota": "折合额度",
      "relay.plans": "在售套餐",
      "relay.query": "查询",
      "relay.refresh": "刷新",
      "relay.secretPath": "<数据根>/science/partner-app-secret",
      "relay.subtitle": "账号同步、套餐购买、额度与支付回填（un.ccagent.cn）",
      "relay.sync": "同步账号",
      "relay.syncOk": "已同步",
      "relay.syncedAt": "同步时间",
      "relay.test": "测试连通",
      "relay.title": "中转站",
      "relay.userId": "中转站用户 ID",
      "relay.username": "中转站用户名",
      "relay.webhook": "支付回填地址",
      "relay.webhookHint": "需在中转站登记为 HTTPS 公网地址；本机通过反向代理或隧道暴露后再填。",
      "reason.blocking": "阻塞",
      "reason.blockingWith": "阻塞 {n}",
      "reason.selfCheck": "自查",
      "reason.todo": "待办",
      "reason.unrecorded": "未留记录",
      "reason.unrecordedWith": "未留记录 {n}",
      "reason.warning": "警告",
      "reason.warningWith": "警告 {n}",
      "settings": "科研",
      "sources.colCredential": "凭据",
      "sources.colFill": "填写",
      "sources.colSource": "数据源",
      "sources.colStatus": "状态",
      "sources.colValue": "当前值",
      "sources.colVerify": "验证",
      "sources.configured": "已配置",
      "sources.failed": "失败",
      "sources.fromEnv": "来自环境变量 ",
      "sources.hasCredential": "有凭据",
      "sources.heading": "科研 / 文献 / 检索 API",
      "sources.kindEmail": "邮箱",
      "sources.kindNone": "免填",
      "sources.missingCredential": "缺凭据",
      "sources.noCredential": "无需凭据",
      "sources.notConfigured": "未配置",
      "sources.pasteKey": "粘贴 key 后保存",
      "sources.savedAt": "已保存 {id} {at}",
      "sources.test": "测试",
      "sources.wired.declared": "已保存·工具侧尚未读取",
      "sources.wired.none": "免凭据",
      "sources.wired.runtime": "已接入工具",
      "stages.blockingCount": "{n} 阻塞",
      "stages.colGate": "门",
      "stages.colHow": "怎么过",
      "stages.colSeverity": "等级",
      "stages.colStatus": "状态",
      "stages.gates": "阶段门",
      "stages.noGates": "这个阶段没有门。",
      "stages.noProject": "还没有课题，先在工作台建一个。",
      "stages.summary": "阻塞 {blocking} · 警告 {warnings} · 未留记录 {skipped} · 自查 {manual}",
      "tools.colArtifact": "这一步的产物",
      "tools.colStage": "阶段",
      "tools.colTool": "工具",
      "tools.count": "{shown}/{total} 个工具",
      "tools.filter": "按工具名或阶段过滤",
      "tools.note": "工具只在「科研模式」预设的会话里可调；这里列的是它们各自属于哪一步。",
      "tools.skillsEmpty": "没读到技能目录。",
      "tools.skillsHeading": "随包技能（{n}）",
      "tools.skillsNote": "技能是「怎么干活」的方法笔记，助手在做对应任务时会自己读；你点不开它们，但可以据此要求它按哪本手册做。",
      "wizard.cancel": "取消",
      "wizard.field.data": "已有数据",
      "wizard.field.deadline": "截止时间",
      "wizard.field.deliverables": "目标产出",
      "wizard.field.domain": "领域",
      "wizard.field.equipment": "设备与平台",
      "wizard.field.ethics": "伦理备案",
      "wizard.field.license": "数据许可",
      "wizard.field.people": "人力",
      "wizard.field.question": "研究问题",
      "wizard.field.subjects": "可招到的样本",
      "wizard.fill": "写进输入框",
      "wizard.hint.question": "一句话写清：在什么对象里，什么相比什么，影响什么，观察多久。",
      "wizard.mandate.ask": "请先用 science_requirement_brief 的 draft 把它结构化成需求书，把缺口列给我；我补齐后再 commit 建课题。",
      "wizard.mandate.intro": "我要开一个新课题，先把需求说清楚：",
      "wizard.needQuestion": "至少填「研究问题」才能生成任务书。",
      "wizard.open": "科研需求",
      "wizard.openHint": "先花两分钟说清要研究什么，再开工",
      "wizard.ph.data": "数据集名称、来源、许可；没有就写「无」",
      "wizard.ph.deadline": "例：2027-03 投稿，或「6 个月内」",
      "wizard.ph.deliverables": "会议摘要 / 期刊论文 / 预注册 / 内部报告",
      "wizard.ph.domain": "生物医学 / 神经科学 / 心理学 / 经济学 / 计算机",
      "wizard.ph.equipment": "仪器、算力、软件；没有特别的就写「普通工作站」",
      "wizard.ph.ethics": "有批号填批号；没有就写打算走哪家伦理委员会",
      "wizard.ph.license": "数据使用协议或授权；公开数据写许可证名",
      "wizard.ph.people": "例：我一个人做，统计可以找人帮忙",
      "wizard.ph.question": "例：在 60 岁以上社区人群中，每周三次太极相比常规护理，对 6 个月内跌倒次数的影响",
      "wizard.ph.subjects": "人群、从哪里来、大致多少人",
      "wizard.start": "直接开始",
      "wizard.title": "把研究需求说清楚",
      "workbench.noPrereg": "无预注册编号",
      "workbench.prereg": "预注册 {ref}",
    }
    const DICT_EN = {
      "app.localData": "Data from the local research store",
      "app.project": "Project {id}",
      "app.title": "DeepScient Research Workbench",
      "auth.accountHint": "Review and refresh your balance under Settings → Account.",
      "auth.accountMenu": "Account",
      "auth.balanceLabel": "API balance",
      "auth.balanceUnknown": "Unknown",
      "auth.canceled": "Authorization cancelled.",
      "auth.close": "Close",
      "auth.email": "Email",
      "auth.expired": "Your sign-in expired. Please sign in again.",
      "auth.expiresAt": "Signed in until",
      "auth.failed": "That did not work. Try again.",
      "auth.gateHint": "Signing in opens the authorization page on deepscient.com. No account yet? Sign up there first. Your password never reaches this app.",
      "auth.gateIntro": "Accounts live on deepscient.com. This app does not register users or store passwords; signing in only lets it read your API balance and top-up entry.",
      "auth.gateTitle": "Sign in to DeepScient",
      "auth.loading": "Loading…",
      "auth.loginWith": "Sign in with DeepScient",
      "auth.logout": "Sign out",
      "auth.manage": "Manage balance",
      "auth.notLoggedIn": "Not signed in.",
      "auth.openSettings": "Account settings",
      "auth.opening": "Opening deepscient.com…",
      "auth.refresh": "Refresh balance",
      "auth.refreshed": "Balance updated.",
      "auth.refreshing": "Refreshing…",
      "auth.role": "Role",
      "auth.settings": "Account",
      "auth.stateMismatch": "This sign-in attempt is no longer valid. Please start again.",
      "auth.unreachable": "Could not reach the account service. Check your connection or whether the instance is still running.",
      "auth.updatedAt": "Updated",
      "auth.waiting": "Waiting for approval on deepscient.com… this will continue automatically.",
      "auth.website": "Open deepscient.com (sign up · balance · top-up)",
      "billing.attribution": "Actual usage is billed to this key; the tokens here are aggregated from local logs, the amount is an estimate from the price table, and the relay invoice is authoritative.",
      "billing.basis": "Billing basis",
      "billing.byModel": "By model",
      "billing.bySession": "By session",
      "billing.colCache": "Cache hit",
      "billing.colEstimate": "Estimate",
      "billing.colInput": "Input",
      "billing.colLastWrite": "Last write",
      "billing.colMask": "Masked key",
      "billing.colModel": "Model",
      "billing.colNote": "Note",
      "billing.colOutput": "Output",
      "billing.colPreset": "Preset",
      "billing.colSession": "Session",
      "billing.colSource": "Source",
      "billing.colTotal": "Total",
      "billing.emptyRange": "No usage recorded in this range.",
      "billing.indexLine": "Index: {files} logs, parsed {parsed} this run, reused {reused}; generated at {at}.",
      "billing.linkHint": "Fill in the relay URL and billing page under Settings → Research and the links will become active.",
      "billing.linkPending": "Link not set: {url}",
      "billing.noKeySource": "No credential source found; a key injected by the launcher through an environment variable would show here.",
      "billing.noZstd": "This Node build cannot decompress zstd, so session logs cannot be read.",
      "billing.noteFallback": "Billing data comes from the New API relay.",
      "billing.openBill": "Open the New API billing page",
      "billing.openRelay": "Open the New API relay",
      "billing.payers": "Billable accounts (each key bills separately)",
      "billing.range.30d": "Last 30 days",
      "billing.range.7d": "Last 7 days",
      "billing.range.all": "All time",
      "billing.range.today": "Today",
      "billing.skipped": "Skipped while aggregating",
      "billing.statCache": "Input (cache hit)",
      "billing.statCost": "Estimated cost ({currency})",
      "billing.statCostHint": "Estimated from the price table in settings",
      "billing.statCostNoTable": "No price table configured",
      "billing.statInput": "Input (uncached)",
      "billing.statOutput": "Output",
      "billing.statTotal": "Total tokens",
      "billing.statTotalHint": "{n} model replies",
      "billing.title": "Token billing",
      "common.cancel": "Cancel",
      "common.copied": "Copied",
      "common.copy": "Copy",
      "common.done": "Done",
      "common.empty": "Nothing here yet",
      "common.loadFailed": "Could not load data",
      "common.loading": "Loading…",
      "common.no": "No",
      "common.refresh": "Refresh",
      "common.retry": "Retry",
      "common.save": "Save",
      "common.yes": "Yes",
      "docs.notPacked": "Documentation is not bundled yet (deepscient/docs/*.md).",
      "gate.status.fail": "Failed",
      "gate.status.manual": "Self-check",
      "gate.status.pass": "Passed",
      "gate.status.skip": "Not recorded",
      "gate.status.unknown": "Unknown",
      "meta.description": "A gated path from question to submission — search, power, cleaning, statistics, figures, writing, internal review — plus a live project panel in the sidebar.",
      "meta.title": "DeepScient research workbench",
      "overview.artifacts": "Artifacts",
      "overview.counts": "{papers} papers · {analyses} analyses · {figures} figures",
      "overview.current": "Current stage",
      "overview.jump": "Open stages",
      "overview.missing": "Pending",
      "overview.next": "Next",
      "overview.noProject": "No project yet",
      "overview.present": "Produced",
      "overview.progress": "{done}/{total} stages done ({percent}%)",
      "overview.project": "Project",
      "page.billing": "Billing · token counts are real, money is an estimate",
      "page.docs": "Docs · how this system works, and where its limits are",
      "page.sources": "Sources · literature and search credentials live in one file",
      "page.stages": "Stages · twelve stages, and why each gate passes",
      "page.tools": "Tools · backend capabilities and third-party skills per stage",
      "page.workbench": "Workbench · the stage verdict and the assistant read the same gates",
      "panel.billing": "Billing",
      "panel.docs": "Docs",
      "panel.root": "Research",
      "panel.sources": "Sources",
      "panel.stages": "Stages",
      "panel.tools": "Tools",
      "panel.workbench": "Workbench",
      "relay.account": "My quota",
      "relay.apiBase": "Model API base",
      "relay.apiKey": "API key (masked)",
      "relay.appId": "App ID",
      "relay.base": "API base URL",
      "relay.binding": "Linked account",
      "relay.bindingNone": "Not synced yet: press \"Sync account\" to create one on the relay silently.",
      "relay.buy": "Buy",
      "relay.colAction": "Action",
      "relay.colAmount": "Amount",
      "relay.colPaidAt": "Effective at",
      "relay.colPlan": "Plan",
      "relay.colStatus": "Status",
      "relay.colTradeNo": "Trade no",
      "relay.configured": "Configured",
      "relay.externalUid": "External user id",
      "relay.noOrders": "No orders yet.",
      "relay.noPlans": "No plans returned (check the secret, network, or relay configuration).",
      "relay.noUrl": "The relay did not return a URL.",
      "relay.notConfigured": "Not configured",
      "relay.notConfiguredHint": "No relay secret on the server yet. Set CCAGENT_PARTNER_APP_SECRET, or write the local secret file shown below (mode 0600), then refresh. The secret is read server-side only and never sent to the browser.",
      "relay.orderStatus": "Order {tradeNo}: {status}",
      "relay.orders": "Recent orders",
      "relay.pingOk": "Reachable, {ms}ms",
      "relay.planDuration": "Duration",
      "relay.planGroup": "Group after purchase",
      "relay.planNote": "Plans and prices are promotional and come from the relay API; this page does not hardcode them.",
      "relay.planPrice": "Price",
      "relay.planQuota": "Quota",
      "relay.plans": "Plans on sale",
      "relay.query": "Query",
      "relay.refresh": "Refresh",
      "relay.secretPath": "<data-root>/science/partner-app-secret",
      "relay.subtitle": "Account sync, plans, quota and payment callbacks (un.ccagent.cn)",
      "relay.sync": "Sync account",
      "relay.syncOk": "Synced",
      "relay.syncedAt": "Synced at",
      "relay.test": "Test connection",
      "relay.title": "Relay",
      "relay.userId": "Relay user ID",
      "relay.username": "Relay username",
      "relay.webhook": "Payment callback URL",
      "relay.webhookHint": "Register this as a public HTTPS URL with the relay; expose this machine through a reverse proxy or tunnel first.",
      "reason.blocking": "Blocking",
      "reason.blockingWith": "{n} blocking",
      "reason.selfCheck": "Self-check",
      "reason.todo": "To do",
      "reason.unrecorded": "Unrecorded",
      "reason.unrecordedWith": "{n} unrecorded",
      "reason.warning": "Warning",
      "reason.warningWith": "{n} warning",
      "settings": "Research",
      "sources.colCredential": "Credential",
      "sources.colFill": "Set value",
      "sources.colSource": "Source",
      "sources.colStatus": "Status",
      "sources.colValue": "Current value",
      "sources.colVerify": "Verify",
      "sources.configured": "Configured",
      "sources.failed": "Failed",
      "sources.fromEnv": "From environment variable ",
      "sources.hasCredential": "Has credential",
      "sources.heading": "Research / literature / search APIs",
      "sources.kindEmail": "Email",
      "sources.kindNone": "None needed",
      "sources.missingCredential": "Missing credential",
      "sources.noCredential": "No credential required",
      "sources.notConfigured": "Not configured",
      "sources.pasteKey": "Paste a key, then save",
      "sources.savedAt": "Saved {id} at {at}",
      "sources.test": "Test",
      "sources.wired.declared": "Saved; tools have not read it yet",
      "sources.wired.none": "No credential needed",
      "sources.wired.runtime": "Wired to tools",
      "stages.blockingCount": "{n} blocking",
      "stages.colGate": "Gate",
      "stages.colHow": "How to pass",
      "stages.colSeverity": "Severity",
      "stages.colStatus": "Status",
      "stages.gates": "Stage gates",
      "stages.noGates": "No gates for this stage.",
      "stages.noProject": "No project yet — create one in the Workbench.",
      "stages.summary": "{blocking} blocking · {warnings} warnings · {skipped} unrecorded · {manual} self-check",
      "tools.colArtifact": "Artifact",
      "tools.colStage": "Stage",
      "tools.colTool": "Tool",
      "tools.count": "{shown}/{total} tools",
      "tools.filter": "Filter by tool or stage",
      "tools.note": "Tools are only callable inside a session using the Research preset; this list shows which stage each belongs to.",
      "tools.skillsEmpty": "Could not read the skill catalog.",
      "tools.skillsHeading": "Bundled skills ({n})",
      "tools.skillsNote": "Skills are method notes on how to do the work; the assistant reads them when the task calls for it. You cannot open them here, but you can ask it to follow a specific playbook.",
      "wizard.cancel": "Cancel",
      "wizard.field.data": "Existing data",
      "wizard.field.deadline": "Deadline",
      "wizard.field.deliverables": "Target output",
      "wizard.field.domain": "Field",
      "wizard.field.equipment": "Equipment and platforms",
      "wizard.field.ethics": "Ethics approval",
      "wizard.field.license": "Data licence",
      "wizard.field.people": "People",
      "wizard.field.question": "Research question",
      "wizard.field.subjects": "Sample you can reach",
      "wizard.fill": "Write into the input",
      "wizard.hint.question": "One sentence: in which population, what compared with what, affecting what, over how long.",
      "wizard.mandate.ask": "Start with action draft of science_requirement_brief to structure this into a requirement brief and show me the gaps; I will fill them and then commit to open the project.",
      "wizard.mandate.intro": "I am opening a new project. Here is the need, stated up front:",
      "wizard.needQuestion": "The research question is the one field required to build a mandate.",
      "wizard.open": "Research brief",
      "wizard.openHint": "Spend two minutes saying what you want to study, before any work starts",
      "wizard.ph.data": "Dataset name, source, licence; write \"none\" if you have none",
      "wizard.ph.deadline": "e.g. submit by 2027-03, or \"within six months\"",
      "wizard.ph.deliverables": "Conference abstract / journal paper / preregistration / internal report",
      "wizard.ph.domain": "Biomedical / neuroscience / psychology / economics / computer science",
      "wizard.ph.equipment": "Instruments, compute, software; write \"ordinary workstation\" if nothing special",
      "wizard.ph.ethics": "Approval id if you have one; otherwise the committee you plan to use",
      "wizard.ph.license": "Data use agreement or authorisation; name the licence for public data",
      "wizard.ph.people": "e.g. just me, with help on statistics",
      "wizard.ph.question": "e.g. In community adults over 60, tai chi three times weekly versus usual care, on falls over six months",
      "wizard.ph.subjects": "Population, where from, roughly how many",
      "wizard.start": "Start now",
      "wizard.title": "State the research need",
      "workbench.noPrereg": "No preregistration id",
      "workbench.prereg": "Preregistration {ref}",
    }

    /* ── 取数 ───────────────────────────────────────────────────────────────
       只看自己的 /deepscient/api。不用 RPC 的原因是：这套数据是「本机研究库的投影」，
       没有会话语义，也不需要经过 connection 的鉴权握手；一个同源 JSON 口就够，
       而且验证脚本可以直接 curl 它。                                          */

    async function getJson(path) {
      const res = await fetch(`${API}${withLocale(path)}`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      const text = await res.text()
      let body = null
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        throw new Error(tf('net.notJsonBody', { status: res.status, body: text.slice(0, 120) }))
      }
      if (!res.ok) throw new Error((body && (body.message || body.error)) || `HTTP ${res.status}`)
      return body
    }

    /* ── 文案（中英双语）──────────────────────────────────────────────────────
       字典值就是纯字符串，没有占位符能力，所以插值在这里自己做：{n} {id} {status}。
       语言切换由 locale 服务的 subscribe 通知，组件用 useLocaleRevision() 重渲；
       不订阅的组件在切语言后会留在旧文案上，所以凡是显示文字的地方都要调它一次。 */

    const i18n = { t: (key) => key, ctx: null }

    function tf(key, vars) {
      const raw = String(i18n.t(key) ?? key)
      if (!vars) return raw
      return raw.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole))
    }

    /** 时间一律按本机时区显示：直接切 ISO 字符串会把 UTC 日期当成本地日期。 */
    function dateText(iso) {
      try {
        return new Date(iso).toLocaleDateString()
      } catch {
        return String(iso).slice(0, 10)
      }
    }

    function dateTimeText(iso) {
      try {
        return new Date(iso).toLocaleString()
      } catch {
        return String(iso)
      }
    }

    /** 订阅语言快照；切语言或字典补注册都会 bump revision，这里跟着重渲。 */
    function useLocaleRevision() {
      const [, bump] = useState(0)
      useEffect(() => {
        const locale = i18n.ctx?.get?.('locale')
        const off = locale?.subscribe?.(() => bump((n) => n + 1))
        return typeof off === 'function' ? off : undefined
      }, [])
    }

    /** 请求带上当前语言：阶段名、门名、下一步动作由服务端按语言回。 */
    function withLocale(path) {
      if (!path) return path
      let active = 'zh'
      try {
        active = i18n.ctx?.get?.('locale')?.getLocale?.()?.active ?? 'zh'
      } catch {
        active = 'zh'
      }
      if (!active || String(active).startsWith('zh')) return path
      return path + (path.includes('?') ? '&' : '?') + 'locale=' + encodeURIComponent(active)
    }

    function useApi(path, deps = []) {
      const [state, setState] = useState({ status: 'loading', data: null, error: null })
      const [tick, setTick] = useState(0)
      useEffect(() => {
        let alive = true
        if (!path) {
          setState({ status: 'idle', data: null, error: null })
          return () => { alive = false }
        }
        setState((prev) => ({ status: prev.data ? 'refreshing' : 'loading', data: prev.data, error: null }))
        getJson(path).then(
          (data) => { if (alive) setState({ status: 'ready', data, error: null }) },
          (error) => { if (alive) setState({ status: 'error', data: null, error: error.message }) },
        )
        return () => { alive = false }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [path, tick, ...deps])
      const reload = useCallback(() => setTick((n) => n + 1), [])
      return { ...state, reload }
    }

    /** 写端点：PUT / POST / DELETE 都用它，错误统一成 throw，交给调用方显示。 */
    async function sendJson(method, path, body) {
      const res = await fetch(`${API}${path}`, {
        method,
        credentials: 'same-origin',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const text = await res.text()
      let payload = null
      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        throw new Error(tf('net.notJson', { status: res.status }))
      }
      if (!res.ok) throw new Error((payload && (payload.message || payload.error)) || `HTTP ${res.status}`)
      return payload
    }

    /** 读端点（按需触发的那种）：与 sendJson 同一套错误口径。 */
    const fetchJson = (path) => sendJson('GET', path)

    /* ── 一级面板注册表 ────────────────────────────────────────────────────
       6 个页面各占侧栏一个图标，id 与 main 的 key 必须同名：侧栏点下去的 id
       就是主栏要渲染的 key。这张表同时驱动两处注册，不可能对不上。            */

    const PAGES = [
      { key: 'workbench', order: 20, Icon: WorkbenchIcon, Component: WorkbenchPage },
      { key: 'stages', order: 21, Icon: StagesIcon, Component: StagesPage },
      { key: 'tools', order: 22, Icon: ToolsIcon, Component: ToolsPage },
      { key: 'billing', order: 23, Icon: BillingIcon, Component: BillingPage },
      { key: 'sources', order: 24, Icon: SourcesIcon, Component: SourcesPage },
      { key: 'docs', order: 25, Icon: DocsIcon, Component: DocsPage },
    ]

    const panelId = (key) => `science-${key}`

    /* ── 跨面板导航：胶囊、引导、设置里点了「计费」「接入」都要换一级面板 ─────
       拍平之后没有「页签」这个概念了，切面板就是 layout 服务的 selectPanel。   */

    const panelHost = { ctx: null }

    function requestPanel(key) {
      const page = PAGES.find((item) => item.key === key)
      if (!page) return
      try {
        panelHost.ctx?.get?.('layout')?.selectPanel?.(panelId(page.key))
      } catch {
        /* 没有 layout 服务时什么也不做：面板本来就已经在那儿了 */
      }
    }

    /* ── 选中课题：跨面板共享，切换面板不丢选择 ───────────────────────────── */

    const selection = { projectId: '', listeners: new Set() }

    function selectProject(id) {
      selection.projectId = id || ''
      selection.listeners.forEach((fn) => fn())
    }

    function useSelectedProject(projects) {
      const [id, setId] = useState(selection.projectId)
      useEffect(() => {
        const fn = () => setId(selection.projectId)
        selection.listeners.add(fn)
        return () => { selection.listeners.delete(fn) }
      }, [])
      const first = projects.data?.items?.[0]?.id ?? ''
      return [id || first, selectProject]
    }

    /* 「工作台」点阶段梯子上的某一级要展开「流程」里的同一级。
       两个面板是两个独立挂载点，中间只留一个待展开的 id。 */
    const stageJump = { id: '' }

    /** 万级以内给原数，以上给 k/M：底部胶囊位置小，别撑成一行。 */
    function formatTokens(value) {
      const n = Number(value) || 0
      if (n < 1000) return String(n)
      if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 2 : 1)}k`
      return `${(n / 1_000_000).toFixed(2)}M`
    }

    /* ── 视觉 ───────────────────────────────────────────────────────────────
       不引入任何外部 UI 库：ModuleLoader 的基线里只有 React。颜色一律走
       host/index.js 首屏注入的 --ds-* 变量（宿主 --dsw-* 优先、自带取色兜底），
       深浅色主题跟着宿主切换；文字用 currentColor 继承宿主。                  */

    /** 行内样式只认变量，不写具体色值：换主题不用改这里。 */
    const V = {
      font: 'var(--ds-font)',
      fontMono: 'var(--ds-font-mono)',
      bg: 'var(--ds-bg)',
      surface: 'var(--ds-surface)',
      surface2: 'var(--ds-surface-2)',
      surface3: 'var(--ds-surface-3)',
      fg: 'var(--ds-fg)',
      fg2: 'var(--ds-fg-2)',
      fg3: 'var(--ds-fg-3)',
      border: 'var(--ds-border)',
      borderStrong: 'var(--ds-border-strong)',
      brand: 'var(--ds-brand)',
      brandHover: 'var(--ds-brand-hover)',
      onBrand: 'var(--ds-on-brand)',
      brandSoft: 'var(--ds-brand-soft)',
      ok: 'var(--ds-ok)',
      okSoft: 'var(--ds-ok-soft)',
      warn: 'var(--ds-warn)',
      warnSoft: 'var(--ds-warn-soft)',
      err: 'var(--ds-err)',
      errSoft: 'var(--ds-err-soft)',
      info: 'var(--ds-info)',
      focus: 'var(--ds-focus)',
      radiusSm: 'var(--ds-radius-sm)',
      radiusMd: 'var(--ds-radius-md)',
      radiusLg: 'var(--ds-radius-lg)',
      radiusPill: 'var(--ds-radius-pill)',
      space1: 'var(--ds-space-1)',
      space2: 'var(--ds-space-2)',
      space3: 'var(--ds-space-3)',
      space4: 'var(--ds-space-4)',
      space5: 'var(--ds-space-5)',
      space6: 'var(--ds-space-6)',
      textXs: 'var(--ds-text-xs)',
      textSm: 'var(--ds-text-sm)',
      textMd: 'var(--ds-text-md)',
      textLg: 'var(--ds-text-lg)',
      textXl: 'var(--ds-text-xl)',
      shadow1: 'var(--ds-shadow-1)',
      shadow2: 'var(--ds-shadow-2)',
      dur: 'var(--ds-dur)',
    }

    /** 首屏 CSS 里的类名，留给随后的结构改造用；现在只做登记。 */
    const CLS = {
      page: 'ds-page',
      header: 'ds-page__header',
      body: 'ds-page__body',
      inner: 'ds-page__inner',
      h1: 'ds-h1',
      h2: 'ds-h2',
      sub: 'ds-sub',
      mono: 'ds-mono',
      num: 'ds-num',
      row: 'ds-row',
      spacer: 'ds-spacer',
      card: 'ds-card',
      cardFlat: 'ds-card ds-card--flat',
      gridStats: 'ds-grid-stats',
      chip: 'ds-chip',
      chipPass: 'ds-chip ds-chip--pass',
      chipFail: 'ds-chip ds-chip--fail',
      chipWarn: 'ds-chip ds-chip--warn',
      chipManual: 'ds-chip ds-chip--manual',
      chipSkip: 'ds-chip ds-chip--skip',
      chipInfo: 'ds-chip ds-chip--info',
      btn: 'ds-btn',
      btnPrimary: 'ds-btn ds-btn--primary',
      btnGhost: 'ds-btn ds-btn--ghost',
      btnDanger: 'ds-btn ds-btn--danger',
      btnSmall: 'ds-btn ds-btn--sm',
      iconBtn: 'ds-iconbtn',
      input: 'ds-input',
      select: 'ds-select',
      textarea: 'ds-textarea',
      scroll: 'ds-scroll',
      table: 'ds-table',
      link: 'ds-link',
      empty: 'ds-empty',
      skeleton: 'ds-skeleton',
      dialog: 'ds-dialog',
      backdrop: 'ds-backdrop',
      sr: 'ds-sr',
      live: 'ds-live',
      liveError: 'ds-live ds-live--error',
      divider: 'ds-divider',
      note: 'ds-note',
      kbd: 'ds-kbd',
      hideSm: 'ds-hide-sm',
    }

    const S = {
      panel: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: 'inherit' },
      header: {
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px',
        borderBottom: `1px solid ${V.border}`, flexWrap: 'wrap',
      },
      title: { fontSize: V.textLg, fontWeight: 600, letterSpacing: 0.2 },
      sub: { fontSize: V.textSm, opacity: 0.6 },
      spacer: { flex: 1 },
      body: { flex: 1, minHeight: 0, overflow: 'auto', padding: '16px 20px 40px' },
      card: {
        border: `1px solid ${V.border}`, borderRadius: V.radiusLg, padding: 14,
        marginBottom: 12, background: V.surface,
      },
      row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
      chip: (tone) => ({
        fontSize: V.textXs, padding: '2px 7px', borderRadius: V.radiusPill, border: '1px solid',
        borderColor: tone === 'pass' ? V.ok : tone === 'fail' ? V.err : V.borderStrong,
        color: tone === 'pass' ? V.ok : tone === 'fail' ? V.err : 'inherit',
        opacity: tone === 'skip' ? 0.6 : 1,
      }),
      ladder: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
      step: (state) => ({
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 8, fontSize: V.textSm,
        border: `1px dashed ${V.borderStrong}`,
        background: state === 'pass' ? V.okSoft : state === 'fail' ? V.errSoft : 'transparent',
        borderStyle: state === 'manual' ? 'dotted' : 'solid',
        cursor: state === 'idle' ? 'default' : 'pointer',
      }),
      table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
      th: { textAlign: 'left', padding: '6px 8px', borderBottom: `1px solid ${V.borderStrong}`, fontWeight: 600, opacity: 0.75 },
      td: { padding: '6px 8px', borderBottom: `1px solid ${V.border}`, verticalAlign: 'top' },
      mono: { fontFamily: V.fontMono, fontSize: V.textSm },
      button: {
        fontSize: V.textSm, padding: '5px 10px', borderRadius: 7, cursor: 'pointer',
        border: `1px solid ${V.borderStrong}`, background: V.surface2, color: 'inherit',
      },
      select: {
        fontSize: 12.5, padding: '5px 8px', borderRadius: 7, color: 'inherit',
        border: `1px solid ${V.borderStrong}`, background: V.surface2,
      },
      input: {
        fontSize: 12.5, padding: '5px 9px', borderRadius: 7, color: 'inherit', minWidth: 180,
        border: `1px solid ${V.borderStrong}`, background: V.surface2,
      },
      notice: { fontSize: 12.5, opacity: 0.75, lineHeight: 1.6 },
      pre: {
        fontFamily: V.fontMono, fontSize: V.textSm,
        padding: 10, borderRadius: 8, background: V.surface2, overflow: 'auto',
      },
    }

    const TONE = { pass: 'pass', fail: 'fail', skip: 'skip', manual: 'manual' }
    const REASON_KEY = {
      blocking: 'reason.blocking',
      warning: 'reason.warning',
      unrecorded: 'reason.unrecorded',
      'self-check': 'reason.selfCheck',
    }
    const REASON_TONE = { blocking: 'fail', warning: 'manual', unrecorded: 'skip', 'self-check': 'manual' }
    const reasonLabel = (reason) => tf(REASON_KEY[reason] ?? 'reason.todo')

    /* 状态位与允许的取值一一对应；未知一律退到 skip（中性灰）。 */
    const CHIP_TONE = { pass: 'pass', fail: 'fail', warning: 'manual', manual: 'manual', skip: 'skip' }

    function Chip({ status, children, dot, title }) {
      const tone = CHIP_TONE[status] ?? 'skip'
      return h(
        'span',
        { className: `ds-chip ds-chip--${tone}`, title },
        dot ? h('span', { className: 'ds-chip__dot', 'aria-hidden': 'true' }) : null,
        children ?? status,
      )
    }

    function Notice({ children }) {
      return h('div', { className: 'ds-note' }, children)
    }

    function ErrorBox({ error, onRetry, title }) {
      useLocaleRevision()
      return h(
        'div',
        { className: 'ds-empty', role: 'alert' },
        h('div', { className: 'ds-h2' }, title ?? tf('common.loadFailed')),
        h('div', { className: 'ds-mono' }, String(error)),
        onRetry ? h('button', { className: 'ds-btn', onClick: onRetry }, tf('common.retry')) : null,
      )
    }

    function Loading() {
      useLocaleRevision()
      return h(
        'div',
        { 'aria-busy': 'true', style: { display: 'flex', flexDirection: 'column', gap: 8, padding: 8 } },
        h('div', { className: 'ds-skeleton', style: { height: 14 } }),
        h('div', { className: 'ds-skeleton', style: { height: 14 } }),
        h('div', { className: 'ds-skeleton', style: { height: 60 } }),
      )
    }

    function Empty({ title, hint, action }) {
      return h(
        'div',
        { className: 'ds-empty' },
        title ? h('div', { className: 'ds-h2' }, title) : null,
        hint ? h('div', null, hint) : null,
        action ?? null,
      )
    }

    function NotReady({ reason }) {
      useLocaleRevision()
      return h(
        'div',
        { className: 'ds-empty' },
        h('div', { className: 'ds-h2' }, tf('common.notReady')),
        reason ? h('div', null, reason) : null,
      )
    }

    function StatCard({ label, value, hint }) {
      return h(
        'div',
        { className: 'ds-stat' },
        h('div', { className: 'ds-stat__label' }, label),
        h('div', { className: 'ds-stat__value' }, value),
        hint ? h('div', { className: 'ds-stat__hint' }, hint) : null,
      )
    }

    function Table({ head, children, caption }) {
      return h(
        'div',
        { className: 'ds-scroll', role: 'region', tabIndex: 0, 'aria-label': caption },
        h(
          'table',
          { className: 'ds-table' },
          head
            ? h('thead', null, h('tr', null, head.map((cell, i) => h('th', { key: i, scope: 'col' }, cell))))
            : null,
          h('tbody', null, children),
        ),
      )
    }

    function Section({ title, hint, actions, children, flat }) {
      return h(
        'section',
        { className: 'ds-card' + (flat ? ' ds-card--flat' : '') },
        h(
          'div',
          { className: 'ds-section__head' },
          h('h2', { className: 'ds-h2' }, title),
          actions ? h('div', { className: 'ds-spacer' }) : null,
          actions ?? null,
        ),
        hint ? h('div', { className: 'ds-sub' }, hint) : null,
        children,
      )
    }

    /** 已有数据、正在后台重取时的行内提示；页面按需引入，不全局挂。 */
    function Refreshing() {
      useLocaleRevision()
      return h('span', { className: 'ds-sub', role: 'status' }, tf('common.refreshing'))
    }

    /* ── 品牌 ───────────────────────────────────────────────────────────── */

    function BrandMark({ size = 22 }) {
      // 双层轨道 + 中心点：科研的"复现"母题，原创图形，不复用官方字形。
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block' } },
        h('ellipse', { cx: 12, cy: 12, rx: 10, ry: 4.4, fill: 'none', stroke: 'currentColor', strokeOpacity: 0.5, strokeWidth: 1.4, transform: 'rotate(-28 12 12)' }),
        h('ellipse', { cx: 12, cy: 12, rx: 10, ry: 4.4, fill: 'none', stroke: 'currentColor', strokeOpacity: 0.28, strokeWidth: 1.2, transform: 'rotate(32 12 12)' }),
        h('circle', { cx: 12, cy: 12, r: 2.6, fill: '#1f6f5c' }),
      )
    }

    function BrandName() {
      useLocaleRevision()
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'baseline', gap: 6, fontWeight: 600, letterSpacing: 0.2 } },
        h('span', null, 'DeepScient'),
        h('span', { style: { fontSize: '0.72em', fontWeight: 400, opacity: 0.55 } }, tf('brand.tagline')),
      )
    }

    /* ── 侧栏一级图标 ──────────────────────────────────────────────────────
       6 个页面 6 个图标，同一套笔画（1.5-1.6，currentColor，未选中降透明度），
       全部内联，不引外部资源。                                               */

    function iconShell(size, active, children) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block', opacity: active ? 1 : 0.75 } },
        children,
      )
    }

    function WorkbenchIcon({ size = 18, active }) {
      return iconShell(size, active, [
        h('rect', { key: 'a', x: 3.5, y: 4.5, width: 17, height: 15, rx: 2.5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { key: 'b', d: 'M7 15.5 L10.2 11.2 L13 13.6 L17 8.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      ])
    }

    function StagesIcon({ size = 18, active }) {
      return iconShell(size, active, [
        h('path', { key: 'a', d: 'M3.5 18.5 h4 v-4 h4 v-4 h4 v-4 h5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('circle', { key: 'b', cx: 5.5, cy: 18.5, r: 1.3, fill: 'currentColor' }),
        h('circle', { key: 'c', cx: 18.5, cy: 6.5, r: 1.3, fill: 'currentColor' }),
      ])
    }

    function ToolsIcon({ size = 18, active }) {
      return iconShell(size, active, [
        h('path', { key: 'a', d: 'M14.8 4.4a4.6 4.6 0 0 0 5.8 6.1l-9.4 9.4a2.3 2.3 0 0 1-3.3-3.3z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('circle', { key: 'b', cx: 16.6, cy: 7.4, r: 1.1, fill: 'currentColor' }),
      ])
    }

    function BillingIcon({ size = 18, active }) {
      return iconShell(size, active, [
        h('circle', { key: 'a', cx: 12, cy: 12, r: 8.3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { key: 'b', d: 'M14.2 9.1c-.6-.7-1.4-1-2.4-1-1.5 0-2.6.7-2.6 1.8 0 2.6 5 1.2 5 3.8 0 1.1-1.1 1.9-2.7 1.9-1 0-1.9-.4-2.5-1.1', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
        h('path', { key: 'c', d: 'M12 6.4v11.2', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      ])
    }

    function SourcesIcon({ size = 18, active }) {
      return iconShell(size, active, [
        h('circle', { key: 'a', cx: 6, cy: 6, r: 2.3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('circle', { key: 'b', cx: 18, cy: 6, r: 2.3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('circle', { key: 'c', cx: 12, cy: 18, r: 2.3, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }),
        h('path', { key: 'd', d: 'M8.1 6.7 L10.4 16 M15.9 6.7 L13.6 16 M8.3 6 h7.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      ])
    }

    function DocsIcon({ size = 18, active }) {
      return iconShell(size, active, [
        h('path', { key: 'a', d: 'M5 4.6h9.2L19 9.4v10H5z', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' }),
        h('path', { key: 'b', d: 'M13.9 4.9v4.6H19', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'round' }),
        h('path', { key: 'c', d: 'M8 13h7 M8 16h5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
      ])
    }

    /* ── 工作台 ─────────────────────────────────────────────────────────── */

    /* ── 总览 ────────────────────────────────────────────────────────────────
       一块屏回答四件事：这是什么课题、走到第几步、产出什么、下一步做什么。
       数据全来自 /projects/:id/overview 一次请求，不再自己拼四个接口——
       以前「当前阶段阻塞几个门」是界面自己数的，现在由服务端回真实值。 */

    const OS = {
      bar: {
        height: 6, borderRadius: V.radiusPill, overflow: 'hidden', marginTop: 8,
        background: V.surface3,
      },
      barFill: (percent) => ({
        height: '100%', width: `${Math.max(0, Math.min(100, Number(percent) || 0))}%`,
        background: V.brand, borderRadius: V.radiusPill, transition: 'width 240ms ease',
      }),
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 },
      artStage: { fontFamily: V.fontMono, fontSize: V.textXs, opacity: 0.65, flex: '0 0 auto' },
      action: { padding: '9px 0', borderTop: `1px solid ${V.border}` },
    }

    function Overview({ overview, projects, projectId, onProject, onJump }) {
      useLocaleRevision()
      if (projects.data?.available === false) return h(NotReady, { reason: projects.data.reason })
      if (overview.status === 'loading') return h(Loading)
      if (overview.error) return h(ErrorBox, { error: overview.error, onRetry: overview.reload })
      const data = overview.data
      if (!data || !data.project) return h(Notice, null, tf('overview.noProject'))

      const progress = data.progress ?? {}
      const current = progress.current ?? null
      const list = projects.data?.items ?? []
      const counters = [
        ['fail', 'reason.blockingWith', current?.blocking],
        ['manual', 'reason.warningWith', current?.warnings],
        ['skip', 'reason.unrecordedWith', current?.skipped],
        ['manual', 'reason.selfCheck', current?.manual],
      ].filter((item) => Number(item[2]) > 0)

      const artifacts = data.artifacts ?? []
      const produced = artifacts.filter((a) => a.present).length
      const actions = data.next?.actions ?? []

      return h('div', null,
        /* 1. 课题身份 */
        h('div', { style: S.card },
          h('div', { style: { ...S.row, marginBottom: 6 } },
            h('label', { className: 'ds-sr', htmlFor: 'ds-project-select' }, tf('overview.project')),
            h('select', {
              id: 'ds-project-select',
              className: 'ds-select',
              style: { maxWidth: 320 },
              value: projectId,
              onChange: (e) => onProject(e.target.value),
            }, list.map((p) => h('option', { key: p.id, value: p.id }, p.title || p.id))),
            data.project.domain ? h(Chip, { status: 'pass' }, data.project.domain) : null,
            data.project.targetJournal ? h(Chip, { status: 'pass' }, data.project.targetJournal) : null,
            h('div', { style: S.spacer }),
            h('button', {
              className: 'ds-btn ds-btn--ghost ds-btn--sm',
              disabled: overview.status === 'refreshing',
              onClick: overview.reload,
            }, tf('common.refresh')),
            overview.status === 'refreshing' ? h(Refreshing) : null,
          ),
          data.project.question ? h('div', { style: S.sub }, data.project.question) : null,
          h('div', { style: { ...S.sub, marginTop: 4 } },
            tf('overview.counts', {
              papers: data.counts?.papers ?? 0,
              analyses: data.counts?.analyses ?? 0,
              figures: data.counts?.figures ?? 0,
            })),
        ),

        /* 2. 进度 + 当前阶段 */
        h('div', { style: S.card },
          h('div', { style: { fontSize: 13, fontWeight: 600 } },
            tf('overview.progress', {
              done: progress.done ?? 0,
              total: progress.total ?? 0,
              percent: progress.percent ?? 0,
            })),
          h('div', { style: OS.bar }, h('div', { style: OS.barFill(progress.percent ?? 0) })),
          current
            ? h('div', { style: { marginTop: 10 } },
                h('div', { style: { ...S.row, marginBottom: 4 } },
                  h('div', { style: { fontSize: 13 } }, `${current.id} ${current.label}`),
                  counters.map(([tone, key, n]) => h(Chip, { key, status: tone }, tf(key, { n }))),
                  h('div', { style: S.spacer }),
                  h('button', { style: S.button, onClick: () => onJump(current.id) }, tf('overview.jump')),
                ),
                current.goal ? h('div', { style: S.sub }, current.goal) : null,
              )
            : h('div', { style: { ...S.sub, marginTop: 8 } }, tf('common.done')),
        ),

        /* 3. 产出清单 */
        h('div', { style: S.card },
          h('div', { style: { ...S.row, marginBottom: 8 } },
            h('div', { style: { fontSize: 13, fontWeight: 600 } }, tf('overview.artifacts')),
            h(Chip, { status: 'pass' }, `${tf('overview.present')} ${produced}`),
            h(Chip, { status: 'skip' }, `${tf('overview.missing')} ${artifacts.length - produced}`),
          ),
          artifacts.length === 0
            ? h('div', { style: S.sub }, tf('common.empty'))
            : h('div', { style: OS.grid },
                artifacts.map((a) => h('button', {
                  key: `${a.stageId}:${a.name}`,
                  type: 'button',
                  className: 'ds-artifact' + (a.present ? ' is-present' : ''),
                  title: a.stageLabel ?? undefined,
                  onClick: () => onJump(a.stageId),
                },
                  h('span', { style: OS.artStage }, a.stageId),
                  h('span', null, a.name),
                ))),
        ),

        /* 4. 下一步 */
        h('div', { style: S.card },
          h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, tf('overview.next')),
          actions.length === 0
            ? h(Empty, { hint: tf('common.empty') })
            : actions.map((a, i) => {
                const target = a.stageId ?? a.gate
                return h('div', { key: `${a.gate ?? ''}:${a.stageId ?? ''}:${i}`, style: OS.action },
                  h('div', { style: S.row },
                    h(Chip, { status: REASON_TONE[a.reason] ?? 'skip' }, reasonLabel(a.reason)),
                    h('div', { style: { fontSize: 13 } }, a.label ?? a.gate ?? tf('reason.todo')),
                    h('div', { style: S.spacer }),
                    target ? h('button', { style: S.button, onClick: () => onJump(target) }, tf('overview.jump')) : null,
                  ),
                  a.fix ? h('div', { style: { ...S.sub, marginTop: 3 } }, a.fix) : null,
                )
              }),
        ),
      )
    }

    function StageList({ stages, initial }) {
      useLocaleRevision()
      const [open, setOpen] = useState(initial ?? '')
      useEffect(() => { if (initial) setOpen(initial) }, [initial])
      // 换课题时收起上一组的展开项，避免把旧阶段 id 带进新项目。
      useEffect(() => { setOpen(initial ?? '') }, [stages.data?.projectId])
      if (stages.status === 'loading') return h(Loading)
      if (stages.status === 'error') return h(ErrorBox, { error: stages.error, onRetry: stages.reload })
      if (stages.data?.available === false) return h(NotReady, { reason: stages.data.reason })
      const list = stages.data?.stages ?? []
      if (!list.length) return h(Empty, { hint: tf('stages.noProject') })
      const summary = stages.data?.summary ?? {}
      return h(
        'div',
        null,
        h('div', { className: 'ds-sub', style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 } },
          tf('stages.summary', { blocking: summary.blocking ?? 0, warnings: summary.warnings ?? 0, skipped: summary.skipped ?? 0, manual: summary.manual ?? 0 }),
          stages.status === 'refreshing' ? h(Refreshing) : null),
        list.map((s) =>
          h(
            'div',
            { key: s.id, className: 'ds-card', style: { padding: 0, overflow: 'hidden' } },
            h(
              'button',
              {
                type: 'button',
                className: 'ds-stage__head',
                'aria-expanded': open === s.id,
                'aria-controls': 'stage-' + s.id,
                onClick: () => setOpen(open === s.id ? '' : s.id),
              },
              h('span', { className: 'ds-mono', style: { opacity: 0.65, width: 26 } }, s.id),
              h('span', { style: { fontWeight: 600, fontSize: 13 } }, s.label),
              h('div', { className: 'ds-spacer' }),
              s.complete ? h(Chip, { status: 'pass' }, tf('common.done')) : h(Chip, { status: s.blocking ? 'fail' : 'skip' }, s.blocking ? tf('stages.blockingCount', { n: s.blocking }) : tf('stages.incomplete')),
              h('span', { style: { opacity: 0.5 }, 'aria-hidden': 'true' }, open === s.id ? '▾' : '▸'),
            ),
            open === s.id
              ? h('div', { id: 'stage-' + s.id, style: { padding: '0 14px 14px' } },
                  h('div', { className: 'ds-sub', style: { marginBottom: 8 } }, s.goal ?? '—'),
                  h(GateTable, { gates: s.gates }))
              : null,
          ),
        ),
      )
    }

    /** 门表：id/名称、等级、状态、怎么过。未知状态一律退到「未判定」+ 中性灰。 */
    function GateTable({ gates }) {
      useLocaleRevision()
      const list = Array.isArray(gates) ? gates : []
      if (!list.length) return h(Empty, { hint: tf('stages.noGates') })
      const STATUS_KEY = {
        pass: 'gate.status.pass',
        fail: 'gate.status.fail',
        skip: 'gate.status.skip',
        manual: 'gate.status.manual',
      }
      const rows = list.map((g, i) => {
        const known = Boolean(STATUS_KEY[g.status])
        const tone = known ? g.status : 'skip'
        const fix = g.fix || ''
        const detail = g.detail || ''
        return h(
          'tr',
          { key: g.id ?? i },
          h('td', { className: 'ds-mono' },
            g.id,
            g.label ? h('div', { className: 'ds-sub' }, g.label) : null),
          h('td', null, h(Chip, { status: REASON_TONE[g.severity] ?? 'skip' }, reasonLabel(g.severity))),
          h('td', null, h(Chip, { status: tone }, tf(known ? STATUS_KEY[g.status] : 'gate.status.unknown'))),
          h('td', null,
            fix || detail || '—',
            fix && detail && fix !== detail ? h('div', { className: 'ds-sub' }, detail) : null),
        )
      })
      return h(
        Table,
        {
          caption: tf('stages.gates'),
          head: [tf('stages.colGate'), tf('stages.colSeverity'), tf('stages.colStatus'), tf('stages.colHow')],
        },
        rows,
      )
    }

    function ToolList({ tools, skills }) {
      useLocaleRevision()
      const [query, setQuery] = useState('')
      if (tools.status === 'loading') return h(Loading)
      if (tools.status === 'error') return h(ErrorBox, { error: tools.error, onRetry: tools.reload })
      if (tools.data?.available === false) return h(NotReady, { reason: tools.data.reason })
      const items = tools.data?.items ?? []
      const q = query.trim().toLowerCase()
      const filtered = q
        ? items.filter((t) => [t.name, t.stageLabel, t.stageId].some((v) => String(v ?? '').toLowerCase().includes(q)))
        : items
      const skillItems = skills.data?.items ?? []
      let skillsBody
      if (skills.status === 'loading') skillsBody = h(Loading)
      else if (skills.status === 'error') skillsBody = h(ErrorBox, { error: skills.error, onRetry: skills.reload })
      else if (skills.data?.available === false) skillsBody = h(NotReady, { reason: skills.data.reason })
      else if (skillItems.length) {
        skillsBody = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
          skillItems.map((s) => h(Chip, {
            key: s.name,
            status: 'skip',
            dot: true,
            title: s.title && s.title !== s.name ? s.name : undefined,
          }, s.title || s.name)))
      } else skillsBody = h(Empty, { hint: tf('tools.skillsEmpty') })
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h(
          Section,
          {
            title: tf('tools.colTool'),
            hint: tf('tools.note'),
            actions: h('div', { style: S.row },
              h('input', {
                className: 'ds-input',
                placeholder: tf('tools.filter'),
                'aria-label': tf('tools.filter'),
                value: query,
                onChange: (e) => setQuery(e.target.value),
              }),
              h('span', { className: 'ds-sub' }, tf('tools.count', { shown: filtered.length, total: items.length }))),
          },
          h(
            Table,
            { caption: tf('tools.colTool'), head: [tf('tools.colTool'), tf('tools.colStage'), tf('tools.colArtifact')] },
            filtered.map((t) => h('tr', { key: t.name },
              h('td', { className: 'ds-mono' }, t.name),
              h('td', null, `${t.stageId} ${t.stageLabel}`),
              h('td', { style: { opacity: 0.75 } }, (t.artifacts ?? []).join(' · ') || '—'),
            )),
          ),
        ),
        h(
          Section,
          { title: tf('tools.skillsHeading', { n: skillItems.length }), hint: tf('tools.skillsNote') },
          skillsBody,
        ),
      )
    }

    /* ── 说明：足够用的 Markdown ───────────────────────────────────────────
       不引 markdown 库（基线里没有）。只支持说明文档真正用到的语法：标题、列表、
       代码块、表格、粗体、行内代码、链接。渲染不出来就当纯文本，不会崩。       */

    function inline(text) {
      const nodes = []
      let rest = String(text)
      let key = 0
      const push = (node) => nodes.push(node)
      while (rest.length) {
        const m = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/.exec(rest)
        if (!m) { push(rest); break }
        if (m.index > 0) push(rest.slice(0, m.index))
        const token = m[0]
        if (token.startsWith('**')) push(h('strong', { key: key++ }, token.slice(2, -2)))
        else if (token.startsWith('`')) push(h('code', { key: key++, style: S.mono }, token.slice(1, -1)))
        else {
          const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(token)
          const href = String(link[2] ?? '').trim()
          // 只放行 http(s)/mailto；其余协议（javascript:、data:、相对路径）一律按纯文本渲染。
          if (/^(https?:|mailto:)/i.test(href)) {
            push(h('a', { key: key++, href, target: '_blank', rel: 'noreferrer', className: 'ds-link' }, link[1]))
          } else {
            push(link[1])
          }
        }
        rest = rest.slice(m.index + token.length)
      }
      return nodes
    }

    function Markdown({ text }) {
      const blocks = useMemo(() => {
        const out = []
        const lines = String(text ?? '').split(/\r?\n/)
        let i = 0
        while (i < lines.length) {
          const line = lines[i]
          if (/^```/.test(line)) {
            const buf = []
            i += 1
            while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i += 1 }
            i += 1
            out.push({ kind: 'code', text: buf.join('\n') })
            continue
          }
          const heading = /^(#{1,4})\s+(.*)$/.exec(line)
          if (heading) {
            const level = heading[1].length
            out.push({ kind: 'heading', level, text: heading[2] })
            i += 1
            continue
          }
          if (/^\s*\|/.test(line) && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1] ?? '')) {
            const rows = []
            while (i < lines.length && /^\s*\|/.test(lines[i])) {
              rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()))
              i += 1
            }
            out.push({ kind: 'table', rows: rows.filter((r) => !r.every((c) => /^:?-+:?$/.test(c))) })
            continue
          }
          if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
            const items = []
            while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
              items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))
              i += 1
            }
            out.push({ kind: 'list', items })
            continue
          }
          if (!line.trim()) { i += 1; continue }
          const buf = []
          while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*\||\s*([-*]|\d+\.)\s)/.test(lines[i])) {
            buf.push(lines[i]); i += 1
          }
          out.push({ kind: 'para', text: buf.join(' ') })
        }
        return out
      }, [text])

      return h('div', { style: { fontSize: 13, lineHeight: 1.75, maxWidth: 820 } },
        blocks.map((b, idx) => {
          if (b.kind === 'heading') {
            const size = b.level === 1 ? 19 : b.level === 2 ? 16 : 14
            const tag = b.level >= 4 ? 'h4' : b.level <= 2 ? 'h2' : 'h3'
            return h(tag, { key: idx, style: { fontSize: size, fontWeight: 650, margin: '18px 0 8px' } }, inline(b.text))
          }
          if (b.kind === 'code') return h('pre', { key: idx, style: S.pre }, b.text)
          if (b.kind === 'list') {
            return h('ul', { key: idx, style: { margin: '6px 0 6px 20px' } },
              b.items.map((it, j) => h('li', { key: j, style: { marginBottom: 4 } }, inline(it))))
          }
          if (b.kind === 'table') {
            const [head, ...rows] = b.rows
            return h('div', { key: idx, style: { margin: '8px 0 14px' } },
              h(Table, { head }, rows.map((r, j) => h('tr', { key: j },
                r.map((c, k) => h('td', { key: k }, inline(c)))))))
          }
          return h('p', { key: idx, style: { margin: '8px 0' } }, inline(b.text))
        }))
    }

    function Docs({ docs }) {
      useLocaleRevision()
      const [active, setActive] = useState('')
      const items = docs.data?.items ?? []
      const current = active || items[0]?.id || ''
      const doc = useApi(current ? `/docs/${current}` : null, [current])
      // 选中的那篇被删掉后，current 还停在旧 id 上会一直 404；回到第一篇。
      useEffect(() => {
        const list = docs.data?.items ?? []
        if (list.length && !list.some((d) => d.id === current)) setActive(list[0].id)
      }, [docs.data])
      if (docs.status === 'loading') return h(Loading)
      if (docs.status === 'error') return h(ErrorBox, { error: docs.error, onRetry: docs.reload })
      if (!items.length) return h(Empty, { hint: tf('docs.notPacked') })
      return h(
        'div',
        { className: 'ds-docs' },
        h('div', { className: 'ds-docs__nav' },
          items.map((d) => h('button', {
            key: d.id,
            type: 'button',
            className: 'ds-docs__item' + (d.id === current ? ' is-active' : ''),
            'aria-current': d.id === current ? 'page' : undefined,
            onClick: () => setActive(d.id),
          }, d.title))),
        h('div', { style: { flex: 1, minWidth: 0 } },
          doc.status === 'loading' ? h(Loading) : doc.status === 'error' ? h(ErrorBox, { error: doc.error, onRetry: doc.reload }) : h(Markdown, { text: doc.data?.markdown })),
      )
    }

    /* ── 计费 ───────────────────────────────────────────────────────────────
       数字全部来自 /deepscient/api/usage：它把会话日志里 provider 给的 usage 汇总起来。
       钱是按「价目 × token」算的预估——真值在中转站账单上，页面上必须写清楚。      */

    const RANGES = ['today', '7d', '30d', 'all']
    const rangeLabel = (range) => tf(`billing.range.${range}`)

    /** 金额一律过这一层：null/undefined/''/NaN 都退到 —，绝不对非数字调 toFixed。 */
    const money = (value) => {
      const n = Number(value)
      return value === null || value === undefined || value === '' || !Number.isFinite(n) ? '—' : n.toFixed(4)
    }

    /** 扣费主体表：每把 key 一行，只有掩码。 */
    function keyTable(keys) {
      const rows = (Array.isArray(keys) ? keys : []).map((k, i) => h('tr', { key: i },
        h('td', null, k.source ?? '—'),
        h('td', { className: 'ds-mono' }, k.provider ?? '—'),
        h('td', { className: 'ds-mono' }, k.masked || '—'),
        h('td', { className: 'ds-sub' }, k.note ?? '—')))

      return h('div', { style: { marginTop: 10 } },
        h('div', { className: 'ds-sub', style: { marginBottom: 4 } }, tf('billing.payers')),
        h(Table, {
          caption: tf('billing.payers'),
          head: [tf('billing.colSource'), 'provider', tf('billing.colMask'), tf('billing.colNote')],
        }, rows))
    }


    /** 按模型表。 */
    function modelTable(rows) {
      const list = Array.isArray(rows) ? rows : []
      const body = list.map((row, i) => h('tr', { key: i },
        h('td', { className: 'ds-mono' }, row.provider),
        h('td', { className: 'ds-mono' }, row.model),
        h('td', { className: 'ds-num' }, formatTokens(row.inputTokens)),
        h('td', { className: 'ds-num' }, formatTokens(row.cacheReadTokens)),
        h('td', { className: 'ds-num' }, formatTokens(row.outputTokens)),
        h('td', { className: 'ds-num' }, formatTokens(row.totalTokens)),
        h('td', { className: 'ds-num' }, money(row.cost))))

      return h(Table, {
        caption: tf('billing.byModel'),
        head: ['provider', tf('billing.colModel'), tf('billing.colInput'), tf('billing.colCache'), tf('billing.colOutput'), tf('billing.colTotal'), tf('billing.colEstimate')],
      }, body)
    }

    /** 按会话表（最多 20 行，最近的在前）。 */
    function sessionTable(rows) {
      const list = Array.isArray(rows) ? rows : []
      const body = list.slice(0, 20).map((row, i) => h('tr', { key: i },
        h('td', { className: 'ds-mono' }, row.title || row.sessionId),
        h('td', null, row.agentPreset ?? '—'),
        h('td', { className: 'ds-num' }, formatTokens(row.totalTokens)),
        h('td', { className: 'ds-num' }, money(row.cost)),
        h('td', { className: 'ds-sub' }, String(row.updatedAt ?? '').slice(0, 16).replace('T', ' '))))

      return h(Table, {
        caption: tf('billing.bySession'),
        head: [tf('billing.colSession'), tf('billing.colPreset'), tf('billing.colTotal'), tf('billing.colEstimate'), tf('billing.colLastWrite')],
      }, body)
    }

    /* ── 中转站 ─────────────────────────────────────────────────────────────
       这一块只做「账号 / 套餐 / 回填」三件事：token 与金额的真值仍走 /usage 和上游账单，
       这里不重复算钱。套餐与订单一律以接口实时返回为准，前端不硬编码价格，
       因为活动价随时会变，写死的数字只会和收银台对不上。
       未配置 secret 时后端连请求都发不出去，所以整块退化成「怎么配」的提示，
       不给按钮——点了也只会得到一个 503。                                    */

    /** 秒级时间戳转本地时间；0/空值给 —，避免渲染出 1970 年那种假时间。
        绑定时间（syncedAt）是 ISO 字符串，订单时间是秒级数字，两种都收，不能各自猜。 */
    function formatTime(value) {
      if (typeof value === 'string' && value) {
        const date = new Date(value)
        return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
      }
      return Number(value) > 0 ? new Date(Number(value) * 1000).toLocaleString() : '—'
    }

    function RelayPanel() {
      useLocaleRevision()
      const status = useApi('/partner')
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [pingInfo, setPingInfo] = useState(null)
      const [orderInfo, setOrderInfo] = useState(null)

      if (status.status === 'loading') return h(Loading)
      if (status.status === 'error') return h(ErrorBox, { error: status.error, onRetry: status.reload })

      const data = status.data ?? {}
      // secretPresent 为 false 才是「真没密钥」；字段缺失时按已配置处理，免得老后端下把按钮藏没了。
      const configured = data.secretPresent !== false
      const binding = data.binding ?? null
      const plans = data.plans ?? []
      const orders = data.orders ?? []
      const disabled = Boolean(busy)
      const actionStyle = disabled ? { ...S.button, opacity: 0.55 } : S.button

      /** 所有按钮共用一套 busy/error/notice 口径，避免每个动作各写一遍 setState。 */
      const act = async (key, fn) => {
        setBusy(key); setError(''); setNotice('')
        try { await fn() } catch (e) { setError(e?.message || String(e)) } finally { setBusy('') }
      }

      /** 跳转由后端签发的一次性地址；没有地址要明确报错，不能静默什么都不做。 */
      const openUrl = (url) => {
        if (!url) throw new Error(tf('relay.noUrl'))
        if (typeof window !== 'undefined' && window.location?.assign) window.location.assign(url)
      }

      const testPing = () => act('ping', async () => {
        const res = await sendJson('POST', '/partner/ping', {})
        setPingInfo(res)
      })

      const syncAccount = () => act('sync', async () => {
        await sendJson('POST', '/partner/sync', {})
        setNotice(tf('relay.syncOk'))
        status.reload()
      })

      const openAccount = () => act('account', async () => {
        const res = await sendJson('POST', '/partner/account-url', {})
        openUrl(res?.url)
      })

      // 按钮都在表格/行内，点击必须 stopPropagation，否则会连带触发外层的行点击。
      const buyPlan = (planId) => (event) => {
        if (event?.stopPropagation) event.stopPropagation()
        act(`buy:${planId}`, async () => {
          const res = await sendJson('POST', '/partner/buy-url', { planId })
          openUrl(res?.url)
        })
      }

      const queryOrder = (tradeNo) => (event) => {
        if (event?.stopPropagation) event.stopPropagation()
        act(`order:${tradeNo}`, async () => {
          const res = await fetchJson('/partner/orders/' + encodeURIComponent(tradeNo))
          setOrderInfo(res)
        })
      }

      const pair = (label, value, mono) => h('tr', { key: label },
        h('th', { style: { ...S.th, width: '34%', fontWeight: 500, opacity: 0.65, borderBottom: `1px solid ${V.border}` } }, label),
        h('td', { style: mono ? { ...S.td, ...S.mono } : S.td }, value || '—'))

      const headerCard = h('div', { style: S.card },
        h('div', { style: S.row },
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, tf('relay.title')),
          h(Chip, { status: configured ? 'pass' : 'skip' }, configured ? tf('relay.configured') : tf('relay.notConfigured')),
          h('div', { style: S.spacer }),
          configured
            ? h('div', { style: S.row },
                h('button', { style: actionStyle, disabled, onClick: testPing }, tf('relay.test')),
                h('button', { style: actionStyle, disabled, onClick: syncAccount }, tf('relay.sync')),
                h('button', { style: actionStyle, disabled, onClick: openAccount }, tf('relay.account')),
                pingInfo ? h(Chip, { status: 'pass' }, tf('relay.pingOk', { ms: pingInfo.latencyMs ?? '—' })) : null)
            : null),
        h('div', { style: { ...S.sub, marginTop: 4 } }, tf('relay.subtitle')),
        h('div', { style: { ...S.notice, display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 } },
          h('span', null, tf('relay.appId') + ': ', h('code', { style: S.mono }, data.appId || '—')),
          h('span', null, tf('relay.base') + ': ', h('code', { style: S.mono }, data.base || '—'))),
        configured
          ? null
          : h('div', { style: { marginTop: 10 } },
              h(Notice, null,
                h('div', null, tf('relay.notConfiguredHint')),
                h('div', { style: { ...S.mono, marginTop: 4 } }, 'CCAGENT_PARTNER_APP_SECRET'),
                h('div', { style: S.mono }, tf('relay.secretPath')))),
      )

      const bindingCard = h('div', { style: S.card },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, tf('relay.binding')),
        binding
          ? h('table', { style: S.table }, h('tbody', null,
              pair(tf('relay.externalUid'), binding.externalUid, true),
              pair(tf('relay.userId'), binding.userId, true),
              pair(tf('relay.username'), binding.username),
              pair(tf('relay.apiKey'), binding.apiKeyMasked),
              pair(tf('relay.apiBase'), binding.apiBaseUrl, true),
              pair(tf('relay.syncedAt'), formatTime(binding.syncedAt))))
          : h('div', { style: S.sub }, tf('relay.bindingNone')),
      )

      const webhookCard = h('div', { style: S.card },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, tf('relay.webhook')),
        h('div', null, h('code', { style: S.mono }, data.webhookUrl || '—')),
        h('div', { style: { ...S.notice, marginTop: 6 } }, tf('relay.webhookHint')),
      )

      const plansCard = h('div', { style: S.card },
        h('div', { style: { ...S.row, marginBottom: 8 } },
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, tf('relay.plans')),
          h('div', { style: S.spacer }),
          h('button', { style: actionStyle, disabled, onClick: () => status.reload() }, tf('relay.refresh'))),
        data.plansError
          // 拉套餐失败就说失败，绝不退回本地的假套餐：价格错一块钱都是事故。
          ? h('div', { style: { color: V.err } }, h(Notice, null, data.plansError.message || '—'))
          : plans.length === 0
            ? h('div', { style: S.sub }, tf('relay.noPlans'))
            : h('table', { style: S.table },
                h('thead', null, h('tr', null,
                  h('th', { style: S.th }, tf('relay.colPlan')),
                  h('th', { style: S.th }, tf('relay.planPrice')),
                  h('th', { style: S.th }, tf('relay.planDuration')),
                  h('th', { style: S.th }, tf('relay.planQuota')),
                  h('th', { style: S.th }, tf('relay.planGroup')),
                  h('th', { style: S.th }, tf('relay.colAction')))),
                h('tbody', null, plans.map((plan, i) => h('tr', { key: plan.planId ?? i },
                  h('td', { style: S.td },
                    h('div', null, plan.title || '—'),
                    plan.subtitle ? h('div', { style: { fontSize: 11, opacity: 0.6, marginTop: 2 } }, plan.subtitle) : null),
                  h('td', { style: S.td }, [plan.price, plan.currency].filter((v) => v !== undefined && v !== null && v !== '').join(' ') || '—'),
                  h('td', { style: S.td }, [plan.durationValue, plan.durationUnit].filter((v) => v !== undefined && v !== null && v !== '').join(' ') || '—'),
                  h('td', { style: S.td }, plan.quotaValue === null || plan.quotaValue === undefined || plan.quotaValue === '' ? '—' : String(plan.quotaValue)),
                  h('td', { style: S.td }, plan.group || '—'),
                  h('td', { style: S.td },
                    h('button', { style: actionStyle, disabled, onClick: buyPlan(plan.planId) }, tf('relay.buy'))))))),
        h('div', { style: { ...S.sub, marginTop: 8 } }, tf('relay.planNote')),
      )

      const ordersCard = h('div', { style: S.card },
        h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 8 } }, tf('relay.orders')),
        orders.length === 0
          ? h('div', { style: S.sub }, tf('relay.noOrders'))
          : h('table', { style: S.table },
              h('thead', null, h('tr', null,
                h('th', { style: S.th }, tf('relay.colTradeNo')),
                h('th', { style: S.th }, tf('relay.colPlan')),
                h('th', { style: S.th }, tf('relay.colAmount')),
                h('th', { style: S.th }, tf('relay.colStatus')),
                h('th', { style: S.th }, tf('relay.colPaidAt')),
                h('th', { style: S.th }, tf('relay.colAction')))),
              h('tbody', null, orders.map((order, i) => h('tr', { key: order.tradeNo ?? i },
                h('td', { style: { ...S.td, ...S.mono } }, order.tradeNo || '—'),
                h('td', { style: S.td }, order.planTitle || '—'),
                h('td', { style: S.td }, [order.amount, order.currency].filter((v) => v !== undefined && v !== null && v !== '').join(' ') || '—'),
                h('td', { style: S.td }, order.status || '—'),
                h('td', { style: S.td }, formatTime(order.startTime)),
                h('td', { style: S.td },
                  h('button', { style: actionStyle, disabled, onClick: queryOrder(order.tradeNo) }, tf('relay.query'))))))),
        orderInfo
          ? h('div', { style: { ...S.notice, marginTop: 8 } },
              tf('relay.orderStatus', { tradeNo: orderInfo.order?.tradeNo ?? '—', status: orderInfo.order?.status ?? '—' }))
          : null,
      )

      return h('div', null,
        headerCard,
        error ? h('div', { style: { ...S.card, borderColor: 'rgba(190,70,60,0.5)' } }, h(Notice, null, error)) : null,
        notice ? h('div', { style: S.card }, h(Notice, null, notice)) : null,
        bindingCard,
        webhookCard,
        plansCard,
        ordersCard,
      )
    }

    function BillingPanel({ usage, range, onRange, onRefresh }) {
      useLocaleRevision()
      if (usage.status === 'loading') return h(Loading)
      if (usage.status === 'error') return h(ErrorBox, { error: usage.error, onRetry: usage.reload })
      const data = usage.data ?? {}
      const totals = data.totals ?? {}
      const billing = data.billing ?? {}
      const cost = data.cost
      const keys = data.keys ?? []
      const byModel = data.byModel ?? []
      const bySession = data.bySession ?? []
      const warnings = data.warnings ?? []
      const refreshing = usage.status === 'refreshing'
      const configured = Boolean(billing.consoleUrl) || Boolean(billing.baseUrl)

      return h('div', null,
        h('div', { className: 'ds-row', style: { marginBottom: 12 } },
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, tf('billing.title')),
          h('div', { className: 'ds-spacer' }),
          RANGES.map((key) =>
            h('button', {
              key,
              className: range === key ? 'ds-btn ds-btn--primary ds-btn--sm' : 'ds-btn ds-btn--ghost ds-btn--sm',
              'aria-pressed': range === key,
              onClick: () => onRange(key),
            }, rangeLabel(key))),
          h('button', { className: 'ds-btn ds-btn--ghost ds-btn--sm', disabled: refreshing, onClick: onRefresh }, tf('common.refresh')),
          refreshing ? h(Refreshing) : null,
        ),

        h('div', { className: 'ds-grid-stats', style: { marginBottom: 12 } },
          h(StatCard, { label: tf('billing.statTotal'), value: formatTokens(totals.totalTokens), hint: tf('billing.statTotalHint', { n: totals.messages ?? 0 }) }),
          h(StatCard, { label: tf('billing.statInput'), value: formatTokens(totals.inputTokens) }),
          h(StatCard, { label: tf('billing.statCache'), value: formatTokens(totals.cacheReadTokens) }),
          h(StatCard, { label: tf('billing.statOutput'), value: formatTokens(totals.outputTokens) }),
          h(StatCard, { label: tf('billing.statCost', { currency: data.currency ?? 'CNY' }), value: cost ? money(cost.amount) : '—', hint: cost ? tf('billing.statCostHint') : tf('billing.statCostNoTable') }),
        ),

        h(Section, { title: tf('billing.basis') },
          h(Notice, null,
            h('div', null, billing.note ?? tf('billing.noteFallback')),
            h('div', { style: { marginTop: 6, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' } },
              configured && billing.consoleUrl
                ? h('a', { href: billing.consoleUrl, target: '_blank', rel: 'noreferrer', className: 'ds-link' }, tf('billing.openBill'))
                : configured && billing.baseUrl
                  ? h('a', { href: billing.baseUrl, target: '_blank', rel: 'noreferrer', className: 'ds-link' }, tf('billing.openRelay'))
                  : h('span', { className: 'ds-chip ds-chip--skip' }, tf('billing.linkPending', { url: billing.linkPlaceholder ?? 'https://<relay>' })),
              h('span', { className: 'ds-sub' }, tf('billing.linkHint')),
            ),
          ),
          keys.length > 0
            ? keyTable(keys)
            : h('div', { className: 'ds-sub', style: { marginTop: 8 } }, tf('billing.noKeySource')),
          h('div', { className: 'ds-sub', style: { marginTop: 8 } }, tf('billing.attribution')),
        ),

        byModel.length > 0
          ? h(Section, { title: tf('billing.byModel') }, modelTable(byModel))
          : h(Notice, null, data.source === 'unavailable' ? tf('billing.noZstd') : tf('billing.emptyRange')),

        bySession.length > 0 ? h(Section, { title: tf('billing.bySession') }, sessionTable(bySession)) : null,

        warnings.length > 0
          ? h(Section, { title: h('span', { className: 'ds-chip ds-chip--warn' }, tf('billing.skipped')) },
              h('ul', { className: 'ds-sub', style: { margin: '0 0 0 18px' } }, warnings.map((w, i) =>
                h('li', { key: i }, h('code', { className: 'ds-mono' }, w.file || '—'), ` ${w.reason}`))))
          : null,

        h('div', { className: 'ds-sub', style: { marginTop: 8 } },
          tf('billing.indexLine', { files: data.index?.files ?? 0, parsed: data.index?.parsed ?? 0, reused: data.index?.reused ?? 0, at: String(data.generatedAt ?? '').slice(11, 19) })),
      )
    }

    /* ── 接入 ───────────────────────────────────────────────────────────── */

    const wiredLabel = (wired) => tf(`sources.wired.${wired}`)

    function sourceStatusCell(item) {
      const nodes = [
        h(Chip, { key: 'state', status: item.configured ? 'pass' : 'skip' }, item.configured ? tf('sources.configured') : tf('sources.notConfigured')),
        h('div', { key: 'wired', style: { fontSize: 11, opacity: 0.6, marginTop: 4 } }, wiredLabel(item.wired) ?? item.wired),
      ]
      if (item.from === 'env') nodes.push(h('div', { key: 'env', style: { fontSize: 11, opacity: 0.6 } }, tf('sources.fromEnv') + item.envName))
      return h('div', null, nodes)
    }

    function sourceInputCell(item, draft, setDraft) {
      if (!item.path) return h('span', { style: { opacity: 0.5 } }, tf('sources.noCredential'))
      return h('input', {
        style: { ...S.input, minWidth: 150 },
        type: item.kind === 'email' ? 'email' : 'password',
        placeholder: item.kind === 'email' ? 'pi@lab.example' : tf('sources.pasteKey'),
        value: draft[item.id] ?? '',
        onChange: (e) => setDraft((prev) => ({ ...prev, [item.id]: e.target.value })),
      })
    }

    function verifyChip(result) {
      if (!result || !result.status || result.status === 'busy') return null
      const good = result.status === 'ok' || result.status === 'ready'
      const text = result.status === 'ok'
        ? tf('sources.verifyOk', { ms: result.ms ?? '?' })
        : result.status === 'ready'
          ? tf('sources.hasCredential')
          : result.status === 'no-credential'
            ? tf('sources.missingCredential')
            : tf('sources.failed')
      return h(Chip, { status: good ? 'pass' : 'fail' }, text)
    }

    function sourceActionCell(item, onSave, onTest, result) {
      const nodes = []
      if (item.path) nodes.push(h('button', { key: 'save', style: S.button, onClick: () => onSave(item.id) }, tf('common.save')))
      nodes.push(h('button', { key: 'test', style: S.button, onClick: () => onTest(item.id) }, tf('sources.test')))
      const chip = verifyChip(result)
      if (chip) nodes.push(h('span', { key: 'chip' }, chip))
      if (result && result.hint) nodes.push(h('div', { key: 'hint', style: { fontSize: 11, opacity: 0.65, width: '100%' } }, result.hint))
      return h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } }, nodes)
    }

    function sourceRow(item, draft, setDraft, onSave, onTest, result) {
      return h('tr', { key: item.id },
        h('td', { style: S.td },
          h('a', { href: item.applyUrl, target: '_blank', rel: 'noreferrer', style: { color: '#3fa07f' } }, item.name),
          item.hint ? h('div', { style: { fontSize: 11, opacity: 0.6, marginTop: 2 } }, item.hint) : null),
        h('td', { style: S.td }, item.kind === 'none' ? tf('sources.kindNone') : item.kind === 'email' ? tf('sources.kindEmail') : tf('sources.kindKey')),
        h('td', { style: S.td }, sourceStatusCell(item)),
        h('td', { style: { ...S.td, ...S.mono, opacity: 0.8 } }, item.masked || '—'),
        h('td', { style: S.td }, sourceInputCell(item, draft, setDraft)),
        h('td', { style: S.td }, sourceActionCell(item, onSave, onTest, result)))
    }

    function SourcesPanel({ sources }) {
      useLocaleRevision()
      const [draft, setDraft] = useState({})
      const [result, setResult] = useState({})
      const [saved, setSaved] = useState('')
      const [error, setError] = useState('')

      if (sources.status === 'loading') return h(Loading)
      if (sources.status === 'error') return h(ErrorBox, { error: sources.error, onRetry: sources.reload })

      const data = sources.data ?? {}
      const items = data.items ?? []

      const save = async (id) => {
        setError('')
        try {
          const payload = await sendJson('PUT', '/sources', { items: { [id]: draft[id] ?? '' } })
          if ((payload.rejected ?? []).length) throw new Error(payload.rejected.map((r) => r.reason).join('；'))
          setDraft((prev) => ({ ...prev, [id]: '' }))
          setSaved(tf('sources.savedAt', { id, at: new Date().toLocaleTimeString() }))
          sources.reload()
        } catch (e) {
          setError(e.message)
        }
      }

      const test = async (id) => {
        setResult((prev) => ({ ...prev, [id]: { status: 'busy' } }))
        try {
          const payload = await sendJson('POST', '/sources/verify', { id })
          setResult((prev) => ({ ...prev, [id]: payload }))
        } catch (e) {
          setResult((prev) => ({ ...prev, [id]: { status: 'fail', hint: e.message } }))
        }
      }

      const head = h('thead', null, h('tr', null,
        h('th', { style: S.th }, tf('sources.colSource')),
        h('th', { style: S.th }, tf('sources.colCredential')),
        h('th', { style: S.th }, tf('sources.colStatus')),
        h('th', { style: S.th }, tf('sources.colValue')),
        h('th', { style: S.th }, tf('sources.colFill')),
        h('th', { style: S.th }, tf('sources.colVerify'))))

      const rows = items.map((item) => sourceRow(item, draft, setDraft, save, test, result[item.id]))
      const configured = items.filter((item) => item.configured).length

      return h('div', null,
        h('div', { key: 'title', style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, tf('sources.heading')),
        h(Notice, { key: 'note' },
          h('div', null, data.note ?? tf('sources.noteDefault')),
          h('div', { style: { ...S.mono, opacity: 0.7, marginTop: 4 } }, data.path ?? '')),
        h('div', { key: 'count', style: { ...S.sub, margin: '10px 0' } }, tf('sources.count', { ready: configured, total: items.length })),
        h('table', { key: 'table', style: S.table }, head, h('tbody', null, rows)),
        error ? h(ErrorBox, { key: 'error', error }) : null,
        saved ? h('div', { key: 'saved', style: { ...S.sub, marginTop: 8 } }, saved) : null,
        h('div', { key: 'foot', style: { ...S.sub, marginTop: 12 } }, tf('sources.foot')))
    }

    /* ── 底部胶囊：只报 token 消耗量 ─────────────────────────────────────────
       出厂的用量胶囊（总 token · 缓存命中 x%）已被首屏样式摘掉；这里补一个只讲 token 的，
       点了就打开「计费」页。数据来自本机日志的汇总，不额外请求模型。               */

    /* ── 应用账号：登录门 + 设置页 ─────────────────────────────────────────
       Host 侧把"谁在用"认在会话 cookie 上（deepscient/host/auth.js）。这里做两件事：
       没有会话就整页拦住登录卡片；有会话就在设置里给一条登出与改密码的入口。 */

    const AU = {
      overlay: {
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: V.bg, padding: '24px',
      },
      card: {
        width: 'min(400px, 92vw)', padding: '24px', borderRadius: V.radiusLg,
        border: `1px solid ${V.border}`,
        boxShadow: V.shadow2, textAlign: 'left',
      },
      brand: { fontSize: V.textSm, letterSpacing: '0.08em', opacity: 0.5, marginBottom: '6px' },
      title: { fontSize: V.textXl, fontWeight: 650, marginBottom: '6px' },
      intro: { fontSize: V.textSm, opacity: 0.65, lineHeight: 1.6, marginBottom: '18px' },
      row: { marginBottom: '12px' },
      label: { display: 'block', fontSize: V.textSm, fontWeight: 500, marginBottom: '4px' },
      input: {
        width: '100%', boxSizing: 'border-box', padding: '9px 10px', fontSize: V.textMd,
        borderRadius: '8px', border: `1px solid ${V.border}`,
        background: 'transparent', color: 'inherit', fontFamily: 'inherit',
      },
      submit: {
        width: '100%', padding: '10px', borderRadius: '9px', fontSize: V.textMd, cursor: 'pointer',
        border: `1px solid ${V.brand}`, background: V.brand, color: V.onBrand, fontWeight: 600,
      },
      submitOff: { opacity: 0.45, cursor: 'not-allowed' },
      error: {
        fontSize: V.textSm, color: V.err, marginTop: '10px', lineHeight: 1.5,
        whiteSpace: 'pre-wrap',
      },
      hint: { fontSize: V.textXs, opacity: 0.55, marginTop: '10px', lineHeight: 1.5 },
      codeBox: {
        fontFamily: V.fontMono, fontSize: '17px',
        letterSpacing: '0.12em', textAlign: 'center', padding: '14px 10px', margin: '4px 0 16px',
        borderRadius: V.radiusMd, border: `1px dashed ${V.brand}`,
        background: V.brandSoft, userSelect: 'all', wordBreak: 'break-all',
      },
      link: {
        display: 'block', width: '100%', marginTop: '12px', padding: '4px',
        background: 'transparent', border: 'none', color: 'inherit', opacity: 0.6,
        fontSize: V.textSm, textDecoration: 'underline', cursor: 'pointer', font: 'inherit',
      },
    }

    /* ── 侧栏常驻账号入口的样式 ─────────────────────────────────────────────
       两个形状：宽栏给头像 + 名字，56px 窄栏只给头像。都靠 owner 传的 wide 切换。 */

    const AE = {
      wide: {
        display: 'flex', alignItems: 'center', gap: '8px', width: '100%',
        padding: '6px 8px', borderRadius: '8px', border: 'none', background: 'transparent',
        color: 'inherit', cursor: 'pointer', font: 'inherit', textAlign: 'left', minWidth: 0,
      },
      narrow: {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '34px', height: '34px', padding: 0, borderRadius: '50%',
        border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer',
      },
      avatar: {
        flex: '0 0 auto', width: '26px', height: '26px', borderRadius: '50%',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: V.brandSoft, color: V.brand, fontSize: V.textSm, fontWeight: 650,
        textTransform: 'uppercase',
      },
      name: { fontSize: '12.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      backdrop: {
        position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(0,0,0,0.18)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', padding: '24px',
      },
      panel: {
        position: 'relative',
        width: 'min(320px, 92vw)', padding: '18px', borderRadius: V.radiusLg,
        background: V.bg, border: `1px solid ${V.border}`,
        boxShadow: V.shadow2,
      },
      panelName: { fontSize: V.textLg, fontWeight: 650, marginBottom: '2px' },
      panelSub: { fontSize: V.textSm, opacity: 0.6, marginBottom: '14px' },
      actions: { display: 'flex', flexDirection: 'column', gap: '8px' },
      action: {
        padding: '8px 10px', borderRadius: '9px', fontSize: '12.5px', cursor: 'pointer',
        border: `1px solid ${V.border}`, background: 'transparent',
        color: 'inherit', font: 'inherit', textAlign: 'left',
      },
      danger: { borderColor: V.err, color: V.err },
      close: {
        position: 'absolute', top: '8px', right: '8px', width: '24px', height: '24px',
        display: 'grid', placeItems: 'center', padding: 0, borderRadius: '7px',
        border: 'none', background: 'transparent', color: 'inherit',
        cursor: 'pointer', fontSize: V.textLg, lineHeight: 1,
      },
      note: { fontSize: '11.5px', opacity: 0.6, marginTop: '10px', lineHeight: 1.5 },
    }

    /** 这几个端点要带着 cookie，且要能读出服务端说的错误原因。 */
    async function authCall(path, options) {
      const response = await fetch('/deepscient/auth' + path, {
        method: options?.method ?? 'GET',
        credentials: 'same-origin',
        headers: options?.body ? { 'content-type': 'application/json; charset=utf-8' } : undefined,
        body: options?.body ? JSON.stringify(options.body) : undefined,
      })
      let data = null
      try { data = await response.json() } catch { data = null }
      return { ok: response.ok, status: response.status, data }
    }

    /* ── 登录门 ─────────────────────────────────────────────────────────────
       账号在官网：应用里没有注册、没有密码框、没有恢复码。
       这里只做两件事——把浏览器送到官网授权页，回来后轮询一次登录态。 */

    const authSite = { site: null }

    /** 机器码翻成人话；不认识的就给一句最普通的。 */
    function authErrorText(code) {
      if (!code) return ''
      if (code === 'access_denied') return tf('auth.canceled')
      if (code === 'state_mismatch' || code === 'invalid_grant' || code === 'invalid_request') return tf('auth.stateMismatch')
      if (code === 'unauthorized') return tf('auth.expired')
      if (code === 'unreachable') return tf('auth.unreachable')
      return tf('auth.failed')
    }

    function balanceText(value) {
      return typeof value === 'number' ? '¥ ' + value.toFixed(2) : tf('auth.balanceUnknown')
    }

    function makeAuthGate(ctx) {
      return function AuthGate() {
        const [state, setState] = useState({ phase: 'loading' })
        const [busy, setBusy] = useState(false)
        const [waiting, setWaiting] = useState(false)
        const [error, setError] = useState('')
        useLocaleRevision()

        useEffect(() => {
          let alive = true
          authCall('/state').then(
            (result) => {
              if (!alive) return
              if (!result.ok || !result.data) {
                setState({ phase: 'anon' })
                setError(tf('auth.unreachable'))
                return
              }
              authSite.site = result.data.site ?? null
              setState({ phase: result.data.loggedIn ? 'authed' : 'anon' })
              if (!result.data.loggedIn) setError(authErrorText(result.data.error))
            },
            () => {
              if (!alive) return
              setState({ phase: 'anon' })
              setError(tf('auth.unreachable'))
            },
          )
          return () => { alive = false }
        }, [])

        // 授权在另一个窗口完成；这个页面自己发现登录态变了就重载，让 mux 用新身份重连。
        useEffect(() => {
          if (!waiting) return undefined
          const timer = setInterval(() => {
            authCall('/state').then((result) => {
              if (result.ok && result.data?.loggedIn) window.location.reload()
            })
          }, 2000)
          const stop = setTimeout(() => setWaiting(false), 5 * 60 * 1000)
          return () => { clearInterval(timer); clearTimeout(stop) }
        }, [waiting])

        const login = async () => {
          if (busy || waiting) return
          setBusy(true)
          setError('')
          const result = await authCall('/authorize', { method: 'POST' })
          setBusy(false)
          if (!result.ok || !result.data?.authorizeUrl) {
            setError(result.data?.message || tf('auth.failed'))
            return
          }
          const opened = window.open(result.data.authorizeUrl, '_blank', 'noopener,noreferrer')
          // 弹窗被拦时退回同页跳转：官网回来会落在 /auth/callback，那一页再把人送回来。
          if (!opened) {
            window.location.href = result.data.authorizeUrl
            return
          }
          setWaiting(true)
        }

        if (state.phase === 'loading') return null
        if (state.phase === 'authed') return null

        const site = authSite.site
        return h('div', { style: AU.overlay, 'data-deepscient-auth': 'gate' },
          h('div', { style: AU.card },
            h('div', { style: AU.brand }, 'DeepScient'),
            h('div', { style: AU.title }, tf('auth.gateTitle')),
            h('div', { style: AU.intro }, tf('auth.gateIntro')),
            h('button', {
              type: 'button',
              style: busy || waiting ? { ...AU.submit, ...AU.submitOff } : AU.submit,
              disabled: busy || waiting,
              onClick: login,
            }, busy ? tf('auth.opening') : tf('auth.loginWith')),
            waiting ? h('div', { style: AU.hint }, tf('auth.waiting')) : null,
            error ? h('div', { style: AU.error }, error) : null,
            h('div', { style: AU.hint }, tf('auth.gateHint')),
            site?.base
              ? h('a', {
                  href: site.base, target: '_blank', rel: 'noreferrer', style: AU.link,
                }, tf('auth.website'))
              : null,
          ),
        )
      }
    }

    /** 设置里的「账号」一节：官网身份、余额、登出。密码不在这里，也不在本机。 */
    function makeAccountSection() {
      return function AccountSection() {
        const [state, setState] = useState({ phase: 'loading', data: null })
        const [busy, setBusy] = useState(false)
        const [note, setNote] = useState('')
        useLocaleRevision()

        const load = () => authCall('/state').then(
          (result) => {
            const data = result.ok ? result.data : null
            authSite.site = data?.site ?? authSite.site
            setState({ phase: 'ready', data })
          },
          () => setState({ phase: 'ready', data: null }),
        )

        useEffect(() => { load() }, [])

        const refresh = async () => {
          setBusy(true)
          setNote('')
          const result = await authCall('/refresh', { method: 'POST' })
          setBusy(false)
          if (result.ok) {
            setState({ phase: 'ready', data: result.data })
            authSite.site = result.data?.site ?? authSite.site
            setNote(tf('auth.refreshed'))
            return
          }
          setNote(result.data?.error === 'unauthorized' ? tf('auth.expired') : tf('auth.failed'))
        }

        const logout = async () => {
          await authCall('/logout', { method: 'POST' })
          // 整页重载最干净：内存里的会话态、课题缓存都不该留着。
          window.location.reload()
        }

        if (state.phase === 'loading') return h('div', { style: S.sub }, tf('auth.loading'))
        const data = state.data
        if (!data?.loggedIn || !data.user) return h('div', { style: S.sub }, tf('auth.notLoggedIn'))

        const user = data.user
        const site = data.site
        return h('div', null,
          h('div', { style: S.title }, user.username || user.email || '—'),
          h('div', { style: S.sub }, tf('auth.email') + ': ' + (user.email || '—') + ' · ' + tf('auth.role') + ': ' + (user.role || 'user')),
          h('div', { style: { ...S.row, marginTop: '16px' } },
            h('div', { style: S.label }, tf('auth.balanceLabel')),
            h('div', { style: { fontSize: '22px', fontWeight: 650 } }, balanceText(data.balance)),
          ),
          data.expiresAt ? h('div', { style: S.sub }, tf('auth.expiresAt') + ' ' + dateText(data.expiresAt)) : null,
          h('div', { style: { display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' } },
            h('button', { type: 'button', style: S.button, disabled: busy, onClick: refresh }, busy ? tf('auth.refreshing') : tf('auth.refresh')),
            site?.base
              ? h('button', {
                  type: 'button', style: S.button,
                  onClick: () => window.open(site.base, '_blank', 'noopener,noreferrer'),
                }, tf('auth.manage'))
              : null,
            h('button', { type: 'button', style: { ...S.button, borderColor: '#b3261e', color: '#b3261e' }, onClick: logout }, tf('auth.logout')),
          ),
          note ? h('div', { style: { ...S.sub, marginTop: '8px' } }, note) : null,
          data.fetchedAt
            ? h('div', { style: { ...S.sub, marginTop: '6px' } }, tf('auth.updatedAt') + ' ' + dateTimeText(data.fetchedAt))
            : null,
        )
      }
    }

    /* ── 侧栏常驻账号入口 ───────────────────────────────────────────────────
       登出不只藏在设置里：侧栏底部一颗头像，点开是一层浮层菜单。
       浮层放在 shell.overlay 而不是 footer 里——footer 在裁剪上下文内，绝对定位会被切掉。
       两个槽共享一份极小的模块级状态，避免为了「谁点了头像」去引一个 store。 */

    const accountBadge = { user: null, balance: null, listeners: new Set() }
    const accountMenu = { open: false, listeners: new Set() }

    function setAccountUser(user, balance = null) {
      accountBadge.user = user
      accountBadge.balance = balance
      accountBadge.listeners.forEach((fn) => fn())
    }

    function setAccountMenu(open) {
      accountMenu.open = open
      accountMenu.listeners.forEach((fn) => fn())
    }

    async function refreshAccount() {
      try {
        const result = await authCall('/state')
        const data = result.ok ? result.data : null
        authSite.site = data?.site ?? authSite.site
        setAccountUser(data?.loggedIn ? data.user ?? null : null, data?.balance ?? null)
      } catch {
        setAccountUser(null)
      }
    }

    /** 设置面板的打开方式随外壳版本变，试几条真实存在的路；都不成就退化成一句提示。 */
    function openAccountSettings(ctx) {
      let opened = false
      try {
        const entry = (ctx?.slots?.entries?.('sidebar.settings') ?? []).find((item) => item?.store)
        const actions = entry?.store?.create?.()?.actions
        if (typeof actions?.openSection === 'function') {
          actions.openSection('deepscient-account')
          opened = true
        }
      } catch {}
      try {
        const shortcuts = ctx?.get?.('shortcuts')
        const rows = shortcuts?.catalog?.getSnapshot?.()?.catalog ?? []
        if (rows.some((row) => row?.id === 'settings.open')) {
          shortcuts.invoke('settings.open', { modal: null, region: 'page' })
          opened = true
        }
      } catch {}
      return opened
    }

    function makeAccountEntry() {
      return function AccountEntry(props) {
        const [user, setUser] = useState(accountBadge.user)
        useLocaleRevision()

        const [balance, setBalance] = useState(accountBadge.balance)

        useEffect(() => {
          const fn = () => { setUser(accountBadge.user); setBalance(accountBadge.balance) }
          accountBadge.listeners.add(fn)
          if (!accountBadge.user) refreshAccount()
          return () => { accountBadge.listeners.delete(fn) }
        }, [])

        if (!user) return null
        const name = user.username || user.email || ''
        const initial = String(name).trim().slice(0, 1).toUpperCase() || '?'
        const wide = props?.wide !== false

        return h('button', {
          type: 'button',
          title: name + ' · ' + balanceText(balance),
          'aria-label': tf('auth.accountMenu') + ': ' + name,
          'data-deepscient-account': 'entry',
          style: wide ? AE.wide : AE.narrow,
          onClick: () => setAccountMenu(true),
        },
          h('span', { style: AE.avatar }, initial),
          wide ? h('span', { style: AE.name }, name) : null,
        )
      }
    }

    function makeAccountMenu() {
      return function AccountMenu() {
        const [open, setOpen] = useState(accountMenu.open)
        const [user, setUser] = useState(accountBadge.user)
        const [note, setNote] = useState('')
        useLocaleRevision()

        useEffect(() => {
          const onOpen = () => setOpen(accountMenu.open)
          const onUser = () => setUser(accountBadge.user)
          accountMenu.listeners.add(onOpen)
          accountBadge.listeners.add(onUser)
          if (accountBadge.user === null) refreshAccount()
          return () => {
            accountMenu.listeners.delete(onOpen)
            accountBadge.listeners.delete(onUser)
          }
        }, [])

        const close = () => { setNote(''); setAccountMenu(false) }
        const logout = async () => {
          await authCall('/logout', { method: 'POST' })
          // 整页重载最干净：内存里的会话态与课题缓存都不该留着。
          window.location.reload()
        }
        const toSettings = () => {
          const opened = openAccountSettings(panelHost.ctx)
          if (opened) close()
          else setNote(tf('auth.accountHint'))
        }

        // Esc 是这层浮层的标准退出口；没有它，弹层只剩卡片里的按钮能关。
        useEffect(() => {
          if (!open) return undefined
          const onKey = (event) => { if (event.key === 'Escape') close() }
          document.addEventListener('keydown', onKey)
          return () => document.removeEventListener('keydown', onKey)
        }, [open])

        if (!open || !user) return null

        return h('div', {
          style: AE.backdrop, 'data-deepscient-auth': 'menu',
          onMouseDown: close, onClick: close,
        },
          h('div', {
            style: AE.panel,
            onMouseDown: (event) => event.stopPropagation(),
            onClick: (event) => event.stopPropagation(),
          },
            h('button', {
              type: 'button', style: AE.close, 'aria-label': tf('auth.close'),
              onClick: close,
            }, '×'),
            h('div', { style: AE.panelName }, user.username || user.email || ''),
            h('div', { style: AE.panelSub }, (user.email || '—') + ' · ' + balanceText(accountBadge.balance)),
            h('div', { style: AE.actions },
              h('button', { type: 'button', style: AE.action, onClick: toSettings }, tf('auth.openSettings')),
              authSite.site?.base
                ? h('button', {
                    type: 'button', style: AE.action,
                    onClick: () => window.open(authSite.site.base, '_blank', 'noopener,noreferrer'),
                  }, tf('auth.manage'))
                : null,
              h('button', { type: 'button', style: { ...AE.action, ...AE.danger }, onClick: logout }, tf('auth.logout')),
            ),
            note ? h('div', { style: AE.note }, note) : null,
          ),
        )
      }
    }

    /* ── 科研需求向导 ─────────────────────────────────────────────────────
       新建会话时点开，十组字段一次问完；生成的是一条给科研合伙人的任务书，
       不是替用户做决定。字段留空就不写进任务书——空着比编一个更有用。
       缺口判定不在这里：那是 science_requirement_brief 的活，前端再算一遍必然漂移。 */

    const WZ = {
      wrap: { position: 'relative', display: 'inline-flex', alignItems: 'center' },
      trigger: {
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: '5px 10px', borderRadius: '8px', cursor: 'pointer',
        border: `1px solid ${V.border}`, background: 'transparent',
        fontSize: V.textSm, lineHeight: 1.2, whiteSpace: 'nowrap',
      },
      triggerOn: { borderColor: V.brand, color: V.brand },
      panel: {
        position: 'absolute', bottom: 'calc(100% + 10px)', left: 0, zIndex: 60,
        width: 'min(560px, 92vw)', maxHeight: '70vh', overflowY: 'auto',
        padding: '16px', borderRadius: '12px', background: V.bg,
        border: `1px solid ${V.border}`,
        boxShadow: V.shadow1, textAlign: 'left',
      },
      title: { fontSize: '14px', fontWeight: 600, marginBottom: '4px' },
      hint: { fontSize: V.textSm, opacity: 0.65, lineHeight: 1.5, marginBottom: '12px' },
      row: { marginBottom: '10px' },
      label: { display: 'block', fontSize: V.textSm, fontWeight: 500, marginBottom: '3px' },
      sub: { fontSize: V.textXs, opacity: 0.6, marginBottom: '4px', lineHeight: 1.45 },
      input: {
        width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontSize: V.textSm,
        borderRadius: '7px', border: `1px solid ${V.border}`,
        background: 'transparent', color: 'inherit', fontFamily: 'inherit', lineHeight: 1.5,
      },
      foot: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' },
      btn: {
        padding: '6px 12px', borderRadius: '8px', fontSize: V.textSm, cursor: 'pointer',
        border: `1px solid ${V.border}`, background: 'transparent', color: 'inherit',
      },
      btnPrimary: { borderColor: V.brand, background: V.brand, color: V.onBrand },
      btnOff: { opacity: 0.4, cursor: 'not-allowed' },
    }

    // id 拼字典 key；hint 是给人看的一句解释，回答「为什么问这个」；rows 走多行输入。
    const WZ_FIELDS = [
      { id: 'question', rows: 2, hint: true },
      { id: 'domain' },
      { id: 'data', rows: 2 },
      { id: 'subjects' },
      { id: 'equipment' },
      { id: 'deadline' },
      { id: 'people' },
      { id: 'deliverables' },
      { id: 'ethics' },
      { id: 'license' },
    ]

    function makeRequirementWizard() {
      return function RequirementWizard(props) {
        useLocaleRevision()
        const [open, setOpen] = useState(false)
        const [form, setForm] = useState({})
        const onActiveChange = props?.onActiveChange
        const inputActions = props?.inputActions

        // 展开时占满工具栏宽度：不在展开状态释放，别的附件控件会被挤没。
        useEffect(() => {
          onActiveChange?.(open)
          return () => { if (open) onActiveChange?.(false) }
        }, [open])

        const set = (id) => (event) => setForm((prev) => ({ ...prev, [id]: event.target.value }))

        // 任务书：只写填了的字段，并显式点名下一步该调哪个工具。
        const compose = () => {
          const lines = [tf('wizard.mandate.intro'), '']
          for (const field of WZ_FIELDS) {
            const value = String(form[field.id] ?? '').trim()
            if (!value) continue
            lines.push(tf('wizard.mandate.line', { label: tf('wizard.field.' + field.id), value }))
          }
          lines.push('', tf('wizard.mandate.ask'))
          return lines.join('\n')
        }

        const filled = Boolean(String(form.question ?? '').trim())

        const writeDraft = () => {
          inputActions?.setDraft?.(compose())
          setOpen(false)
        }
        const startNow = () => {
          if (!inputActions?.setDraft) return
          inputActions.setDraft(compose())
          inputActions.submit?.()
          setOpen(false)
        }

        return h('div', { style: WZ.wrap },
          h('button', {
            type: 'button',
            title: tf('wizard.openHint'),
            style: open ? { ...WZ.trigger, ...WZ.triggerOn } : WZ.trigger,
            onClick: () => setOpen((v) => !v),
          }, tf('wizard.open')),
          open
            ? h('div', { style: WZ.panel },
                h('div', { style: WZ.title }, tf('wizard.title')),
                h('div', { style: WZ.hint }, tf('wizard.hint')),
                ...WZ_FIELDS.map((field) => h('div', { key: field.id, style: WZ.row },
                  h('label', { style: WZ.label }, tf('wizard.field.' + field.id)),
                  field.hint ? h('div', { style: WZ.sub }, tf('wizard.hintField.' + field.id)) : null,
                  field.rows
                    ? h('textarea', {
                        rows: field.rows,
                        style: WZ.input,
                        placeholder: tf('wizard.ph.' + field.id),
                        value: form[field.id] ?? '',
                        onChange: set(field.id),
                      })
                    : h('input', {
                        type: 'text',
                        style: WZ.input,
                        placeholder: tf('wizard.ph.' + field.id),
                        value: form[field.id] ?? '',
                        onChange: set(field.id),
                      }),
                )),
                h('div', { style: WZ.foot },
                  h('button', { type: 'button', style: WZ.btn, onClick: () => setOpen(false) }, tf('wizard.cancel')),
                  h('button', {
                    type: 'button',
                    style: filled ? WZ.btn : { ...WZ.btn, ...WZ.btnOff },
                    disabled: !filled,
                    onClick: writeDraft,
                  }, tf('wizard.fill')),
                  h('button', {
                    type: 'button',
                    style: filled ? { ...WZ.btn, ...WZ.btnPrimary } : { ...WZ.btn, ...WZ.btnOff },
                    disabled: !filled,
                    onClick: startNow,
                  }, tf('wizard.start')),
                ),
                filled ? null : h('div', { style: { ...WZ.sub, marginTop: '8px' } }, tf('wizard.needQuestion')),
              )
            : null,
        )
      }
    }

    function makeUsagePill(ctx) {
      return function UsageDockPill() {
        const [state, setState] = useState({ status: 'loading', data: null })
        const [hover, setHover] = useState(false)
        useLocaleRevision()

        useEffect(() => {
          let alive = true
          const load = () => {
            getJson('/usage?range=today').then(
              (data) => { if (alive) setState({ status: 'ready', data }) },
              () => { if (alive) setState({ status: 'error', data: null }) },
            )
          }
          load()
          const timer = setInterval(load, 30_000)
          return () => { alive = false; clearInterval(timer) }
        }, [])

        const totals = state.data?.totals
        // 底部只报消耗量：缓存命中率与金额都不入座，金额留给「计费」页。
        const label = state.status === 'ready' && totals
          ? tf('pill.tokens', { n: formatTokens(totals.totalTokens) })
          : state.status === 'error' ? 'tokens —' : 'tokens …'

        const open = () => requestPanel('billing')

        return h('button',
          {
            type: 'button',
            onClick: open,
            onMouseEnter: () => setHover(true),
            onMouseLeave: () => setHover(false),
            title: tf('pill.title'),
            style: {
              display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none', background: 'none',
              color: 'inherit', opacity: hover ? 0.92 : 0.6, cursor: 'pointer', fontSize: 11.5, padding: '2px 4px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            },
          },
          h('span', { key: 'dot', 'aria-hidden': true, style: { fontSize: 11 } }, '◇'),
          label)
      }
    }

    /* ── 首次打开的使用引导 ─────────────────────────────────────────────────
       装完之后人最需要的是「下一步做什么」，不是一张功能清单。六步，每步一个能按的按钮，
       进度写回 ui-settings.json（onboardingDone / onboardingStep）。               */

    const GUIDE_TOTAL = 6
    // 模板里写的工具名必须是真实存在的：写错名字，模型会安静地什么都不调，人以为「跑过了」。
    const PROMPT_TEMPLATES = [
      ['guide.template.topic.tag', 'guide.template.topic.text'],
      ['guide.template.map.tag', 'guide.template.map.text'],
      ['guide.template.hypothesis.tag', 'guide.template.hypothesis.text'],
    ]

    function guideCheckStep(health) {
      const science = health.data?.science
      const preset = health.data?.preset
      const model = health.data?.model
      const keyText = model?.keyPresent === true ? tf('sources.configured') : model?.keyPresent === false ? tf('guide.check.keyMissing') : tf('guide.check.notRead')
      const scienceText = science?.available
        ? tf('guide.check.stateLoaded', { mode: science.source === 'runtime' ? tf('guide.check.modeRuntime') : tf('guide.check.modeBundled') })
        : tf('guide.check.stateUnavailable', { reason: science?.reason ?? tf('guide.check.waiting') })
      const presetText = preset?.id
        ? tf('guide.check.presetValue', {
            name: preset.name ?? preset.id,
            id: preset.id,
            broken: preset.broken ? tf('guide.check.broken', { reason: preset.broken }) : '',
          })
        : tf('guide.check.notRead')
      const modelText = model?.provider
        ? `${model.provider}${model.model ? ' / ' + model.model : ''}`
        : tf('guide.check.notRead')
      return [
        h('p', { key: 'p', style: { margin: '0 0 8px' } }, tf('guide.check.intro')),
        h('ul', { key: 'ul', style: { margin: '0 0 8px 18px', lineHeight: 1.8 } },
          h('li', null, tf('guide.check.product', { product: health.data?.product ?? 'DeepScient', version: health.data?.version ?? '' })),
          h('li', null, tf('guide.check.science', { state: scienceText })),
          h('li', null, tf('guide.check.preset', { preset: presetText })),
          h('li', null, tf('guide.check.model', { model: modelText, key: keyText })),
          h('li', null, tf('guide.check.dataRoot', { path: health.data?.dataRoot ?? '—' }))),
        h('div', { key: 'sub', style: S.sub }, tf('guide.check.settingsPath', { path: health.data?.settingsPath ?? '—' })),
      ]
    }

    function guideModelStep(usage, openPanel) {
      const keys = usage.data?.keys ?? []
      const nodes = [h('p', { key: 'p', style: { margin: '0 0 8px' } }, tf('guide.model.intro'))]
      if (keys.length) {
        nodes.push(h('ul', { key: 'ul', style: { margin: '0 0 8px 18px', lineHeight: 1.8 } },
          keys.map((k, i) => h('li', { key: i }, `${k.provider ?? '—'}${k.model ? ' / ' + k.model : ''} — ${k.masked || k.source || ''}`))))
      } else {
        nodes.push(h(Notice, { key: 'notice' }, tf('guide.model.noKeys')))
      }
      nodes.push(h('div', { key: 'row', style: S.row },
        h('button', { style: S.button, onClick: () => openPanel('billing') }, tf('guide.model.goBilling'))))
      nodes.push(h('div', { key: 'foot', style: { ...S.sub, marginTop: 8 } }, tf('guide.model.foot')))
      return nodes
    }

    function guideSourceStep(sources, openPanel) {
      const items = sources.data?.items ?? []
      const ready = items.filter((item) => item.configured).length
      return [
        h('p', { key: 'p', style: { margin: '0 0 8px' } }, tf('guide.sources.intro', { ready, total: items.length || 8 })),
        h('ul', { key: 'ul', style: { margin: '0 0 8px 18px', lineHeight: 1.8 } },
          h('li', null, tf('guide.sources.polite')),
          h('li', null, tf('guide.sources.keys')),
          h('li', null, tf('guide.sources.secrets'))),
        h('div', { key: 'row', style: S.row },
          h('button', { style: S.button, onClick: () => openPanel('sources') }, tf('guide.sources.go'))),
        h('div', { key: 'foot', style: { ...S.sub, marginTop: 8 } }, tf('guide.sources.foot')),
      ]
    }

    function guideProjectStep(form, setForm, created, createProject) {
      const nodes = [
        h('p', { key: 'p', style: { margin: '0 0 8px' } }, tf('guide.project.intro')),
        h('div', { key: 'form', style: { display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 460 } },
          h('input', { style: S.input, placeholder: tf('guide.project.titlePh'), value: form.title, onChange: (e) => setForm({ ...form, title: e.target.value }) }),
          h('input', { style: S.input, placeholder: tf('guide.project.domainPh'), value: form.domain, onChange: (e) => setForm({ ...form, domain: e.target.value }) }),
          h('input', { style: S.input, placeholder: tf('guide.project.journalPh'), value: form.journal, onChange: (e) => setForm({ ...form, journal: e.target.value }) })),
        h('div', { key: 'row', style: { ...S.row, marginTop: 10 } },
          h('button', { style: S.button, onClick: createProject, disabled: !form.title.trim() }, tf('guide.project.create'))),
      ]
      if (created) {
        nodes.push(h('div', { key: 'done', style: { ...S.card, marginTop: 10 } },
          h('div', { style: { fontSize: 13, fontWeight: 600 } }, tf('guide.project.created', { title: created.title })),
          h('div', { style: S.sub }, tf('guide.project.createdMeta', {
            id: created.id,
            progress: created.progress ? `${created.progress.done}/${created.progress.total}` : '—',
          }))))
      }
      return nodes
    }

    /**
     * 第五步：点一条模板，直接开好会话并把这句话放进输入框。
     *
     * 不做「复制 → 自己新建 → 粘贴」：那是三步，而且中间任何一步失败用户都只能看到
     * 一句「新建会话失败」。这里把预设、工作区、失败原因三件事摊在同一张卡上。
     */
    function guideSessionStep(view) {
      const { templates, preset, sessionState, copy, copied } = view
      const presetBroken = Boolean(preset?.broken)
      const nodes = [
        h('p', { key: 'p', style: { margin: '0 0 8px' } }, tf('guide.session.intro')),
        h('div', { key: 'preset', style: { ...S.sub, marginBottom: 8 } },
          preset
            ? presetBroken
              ? tf('guide.session.presetFailed', { name: preset.name ?? preset.id, reason: preset.broken })
              : tf('guide.session.preset', { name: preset.name ?? preset.id })
            : tf('guide.session.presetPending')),
      ]
      nodes.push(h('div', { key: 'templates', style: { display: 'flex', flexDirection: 'column', gap: 8 } },
        templates.map(([tagKey, textKey]) => {
          const tag = tf(tagKey)
          const text = tf(textKey)
          const state = sessionState.tag === tag ? sessionState.status : 'idle'
          const busy = state === 'starting'
          return h('div', { key: tagKey, style: { ...S.card, marginBottom: 0 } },
            h('div', { style: S.row },
              h('span', { style: { fontSize: 12.5, fontWeight: 600 } }, tag),
              h('div', { style: S.spacer }),
              h('button', { style: { ...S.button, border: 'none', background: 'none', opacity: 0.7 }, onClick: () => copy(text, tag) }, copied === tag ? tf('guide.session.copied') : tf('guide.session.copy')),
              h('button', {
                style: { ...S.button, borderColor: 'rgba(31,111,92,0.7)', opacity: busy || presetBroken ? 0.55 : 1 },
                disabled: busy || presetBroken,
                onClick: () => view.start(text, tag),
              }, state === 'starting' ? tf('guide.session.starting') : state === 'started' ? tf('guide.session.started') : tf('guide.session.open'))),
            h('div', { style: { ...S.mono, fontSize: 11.5, opacity: 0.8, marginTop: 6, lineHeight: 1.6 } }, text))
        })))
      if (sessionState.detail) {
        nodes.push(h('div', { key: 'detail', style: { ...S.sub, marginTop: 10 } }, sessionState.detail))
      }
      return nodes
    }

    function guideRulesStep() {
      return [
        h('p', { key: 'p', style: { margin: '0 0 8px' } }, tf('guide.rules.intro')),
        h('ol', { key: 'ol', style: { margin: '0 0 10px 18px', lineHeight: 1.9 } },
          h('li', null, tf('guide.rules.one')),
          h('li', null, tf('guide.rules.two')),
          h('li', null, tf('guide.rules.three'))),
        h(Notice, { key: 'notice' }, tf('guide.rules.notice')),
      ]
    }

    function makeOnboarding(ctx) {
      return function OnboardingOverlay(props) {
        const settings = useApi('/settings')
        const health = useApi('/health')
        const sources = useApi('/sources')
        const usage = useApi('/usage?range=today')
        const presets = useApi('/presets')
        const [step, setStep] = useState(null)
        const [error, setError] = useState('')
        const [form, setForm] = useState({ title: '', domain: '', journal: '' })
        const [created, setCreated] = useState(null)
        const [copied, setCopied] = useState('')
        const [sessionState, setSessionState] = useState({ tag: '', status: 'idle', detail: '' })
        useLocaleRevision()

        // shell.overlay 的 standardProps 里有 useWorkspaces；桩测试传空 props，所以要能缺。
        const useWorkspacesHook = typeof props?.useWorkspaces === 'function' ? props.useWorkspaces : null
        const snapshot = useWorkspacesHook ? useWorkspacesHook((state) => state) : null
        const snapshotRef = useRef(snapshot)
        snapshotRef.current = snapshot

        useEffect(() => {
          if (step === null && settings.data?.values) setStep(Number(settings.data.values.onboardingStep) || 0)
        }, [settings.data, step])

        if (settings.status !== 'ready' && settings.status !== 'refreshing') return null
        if (!settings.data?.values || settings.data.values.onboardingDone === true) return null

        const current = Math.min(Math.max(step ?? 0, 0), GUIDE_TOTAL - 1)

        const persist = async (patch) => {
          try {
            await sendJson('PUT', '/settings', patch)
            settings.reload()
          } catch (e) {
            setError(e.message)
          }
        }
        const go = (next) => {
          setError('')
          setStep(next)
          persist({ onboardingStep: next })
        }
        const finish = () => {
          setError('')
          persist({ onboardingDone: true, onboardingStep: GUIDE_TOTAL })
        }
        const openPanel = (key) => requestPanel(key)
        const copy = (text, tag) => {
          try {
            navigator.clipboard?.writeText(text)
            setCopied(tag)
          } catch {
            setCopied('')
          }
        }
        const createProject = async () => {
          setError('')
          try {
            const payload = await sendJson('POST', '/projects', form)
            if (!payload.ok) throw new Error(payload.message || payload.error || tf('guide.session.errorCreate'))
            setCreated(payload.project)
            openPanel('workbench')
          } catch (e) {
            setError(e.message)
          }
        }
        /** 当前工作区：优先刚建课题的目录，其次最近一个。 */
        const workspaceIdFor = (snap) => {
          const items = Array.isArray(snap?.items) ? snap.items : []
          if (items.length === 0) return null
          const wanted = created?.dir
          const match = wanted ? items.find((w) => w?.path === wanted) : null
          return (match ?? items[items.length - 1])?.workspaceId ?? null
        }
        const sessionCountOf = (snap, workspaceId) => {
          const items = Array.isArray(snap?.items) ? snap.items : []
          if (workspaceId) return items.find((w) => w?.workspaceId === workspaceId)?.sessionIds?.length ?? 0
          return items.reduce((sum, w) => sum + (w?.sessionIds?.length ?? 0), 0)
        }
        /** 等一个新会话出现：startSession 不返回 id 也不抛错，只能用「多了一个」当证据。 */
        const waitForSession = (workspaceId, before, timeoutMs = 2500) =>
          new Promise((resolve) => {
            const started = Date.now()
            const tick = () => {
              const now = sessionCountOf(snapshotRef.current, workspaceId)
              if (now > before) return resolve({ ok: true, total: now })
              if (Date.now() - started >= timeoutMs) return resolve({ ok: false, total: now })
              setTimeout(tick, 120)
            }
            tick()
          })

        /**
         * 开一个会话并把模板放进输入框。
         *
         * 失败必须说得出原因：预设坏了说预设、key 没配说 key、工作区拿不到说工作区。
         * 这三句都能落到卡上，用户才知道下一步该点哪儿。
         */
        const startWithTemplate = async (text, tag) => {
          setError('')
          setSessionState({ tag, status: 'starting', detail: '' })
          try {
            const preset = presets.data?.items?.[0] ?? null
            if (preset?.broken) throw new Error(tf('guide.session.presetFailed', { name: preset.name ?? preset.id, reason: preset.broken }))
            const presetId = preset?.id ?? null

            const ui = ctx.get?.('uiWorkspace')
            if (!ui?.startSession) throw new Error(tf('guide.session.errorNoUi'))

            let workspaceId = workspaceIdFor(snapshotRef.current)
            if (!workspaceId) {
              const service = ctx.get?.('workspaces')
              const path = created?.dir ?? health.data?.dataRoot
              if (!service?.create || !path) throw new Error(tf('guide.session.errorNoPath'))
              const view = await service.create({ path })
              workspaceId = view?.workspaceId ?? null
              if (!workspaceId) throw new Error(tf('guide.session.errorNoWorkspaceId', { path }))
            }

            const before = sessionCountOf(snapshotRef.current, workspaceId)
            ui.startSession(workspaceId, {
              ...(presetId ? { agentPreset: presetId } : {}),
              prompt: text,
              clearPreviousDraft: true,
            })
            const outcome = await waitForSession(workspaceId, before)
            if (!outcome.ok) {
              const keyMissing = health.data?.model?.keyPresent === false
              throw new Error(
                keyMissing
                  ? tf('guide.session.errorKeyMissing')
                  : tf('guide.session.errorGeneric'),
              )
            }
            setSessionState({ tag, status: 'started', detail: tf('guide.session.startedDetail') })
            try {
              ctx.get?.('layout')?.selectPanel?.(null)
            } catch {
              /* 没有布局服务就不切页 */
            }
            persist({ onboardingDone: true, onboardingStep: GUIDE_TOTAL })
          } catch (e) {
            setSessionState({ tag, status: 'failed', detail: e?.message ?? String(e) })
            setError(e?.message ?? String(e))
          }
        }

        let body
        if (current === 0) body = guideCheckStep(health)
        else if (current === 1) body = guideModelStep(usage, openPanel)
        else if (current === 2) body = guideSourceStep(sources, openPanel)
        else if (current === 3) body = guideProjectStep(form, setForm, created, createProject)
        else if (current === 4) {
          body = guideSessionStep({
            templates: PROMPT_TEMPLATES,
            preset: presets.data?.items?.[0] ?? null,
            sessionState,
            copy,
            copied,
            start: startWithTemplate,
          })
        } else body = guideRulesStep()

        const progress = Array.from({ length: GUIDE_TOTAL }).map((_, i) => h('div', {
          key: i,
          style: { height: 3, flex: 1, borderRadius: 999, background: i <= current ? '#1f6f5c' : 'rgba(127,127,127,0.28)' },
        }))

        const card = h('div', {
          role: 'dialog',
          'aria-label': tf('guide.aria'),
          style: {
            width: 'min(620px, 100%)', maxHeight: '86vh', overflow: 'auto', borderRadius: 14, padding: '20px 22px',
            background: 'Canvas', color: 'CanvasText', border: '1px solid rgba(127,127,127,0.35)',
            boxShadow: '0 18px 48px rgba(0,0,0,0.35)',
          },
        },
        h('div', { style: S.row },
          h('div', { style: { fontSize: 15, fontWeight: 600 } }, tf('guide.title')),
          h('div', { style: S.spacer }),
          h('div', { style: S.sub }, tf('guide.stepProgress', { current: current + 1, total: GUIDE_TOTAL }))),
        h('div', { style: { display: 'flex', gap: 6, margin: '12px 0 16px' } }, progress),
        h('div', { style: { fontSize: 13, lineHeight: 1.75, minHeight: 150 } }, body),
        error ? h(ErrorBox, { error }) : null,
        h('div', { style: { ...S.row, marginTop: 16 } },
          current > 0 ? h('button', { style: S.button, onClick: () => go(current - 1) }, tf('guide.prev')) : null,
          h('div', { style: S.spacer }),
          h('button', { style: { ...S.button, border: 'none', background: 'none', opacity: 0.6 }, onClick: finish }, tf('guide.skip')),
          current < GUIDE_TOTAL - 1
            ? h('button', { style: { ...S.button, borderColor: 'rgba(31,111,92,0.7)' }, onClick: () => go(current + 1) }, tf('guide.next'))
            : h('button', { style: { ...S.button, borderColor: 'rgba(31,111,92,0.7)' }, onClick: finish }, tf('guide.start'))))

        return h('div', {
          // shell.overlay 这一层本身是 click-through，入场者要点回指针事件，否则点不动。
          style: {
            position: 'fixed', inset: 0, zIndex: 9000, display: 'grid', placeItems: 'center',
            background: 'rgba(0,0,0,0.42)', padding: 20, pointerEvents: 'auto',
          },
        }, card)
      }
    }


    /* ── 六个一级页面 ──────────────────────────────────────────────────────
       每个页面是 main 上独立的挂载点，只有当前这个在发请求；切走即卸载。
       页面之间不共享取数结果，只共享「选中了哪个课题」这一件事。             */

    function Page({ title, projectId, children }) {
      useLocaleRevision()
      return h(
        'div',
        { className: CLS.page },
        h(
          'header',
          { className: CLS.header },
          h(
            'div',
            { className: 'ds-page__heading' },
            h('h1', { className: CLS.h1 }, tf('app.title')),
            h('div', { className: 'ds-sub ds-hide-sm' }, title),
          ),
          h('div', { className: CLS.spacer }),
          h('span', { className: CLS.chipSkip }, projectId ? tf('app.project', { id: projectId }) : tf('app.localData')),
        ),
        h('div', { className: CLS.body }, h('div', { className: CLS.inner }, children)),
      )
    }

    function WorkbenchPage() {
      const projects = useApi('/projects')
      const [projectId, onProject] = useSelectedProject(projects)
      const overview = useApi(projectId ? `/projects/${encodeURIComponent(projectId)}/overview` : null, [projectId])
      const jump = (id) => { stageJump.id = id; requestPanel('stages') }
      const content = projects.status === 'loading' ? h(Loading)
        : projects.status === 'error' ? h(ErrorBox, { error: projects.error, onRetry: projects.reload })
        : projects.data?.available === false ? h(NotReady, { reason: projects.data.reason })
        : h(Overview, { overview, projects, projectId, onProject, onJump: jump })
      return h(Page, { title: tf('page.workbench'), projectId }, content)
    }

    function StagesPage() {
      const projects = useApi('/projects')
      const [projectId] = useSelectedProject(projects)
      const stages = useApi(projectId ? `/projects/${encodeURIComponent(projectId)}/stages` : null, [projectId])
      // 从工作台跳过来时要展开同一级；读过一次就清掉，免得下次进来又自动展开
      const initial = useRef(stageJump.id)
      useEffect(() => { stageJump.id = '' }, [])
      return h(Page, { title: tf('page.stages'), projectId },
        h(StageList, { stages, initial: initial.current }))
    }

    function ToolsPage() {
      const tools = useApi('/tools')
      const skills = useApi('/skills')
      return h(Page, { title: tf('page.tools') },
        h(ToolList, { tools, skills }))
    }

    function BillingPage() {
      const [range, setRange] = useState('today')
      const usage = useApi(`/usage?range=${range}`, [range])
      return h(Page, { title: tf('page.billing') },
        h('div', null,
          h(RelayPanel),
          h(BillingPanel, { usage, range, onRange: setRange, onRefresh: usage.reload })))
    }

    function SourcesPage() {
      const sources = useApi('/sources')
      return h(Page, { title: tf('page.sources') },
        h(SourcesPanel, { sources }))
    }

    function DocsPage() {
      const docs = useApi('/docs')
      return h(Page, { title: tf('page.docs') },
        h(Docs, { docs }))
    }

    /* ── 设置页 ─────────────────────────────────────────────────────────── */

    const FIELDS = [
      ['defaultDiscipline', 'settings.field.defaultDiscipline', 'text'],
      ['defaultJournal', 'settings.field.defaultJournal', 'text'],
      ['evidenceStrictness', 'settings.field.evidenceStrictness', ['strict', 'normal']],
      ['networkForSearch', 'settings.field.networkForSearch', 'bool'],
      ['alpha', 'settings.field.alpha', 'number'],
      ['effectSize', 'settings.field.effectSize', ['cohen-d', 'hedges-g', 'eta-squared', 'odds-ratio']],
      ['correction', 'settings.field.correction', ['holm', 'bonferroni', 'fdr-bh', 'none']],
      ['figureUnits', 'settings.field.figureUnits', ['mm', 'inch']],
      ['locale', 'settings.field.locale', ['zh', 'en']],
      ['billingProvider', 'settings.field.billingProvider', ['newapi', 'none']],
      ['billingBaseUrl', 'settings.field.billingBaseUrl', 'url'],
      ['billingConsoleUrl', 'settings.field.billingConsoleUrl', 'url'],
      ['billingCurrency', 'settings.field.billingCurrency', ['CNY', 'USD']],
    ]

    function fieldRow(draft, setDraft, key, label, kind) {
      const value = draft[key]
      let control
      if (kind === 'bool') {
        control = h('input', { type: 'checkbox', checked: Boolean(value), onChange: (e) => setDraft({ ...draft, [key]: e.target.checked }) })
      } else if (Array.isArray(kind)) {
        control = h('select', { style: S.select, value: value ?? '', onChange: (e) => setDraft({ ...draft, [key]: e.target.value }) },
          kind.map((v) => h('option', { key: v, value: v }, v)))
      } else if (kind === 'number') {
        control = h('input', { style: { ...S.input, minWidth: 100 }, type: 'number', step: 0.01, min: 0.001, max: 0.5, value: value ?? '', onChange: (e) => setDraft({ ...draft, [key]: Number(e.target.value) }) })
      } else if (kind === 'url') {
        control = h('input', {
          style: { ...S.input, minWidth: 260 },
          type: 'url',
          placeholder: key === 'billingBaseUrl' ? tf('settings.ph.billingBaseUrl') : tf('settings.ph.billingConsoleUrl'),
          value: value ?? '',
          onChange: (e) => setDraft({ ...draft, [key]: e.target.value }),
        })
      } else {
        control = h('input', { style: S.input, value: value ?? '', onChange: (e) => setDraft({ ...draft, [key]: e.target.value }) })
      }
      return h('div', { key, style: { display: 'flex', alignItems: 'center', gap: 12 } },
        h('div', { style: { width: 150, fontSize: 12.5, opacity: 0.8 } }, label),
        control)
    }

    function makeSettingsSection(ctx) {
      return function SettingsSection() {
        const state = useApi('/settings')
        const presets = useApi('/presets')
        const [draft, setDraft] = useState(null)
        const [saved, setSaved] = useState('')
        const [rejected, setRejected] = useState([])
        const [error, setError] = useState('')
        const [inspect, setInspect] = useState(null)
        const [skillCat, setSkillCat] = useState(null)
        const [skillCheck, setSkillCheck] = useState(null)
        const busy = useRef(false)
        useLocaleRevision()

        useEffect(() => { if (state.data?.values) setDraft(state.data.values) }, [state.data])

        const save = useCallback(async () => {
          if (!draft || busy.current) return
          busy.current = true
          setError('')
          try {
            const body = await sendJson('PUT', '/settings', draft)
            setDraft(body.values)
            setRejected(body.rejected ?? [])
            setSaved(tf('settings.savedAt', { at: new Date().toLocaleTimeString() }))
            state.reload()
          } catch (e) {
            setError(e.message)
          } finally {
            busy.current = false
          }
        }, [draft, state])

        const reopenGuide = useCallback(async () => {
          try {
            await sendJson('PUT', '/settings', { onboardingDone: false, onboardingStep: 0 })
            state.reload()
            setSaved(tf('settings.reopenDone'))
          } catch (e) {
            setError(e.message)
          }
        }, [state])

        if (state.status === 'loading') return h(Loading)
        if (state.status === 'error') return h(ErrorBox, { error: state.error, onRetry: state.reload })
        if (!draft) return h(Loading)

        const rows = Array.isArray(draft.billingPriceTable) ? draft.billingPriceTable : []
        const patchRow = (index, patch) => setDraft({ ...draft, billingPriceTable: rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) })
        const addRow = () => setDraft({ ...draft, billingPriceTable: [...rows, { provider: '', model: '', inputPerM: 0, cacheReadPerM: 0, outputPerM: 0 }] })
        const removeRow = (index) => setDraft({ ...draft, billingPriceTable: rows.filter((_, i) => i !== index) })

        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 } },
          h('div', { style: { fontSize: 13, opacity: 0.75, lineHeight: 1.6 } },
            tf('settings.introPrefix'),
            h('code', { style: S.mono }, state.data?.path ?? ''),
            tf('settings.introSuffix')),
          FIELDS.map(([key, label, kind]) => fieldRow(draft, setDraft, key, tf(label), kind)),

          h('div', { style: { ...S.card, marginTop: 6 } },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, tf('settings.billingTitle')),
            h('div', { style: { ...S.sub, marginBottom: 8 } },
              tf('settings.billingHint')),
            rows.length
              ? h('table', { style: S.table },
                  h('thead', null, h('tr', null,
                    h('th', { style: S.th }, 'provider'), h('th', { style: S.th }, tf('billing.colModel')),
                    h('th', { style: S.th }, tf('settings.colInput')), h('th', { style: S.th }, tf('settings.colCache')),
                    h('th', { style: S.th }, tf('settings.colOutput')), h('th', { style: S.th }, ''))),
                  h('tbody', null, rows.map((row, index) =>
                    h('tr', { key: index },
                      h('td', { style: S.td }, h('input', { style: { ...S.input, minWidth: 90 }, value: row.provider ?? '', placeholder: tf('settings.ph.provider'), onChange: (e) => patchRow(index, { provider: e.target.value }) })),
                      h('td', { style: S.td }, h('input', { style: { ...S.input, minWidth: 120 }, value: row.model ?? '', placeholder: tf('settings.ph.model'), onChange: (e) => patchRow(index, { model: e.target.value }) })),
                      h('td', { style: S.td }, h('input', { style: { ...S.input, minWidth: 70 }, type: 'number', step: '0.01', value: row.inputPerM ?? 0, onChange: (e) => patchRow(index, { inputPerM: Number(e.target.value) }) })),
                      h('td', { style: S.td }, h('input', { style: { ...S.input, minWidth: 70 }, type: 'number', step: '0.01', value: row.cacheReadPerM ?? 0, onChange: (e) => patchRow(index, { cacheReadPerM: Number(e.target.value) }) })),
                      h('td', { style: S.td }, h('input', { style: { ...S.input, minWidth: 70 }, type: 'number', step: '0.01', value: row.outputPerM ?? 0, onChange: (e) => patchRow(index, { outputPerM: Number(e.target.value) }) })),
                      h('td', { style: S.td }, h('button', { style: S.button, onClick: () => removeRow(index) }, tf('settings.remove')))))))
              : h('div', { style: S.sub }, tf('settings.emptyPrice')),
            h('div', { style: { ...S.row, marginTop: 8 } },
              h('button', { style: S.button, onClick: addRow }, tf('settings.addRow')),
              h('span', { style: S.sub }, tf('settings.wildcard'))),
          ),

          h('div', { style: { ...S.card } },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, tf('settings.guideTitle')),            h('div', { style: { ...S.row } },
              h('button', { style: S.button, onClick: reopenGuide }, tf('settings.reopenGuide')),
              h('button', {
                style: S.button,
                onClick: () => requestPanel('sources'),
              }, tf('settings.goSources'))),
            h('div', { style: { ...S.sub, marginTop: 8 } },
              tf('settings.guideHint'))),

          // 预设体检：开会话失败时先来这里看是哪一行插件没起来，而不是靠猜。
          h('div', { style: { ...S.card } },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, tf('settings.presetTitle')),
            h('div', { style: { ...S.sub, marginBottom: 8 } },
              (presets.data?.items ?? []).length
                ? tf('settings.presetCurrent', { list: (presets.data.items ?? []).map((p) => `${p.name ?? p.id}${p.broken ? tf('settings.presetBroken') : ''}`).join(', ') })
                : tf('settings.presetNone')),
            h('div', { style: S.row },
              h('button', {
                style: S.button,
                onClick: async () => {
                  setError('')
                  try {
                    setInspect(await fetchJson('/presets/inspect'))
                  } catch (e) {
                    setError(e.message)
                  }
                },
              }, tf('settings.presetInspect'))),
            inspect
              ? h('div', { style: { marginTop: 8 } },
                  inspect.available === false
                    ? h('div', { style: S.sub }, tf('settings.presetUnavailable', { reason: inspect.reason ?? tf('settings.presetUnknown') }))
                    : (inspect.presets ?? []).map((p) => h('div', { key: p.id, style: { marginTop: 6 } },
                        h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, `${p.name ?? p.id}${p.isDefault ? tf('settings.presetDefault') : ''}${p.broken ? tf('settings.presetFailed', { reason: p.broken }) : ''}`),
                        h('div', { style: { ...S.mono, fontSize: 11.5, opacity: 0.85, marginTop: 4, lineHeight: 1.6 } },
                          (p.rows ?? []).map((r) => `${r.fiberState ?? '?'}  ${r.moduleName}${r.entryId ? `#${r.entryId}` : ''}`).join('\n')))))
              : null),

          // 技能目录：磁盘上有几条、模型真能看见几条 —— 这两件事必须分开看。
          h('div', { style: { ...S.card } },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, tf('settings.skillsTitle')),
            h('div', { style: { ...S.sub, marginBottom: 8 } },
              tf('settings.skillsHint')),
            h('div', { style: S.row },
              h('button', {
                style: S.button,
                onClick: async () => {
                  setError('')
                  try {
                    setSkillCat(await fetchJson('/skills'))
                  } catch (e) {
                    setError(e.message)
                  }
                },
              }, tf('settings.skillsShow')),
              h('button', {
                style: S.button,
                onClick: async () => {
                  setError('')
                  try {
                    setSkillCheck(await sendJson('POST', '/skills/check'))
                  } catch (e) {
                    setError(e.message)
                  }
                },
              }, tf('settings.skillsCheck'))),
            skillCat
              ? h('div', { style: { marginTop: 8 } },
                  h('div', { style: { fontSize: 12.5, fontWeight: 600 } },
                    tf('settings.skillsCounts', {
                      bundled: skillCat.counts?.bundled ?? 0,
                      vendor: skillCat.counts?.vendor ?? 0,
                      user: skillCat.counts?.user ?? 0,
                      session: skillCat.counts?.sessionExpect ?? 0,
                    })),
                  h('div', { style: S.sub },
                    tf('settings.skillsCatalog', {
                      tokens: skillCat.catalog?.session?.approxTokens ?? '?',
                      host: skillCat.counts?.hostCatalog ?? '?',
                    })),
                  (skillCat.items ?? []).filter((row) => row.source === 'vendor').length
                    ? h('div', { style: { ...S.mono, fontSize: 11, opacity: 0.85, marginTop: 6, maxHeight: 220, overflow: 'auto', lineHeight: 1.7 } },
                        (skillCat.items ?? [])
                          .filter((row) => row.source === 'vendor')
                          .map((row) => `${row.name}${row.vendor?.license ? `  [${row.vendor.license}]` : ''}${row.vendor?.repo ? `  ${row.vendor.repo.split('/').pop()}@${String(row.vendor.ref ?? '').slice(0, 7)}` : ''}`)
                          .join('\n'))
                    : h('div', { style: S.sub }, tf('settings.skillsNoVendor')),
                  h('div', { style: { ...S.sub, marginTop: 6 } }, tf('settings.skillsRoot', { path: skillCat.roots?.vendor ?? '' })))
              : null,
            skillCheck
              ? h('div', { style: { marginTop: 8 } },
                  h('div', { style: { fontSize: 12.5, fontWeight: 600 } },
                    skillCheck.ok
                      ? tf('settings.skillsCheckOk', {
                          passed: skillCheck.passed,
                          checked: skillCheck.checked,
                          pinned: skillCheck.manifest?.pinned ?? 0,
                          rows: skillCheck.manifest?.rows ?? 0,
                        })
                      : tf('settings.skillsCheckBad', { n: (skillCheck.failed?.length ?? 0) + (skillCheck.problems?.length ?? 0) })),
                  (skillCheck.failed ?? []).map((row) => h('div', { key: row.name, style: { ...S.sub, color: '#d06a5f' } }, tf('settings.skillsFailLine', { name: row.name, reason: row.reason }))),
                  (skillCheck.problems ?? []).map((line, i) => h('div', { key: `p${i}`, style: { ...S.sub, color: '#d06a5f' } }, line)))
              : null),

          h('div', { style: { ...S.row, marginTop: 6 } },
            h('button', { style: S.button, onClick: save }, tf('common.save')),
            h('button', { style: S.button, onClick: () => setDraft(state.data?.values ?? draft) }, tf('settings.restore')),
            saved ? h('span', { style: S.sub }, saved) : null),
          rejected.length
            ? h('div', { style: { ...S.sub, color: '#d06a5f' } }, tf('settings.rejected', { keys: rejected.join(', ') }))
            : null,
          error ? h(ErrorBox, { error }) : null,
        )
      }
    }


    /* ── 注册 ───────────────────────────────────────────────────────────────
       id 与 key 必须是同一个字符串：侧栏图标点下去就是把 main 切到同名 key。      */

    /* ── 浏览器标签 ────────────────────────────────────────────────────────
       外壳的静态 index.html 写着自家名字，这里改成产品名；路由切换时外壳可能
       把 title 写回去，所以盯着 head 变化重设。只在值不同时写，避免自触发。   */

    function applyDocumentTitle(ctx) {
      if (typeof document === 'undefined' || !document.head) return
      // 标签跟着语言走：切到英文时浏览器标签也要是英文
      const want = () => tf('app.title')
      const set = () => {
        const title = want()
        if (document.title !== title) document.title = title
      }
      set()
      if (typeof MutationObserver === 'undefined') return
      const observer = new MutationObserver(set)
      observer.observe(document.head, { childList: true, subtree: true, characterData: true })
      const offLocale = ctx.locale?.subscribe?.(set)
      const stop = () => {
        observer.disconnect()
        if (typeof offLocale === 'function') offLocale()
      }
      if (typeof ctx.effect === 'function') ctx.effect(() => stop)
      else if (typeof ctx.on === 'function') ctx.on('dispose', stop)
    }

    function apply(ctx) {
      const t = ctx.locale.bind(NS)

      // bind 只是拿到查表函数，词典还得注册；不注册 t() 会把 key 原样吐回来。
      if (typeof ctx.effect === 'function') ctx.effect(() => ctx.locale.register(NS, { zh: DICT_ZH, en: DICT_EN }), 'deepscient: 词典')
      // 胶囊、引导、设置页要换一级面板，先把 ctx 交出去给 requestPanel
      panelHost.ctx = ctx
      // 文案与语言切换：tf() 读 i18n.t，useLocaleRevision() 从 i18n.ctx 拿订阅口
      i18n.t = t
      i18n.ctx = ctx

      const SettingsSection = makeSettingsSection(ctx)
      const UsageDockPill = makeUsagePill(ctx)
      const Onboarding = makeOnboarding(ctx)

      applyDocumentTitle(ctx)

      ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.register({ name: 'sidebar.brand.mark', locale: NS }, BrandMark))

      ctx.slots.inject('sidebar.brand.name', () =>
        ctx.slots.register({ name: 'sidebar.brand.name', locale: NS }, BrandName))

      // 空白会话欢迎页的品牌位。不接这里，第一屏大字标还是外壳自己的。
      ctx.slots.inject('conversation.hero.brand.mark', () =>
        ctx.slots.register({ name: 'conversation.hero.brand.mark', locale: NS }, () => h(BrandMark, { size: 30 })))

      // 六个一级面板：侧栏 id 与 main 的 key 出自同一张 PAGES 表
      for (const page of PAGES) {
        const id = panelId(page.key)
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id, order: page.order, locale: NS, label: () => t(`panel.${page.key}`) },
            page.Icon,
          ))

        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: id, locale: NS }, page.Component))
      }

      ctx.slots.inject('settings.section', () =>
        ctx.slots.register({ name: 'settings.section', id: PANEL_ID, order: 40, locale: NS, label: () => t('settings.title') }, SettingsSection))

      // 底部：只报 token 消耗。出厂那颗（含缓存命中率）已被首屏样式摘掉，这里补一颗只讲 token 的。
      ctx.slots.inject('conversation.composer.dock', () =>
        ctx.slots.register({ name: 'conversation.composer.dock', id: 'deepscient-usage', order: 1, locale: NS }, UsageDockPill))

        // 科研需求向导：挂在 composer 工具栏（模型选择器之后）。single 槽，实测空着，
        // 且它是唯一同时提供 inputActions（写草稿/提交）与 onActiveChange（展开时让出宽度）的位置。
        // 本实例（DeepScient）的预设就是科研模式，不额外做开关——多一个开关就多一处会漂的状态。
        const RequirementWizard = makeRequirementWizard()
        ctx.slots.inject('conversation.input.activity', () =>
          ctx.slots.register({ name: 'conversation.input.activity', locale: NS }, RequirementWizard))

      // 首次打开的分步引导：只在 onboardingDone 不为 true 时渲染。
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'deepscient-onboarding', order: 900, locale: NS }, Onboarding))

      // 应用账号：没有会话就整页拦住登录卡片。order 很小 = 盖在首屏引导之上。
      const AuthGate = makeAuthGate(ctx)
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'deepscient-auth-gate', order: 5, locale: NS }, AuthGate))

      // 侧栏底部常驻账号入口：头像 + 浮层菜单（登出）。
      const AccountEntry = makeAccountEntry()
      ctx.slots.inject('sidebar.footer.action', () =>
        ctx.slots.register(
          { name: 'sidebar.footer.action', id: 'deepscient.account', order: 10, locale: NS, label: () => t('auth.accountMenu') },
          AccountEntry,
        ))

      const AccountMenu = makeAccountMenu()
      ctx.slots.inject('shell.overlay', () =>
        ctx.slots.register({ name: 'shell.overlay', id: 'deepscient-account-menu', order: 4, locale: NS }, AccountMenu))

      // 设置里的「账号」一节：登出与改密码。
      const AccountSection = makeAccountSection()
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register({ name: 'settings.section', id: 'deepscient-account', order: 45, locale: NS, label: () => t('auth.settings') }, AccountSection))
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
