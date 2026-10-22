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
      "app.title": "DeepScient · 科研工作台",
      "auth.accountHint": "在「设置 → 账号」里查看与刷新额度。",
      "auth.accountMenu": "账号",
      "auth.balanceLabel": "API 额度",
      "auth.balanceUnknown": "未知",
      "auth.canceled": "已取消授权。",
      "auth.close": "关闭",
      "auth.email": "邮箱",
      "auth.expired": "登录已过期，请重新登录。",
      "auth.expiresAt": "登录有效期至",
      "auth.eyebrow": "DEEPSCIENT · 账号",
      "auth.failed": "没能完成，再试一次。",
      "auth.footnote": "登录由 deepscient.com 提供 · 本机不保存密码",
      "auth.freeBadge": "科研应用永久免费 · 不收订阅费",
      "auth.gateHint": "登录会打开官网授权页；没有账号先去官网注册。密码不经过本机。",
      "auth.gateIntro": "账号由官网 deepscient.com 管理。这里不注册、不存密码；登录只为读取你的 API 额度与充值入口。",
      "auth.gateTitle": "登录 DeepScient",
      "auth.loading": "读取中…",
      "auth.loginWith": "登录 DeepScient",
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
      "auth.step1Desc": "在 deepscient.com 登录或注册",
      "auth.step1Title": "官网账号",
      "auth.step2Desc": "确认把本机应用连接到你的账号",
      "auth.step2Title": "浏览器授权",
      "auth.step3Desc": "授权完成后自动进入工作台，密码不经过本机",
      "auth.step3Title": "自动返回",
      "auth.timeout": "授权窗口没有回来。重新点一次登录，或检查浏览器是否拦截了弹窗。",
      "auth.unreachable": "连不上账号服务，检查网络或实例是否还在运行。",
      "auth.unreachableTitle": "连不上账号服务",
      "auth.updatedAt": "更新于",
      "auth.waiting": "等待官网确认授权…完成后会自动进入。",
      "auth.waitingShort": "等待授权…",
      "auth.website": "打开 deepscient.com",
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
      "brand.tagline": "科研",
      "common.cancel": "取消",
      "common.copied": "已复制",
      "common.copy": "复制",
      "common.done": "完成",
      "common.empty": "还没有数据",
      "common.loadFailed": "读不到数据",
      "common.loading": "读取中…",
      "common.no": "否",
      "common.notReady": "未就绪",
      "common.refresh": "刷新",
      "common.refreshing": "刷新中…",
      "common.retry": "重试",
      "common.save": "保存",
      "common.yes": "是",
      "docs.notPacked": "说明文档还没打包进来（deepscient/docs/*.md）。",
      "gate.status.fail": "未通过",
      "gate.status.manual": "自查",
      "gate.status.pass": "通过",
      "gate.status.skip": "未留记录",
      "gate.status.unknown": "未判定",
      "guide.aria": "DeepScient 使用引导",
      "guide.check.broken": " — 激活失败：{reason}",
      "guide.check.dataRoot": "数据根：{path}",
      "guide.check.intro": "先确认这套东西真的起来了。下面五项都对，就可以往下走。",
      "guide.check.keyMissing": "未配置（设置 → 模型）",
      "guide.check.modeBundled": "包直读",
      "guide.check.modeRuntime": "运行中",
      "guide.check.model": "模型：{model} — key {key}",
      "guide.check.notRead": "未读到",
      "guide.check.preset": "预设：{preset}",
      "guide.check.presetValue": "{name}（{id}）{broken}",
      "guide.check.product": "产品：{product} {version}",
      "guide.check.science": "科研库：{state}",
      "guide.check.settingsPath": "偏好文件：{path}",
      "guide.check.stateLoaded": "已装载（{mode}）",
      "guide.check.stateUnavailable": "未就绪 — {reason}",
      "guide.check.waiting": "等待读取",
      "guide.copyFailed": "复制失败，请手动选择文本。",
      "guide.creating": "建题中…",
      "guide.errorTitle": "引导遇到问题",
      "guide.model.foot": "每个 provider 的 key 就是计费主体；账单在中转站，本页只做同口径统计。",
      "guide.model.goBilling": "看计费与 key 归属",
      "guide.model.intro": "模型和它的 key 决定你能干活、以及账记在谁头上。",
      "guide.model.noKeys": "还没读到凭据来源。启动器用环境变量注入 key，或在「设置 → 模型」里填。",
      "guide.next": "下一步",
      "guide.prev": "上一步",
      "guide.project.create": "建这个课题",
      "guide.project.created": "已建好：{title}",
      "guide.project.createdMeta": "id {id}；进度 {progress}",
      "guide.project.domainPh": "学科/领域（可空，例：认知神经科学）",
      "guide.project.intro": "一个课题 = 一个能写完的故事。先给它一个题目，学科和目标刊可以以后改。",
      "guide.project.journalPh": "目标刊（可空，例：Nature Human Behaviour）",
      "guide.project.titlePh": "题目，例如：睡眠时长与工作记忆的剂量效应",
      "guide.rules.intro": "十二条流程、55 道门。记住三条就够开工：",
      "guide.rules.notice": "随时可以重开这份引导：设置 → 科研工作台 → 重新打开使用引导。",
      "guide.rules.one": "每个结论都要能在原文里指出来 —— 没有出处的断言算阻塞，不算「差不多」。",
      "guide.rules.three": "阶段没过是门没开，不是模型偷懒：去「流程」看是哪一道，它会告诉你补什么。",
      "guide.rules.two": "数据、代码、图、环境指纹都留痕；重跑要能复现同一张图。",
      "guide.saving": "保存中…",
      "guide.session.copied": "已复制",
      "guide.session.copy": "复制",
      "guide.session.errorCreate": "建课题失败",
      "guide.session.errorGeneric": "会话没建起来：界面只说「新建会话失败」，真实原因在 设置 → 科研 → 预设体检（/presets/inspect）",
      "guide.session.errorKeyMissing": "会话没建起来：模型 key 未配置（设置 → 模型），配好再回来点一次",
      "guide.session.errorNoPath": "既没有现成工作区，也拿不到课题目录，没法建工作区",
      "guide.session.errorNoUi": "当前界面没有 uiWorkspace 服务，没法开会话",
      "guide.session.errorNoWorkspaceId": "建工作区没有返回 id（{path}）",
      "guide.session.intro": "选一条，点「用这条开会话」：会话会开好，这句话已经在输入框里，你确认后按回车就开跑。",
      "guide.session.open": "用这条开会话",
      "guide.session.preset": "预设：{name}",
      "guide.session.presetFailed": "预设「{name}」激活失败：{reason}",
      "guide.session.presetPending": "预设：等注册表回报",
      "guide.session.started": "已开好",
      "guide.session.startedDetail": "会话已开好，提示词已放进输入框；按回车就开跑。",
      "guide.session.starting": "正在开会话…",
      "guide.skip": "跳过引导",
      "guide.skipConfirm": "跳过引导后可以随时在设置里重新打开。确定跳过？",
      "guide.sources.foot": "填完关掉面板页就能回到这里，再点下一步。",
      "guide.sources.go": "去填 API",
      "guide.sources.intro": "文献/检索 API：已配置 {ready}/{total}。全部可以不填，先用公开池也能跑。",
      "guide.sources.keys": "Semantic Scholar / CORE / Zotero / Exa：有 key 更稳，没有也能用。",
      "guide.sources.polite": "OpenAlex / Unpaywall / Crossref：填邮箱即可进 polite pool，最省事的三个。",
      "guide.sources.secrets": "密钥只写到本机 science/config.json，不上传、不回显。",
      "guide.start": "开始科研",
      "guide.stepProgress": "{current} / {total}",
      "guide.template.hypothesis.tag": "假设与样本量",
      "guide.template.hypothesis.text": "把「<现象>」写成可检验的假设：H1 明确自变量、因变量与预期方向；用 science_exp_plan 给出最小可复现的样本量、实验步骤，用 science_statistics_choice 指定主分析模型，并列出预注册要点。",
      "guide.template.map.tag": "文献地图",
      "guide.template.map.text": "围绕「<研究问题>」建一张文献地图：用 science_lit_query 取核心 15 篇，用 science_gap_matrix 标出未被覆盖的空白；每条结论都给出出处、证据强度、是否可复现。",
      "guide.template.topic.tag": "选题定位",
      "guide.template.topic.text": "我在做「<方向>」。先用 science_frontier_scan 扫近两年的前沿锚点，再用 science_novelty 给三个候选选题打新颖性分，最后只告诉我哪一个值得做成一篇、为什么。",
      "guide.title": "开始你的第一个课题",
      "meta.description": "把选题、检索、样本量、清洗、统计、作图、写作、内审、投稿串成一条有门的流程，并在侧栏给出可直接看的研究状态面板。",
      "meta.title": "DeepScient 科研工作台",
      "net.notJson": "返回的不是 JSON（{status}）",
      "net.notJsonBody": "返回的不是 JSON（{status}）：{body}",
      "net.unreachable": "连不上本机服务，请确认实例还在运行。",
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
      "pill.title": "只统计今天消耗的 token；金额与明细在「计费」页，真值在 New API 中转站",
      "pill.tokens": "今日 {n} tokens",
      "reason.blocking": "阻塞",
      "reason.blockingWith": "阻塞 {n}",
      "reason.selfCheck": "自查",
      "reason.todo": "待办",
      "reason.unrecorded": "未留记录",
      "reason.unrecordedWith": "未留记录 {n}",
      "reason.warning": "警告",
      "reason.warningWith": "警告 {n}",
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
      "settings.addRow": "添加一行",
      "settings.alphaError": "α 必须在 0 与 1 之间（不含 0）。",
      "settings.billingHint": "填了价目，计费页和底部胶囊才会出现「≈金额」。命中缓存的输入与未命中的输入分开算：缓存通常便宜一个数量级，混在一起会虚高。",
      "settings.billingTitle": "计费价目（每百万 token 单价）",
      "settings.colCache": "缓存命中/M",
      "settings.colInput": "输入/M",
      "settings.colOutput": "输出/M",
      "settings.emptyPrice": "还没有价目行。",
      "settings.field.alpha": "显著性水平 α",
      "settings.field.billingBaseUrl": "New API 中转站地址",
      "settings.field.billingConsoleUrl": "账单 / 余额页",
      "settings.field.billingCurrency": "币种",
      "settings.field.billingProvider": "计费口径来源",
      "settings.field.correction": "多重比较校正",
      "settings.field.defaultDiscipline": "默认学科包",
      "settings.field.defaultJournal": "默认目标刊",
      "settings.field.effectSize": "默认效应量",
      "settings.field.evidenceStrictness": "证据链严格度",
      "settings.field.figureUnits": "出图单位",
      "settings.field.locale": "界面语言",
      "settings.field.networkForSearch": "检索是否允许联网",
      "settings.goSources": "去填文献 / 检索 API",
      "settings.guideHint": "引导在新建的浏览器里第一次打开时自动出现；重开后立刻会再出现一次。",
      "settings.guideTitle": "使用引导与接入",
      "settings.introPrefix": "这些是偏好，不是能力开关。改完立刻生效，落在本实例自己的数据根里（",
      "settings.introSuffix": "）。",
      "settings.loading": "读取中…",
      "settings.ph.billingBaseUrl": "https://<你的 New API 中转站地址>",
      "settings.ph.billingConsoleUrl": "https://<中转站>/panel/token",
      "settings.ph.model": "模型名或 *",
      "settings.ph.provider": "tree 或 *",
      "settings.presetBroken": "（激活失败）",
      "settings.presetCurrent": "当前预设：{list}",
      "settings.presetDefault": "（默认）",
      "settings.presetFailed": " — 激活失败：{reason}",
      "settings.presetInspect": "看每一行插件的状态",
      "settings.presetNone": "还没读到预设注册表。",
      "settings.presetTitle": "预设体检",
      "settings.presetUnavailable": "读不到：{reason}",
      "settings.presetUnknown": "未知原因",
      "settings.priceRowInvalid": "有一行价目只填了 provider / 模型，没有任何单价；这一行保存后会被丢弃。",
      "settings.rejected": "未接受：{keys}",
      "settings.remove": "删除",
      "settings.reopenDone": "使用引导已重新打开：切回对话或刷新页面就能看到",
      "settings.reopenGuide": "重新打开使用引导",
      "settings.restore": "还原",
      "settings.savedAt": "已保存 {at}",
      "settings.saveFailed": "保存失败",
      "settings.saving": "保存中…",
      "settings.skillsCatalog": "目录进系统提示约 {tokens} tokens（描述按 260 字截断）。host 平面视图 {host} 条 —— 会话跑在科研预设里，以「会话里应有」为准。",
      "settings.skillsCheck": "检查已装技能",
      "settings.skillsCheckBad": "有 {n} 处问题",
      "settings.skillsCheckOk": "全部通过：{passed}/{checked} 条，manifest {pinned}/{rows} 条已 pin",
      "settings.skillsCounts": "随包 {bundled} 条 · vendor {vendor} 条 · 自己的 {user} 条 · 会话里应有 {session} 条",
      "settings.skillsFailLine": "{name}：{reason}",
      "settings.skillsHint": "随包科研技能 + 第三方 vendor 技能。vendor 由 scripts/install-skills.mjs 按 manifest 装，装在 $DSH_HOME/science/skills-vendor。",
      "settings.skillsNoVendor": "还没有 vendor 技能：跑 node scripts/install-skills.mjs --apply",
      "settings.skillsRoot": "根：{path}",
      "settings.skillsShow": "看装了哪些技能",
      "settings.skillsTitle": "技能目录",
      "settings.title": "科研",
      "settings.wildcard": "provider / 模型填 * 表示通配。",
      "sources.colCredential": "凭据",
      "sources.colFill": "填写",
      "sources.colSource": "数据源",
      "sources.colStatus": "状态",
      "sources.colValue": "当前值",
      "sources.colVerify": "验证",
      "sources.configured": "已配置",
      "sources.count": "已配置 {ready}/{total}。留空保存即清除。",
      "sources.failed": "失败",
      "sources.foot": "标「已保存·工具侧尚未读取」的字段：本页可以保存与连通性测试，但当前 dsh-science 版本的检索运行时还没消费它 —— 不是这里没存进去。",
      "sources.fromEnv": "来自环境变量 ",
      "sources.hasCredential": "有凭据",
      "sources.heading": "科研 / 文献 / 检索 API",
      "sources.kindEmail": "邮箱",
      "sources.kindKey": "Key",
      "sources.kindNone": "免填",
      "sources.missingCredential": "缺凭据",
      "sources.noCredential": "无需凭据",
      "sources.notConfigured": "未配置",
      "sources.noteDefault": "密钥只写入本机 science/config.json。",
      "sources.pasteKey": "粘贴 key 后保存",
      "sources.saved": "已保存 {at}",
      "sources.savedAt": "已保存 {id} {at}",
      "sources.saving": "保存中…",
      "sources.test": "测试",
      "sources.testing": "测试中…",
      "sources.verifyOk": "通 {ms}ms",
      "sources.wired.declared": "已保存·工具侧尚未读取",
      "sources.wired.none": "免凭据",
      "sources.wired.runtime": "已接入工具",
      "stages.blockingCount": "{n} 阻塞",
      "stages.colGate": "门",
      "stages.colHow": "怎么过",
      "stages.colSeverity": "等级",
      "stages.colStatus": "状态",
      "stages.gates": "阶段门",
      "stages.incomplete": "未完成",
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
      "wizard.hint": "先把已知的说清楚；留空比编一个更有用。最后会生成一条给科研助理的任务书。",
      "wizard.hintField.question": "一句话写清：在什么对象里，什么相比什么，影响什么，观察多久。",
      "wizard.mandate.ask": "请先用 science_requirement_brief 的 draft 把它结构化成需求书，把缺口列给我；我补齐后再 commit 建课题。",
      "wizard.mandate.intro": "我要开一个新课题，先把需求说清楚：",
      "wizard.mandate.line": "- {label}：{value}",
      "wizard.needQuestion": "至少填「研究问题」才能生成任务书。",
      "wizard.noTarget": "这个界面没有可写入的输入框，内容已保留在面板里。",
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
      "auth.eyebrow": "DEEPSCIENT · ACCOUNT",
      "auth.failed": "That did not work. Try again.",
      "auth.footnote": "Sign-in is provided by deepscient.com · no password is stored locally",
      "auth.freeBadge": "Free for research · no subscription fees",
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
      "auth.step1Desc": "Sign in or sign up at deepscient.com",
      "auth.step1Title": "Website account",
      "auth.step2Desc": "Approve connecting this app to your account",
      "auth.step2Title": "Browser approval",
      "auth.step3Desc": "The workbench opens automatically; your password never reaches this app",
      "auth.step3Title": "Return automatically",
      "auth.timeout": "The authorization window did not return. Try again, or check whether the browser blocked the popup.",
      "auth.unreachable": "Could not reach the account service. Check your connection or whether the instance is still running.",
      "auth.unreachableTitle": "Cannot reach the account service",
      "auth.updatedAt": "Updated",
      "auth.waiting": "Waiting for approval on deepscient.com… this will continue automatically.",
      "auth.waitingShort": "Waiting…",
      "auth.website": "Open deepscient.com",
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
      "brand.tagline": "Research",
      "common.cancel": "Cancel",
      "common.copied": "Copied",
      "common.copy": "Copy",
      "common.done": "Done",
      "common.empty": "Nothing here yet",
      "common.loadFailed": "Could not load data",
      "common.loading": "Loading…",
      "common.no": "No",
      "common.notReady": "Not ready",
      "common.refresh": "Refresh",
      "common.refreshing": "Refreshing…",
      "common.retry": "Retry",
      "common.save": "Save",
      "common.yes": "Yes",
      "docs.notPacked": "Documentation is not bundled yet (deepscient/docs/*.md).",
      "gate.status.fail": "Failed",
      "gate.status.manual": "Self-check",
      "gate.status.pass": "Passed",
      "gate.status.skip": "Not recorded",
      "gate.status.unknown": "Unknown",
      "guide.aria": "DeepScient onboarding guide",
      "guide.check.broken": " — failed to activate: {reason}",
      "guide.check.dataRoot": "Data root: {path}",
      "guide.check.intro": "First make sure the whole stack is actually up. If the five items below are all right, you can continue.",
      "guide.check.keyMissing": "not configured (Settings → Model)",
      "guide.check.modeBundled": "read from package",
      "guide.check.modeRuntime": "runtime",
      "guide.check.model": "Model: {model} — key {key}",
      "guide.check.notRead": "not read",
      "guide.check.preset": "Preset: {preset}",
      "guide.check.presetValue": "{name} ({id}){broken}",
      "guide.check.product": "Product: {product} {version}",
      "guide.check.science": "Research library: {state}",
      "guide.check.settingsPath": "Preferences file: {path}",
      "guide.check.stateLoaded": "Loaded ({mode})",
      "guide.check.stateUnavailable": "Not ready — {reason}",
      "guide.check.waiting": "waiting to read",
      "guide.copyFailed": "Copy failed; select the text manually.",
      "guide.creating": "Creating…",
      "guide.errorTitle": "Something went wrong",
      "guide.model.foot": "Each provider key is the billing entity; the bill lives in the relay, and this page only reports on the same basis.",
      "guide.model.goBilling": "See billing and key attribution",
      "guide.model.intro": "The model and its key decide what you can do and who gets billed.",
      "guide.model.noKeys": "No credential source found yet. The launcher injects keys through environment variables, or fill them in under Settings → Model.",
      "guide.next": "Next",
      "guide.prev": "Back",
      "guide.project.create": "Create this project",
      "guide.project.created": "Created: {title}",
      "guide.project.createdMeta": "id {id}; progress {progress}",
      "guide.project.domainPh": "Field / domain (optional, e.g. cognitive neuroscience)",
      "guide.project.intro": "A project = one story you can finish. Give it a title first; the field and target journal can change later.",
      "guide.project.journalPh": "Target journal (optional, e.g. Nature Human Behaviour)",
      "guide.project.titlePh": "Title, e.g. dose-response of sleep duration on working memory",
      "guide.rules.intro": "Twelve workflows and 55 gates. Remember three things and you can start:",
      "guide.rules.notice": "You can reopen this guide anytime: Settings → Research Workbench → Reopen the onboarding guide.",
      "guide.rules.one": "Every claim must be pointable in the source — an assertion without a citation is a blocker, not close enough.",
      "guide.rules.three": "A stage not passing means a gate is closed, not that the model is lazy: open Stages to see which gate it is, and it will tell you what to add.",
      "guide.rules.two": "Data, code, figures and environment fingerprints are all recorded; a rerun must reproduce the same figure.",
      "guide.saving": "Saving…",
      "guide.session.copied": "Copied",
      "guide.session.copy": "Copy",
      "guide.session.errorCreate": "Failed to create the project",
      "guide.session.errorGeneric": "Session did not start: the UI only says new session failed; the real reason is in Settings → Research → preset diagnostics (/presets/inspect)",
      "guide.session.errorKeyMissing": "Session did not start: the model key is not configured (Settings → Model). Configure it and click again.",
      "guide.session.errorNoPath": "There is no existing workspace and no project directory, so a workspace cannot be created",
      "guide.session.errorNoUi": "This shell has no uiWorkspace service, so a session cannot be started",
      "guide.session.errorNoWorkspaceId": "Workspace creation returned no id ({path})",
      "guide.session.intro": "Pick one and click Start a session with this: the session is created with the prompt already in the input — press Enter to run.",
      "guide.session.open": "Start a session with this",
      "guide.session.preset": "Preset: {name}",
      "guide.session.presetFailed": "Preset \"{name}\" failed to activate: {reason}",
      "guide.session.presetPending": "Preset: waiting for the registry",
      "guide.session.started": "Started",
      "guide.session.startedDetail": "Session started and the prompt is in the input box; press Enter to run.",
      "guide.session.starting": "Starting session…",
      "guide.skip": "Skip guide",
      "guide.skipConfirm": "You can reopen the guide in Settings. Skip now?",
      "guide.sources.foot": "After saving, close the panel to return here, then click Next.",
      "guide.sources.go": "Fill in API keys",
      "guide.sources.intro": "Literature / search APIs: {ready}/{total} configured. All are optional — the public pool works without them.",
      "guide.sources.keys": "Semantic Scholar / CORE / Zotero / Exa: more reliable with a key, usable without one.",
      "guide.sources.polite": "OpenAlex / Unpaywall / Crossref: just add an email to join the polite pool — the three easiest ones.",
      "guide.sources.secrets": "Keys are written only to the local science/config.json — never uploaded or echoed back.",
      "guide.start": "Start research",
      "guide.stepProgress": "{current} / {total}",
      "guide.template.hypothesis.tag": "Hypothesis and sample size",
      "guide.template.hypothesis.text": "Turn \"<phenomenon>\" into a testable hypothesis: H1 must state the independent variable, dependent variable and expected direction; use science_exp_plan for the smallest reproducible sample size and procedure, science_statistics_choice for the primary model, and list the preregistration points.",
      "guide.template.map.tag": "Literature map",
      "guide.template.map.text": "Build a literature map around \"<research question>\": use science_lit_query to pull the 15 core papers and science_gap_matrix to mark uncovered gaps; every conclusion must give its source, evidence strength, and reproducibility.",
      "guide.template.topic.tag": "Topic framing",
      "guide.template.topic.text": "I am working on \"<direction>\". Start with science_frontier_scan to map frontier anchors from the last two years, then use science_novelty to score three candidate topics for novelty, and finally tell me only which one is worth a paper and why.",
      "guide.title": "Start your first project",
      "meta.description": "A gated path from question to submission — search, power, cleaning, statistics, figures, writing, internal review — plus a live project panel in the sidebar.",
      "meta.title": "DeepScient research workbench",
      "net.notJson": "The response was not JSON ({status})",
      "net.notJsonBody": "The response was not JSON ({status}): {body}",
      "net.unreachable": "Cannot reach the local service; make sure the instance is still running.",
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
      "pill.title": "Today's token usage only; amounts and details live on the Billing page, with the relay as source of truth.",
      "pill.tokens": "Today {n} tokens",
      "reason.blocking": "Blocking",
      "reason.blockingWith": "{n} blocking",
      "reason.selfCheck": "Self-check",
      "reason.todo": "To do",
      "reason.unrecorded": "Unrecorded",
      "reason.unrecordedWith": "{n} unrecorded",
      "reason.warning": "Warning",
      "reason.warningWith": "{n} warning",
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
      "settings.addRow": "Add a row",
      "settings.alphaError": "α must be between 0 and 1 (excluding 0).",
      "settings.billingHint": "Rates are needed before the Billing page and the bottom pill can show an approximate amount. Cached and uncached input are priced separately: cache is usually an order of magnitude cheaper, and mixing them inflates the total.",
      "settings.billingTitle": "Billing rates (price per million tokens)",
      "settings.colCache": "Cache hit/M",
      "settings.colInput": "Input/M",
      "settings.colOutput": "Output/M",
      "settings.emptyPrice": "No rate rows yet.",
      "settings.field.alpha": "Significance level α",
      "settings.field.billingBaseUrl": "New API relay URL",
      "settings.field.billingConsoleUrl": "Billing / balance page",
      "settings.field.billingCurrency": "Currency",
      "settings.field.billingProvider": "Billing source",
      "settings.field.correction": "Multiple comparison correction",
      "settings.field.defaultDiscipline": "Default discipline pack",
      "settings.field.defaultJournal": "Default target journal",
      "settings.field.effectSize": "Default effect size",
      "settings.field.evidenceStrictness": "Evidence chain strictness",
      "settings.field.figureUnits": "Figure units",
      "settings.field.locale": "Interface language",
      "settings.field.networkForSearch": "Allow network search",
      "settings.goSources": "Fill in literature / search APIs",
      "settings.guideHint": "The guide appears automatically the first time a browser opens this app; reopening it shows it again right away.",
      "settings.guideTitle": "Onboarding and integrations",
      "settings.introPrefix": "These are preferences, not capability switches. Changes apply immediately and are stored in the data root of this instance (",
      "settings.introSuffix": ").",
      "settings.loading": "Loading…",
      "settings.ph.billingBaseUrl": "https://<your New API relay URL>",
      "settings.ph.billingConsoleUrl": "https://<relay>/panel/token",
      "settings.ph.model": "Model name or *",
      "settings.ph.provider": "tree or *",
      "settings.presetBroken": " (failed to activate)",
      "settings.presetCurrent": "Current presets: {list}",
      "settings.presetDefault": " (default)",
      "settings.presetFailed": " — failed to activate: {reason}",
      "settings.presetInspect": "Show the status of each plugin fiber",
      "settings.presetNone": "Could not read the preset registry yet.",
      "settings.presetTitle": "Preset diagnostics",
      "settings.presetUnavailable": "Could not read: {reason}",
      "settings.presetUnknown": "unknown reason",
      "settings.priceRowInvalid": "One rate row has only provider / model and no price; it will be dropped when saved.",
      "settings.rejected": "Rejected: {keys}",
      "settings.remove": "Delete",
      "settings.reopenDone": "Onboarding reopened: switch back to the chat or refresh the page to see it.",
      "settings.reopenGuide": "Reopen the onboarding guide",
      "settings.restore": "Revert",
      "settings.savedAt": "Saved {at}",
      "settings.saveFailed": "Save failed",
      "settings.saving": "Saving…",
      "settings.skillsCatalog": "The catalog adds about {tokens} tokens to the system prompt (descriptions truncated at 260 characters). The host-level view lists {host} — sessions run in the research preset, so expected in session is authoritative.",
      "settings.skillsCheck": "Check installed skills",
      "settings.skillsCheckBad": "Issues found: {n}",
      "settings.skillsCheckOk": "All passed: {passed}/{checked}, manifest {pinned}/{rows} pinned",
      "settings.skillsCounts": "Bundled {bundled} · vendor {vendor} · own {user} · expected in session {session}",
      "settings.skillsFailLine": "{name}: {reason}",
      "settings.skillsHint": "Bundled research skills plus third-party vendor skills. Vendor skills are installed from the manifest by scripts/install-skills.mjs into $DSH_HOME/science/skills-vendor.",
      "settings.skillsNoVendor": "No vendor skills yet: run node scripts/install-skills.mjs --apply",
      "settings.skillsRoot": "Root: {path}",
      "settings.skillsShow": "Show installed skills",
      "settings.skillsTitle": "Skill catalog",
      "settings.title": "Research",
      "settings.wildcard": "An asterisk in provider / model means wildcard.",
      "sources.colCredential": "Credential",
      "sources.colFill": "Set value",
      "sources.colSource": "Source",
      "sources.colStatus": "Status",
      "sources.colValue": "Current value",
      "sources.colVerify": "Verify",
      "sources.configured": "Configured",
      "sources.count": "Configured {ready}/{total}. Saving an empty value clears it.",
      "sources.failed": "Failed",
      "sources.foot": "Fields marked \"saved · runtime not reading yet\" can be saved and tested on this page, but the current dsh-science retrieval runtime does not consume them yet — this is not a save failure.",
      "sources.fromEnv": "From environment variable ",
      "sources.hasCredential": "Has credential",
      "sources.heading": "Research / literature / search APIs",
      "sources.kindEmail": "Email",
      "sources.kindKey": "Key",
      "sources.kindNone": "None needed",
      "sources.missingCredential": "Missing credential",
      "sources.noCredential": "No credential required",
      "sources.notConfigured": "Not configured",
      "sources.noteDefault": "Credentials are written only to the local science/config.json.",
      "sources.pasteKey": "Paste a key, then save",
      "sources.saved": "Saved {at}",
      "sources.savedAt": "Saved {id} at {at}",
      "sources.saving": "Saving…",
      "sources.test": "Test",
      "sources.testing": "Testing…",
      "sources.verifyOk": "OK {ms}ms",
      "sources.wired.declared": "Saved; tools have not read it yet",
      "sources.wired.none": "No credential needed",
      "sources.wired.runtime": "Wired to tools",
      "stages.blockingCount": "{n} blocking",
      "stages.colGate": "Gate",
      "stages.colHow": "How to pass",
      "stages.colSeverity": "Severity",
      "stages.colStatus": "Status",
      "stages.gates": "Stage gates",
      "stages.incomplete": "Incomplete",
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
      "wizard.hint": "Write down what you know; leaving a field blank is better than inventing. This produces a brief for your research assistant.",
      "wizard.hintField.question": "One sentence: in which population, what compared with what, affecting what, over how long.",
      "wizard.mandate.ask": "Start with action draft of science_requirement_brief to structure this into a requirement brief and show me the gaps; I will fill them and then commit to open the project.",
      "wizard.mandate.intro": "I am opening a new project. Here is the need, stated up front:",
      "wizard.mandate.line": "- {label}: {value}",
      "wizard.needQuestion": "The research question is the one field required to build a mandate.",
      "wizard.noTarget": "This shell has no input target; your text stays in the panel.",
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

    /* 401 是全局信号：任何接口发现会话过期，登录门都要重新探一次，而不是让各页各自报错。 */
    const unauthorizedState = { at: 0 }
    function notifyUnauthorized() {
      const now = Date.now()
      if (now - unauthorizedState.at < 1000) return
      unauthorizedState.at = now
      try { window.dispatchEvent(new CustomEvent('deepscient:unauthorized')) } catch {}
    }

    async function getJson(path) {
      let res
      try {
        res = await fetch(`${API}${withLocale(path)}`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      } catch {
        throw new Error(tf('net.unreachable'))
      }
      if (res.status === 401) notifyUnauthorized()
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
      let res
      try {
        res = await fetch(`${API}${path}`, {
          method,
          credentials: 'same-origin',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        })
      } catch {
        throw new Error(tf('net.unreachable'))
      }
      if (res.status === 401) notifyUnauthorized()
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
      cobalt: 'var(--ds-brand)',
      mist: 'var(--ds-surface-2)',
      line: 'var(--ds-border)',
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
      radiusXl: 'var(--ds-radius-xl)',
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
      shadowBrand: 'var(--ds-shadow-brand)',
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
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 22px',
        borderBottom: `1px solid ${V.border}`, flexWrap: 'wrap',
      },
      title: { fontSize: V.textLg, fontWeight: 600, letterSpacing: '-0.02em' },
      sub: { fontSize: V.textSm, color: V.fg2, lineHeight: 1.6 },
      spacer: { flex: 1 },
      body: { flex: 1, minHeight: 0, overflow: 'auto', padding: '18px 22px 44px' },
      card: {
        border: `1px solid ${V.border}`, borderRadius: V.radiusLg, padding: 18,
        marginBottom: 14, background: V.surface, boxShadow: '0 1px 2px rgba(7,20,38,.04)',
      },
      row: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' },
      chip: (tone) => ({
        fontSize: V.textXs, padding: '2px 7px', borderRadius: V.radiusPill, border: 'none',
        color: tone === 'pass' ? V.ok : tone === 'fail' ? V.err : 'inherit',
        opacity: tone === 'skip' ? 0.6 : 1,
      }),
      ladder: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
      step: (state) => ({
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: V.radiusMd, fontSize: V.textSm,
        border: `1px dashed ${V.borderStrong}`,
        background: state === 'pass' ? V.okSoft : state === 'fail' ? V.errSoft : 'transparent',
        borderStyle: state === 'manual' ? 'dotted' : 'solid',
        cursor: state === 'idle' ? 'default' : 'pointer',
      }),
      table: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
      th: {
        textAlign: 'left', padding: '8px 10px', background: V.surface2,
        borderBottom: `1px solid ${V.border}`, fontWeight: 600, color: V.fg2,
        fontSize: V.textXs, letterSpacing: '.04em', whiteSpace: 'nowrap',
      },
      td: { padding: '8px 10px', borderBottom: `1px solid ${V.border}`, verticalAlign: 'top', lineHeight: 1.5 },
      mono: { fontFamily: V.fontMono, fontSize: V.textSm },
      button: {
        height: 32, padding: '0 14px', borderRadius: V.radiusPill, cursor: 'pointer',
        border: `1px solid ${V.line || V.border}`, background: V.bg, color: 'inherit',
        fontSize: V.textSm, fontWeight: 500,
      },
      select: {
        fontSize: 12.5, minHeight: 38, padding: '9px 14px', borderRadius: V.radiusLg, color: 'inherit',
        border: `1px solid ${V.border}`, background: V.bg,
      },
      input: {
        fontSize: 12.5, minHeight: 38, padding: '9px 14px', borderRadius: V.radiusLg, color: 'inherit', minWidth: 180,
        border: `1px solid ${V.border}`, background: V.bg,
      },
      notice: { fontSize: 12.5, color: V.fg2, lineHeight: 1.65 },
      pre: {
        fontFamily: V.fontMono, fontSize: 12,
        padding: 14, borderRadius: V.radiusMd, background: V.surface2,
        border: `1px solid ${V.border}`, overflow: 'auto',
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
        { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, style: { display: 'block', color: V.brand } },
        h('ellipse', { cx: 12, cy: 12, rx: 10, ry: 4.4, fill: 'none', stroke: 'currentColor', strokeOpacity: 0.55, strokeWidth: 1.4, transform: 'rotate(-28 12 12)' }),
        h('ellipse', { cx: 12, cy: 12, rx: 10, ry: 4.4, fill: 'none', stroke: 'currentColor', strokeOpacity: 0.3, strokeWidth: 1.2, transform: 'rotate(32 12 12)' }),
        h('circle', { cx: 12, cy: 12, r: 2.4, fill: V.brand }),
      )
    }

    function BrandName() {
      useLocaleRevision()
      return h(
        'span',
        { className: 'ds-wordmark', style: { display: 'inline-flex', alignItems: 'baseline', gap: 2, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.1 } },
        'DeepScient',
        h('span', { className: 'ds-wordmark__dot' }, '.com'),
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
                  h('button', { className: 'ds-btn ds-btn--ghost ds-btn--sm', onClick: () => onJump(current.id) }, tf('overview.jump')),
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
                    target ? h('button', { className: 'ds-btn ds-btn--ghost ds-btn--sm', onClick: () => onJump(target) }, tf('overview.jump')) : null,
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
          h('td', null, h(Chip, { status: REASON_TONE[g.severity] ?? 'skip' }, reasonLabel(g.severity ?? (g.status === 'manual' ? 'self-check' : 'todo')))),
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
      const actionStyle = disabled ? { opacity: 0.55 } : undefined

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
                h('button', { className: 'ds-btn ds-btn--ghost ds-btn--sm', style: actionStyle, disabled, onClick: testPing }, tf('relay.test')),
                h('button', { className: 'ds-btn ds-btn--ghost ds-btn--sm', style: actionStyle, disabled, onClick: syncAccount }, tf('relay.sync')),
                h('button', { className: 'ds-btn ds-btn--ghost ds-btn--sm', style: actionStyle, disabled, onClick: openAccount }, tf('relay.account')),
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
          h('button', { className: 'ds-btn ds-btn--ghost ds-btn--sm', style: actionStyle, disabled, onClick: () => status.reload() }, tf('relay.refresh'))),
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
                    h('button', { className: 'ds-btn ds-btn--primary ds-btn--sm', style: actionStyle, disabled, onClick: buyPlan(plan.planId) }, tf('relay.buy'))))))),
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
                  h('button', { className: 'ds-btn ds-btn--ghost ds-btn--sm', style: actionStyle, disabled, onClick: queryOrder(order.tradeNo) }, tf('relay.query'))))))),
        orderInfo
          ? h('div', { style: { ...S.notice, marginTop: 8 } },
              tf('relay.orderStatus', { tradeNo: orderInfo.order?.tradeNo ?? '—', status: orderInfo.order?.status ?? '—' }))
          : null,
      )

      return h('div', null,
        headerCard,
        error ? h('div', { style: { ...S.card, borderColor: V.err } }, h(Notice, null, error)) : null,
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
        id: 'src-' + item.id,
        className: 'ds-input',
        style: { minWidth: 150 },
        'aria-label': tf('sources.colFill') + ': ' + item.name,
        type: item.kind === 'email' ? 'email' : 'password',
        placeholder: item.kind === 'email' ? 'pi@lab.example' : tf('sources.pasteKey'),
        value: draft[item.id] ?? '',
        onChange: (e) => setDraft((prev) => ({ ...prev, [item.id]: e.target.value })),
      })
    }

    function verifyChip(result) {
      if (!result || !result.status) return null
      if (result.status === 'busy') return h(Chip, { status: 'manual' }, tf('sources.testing'))
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

    function sourceActionCell(item, onSave, onTest, result, busyKind, savedAt) {
      const busy = Boolean(busyKind)
      const nodes = []
      if (item.path) {
        nodes.push(h('button', {
          key: 'save',
          className: 'ds-btn ds-btn--sm',
          disabled: busy,
          onClick: () => onSave(item.id),
        }, busyKind === 'save' ? tf('sources.saving') : tf('common.save')))
      }
      nodes.push(h('button', {
        key: 'test',
        className: 'ds-btn ds-btn--sm',
        disabled: busy,
        onClick: () => onTest(item.id),
      }, busyKind === 'test' ? tf('sources.testing') : tf('sources.test')))
      const chip = verifyChip(result)
      if (chip) nodes.push(h('span', { key: 'chip' }, chip))
      if (result && result.hint) nodes.push(h('div', { key: 'hint', style: { fontSize: 11, opacity: 0.65, width: '100%' } }, result.hint))
      if (savedAt) nodes.push(h('span', { key: 'saved', className: 'ds-sub' }, tf('sources.saved', { at: savedAt })))
      return h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } }, nodes)
    }

    function sourceRow(item, draft, setDraft, onSave, onTest, result, busyKind, savedAt) {
      return h('tr', { key: item.id },
        h('td', { style: S.td },
          h('a', { href: item.applyUrl, target: '_blank', rel: 'noreferrer', className: 'ds-link' }, item.name),
          item.hint ? h('div', { style: { fontSize: 11, opacity: 0.6, marginTop: 2 } }, item.hint) : null),
        h('td', { style: S.td }, item.kind === 'none' ? tf('sources.kindNone') : item.kind === 'email' ? tf('sources.kindEmail') : tf('sources.kindKey')),
        h('td', { style: S.td }, sourceStatusCell(item)),
        h('td', { style: { ...S.td, ...S.mono, opacity: 0.8 } }, item.masked || '—'),
        h('td', { style: S.td }, sourceInputCell(item, draft, setDraft)),
        h('td', { style: S.td }, sourceActionCell(item, onSave, onTest, result, busyKind, savedAt)))
    }

    function SourcesPanel({ sources }) {
      useLocaleRevision()
      const [draft, setDraft] = useState({})
      const [result, setResult] = useState({})
      const [busy, setBusy] = useState({})
      const [saved, setSaved] = useState({})
      const [error, setError] = useState('')
      const timers = useRef({})

      useEffect(() => () => {
        Object.keys(timers.current).forEach((id) => clearTimeout(timers.current[id]))
        timers.current = {}
      }, [])

      if (sources.status === 'loading') return h(Loading)
      if (sources.status === 'error') return h(ErrorBox, { error: sources.error, onRetry: sources.reload })

      const data = sources.data ?? {}
      const items = data.items ?? []

      const save = async (id) => {
        if (busy[id]) return
        setBusy((prev) => ({ ...prev, [id]: 'save' }))
        setError('')
        try {
          const payload = await sendJson('PUT', '/sources', { items: { [id]: draft[id] ?? '' } })
          if ((payload.rejected ?? []).length) throw new Error(payload.rejected.map((r) => r.reason).join('；'))
          setDraft((prev) => ({ ...prev, [id]: '' }))
          setSaved((prev) => ({ ...prev, [id]: new Date().toLocaleTimeString() }))
          if (timers.current[id]) clearTimeout(timers.current[id])
          timers.current[id] = setTimeout(() => {
            delete timers.current[id]
            setSaved((prev) => ({ ...prev, [id]: '' }))
          }, 4000)
          sources.reload()
        } catch (e) {
          setResult((prev) => ({ ...prev, [id]: { status: 'fail', hint: e.message } }))
          setError(e.message)
        } finally {
          setBusy((prev) => ({ ...prev, [id]: '' }))
        }
      }

      const test = async (id) => {
        if (busy[id]) return
        setBusy((prev) => ({ ...prev, [id]: 'test' }))
        setResult((prev) => ({ ...prev, [id]: { status: 'busy' } }))
        try {
          const payload = await sendJson('POST', '/sources/verify', { id })
          setResult((prev) => ({ ...prev, [id]: payload }))
        } catch (e) {
          setResult((prev) => ({ ...prev, [id]: { status: 'fail', hint: e.message } }))
        } finally {
          setBusy((prev) => ({ ...prev, [id]: '' }))
        }
      }

      const head = [
        tf('sources.colSource'),
        tf('sources.colCredential'),
        tf('sources.colStatus'),
        tf('sources.colValue'),
        tf('sources.colFill'),
        tf('sources.colVerify'),
      ]

      const rows = items.map((item) => sourceRow(item, draft, setDraft, save, test, result[item.id], busy[item.id], saved[item.id]))
      const configured = items.filter((item) => item.configured).length

      return h('div', null,
        h('div', { key: 'title', style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, tf('sources.heading')),
        sources.status === 'refreshing' ? h(Refreshing, { key: 'refreshing' }) : null,
        h(Notice, { key: 'note' },
          h('div', null, data.note ?? tf('sources.noteDefault')),
          h('div', { style: { ...S.mono, opacity: 0.7, marginTop: 4 } }, data.path ?? '')),
        h('div', { key: 'count', style: { ...S.sub, margin: '10px 0' } }, tf('sources.count', { ready: configured, total: items.length })),
        h(Table, { key: 'table', head, caption: tf('sources.heading') }, rows),
        error ? h(ErrorBox, { key: 'error', error }) : null,
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
        width: 'min(430px, 92vw)', padding: 28, borderRadius: V.radiusXl,
        border: `1px solid ${V.line}`,
        boxShadow: V.shadow1, textAlign: 'left',
      },
      brand: { fontSize: V.textSm, letterSpacing: '0.08em', opacity: 0.5, marginBottom: '6px' },
      title: { fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', marginBottom: '6px' },
      intro: { fontSize: V.textSm, opacity: 0.65, lineHeight: 1.6, marginBottom: '18px' },
      row: { marginBottom: '12px' },
      label: { display: 'block', fontSize: V.textSm, fontWeight: 500, marginBottom: '4px' },
      input: {
        width: '100%', boxSizing: 'border-box', padding: '9px 10px', fontSize: V.textMd, minHeight: 38,
        borderRadius: V.radiusLg, border: `1px solid ${V.line}`,
        background: V.bg, color: 'inherit', fontFamily: 'inherit',
      },
      submit: {
        width: '100%', height: 44, padding: '0 16px', borderRadius: V.radiusPill, fontSize: V.textMd, cursor: 'pointer',
        border: `1px solid ${V.brand}`, background: V.brand, color: V.onBrand, fontWeight: 600,
        boxShadow: V.shadowBrand,
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
        borderRadius: V.radiusLg, border: `1px dashed ${V.brand}`,
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
        padding: '6px 8px', borderRadius: V.radiusMd, border: 'none', background: 'transparent',
        color: 'inherit', cursor: 'pointer', font: 'inherit', textAlign: 'left', minWidth: 0,
      },
      narrow: {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '34px', height: '34px', padding: 0, borderRadius: '50%',
        border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer',
      },
      avatar: {
        flex: '0 0 auto', width: '28px', height: '28px', borderRadius: '50%',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: V.brandSoft, color: V.brand, fontSize: V.textSm, fontWeight: 650,
        textTransform: 'uppercase',
      },
      name: { fontSize: V.textSm, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      backdrop: {
        position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(7,20,38,.45)',
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'auto', padding: '24px',
      },
      panel: {
        position: 'relative',
        width: 'min(360px, 92vw)', padding: 22, borderRadius: V.radiusXl,
        background: V.surface, border: `1px solid ${V.line}`,
        boxShadow: V.shadow2,
      },
      panelName: { fontSize: V.textLg, fontWeight: 600, marginBottom: '2px' },
      panelSub: { fontSize: V.textSm, color: V.fg2, marginBottom: '14px' },
      actions: { display: 'flex', flexDirection: 'column', gap: '8px' },
      action: {
        width: '100%', justifyContent: 'flex-start', textAlign: 'left',
      },
      close: {
        position: 'absolute', top: '8px', right: '8px', width: '28px', height: '28px',
        display: 'grid', placeItems: 'center', padding: 0, borderRadius: V.radiusPill,
        border: 'none', background: 'transparent', color: 'inherit',
        cursor: 'pointer', fontSize: V.textLg, lineHeight: 1,
      },
      note: { fontSize: '11.5px', color: V.fg2, marginTop: '10px', lineHeight: 1.6 },
    }

    /** 这几个端点要带着 cookie，且要能读出服务端说的错误原因。 */
    async function authCall(path, options) {
      let response
      try {
        response = await fetch('/deepscient/auth' + path, {
          method: options?.method ?? 'GET',
          credentials: 'same-origin',
          headers: options?.body ? { 'content-type': 'application/json; charset=utf-8' } : undefined,
          body: options?.body ? JSON.stringify(options.body) : undefined,
        })
      } catch {
        // 网络层失败不是「没登录」：调用方要靠 networkError 区分，别把人当成匿名。
        return { ok: false, status: 0, data: null, networkError: true }
      }
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
        const submitRef = useRef(null)
        const retryRef = useRef(null)
        useLocaleRevision()

        // 只读状态、只写 state：探针没有闭包依赖，可以安全地给事件与重试按钮复用。
        const probe = () => {
          authCall('/state').then(
            (result) => {
              if (result.networkError || !result.ok || !result.data) {
                setState({ phase: 'unreachable' })
                setError(tf('auth.unreachable'))
                return
              }
              authSite.site = result.data.site ?? null
              setState({ phase: result.data.loggedIn ? 'authed' : 'anon' })
              setError(result.data.loggedIn ? '' : authErrorText(result.data.error))
            },
            () => {
              setState({ phase: 'unreachable' })
              setError(tf('auth.unreachable'))
            },
          )
        }

        useEffect(() => { probe() }, [])

        // 任何接口撞上 401 都从这里回到探针：会话过期时登录门自己亮出来。
        useEffect(() => {
          const onUnauthorized = () => probe()
          window.addEventListener('deepscient:unauthorized', onUnauthorized)
          return () => window.removeEventListener('deepscient:unauthorized', onUnauthorized)
        }, [])

        // 从浏览器授权完回到窗口（或窗口重新获得焦点）时对一次状态：
        // 服务端已经登录就重载，让 mux 用新身份重连。轮询之外的兜底，
        // 覆盖「授权窗口比 5 分钟轮询更久」「先在外面登录、再回窗口」这类顺序。
        useEffect(() => {
          const sync = () => {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
            authCall('/state').then((result) => {
              if (result.ok && result.data?.loggedIn && state.phase !== 'authed') window.location.reload()
            }, () => {})
          }
          window.addEventListener('focus', sync)
          document.addEventListener('visibilitychange', sync)
          return () => {
            window.removeEventListener('focus', sync)
            document.removeEventListener('visibilitychange', sync)
          }
        }, [state.phase])

        // 授权在另一个窗口完成；这个页面自己发现登录态变了就重载，让 mux 用新身份重连。
        useEffect(() => {
          if (!waiting) return undefined
          const timer = setInterval(() => {
            authCall('/state').then((result) => {
              if (result.ok && result.data?.loggedIn) window.location.reload()
            }, () => {})
          }, 2000)
          const stop = setTimeout(() => {
            setWaiting(false)
            setError(tf('auth.timeout'))
          }, 5 * 60 * 1000)
          return () => { clearInterval(timer); clearTimeout(stop) }
        }, [waiting])

        // 状态一亮出来就把焦点交给主按钮：加载结束或连接恢复后可以直接回车。
        useEffect(() => {
          if (state.phase === 'unreachable') retryRef.current?.focus()
          else if (state.phase === 'anon') submitRef.current?.focus()
        }, [state.phase])

        const login = async () => {
          if (busy || waiting) return
          setBusy(true)
          setError('')
          try {
            const result = await authCall('/authorize', { method: 'POST' })
            if (result.networkError) {
              setError(tf('auth.unreachable'))
              return
            }
            if (!result.ok || !result.data?.authorizeUrl) {
              setError(result.data?.message || tf('auth.failed'))
              return
            }
            const opened = window.open(result.data.authorizeUrl, '_blank', 'noopener,noreferrer')
            // 桌面壳把外链交给系统浏览器、同时拒绝创建窗口（window.open 返回 null），
            // 而且 will-navigate 会拦下 location.href 跳转——所以桌面形态只能进入轮询等待，
            // 绝不能导航（导航被拦后既不开浏览器也不轮询，账号状态就永远不同步）。
            if (location.protocol === 'dsh-app:') {
              setWaiting(true)
              return
            }
            // 弹窗被拦时退回同页跳转：官网回来会落在 /auth/callback，那一页再把人送回来。
            if (!opened) {
              window.location.href = result.data.authorizeUrl
              return
            }
            setWaiting(true)
          } catch {
            setError(tf('auth.unreachable'))
          } finally {
            setBusy(false)
          }
        }

        if (state.phase === 'loading') return null
        if (state.phase === 'authed') return null

        // 连不上服务时不摆登录按钮：授权也没法完成，先修连接；重试按钮随 phase 变化接管焦点。
        const unreachable = state.phase === 'unreachable'
        const site = authSite.site
        return h('div', { className: 'ds-auth ds-veil', 'data-deepscient-auth': 'gate' },
          h('div', {
            className: 'ds-auth__card',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-label': tf(unreachable ? 'auth.unreachableTitle' : 'auth.gateTitle'),
            style: { margin: 'auto' },
          },
            h('div', { className: 'ds-auth__head' },
              h('span', { className: 'ds-eyebrow' }, tf('auth.eyebrow')),
              h('h2', { className: 'ds-auth__title' }, tf(unreachable ? 'auth.unreachableTitle' : 'auth.gateTitle')),
              h('p', { className: 'ds-auth__intro' }, tf(unreachable ? 'auth.unreachable' : 'auth.gateIntro')),
              unreachable ? null : h('span', { className: 'ds-auth__badge' }, tf('auth.freeBadge')),
            ),
            unreachable ? null : h('div', { className: 'ds-auth__steps', style: { marginTop: '18px' } },
              h('div', { className: 'ds-auth__step' },
                h('span', { className: 'ds-auth__num' }, '01'),
                h('div', null,
                  h('div', { className: 'ds-auth__stepTitle' }, tf('auth.step1Title')),
                  h('div', { className: 'ds-auth__stepDesc' }, tf('auth.step1Desc')))),
              h('div', { className: 'ds-auth__step' },
                h('span', { className: 'ds-auth__num' }, '02'),
                h('div', null,
                  h('div', { className: 'ds-auth__stepTitle' }, tf('auth.step2Title')),
                  h('div', { className: 'ds-auth__stepDesc' }, tf('auth.step2Desc')))),
              h('div', { className: 'ds-auth__step' },
                h('span', { className: 'ds-auth__num' }, '03'),
                h('div', null,
                  h('div', { className: 'ds-auth__stepTitle' }, tf('auth.step3Title')),
                  h('div', { className: 'ds-auth__stepDesc' }, tf('auth.step3Desc')))),
            ),
            unreachable
              ? h('button', {
                  ref: retryRef, type: 'button', className: 'ds-auth__submit', style: { marginTop: '16px' }, onClick: probe,
                }, tf('common.retry'))
              : h('button', {
                  ref: submitRef,
                  type: 'button',
                  className: 'ds-auth__submit',
                  style: { marginTop: '16px' },
                  disabled: busy || waiting,
                  onClick: login,
                }, busy ? tf('auth.opening') : waiting ? tf('auth.waitingShort') : tf('auth.loginWith')),
            unreachable ? null : (site?.base
              ? h('button', {
                  type: 'button',
                  className: 'ds-auth__secondary',
                  style: { marginTop: '8px' },
                  onClick: () => window.open(site.base, '_blank', 'noopener,noreferrer'),
                }, tf('auth.website'))
              : null),
            waiting
              ? h('div', { className: 'ds-auth__wait', style: { marginTop: '12px' } },
                  h('span', { className: 'ds-spinner', 'aria-hidden': true }),
                  h('span', null, tf('auth.waiting')))
              : null,
            !unreachable && error ? h('div', { className: 'ds-auth__error', role: 'alert', style: { marginTop: '10px' } }, error) : null,
            h('p', { className: 'ds-auth__foot', style: { marginTop: '16px' } }, tf('auth.footnote')),
          ),
        )
      }
    }

    /** 设置里的「账号」一节：官网身份、余额、登出。密码不在这里，也不在本机。 */
    function makeAccountSection() {
      return function AccountSection() {
        const [state, setState] = useState({ phase: 'loading', data: null })
        const [busy, setBusy] = useState(false)
        const [note, setNote] = useState(null)
        useLocaleRevision()

        const load = async () => {
          const result = await authCall('/state')
          if (result.networkError || !result.ok) {
            setState({ phase: 'error', data: null, error: tf('auth.unreachable') })
            return
          }
          const data = result.data
          authSite.site = data?.site ?? authSite.site
          setState({ phase: 'ready', data })
        }

        useEffect(() => { load() }, [])

        const refresh = async () => {
          setBusy(true)
          setNote(null)
          try {
            const result = await authCall('/refresh', { method: 'POST' })
            if (result.networkError) {
              setNote({ text: tf('auth.unreachable'), tone: 'alert' })
              return
            }
            if (result.ok) {
              setState({ phase: 'ready', data: result.data })
              authSite.site = result.data?.site ?? authSite.site
              setNote({ text: tf('auth.refreshed'), tone: 'status' })
              return
            }
            setNote({
              text: result.data?.error === 'unauthorized' ? tf('auth.expired') : tf('auth.failed'),
              tone: 'alert',
            })
          } catch {
            setNote({ text: tf('auth.unreachable'), tone: 'alert' })
          } finally {
            setBusy(false)
          }
        }

        const logout = async () => {
          try {
            const result = await authCall('/logout', { method: 'POST' })
            if (result.networkError || !result.ok) {
              setNote({ text: tf('auth.failed'), tone: 'alert' })
              return
            }
          } catch {
            setNote({ text: tf('auth.failed'), tone: 'alert' })
            return
          }
          // 整页重载最干净：内存里的会话态、课题缓存都不该留着。
          window.location.reload()
        }

        if (state.phase === 'loading') return h('div', { style: S.sub }, tf('auth.loading'))
        if (state.phase === 'error') return h(ErrorBox, { error: state.error, onRetry: load })
        const data = state.data
        if (!data?.loggedIn || !data.user) return h('div', { style: S.sub }, tf('auth.notLoggedIn'))

        const user = data.user
        const site = data.site
        return h('div', null,
          h('div', { style: S.title }, user.username || user.email || '—'),
          h('div', { style: S.sub }, tf('auth.email') + ': ' + (user.email || '—') + ' · ' + tf('auth.role') + ': ' + (user.role || 'user')),
          h('div', { style: { ...S.row, marginTop: '16px' } },
            h('div', { className: 'ds-sub' }, tf('auth.balanceLabel')),
            h('div', { className: 'ds-num', style: { fontSize: '22px', fontWeight: 650 } }, balanceText(data.balance)),
          ),
          data.expiresAt ? h('div', { style: S.sub }, tf('auth.expiresAt') + ' ' + dateText(data.expiresAt)) : null,
          h('div', { style: { display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' } },
            h('button', { type: 'button', className: 'ds-btn', disabled: busy, onClick: refresh }, busy ? tf('auth.refreshing') : tf('auth.refresh')),
            site?.base
              ? h('button', {
                  type: 'button', className: 'ds-btn',
                  onClick: () => window.open(site.base, '_blank', 'noopener,noreferrer'),
                }, tf('auth.manage'))
              : null,
            h('button', { type: 'button', className: 'ds-btn ds-btn--danger', onClick: logout }, tf('auth.logout')),
          ),
          note?.text
            ? h('div', {
                className: 'ds-sub',
                role: note.tone === 'alert' ? 'alert' : 'status',
                style: { marginTop: '8px' },
              }, note.text)
            : null,
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
        const panelRef = useRef(null)
        const closeRef = useRef(null)
        const wasOpen = useRef(false)
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

        // 打开时把焦点交给关闭键，关上时还回侧栏头像：键盘用户不会丢位置。
        useEffect(() => {
          if (open) {
            wasOpen.current = true
            closeRef.current?.focus?.()
            return
          }
          if (!wasOpen.current) return
          wasOpen.current = false
          document.querySelector('[data-deepscient-account="entry"]')?.focus?.()
        }, [open])

        const close = () => { setNote(''); setAccountMenu(false) }
        const logout = async () => {
          try {
            const result = await authCall('/logout', { method: 'POST' })
            if (result.networkError || !result.ok) {
              setNote(tf('auth.failed'))
              return
            }
          } catch {
            setNote(tf('auth.failed'))
            return
          }
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

        const actionStyle = AE.action
        return h('div', {
          style: AE.backdrop, 'data-deepscient-auth': 'menu', onClick: close,
        },
          h('div', {
            ref: panelRef,
            style: AE.panel,
            role: 'dialog', 'aria-modal': 'true', 'aria-label': tf('auth.accountMenu'),
            onMouseDown: (event) => event.stopPropagation(),
            onClick: (event) => event.stopPropagation(),
          },
            h('button', {
              type: 'button', ref: closeRef, className: 'ds-iconbtn', style: AE.close,
              'aria-label': tf('auth.close'), onClick: close,
            }, '×'),
            h('div', { style: AE.panelName }, user.username || user.email || ''),
            h('div', { style: AE.panelSub }, (user.email || '—') + ' · ' + balanceText(accountBadge.balance)),
            h('div', { style: AE.actions },
              h('button', {
                type: 'button', className: 'ds-btn ds-btn--ghost', style: actionStyle, onClick: toSettings,
              }, tf('auth.openSettings')),
              authSite.site?.base
                ? h('button', {
                    type: 'button', className: 'ds-btn ds-btn--ghost', style: actionStyle,
                    onClick: () => window.open(authSite.site.base, '_blank', 'noopener,noreferrer'),
                  }, tf('auth.manage'))
                : null,
              h('button', {
                type: 'button', className: 'ds-btn ds-btn--danger', style: actionStyle, onClick: logout,
              }, tf('auth.logout')),
            ),
            note ? h('div', { style: AE.note, role: 'alert' }, note) : null,
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
        display: 'inline-flex', alignItems: 'center', gap: '6px', height: 30,
        padding: '0 12px', borderRadius: V.radiusPill, cursor: 'pointer',
        border: `1px solid ${V.border}`, background: V.bg,
        fontSize: V.textSm, lineHeight: 1.2, whiteSpace: 'nowrap',
      },
      triggerOn: { borderColor: V.brand, color: V.brand, background: V.brandSoft },
      panel: {
        position: 'absolute', bottom: 'calc(100% + 10px)', left: 0, zIndex: 60,
        width: 'min(560px, 92vw)', maxHeight: '70vh', overflowY: 'auto',
        padding: 18, borderRadius: V.radiusXl, background: V.surface,
        border: `1px solid ${V.line}`,
        boxShadow: V.shadow2, textAlign: 'left',
      },
      title: { fontSize: 15, fontWeight: 600, marginBottom: '4px' },
      hint: { fontSize: V.textSm, color: V.fg2, lineHeight: 1.5, marginBottom: '12px' },
      row: { marginBottom: '10px' },
      label: { display: 'block', fontSize: V.textSm, fontWeight: 500, marginBottom: '3px' },
      sub: { fontSize: V.textXs, color: V.fg3, marginBottom: '4px', lineHeight: 1.45 },
      foot: { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' },
      btnOff: { opacity: 0.5, cursor: 'not-allowed' },
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
        const [note, setNote] = useState('')
        const wrapRef = useRef(null)
        const panelRef = useRef(null)
        const onActiveChange = props?.onActiveChange
        const inputActions = props?.inputActions

        // 展开时占满工具栏宽度：不在展开状态释放，别的附件控件会被挤没。
        useEffect(() => {
          onActiveChange?.(open)
          return () => { if (open) onActiveChange?.(false) }
        }, [open])

        // 每次开合都清掉上一条提示，免得下次打开还挂着「没有可写入的输入框」。
        useEffect(() => {
          setNote('')
          if (open) panelRef.current?.focus?.()
        }, [open])

        // Esc 关面板；点到 wrap 外面也关。用 mousedown 而不是 click：
        // 面板里的按钮一按就被卸载，click 再也冒不到 document 上。
        useEffect(() => {
          if (!open) return undefined
          if (typeof document === 'undefined') return undefined
          const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
          const onDown = (event) => {
            const wrap = wrapRef.current
            if (!wrap || typeof wrap.contains !== 'function') return
            if (!wrap.contains(event.target)) setOpen(false)
          }
          document.addEventListener('keydown', onKey)
          document.addEventListener('mousedown', onDown)
          return () => {
            document.removeEventListener('keydown', onKey)
            document.removeEventListener('mousedown', onDown)
          }
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

        // 写不进去时必须说清楚，且不能顺手关面板：内容还在，用户能自己选中复制。
        const writeDraft = () => {
          if (typeof inputActions?.setDraft !== 'function') {
            setNote(tf('wizard.noTarget'))
            return
          }
          inputActions.setDraft(compose())
          setOpen(false)
        }
        const startNow = () => {
          if (typeof inputActions?.setDraft !== 'function') {
            setNote(tf('wizard.noTarget'))
            return
          }
          inputActions.setDraft(compose())
          inputActions.submit?.()
          setOpen(false)
        }

        return h('div', { style: WZ.wrap, ref: wrapRef },
          h('button', {
            type: 'button',
            title: tf('wizard.openHint'),
            'aria-haspopup': 'dialog',
            'aria-expanded': open,
            'aria-controls': 'ds-wizard-panel',
            style: open ? { ...WZ.trigger, ...WZ.triggerOn } : WZ.trigger,
            onClick: () => setOpen((v) => !v),
          }, tf('wizard.open')),
          open
            ? h('div', {
                id: 'ds-wizard-panel',
                ref: panelRef,
                role: 'dialog',
                'aria-label': tf('wizard.title'),
                tabIndex: -1,
                style: { ...WZ.panel, maxWidth: 'min(560px, calc(100vw - 24px))' },
              },
                h('div', { style: WZ.title }, tf('wizard.title')),
                h('div', { style: WZ.hint }, tf('wizard.hint')),
                ...WZ_FIELDS.map((field) => h('div', { key: field.id, style: WZ.row },
                  h('label', { style: WZ.label, htmlFor: 'wz-' + field.id }, tf('wizard.field.' + field.id)),
                  field.hint ? h('div', { style: WZ.sub }, tf('wizard.hintField.' + field.id)) : null,
                  field.rows
                    ? h('textarea', {
                        id: 'wz-' + field.id,
                        rows: field.rows,
                        className: 'ds-textarea',
                        style: { width: '100%' },
                        placeholder: tf('wizard.ph.' + field.id),
                        value: form[field.id] ?? '',
                        onChange: set(field.id),
                      })
                    : h('input', {
                        id: 'wz-' + field.id,
                        type: 'text',
                        className: 'ds-input',
                        style: { width: '100%' },
                        placeholder: tf('wizard.ph.' + field.id),
                        value: form[field.id] ?? '',
                        onChange: set(field.id),
                      }),
                )),
                note ? h('div', { role: 'alert', style: { ...WZ.sub, color: V.err } }, note) : null,
                h('div', { style: WZ.foot },
                  h('button', { type: 'button', className: 'ds-btn ds-btn--ghost', onClick: () => setOpen(false) }, tf('wizard.cancel')),
                  h('button', {
                    type: 'button',
                    className: 'ds-btn',
                    style: filled ? undefined : WZ.btnOff,
                    disabled: !filled,
                    onClick: writeDraft,
                  }, tf('wizard.fill')),
                  h('button', {
                    type: 'button',
                    className: 'ds-btn ds-btn--primary',
                    style: filled ? undefined : WZ.btnOff,
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
              fontFamily: V.fontMono,
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
        h('button', { className: 'ds-btn ds-btn--ghost', onClick: () => openPanel('billing') }, tf('guide.model.goBilling'))))
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
          h('button', { className: 'ds-btn ds-btn--ghost', onClick: () => openPanel('sources') }, tf('guide.sources.go'))),
        h('div', { key: 'foot', style: { ...S.sub, marginTop: 8 } }, tf('guide.sources.foot')),
      ]
    }

    function guideProjectStep(form, setForm, created, createProject, creating) {
      const nodes = [
        h('p', { key: 'p', style: { margin: '0 0 8px' } }, tf('guide.project.intro')),
        h('div', { key: 'form', style: { display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 460 } },
          h('input', { style: S.input, placeholder: tf('guide.project.titlePh'), value: form.title, onChange: (e) => setForm({ ...form, title: e.target.value }) }),
          h('input', { style: S.input, placeholder: tf('guide.project.domainPh'), value: form.domain, onChange: (e) => setForm({ ...form, domain: e.target.value }) }),
          h('input', { style: S.input, placeholder: tf('guide.project.journalPh'), value: form.journal, onChange: (e) => setForm({ ...form, journal: e.target.value }) })),
        h('div', { key: 'row', style: { ...S.row, marginTop: 10 } },
          h('button', { className: 'ds-btn ds-btn--primary', onClick: createProject, disabled: creating || !form.title.trim() },
            creating ? tf('guide.creating') : tf('guide.project.create'))),
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
              h('button', { className: 'ds-btn ds-btn--ghost ds-btn--sm', onClick: () => copy(text, tag) }, copied === tag ? tf('guide.session.copied') : tf('guide.session.copy')),
              h('button', {
                className: 'ds-btn ds-btn--primary ds-btn--sm',
                style: { opacity: busy || presetBroken ? 0.55 : 1 },
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

    /* 引导浮层拆成两段：门外只读 /settings，门里才拉那四份数据。
       隐藏的引导（onboardingDone 已为 true）不该顺手把 /health、/sources 全打一遍。 */
    function makeOnboarding(ctx) {
      return function OnboardingGate(props) {
        const settings = useApi('/settings')
        useLocaleRevision()
        if (settings.status !== 'ready' && settings.status !== 'refreshing') return null
        if (!settings.data?.values || settings.data.values.onboardingDone === true) return null
        return h(OnboardingDialog, { ctx, props, settings })
      }
    }

    function OnboardingDialog({ ctx, props, settings }) {
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
      const [saving, setSaving] = useState(false)
      const [creating, setCreating] = useState(false)
      const pending = useRef(0)
      const queue = useRef(Promise.resolve())
      const copyTimer = useRef(null)
      const cardRef = useRef(null)
      useLocaleRevision()

      // shell.overlay 的 standardProps 里有 useWorkspaces；桩测试传空 props，所以要能缺。
      const useWorkspacesHook = typeof props?.useWorkspaces === 'function' ? props.useWorkspaces : null
      const snapshot = useWorkspacesHook ? useWorkspacesHook((state) => state) : null
      const snapshotRef = useRef(snapshot)
      snapshotRef.current = snapshot

      useEffect(() => {
        if (step === null && settings.data?.values) setStep(Number(settings.data.values.onboardingStep) || 0)
      }, [settings.data, step])

      useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])

      const current = Math.min(Math.max(step ?? 0, 0), GUIDE_TOTAL - 1)

      /** 进度写盘串行化：连点「下一步」时 PUT 必须按点下去的顺序落地，否则 step 会回跳。 */
      const persist = (patch) => {
        pending.current += 1
        setSaving(true)
        queue.current = queue.current
          .then(() => sendJson('PUT', '/settings', patch))
          .then(() => settings.reload())
          .catch((e) => setError(e?.message ?? String(e)))
          .finally(() => {
            pending.current -= 1
            if (pending.current === 0) setSaving(false)
          })
        return queue.current
      }
      const go = (next) => {
        if (saving) return
        setError('')
        setStep(next)
        persist({ onboardingStep: next })
      }
      const finish = () => {
        if (saving) return
        setError('')
        setStep(GUIDE_TOTAL)
        persist({ onboardingDone: true, onboardingStep: GUIDE_TOTAL })
      }

      // 打开时把焦点收进卡片，否则 Tab 会从背后的界面开始走。
      useEffect(() => {
        const card = cardRef.current
        if (!card?.querySelectorAll) return
        const first = Array.from(card.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
          .find((el) => !el.disabled)
        first?.focus?.()
      }, [])

      // 浮层是全屏的：Tab 不许跑出去，Esc 问一句再退出。
      useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const focusables = () => {
          const card = cardRef.current
          if (!card?.querySelectorAll) return []
          return Array.from(card.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
            .filter((el) => !el.disabled)
        }
        const onKey = (event) => {
          if (event.key === 'Escape') {
            const ok = typeof window === 'undefined' ? true : window.confirm(tf('guide.skipConfirm'))
            if (ok) finish()
            return
          }
          if (event.key !== 'Tab') return
          const items = focusables()
          if (items.length === 0) return
          const first = items[0]
          const last = items[items.length - 1]
          const active = document.activeElement
          const inside = cardRef.current?.contains?.(active)
          if (event.shiftKey) {
            if (active === first || !inside) { event.preventDefault(); last.focus?.() }
          } else if (active === last || !inside) {
            event.preventDefault(); first.focus?.()
          }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [saving, creating, step])

      const openPanel = (key) => requestPanel(key)
      const copy = async (text, tag) => {
        try {
          await navigator.clipboard?.writeText(text)
          setCopied(tag)
          clearTimeout(copyTimer.current)
          copyTimer.current = setTimeout(() => setCopied(''), 2000)
        } catch {
          setCopied('')
          setError(tf('guide.copyFailed'))
        }
      }
      const createProject = async () => {
        if (creating) return
        setCreating(true)
        setError('')
        try {
          const payload = await sendJson('POST', '/projects', form)
          if (!payload.ok) throw new Error(payload.message || payload.error || tf('guide.session.errorCreate'))
          setCreated({ ...payload.project, progress: payload.progress ?? null })
          openPanel('workbench')
        } catch (e) {
          setError(e?.message ?? String(e))
        } finally {
          setCreating(false)
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
          const preset = presets.data?.items?.find((p) => p.isDefault) ?? presets.data?.items?.[0] ?? null
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
          // 等它的返回值：拒绝的 promise 要走同一个 catch，否则界面上只会看到「多了一个会话」的错觉。
          await ui.startSession(workspaceId, {
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
          await persist({ onboardingDone: true, onboardingStep: GUIDE_TOTAL })
        } catch (e) {
          setSessionState({ tag, status: 'failed', detail: e?.message ?? String(e) })
          setError(e?.message ?? String(e))
        }
      }

      let body
      if (current === 0) body = guideCheckStep(health)
      else if (current === 1) body = guideModelStep(usage, openPanel)
      else if (current === 2) body = guideSourceStep(sources, openPanel)
      else if (current === 3) body = guideProjectStep(form, setForm, created, createProject, creating)
      else if (current === 4) {
        body = guideSessionStep({
          templates: PROMPT_TEMPLATES,
          preset: presets.data?.items?.find((p) => p.isDefault) ?? presets.data?.items?.[0] ?? null,
          sessionState,
          copy,
          copied,
          start: startWithTemplate,
        })
      } else body = guideRulesStep()

      const progress = Array.from({ length: GUIDE_TOTAL }).map((_, i) => h('div', {
        key: i,
        style: { height: 3, flex: 1, borderRadius: V.radiusPill, background: i <= current ? V.brand : V.surface3 },
      }))

      const card = h('div', {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': tf('guide.aria'),
        ref: cardRef,
        className: 'ds-dialog',
        style: { width: 'min(620px, 100%)', padding: '20px 22px' },
      },
      h('div', { style: S.row },
        h('div', { style: { fontSize: 15, fontWeight: 600 } }, tf('guide.title')),
        h('div', { style: S.spacer }),
        h('div', { style: S.sub }, tf('guide.stepProgress', { current: current + 1, total: GUIDE_TOTAL }))),
      h('div', { style: { display: 'flex', gap: 6, margin: '12px 0 16px' } }, progress),
      h('div', { style: { fontSize: 13, lineHeight: 1.75, minHeight: 150 } }, body),
      // 错误与保存状态都要被读屏念出来，否则失败只剩视觉上的一个红框。
      h('div', { 'aria-live': 'polite' }, error ? h(ErrorBox, { error, title: tf('guide.errorTitle') }) : null),
      h('div', { style: { ...S.row, marginTop: 16 } },
        current > 0 ? h('button', { className: 'ds-btn ds-btn--ghost', disabled: saving, onClick: () => go(current - 1) }, tf('guide.prev')) : null,
        h('div', { style: S.spacer }),
        h('button', { className: 'ds-btn ds-btn--ghost', disabled: saving, onClick: finish }, tf('guide.skip')),
        current < GUIDE_TOTAL - 1
          ? h('button', { className: 'ds-btn ds-btn--primary', disabled: saving, onClick: () => go(current + 1) }, saving ? tf('guide.saving') : tf('guide.next'))
          : h('button', { className: 'ds-btn ds-btn--primary', disabled: saving, onClick: finish }, tf('guide.start'))))

      return h('div', {
        // shell.overlay 这一层本身是 click-through，入场者要点回指针事件，否则点不动。
        className: 'ds-backdrop',
        style: { pointerEvents: 'auto' },
      }, card)
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
      const id = 'ds-setting-' + key
      const value = draft[key]
      let control
      if (kind === 'bool') {
        control = h('input', { id, type: 'checkbox', checked: Boolean(value), onChange: (e) => setDraft({ ...draft, [key]: e.target.checked }) })
      } else if (Array.isArray(kind)) {
        control = h('select', { id, className: 'ds-select', style: S.select, value: value ?? '', onChange: (e) => setDraft({ ...draft, [key]: e.target.value }) },
          kind.map((v) => h('option', { key: v, value: v }, v)))
      } else if (kind === 'number') {
        control = h('input', {
          id,
          className: 'ds-input',
          style: { ...S.input, minWidth: 100 },
          type: 'number',
          step: 0.01,
          min: 0.001,
          max: 0.5,
          value: value ?? '',
          onChange: (e) => setDraft({ ...draft, [key]: e.target.value === '' ? '' : Number(e.target.value) }),
        })
      } else if (kind === 'url') {
        control = h('input', {
          id,
          className: 'ds-input',
          style: { ...S.input, minWidth: 260 },
          type: 'url',
          placeholder: key === 'billingBaseUrl' ? tf('settings.ph.billingBaseUrl') : tf('settings.ph.billingConsoleUrl'),
          value: value ?? '',
          onChange: (e) => setDraft({ ...draft, [key]: e.target.value }),
        })
      } else {
        control = h('input', {
          id,
          className: 'ds-input',
          style: S.input,
          value: value ?? '',
          onChange: (e) => setDraft({ ...draft, [key]: e.target.value }),
        })
      }
      return h('div', { key, style: { display: 'flex', alignItems: 'center', gap: 12 } },
        h('label', { htmlFor: id, className: 'ds-sub', style: { width: 150 } }, label),
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
        const [saving, setSaving] = useState(false)
        const [pending, setPending] = useState('')
        const busy = useRef(false)
        useLocaleRevision()

        useEffect(() => { if (state.data?.values) setDraft(state.data.values) }, [state.data])

        const save = useCallback(async () => {
          if (!draft || busy.current) return
          const alpha = draft.alpha === '' || draft.alpha === null || draft.alpha === undefined ? NaN : Number(draft.alpha)
          if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
            setError(tf('settings.alphaError'))
            return
          }
          const priceRows = Array.isArray(draft.billingPriceTable) ? draft.billingPriceTable : []
          const invalidRow = priceRows.some((row) => {
            const named = String(row.provider ?? '').trim() !== '' || String(row.model ?? '').trim() !== ''
            if (!named) return false
            return [row.inputPerM, row.cacheReadPerM, row.outputPerM]
              .every((v) => v === '' || v === null || v === undefined || Number(v) === 0)
          })
          if (invalidRow) {
            setError(tf('settings.priceRowInvalid'))
            return
          }
          busy.current = true
          setSaving(true)
          setError('')
          try {
            const body = await sendJson('PUT', '/settings', draft)
            setDraft(body.values)
            setRejected(body.rejected ?? [])
            setSaved(tf('settings.savedAt', { at: new Date().toLocaleTimeString() }))
            if (body.values?.locale && body.values.locale !== state.data?.values?.locale) {
              try {
                i18n.ctx?.get?.('locale')?.setLocale?.(body.values.locale)
              } catch {
                // 切不动就等下次加载：服务端已经存下了，不下发全页刷新。
              }
            }
            state.reload()
          } catch (e) {
            setError(e.message)
          } finally {
            setSaving(false)
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

        const humanKey = (k) => {
          const key = 'settings.field.' + k
          const v = tf(key)
          return v === key ? k : v
        }

        return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 } },
          h('div', { style: { fontSize: 13, opacity: 0.75, lineHeight: 1.6 } },
            tf('settings.introPrefix'),
            h('code', { style: S.mono }, state.data?.path ?? ''),
            tf('settings.introSuffix')),
          state.status === 'refreshing' ? h(Refreshing) : null,
          FIELDS.map(([key, label, kind]) => fieldRow(draft, setDraft, key, tf(label), kind)),

          h('div', { style: { ...S.card, marginTop: 6 } },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 4 } }, tf('settings.billingTitle')),
            h('div', { style: { ...S.sub, marginBottom: 8 } },
              tf('settings.billingHint')),
            rows.length
              ? h(Table, {
                  head: ['provider', tf('billing.colModel'), tf('settings.colInput'), tf('settings.colCache'), tf('settings.colOutput'), ''],
                }, rows.map((row, index) =>
                  h('tr', { key: index },
                    h('td', { style: S.td }, h('input', {
                      className: 'ds-input',
                      style: { minWidth: 90 },
                      value: row.provider ?? '',
                      placeholder: tf('settings.ph.provider'),
                      'aria-label': `provider ${index + 1}`,
                      onChange: (e) => patchRow(index, { provider: e.target.value }),
                    })),
                    h('td', { style: S.td }, h('input', {
                      className: 'ds-input',
                      style: { minWidth: 120 },
                      value: row.model ?? '',
                      placeholder: tf('settings.ph.model'),
                      'aria-label': `${tf('billing.colModel')} ${index + 1}`,
                      onChange: (e) => patchRow(index, { model: e.target.value }),
                    })),
                    h('td', { style: S.td }, h('input', {
                      className: 'ds-input',
                      style: { minWidth: 70 },
                      type: 'number',
                      step: '0.01',
                      value: row.inputPerM ?? 0,
                      'aria-label': `${tf('settings.colInput')} ${index + 1}`,
                      onChange: (e) => patchRow(index, { inputPerM: e.target.value === '' ? '' : Number(e.target.value) }),
                    })),
                    h('td', { style: S.td }, h('input', {
                      className: 'ds-input',
                      style: { minWidth: 70 },
                      type: 'number',
                      step: '0.01',
                      value: row.cacheReadPerM ?? 0,
                      'aria-label': `${tf('settings.colCache')} ${index + 1}`,
                      onChange: (e) => patchRow(index, { cacheReadPerM: e.target.value === '' ? '' : Number(e.target.value) }),
                    })),
                    h('td', { style: S.td }, h('input', {
                      className: 'ds-input',
                      style: { minWidth: 70 },
                      type: 'number',
                      step: '0.01',
                      value: row.outputPerM ?? 0,
                      'aria-label': `${tf('settings.colOutput')} ${index + 1}`,
                      onChange: (e) => patchRow(index, { outputPerM: e.target.value === '' ? '' : Number(e.target.value) }),
                    })),
                    h('td', { style: S.td }, h('button', { className: 'ds-btn ds-btn--sm', onClick: () => removeRow(index) }, tf('settings.remove'))))))
              : h('div', { style: S.sub }, tf('settings.emptyPrice')),
            h('div', { style: { ...S.row, marginTop: 8 } },
              h('button', { className: 'ds-btn ds-btn--sm', onClick: addRow }, tf('settings.addRow')),
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
                className: 'ds-btn',
                disabled: Boolean(pending),
                onClick: async () => {
                  if (pending) return
                  setError('')
                  setPending('inspect')
                  try {
                    setInspect(await fetchJson('/presets/inspect'))
                  } catch (e) {
                    setError(e.message)
                  } finally {
                    setPending('')
                  }
                },
              }, pending === 'inspect' ? tf('settings.loading') : tf('settings.presetInspect'))),
            inspect
              ? h('div', { style: { marginTop: 8 } },
                  inspect.available === false
                    ? h('div', { style: S.sub }, tf('settings.presetUnavailable', { reason: inspect.reason ?? tf('settings.presetUnknown') }))
                    : (inspect.presets ?? []).map((p) => h('div', { key: p.id, style: { marginTop: 6 } },
                        h('div', { style: { fontSize: 12.5, fontWeight: 600 } }, `${p.name ?? p.id}${p.isDefault ? tf('settings.presetDefault') : ''}${p.broken ? tf('settings.presetFailed', { reason: p.broken }) : ''}`),
                        h('div', { style: { ...S.mono, fontSize: 11.5, opacity: 0.85, marginTop: 4, lineHeight: 1.6, whiteSpace: 'pre-wrap' } },
                          (p.rows ?? []).map((r) => `${r.fiberState ?? '?'}  ${r.moduleName}${r.entryId ? `#${r.entryId}` : ''}`).join('\n')))))
              : null),

          // 技能目录：磁盘上有几条、模型真能看见几条 —— 这两件事必须分开看。
          h('div', { style: { ...S.card } },
            h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, tf('settings.skillsTitle')),
            h('div', { style: { ...S.sub, marginBottom: 8 } },
              tf('settings.skillsHint')),
            h('div', { style: S.row },
              h('button', {
                className: 'ds-btn',
                disabled: Boolean(pending),
                onClick: async () => {
                  if (pending) return
                  setError('')
                  setPending('skills')
                  try {
                    setSkillCat(await fetchJson('/skills'))
                  } catch (e) {
                    setError(e.message)
                  } finally {
                    setPending('')
                  }
                },
              }, pending === 'skills' ? tf('settings.loading') : tf('settings.skillsShow')),
              h('button', {
                className: 'ds-btn',
                disabled: Boolean(pending),
                onClick: async () => {
                  if (pending) return
                  setError('')
                  setPending('check')
                  try {
                    setSkillCheck(await sendJson('POST', '/skills/check'))
                  } catch (e) {
                    setError(e.message)
                  } finally {
                    setPending('')
                  }
                },
              }, pending === 'check' ? tf('settings.loading') : tf('settings.skillsCheck'))),
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
                    ? h('div', { style: { ...S.mono, fontSize: 11, opacity: 0.85, marginTop: 6, maxHeight: 220, overflow: 'auto', lineHeight: 1.7, whiteSpace: 'pre-wrap' } },
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
                  (skillCheck.failed ?? []).map((row) => h('div', { key: row.name, style: { ...S.sub, color: V.err } }, tf('settings.skillsFailLine', { name: row.name, reason: row.reason }))),
                  (skillCheck.problems ?? []).map((line, i) => h('div', { key: `p${i}`, style: { ...S.sub, color: V.err } }, line)))
              : null),

          h('div', { style: { ...S.row, marginTop: 6 } },
            h('button', { className: 'ds-btn ds-btn--primary', disabled: saving, onClick: save }, saving ? tf('settings.saving') : tf('common.save')),
            h('button', { className: 'ds-btn', onClick: () => setDraft(state.data?.values ?? draft) }, tf('settings.restore'))),
          h('div', { 'aria-live': 'polite' },
            saved ? h('span', { className: 'ds-sub', role: 'status' }, saved) : null,
            rejected.length
              ? h('div', { style: { ...S.sub, color: V.err } }, tf('settings.rejected', { keys: rejected.map(humanKey).join(', ') }))
              : null,
            error ? h(ErrorBox, { error, title: tf('settings.saveFailed') }) : null),
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
        // 桌面壳直接从本地 dist 出首屏，绕过 webServer.tapIndex 的 head 注入；
        // 这里补一次同样的品牌标记，让两种形态看到同一份 HTML 语义。
        if (!document.head.querySelector('meta[data-deepscient="brand"]')) {
          const meta = document.createElement('meta')
          meta.setAttribute('name', 'application-name')
          meta.setAttribute('content', 'DeepScient')
          meta.setAttribute('data-deepscient', 'brand')
          document.head.appendChild(meta)
        }
        // 同理补视觉层：Web 形态由 tapIndex 内联 <style>，桌面形态没有，就链接到同一份 CSS。
        if (!document.head.querySelector('style[data-deepscient="ui"], link[data-deepscient="ui"]')) {
          const link = document.createElement('link')
          link.setAttribute('rel', 'stylesheet')
          link.setAttribute('href', '/deepscient/ui.css')
          link.setAttribute('data-deepscient', 'ui')
          document.head.appendChild(link)
        }
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
