/**
 * 发表层工具（preset 平面）。
 *
 * M2：science_journal_fit / science_paper_audit / science_submission_route /
 *     science_novelty / science_cover_letter / science_rebuttal
 * M3：science_journal_intel / science_journal_refresh（三源实证情报）
 *
 * 全部确定性：同输入同输出，可进 CI。语义判断（"标题算不算 claim"）不在这里做，
 * 交给 agent 读完 science-top-journal-writing 后自己判断。
 */
import { resolveDshToolsPackage } from './tools.js'
import { loadJournals, profileQuery, rankJournals, scoreJournal } from './science/method/journals.js'
import { runAudit } from './science/method/rules.js'
import { planRoute } from './science/method/route.js'
import { checkNovelty } from './science/method/novelty.js'
import { buildCoverLetter, parseRebuttal } from './science/method/draft.js'
import { mapManuscript } from './science/intel/openalex-profile.js'
import { buildIntelCard, rankJournalsByFootprint } from './science/intel/card.js'
import { refresh as refreshIntel, SOURCE_IDS as INTEL_SOURCE_IDS } from './science/intel/index.js'

const dshTools = resolveDshToolsPackage()
const defineTool = dshTools.defineTool || dshTools.default?.defineTool
if (typeof defineTool !== 'function') throw new Error('dsh-science/method-tools: defineTool 不可用')

export const name = 'dsh-science-method'
export const inject = ['tools']

/** 取检索运行时。不同工具需要的能力不同：novelty 要 pipeline，intel 只要 client+store。 */
function runtimeOf(ctx, { needs = ['pipeline'] } = {}) {
  const rt = ctx.get('scienceRuntime')
  if (!rt) throw new Error('检索运行时未就绪：先跑 science_preflight 看初始化错误')
  const missing = needs.filter((k) => !rt[k])
  if (missing.length > 0) throw new Error(`检索运行时缺少 ${missing.join('/')}：先跑 science_preflight 看初始化错误`)
  return rt
}

const rethrow = (error) => {
  const message = error && error.message ? error.message : String(error)
  throw new Error(`科研工具失败：${message}`)
}

function shape(s, tier) {
  return {
    tier,
    id: s.id,
    name: s.name,
    type: s.type,
    band: s.band,
    score: s.score,
    scope: s.parts.scope,
    ...(s.parts.empirical !== undefined ? { empirical: s.parts.empirical } : {}),
    design: s.parts.design,
    bandFit: s.parts.band,
    format: s.parts.format,
    acceleration: s.parts.acceleration,
    ...(s.topicFootprint ? {
      footprint: s.topicFootprint.hitShare,
      footprintSubfields: s.topicFootprint.hitSubfields.map((h) => `${h.name}:${(h.share * 100).toFixed(1)}%`),
    } : {}),
    weightMode: s.weightMode,
    matchedTopics: s.matchedTopics,
    missingTopics: s.missingTopics,
    genericScope: s.genericScope === true,
    risks: s.risks,
    deskDays: s.estimate.deskDays,
    reviewDays: s.estimate.reviewDays,
    acceptRate: s.estimate.acceptRate,
    registeredReports: s.acceleration.registeredReports,
    portableReview: s.acceleration.portableReview,
    transferChain: s.acceleration.transferChain,
  }
}

const tierLine = (label, note, list) => {
  if (list.length === 0) return [`${label}：无（${note}）`]
  return [
    `${label}：`,
    ...list.map((s) => {
      const bits = [
        `${s.id}(${s.score})`,
        `档${s.band}`,
        s.genericScope ? '综合刊' : (s.matchedTopics.slice(0, 2).join('/') || '主题未命中'),
        `desk~${s.deskDays ?? '?'}d`,
      ]
      if (s.footprint !== undefined) bits.push(`实证${(s.footprint * 100).toFixed(1)}%`)
      if (s.risks.length > 0) bits.push(`⚠${s.risks.length}`)
      return `  - ${bits.join(' · ')}`
    }),
  ]
}

/** 候选条目的输出 schema（三档共用同一结构，JS 层复用避免 $ref 兼容问题）。 */
const CANDIDATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    tier: { type: 'string', required: true },
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    type: { type: 'string' },
    band: { type: 'integer', required: true },
    score: { type: 'number', required: true },
    scope: { type: 'number' },
    empirical: { type: 'number' },
    design: { type: 'number' },
    bandFit: { type: 'number' },
    format: { type: 'number' },
    acceleration: { type: 'number' },
    footprint: { type: 'number' },
    footprintSubfields: { type: 'array', items: { type: 'string' } },
    weightMode: { type: 'string' },
    matchedTopics: { type: 'array', items: { type: 'string' } },
    missingTopics: { type: 'array', items: { type: 'string' } },
    genericScope: { type: 'boolean' },
    risks: { type: 'array', items: { type: 'string' } },
    deskDays: { type: 'integer' },
    reviewDays: { type: 'integer' },
    acceptRate: { type: 'number' },
    registeredReports: { type: 'boolean' },
    portableReview: { type: 'array', items: { type: 'string' } },
    transferChain: { type: 'array', items: { type: 'string' } },
  },
}

export function apply(ctx) {
  /* ── 1. 期刊匹配 ────────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_journal_fit',
    description:
      'Match a manuscript to journals and return three tiers: reach (higher band, real topic evidence), '
      + 'target (band matches, score high enough), safe (one to three bands down, design-compatible). '
      + 'When journal intel is available it scores against what each journal actually published in the last two '
      + 'years (empirical layer) instead of its self-declared scope keywords, and reports the footprint share. '
      + 'Every candidate comes with sub-scores, matched and missing scope topics, and concrete risks such as '
      + 'word/figure overrun or band gap. It never predicts acceptance.',
    parameters: {
      title: { type: 'string', description: 'Manuscript title. Weighted 3x in scope matching.', required: true },
      abstract: { type: 'string', description: 'Abstract text (or a 3-5 sentence summary).' },
      keywords: {
        type: 'array',
        description: 'Author keywords or field terms; weighted 2x.',
        items: { type: 'string' },
      },
      design: {
        type: 'string',
        description: 'Study design: experimental | observational | computational | theory | clinical-trial | meta-analysis.',
      },
      band: { type: 'integer', description: 'Self-assessed work band, 1 (incremental) to 5 (field-defining). Drives the tier split.' },
      words: { type: 'integer', description: 'Main-text word count (excluding refs), used for limit checks.' },
      figures: { type: 'integer', description: 'Figure + table count.' },
      refs: { type: 'integer', description: 'Reference count.' },
      needsRegisteredReport: { type: 'boolean', description: 'Set when a Registered Report route is viable; boosts journals that support it.' },
      needsPortableReview: { type: 'boolean', description: 'Set when portable review (Review Commons style) matters.' },
      only: {
        type: 'array',
        description: 'Restrict to these journal ids (e.g. ["nature","science"]) to score a fixed shortlist.',
        items: { type: 'string' },
      },
      perTier: { type: 'integer', description: 'Max candidates per tier, 1-10. Defaults to 5.' },
      intel: {
        type: 'boolean',
        description: 'Use the empirical layer (what the journal actually published in the last 2 years). '
          + 'On by default when at least 80% of candidates have an OpenAlex profile; otherwise it falls back to '
          + 'declared scope keywords and says so in intelNote. Set false to force declared-only scoring.',
      },
      minTopicShare: {
        type: 'number',
        description: 'Drop candidates whose empirical footprint for your subfield is below this share (e.g. 0.01 = 1%).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          considered: { type: 'integer', required: true },
          intel: { type: 'string', required: true },
          intelCoverage: { type: 'string', required: true },
          intelNote: { type: 'string' },
          minTopicShare: { type: 'number' },
          filteredOut: {
            type: 'object', additionalProperties: false,
            properties: {
              reach: { type: 'integer', required: true },
              target: { type: 'integer', required: true },
              safe: { type: 'integer', required: true },
            },
          },
          dataVerifiedAt: { type: 'string' },
          confidence: { type: 'string', required: true },
          reach: { type: 'array', required: true, items: CANDIDATE_SCHEMA },
          target: { type: 'array', required: true, items: CANDIDATE_SCHEMA },
          safe: { type: 'array', required: true, items: CANDIDATE_SCHEMA },
          others: { type: 'array', items: CANDIDATE_SCHEMA },
        },
      },
      render: (args, value) => {
        const lines = [
          `候选 ${value.considered} 本期刊｜画像核验 ${value.dataVerifiedAt || '未知'}｜置信度 ${value.confidence}`,
          `打分层：${value.intel === 'empirical' ? '实证（近两年真实产出）' : '声明（期刊自述 scope）'}｜覆盖 ${value.intelCoverage}`,
        ]
        if (value.intelNote) lines.push(`注：${value.intelNote}`)
        if (value.filteredOut) {
          lines.push(`已按实证命中 ≥${(value.minTopicShare * 100).toFixed(1)}% 过滤掉 ${value.filteredOut.reach + value.filteredOut.target + value.filteredOut.safe} 本`)
        }
        lines.push(
          '',
          ...tierLine('冲刺 Reach', '没有更高档且有主题证据的刊，直接投 target 更省时间', value.reach),
          '',
          ...tierLine('主投 Target', '档位与分数都不匹配，先回头检查 band 与设计描述', value.target),
          '',
          ...tierLine('保底 Safe', '该领域缺少降档刊，可补 data/journals.json', value.safe),
        )
        const risky = [...value.reach, ...value.target, ...value.safe].filter((s) => s.risks.length > 0)
        if (risky.length > 0) {
          lines.push('', '必须处理的硬风险：')
          for (const s of risky) lines.push(`  - ${s.id}：${s.risks[0]}`)
        }
        if (value.others && value.others.length > 0) {
          lines.push('', '指定短名单里未进三档的（逐刊打分）：')
          for (const s of value.others) {
            lines.push(`  - ${s.id}(${s.score}) · 档${s.band} · ${s.genericScope ? '综合刊' : (s.matchedTopics.slice(0, 2).join('/') || '主题未命中')}`)
          }
        }
        if (value.confidence === 'low') {
          lines.push('', '提示：期刊画像已超过 12 个月未核验，字数与图数上限请以官网当期为准。')
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const { journals, meta } = loadJournals()
      const pool = Array.isArray(args.only) && args.only.length > 0
        ? journals.filter((j) => args.only.includes(j.id))
        : journals
      if (pool.length === 0) throw new Error(`only 里没有匹配的期刊 id：${(args.only || []).join(',')}`)

      const q = profileQuery({
        title: args.title,
        abstract: args.abstract,
        keywords: args.keywords,
        design: args.design,
        band: args.band,
        words: args.words,
        figures: args.figures,
        refs: args.refs,
        needsRegisteredReport: args.needsRegisteredReport,
        needsPortableReview: args.needsPortableReview,
      })

      /* 实证层：只有覆盖率达到阈值才启用，否则整批退回声明层（分数必须可比） */
      const rt = ctx.get('scienceRuntime')
      let intelEnabled = false
      let intelNote = null
      let manuscriptMap = null
      let coveredCount = 0

      if (args.intel !== false) {
        if (!rt?.store) {
          intelNote = '存储未就绪，退回声明层打分'
        } else {
          coveredCount = pool.filter((j) => rt.store.getJournalIntel(j.id).openalex?.payload?.bySubfield?.length > 0).length
          const ratio = coveredCount / pool.length
          if (ratio >= 0.8) {
            intelEnabled = true
            if (rt.client) {
              try {
                manuscriptMap = await mapManuscript(
                  { title: args.title, keywords: args.keywords },
                  { client: rt.client, mailto: rt.config?.mailto || null },
                )
              } catch { manuscriptMap = null }
            }
            if (!manuscriptMap || manuscriptMap.subfields.length === 0) {
              intelEnabled = false
              intelNote = manuscriptMap?.error
                ? `OpenAlex 不可用（${manuscriptMap.error}），本次退回声明层；稍后重试，或传 intel:false 跳过`
                : '稿件无法映射到 OpenAlex 子领域（标题/关键词太泛），退回声明层打分'
            }
          } else {
            intelNote = `仅 ${coveredCount}/${pool.length} 刊有实证画像（需 ≥80%），本次退回声明层打分；运行 science_journal_refresh 补全`
          }
        }
      }

      const intelFor = intelEnabled && manuscriptMap
        ? (journal) => {
          const profile = rt.store.getJournalIntel(journal.id).openalex?.payload
          return profile?.bySubfield?.length > 0 ? { profile, manuscriptMap } : null
        }
        : null

      const ranked = rankJournals(pool, q, { perTier: Math.max(1, Math.min(10, args.perTier || 5)), intelFor })

      /* 实证命中下限过滤：把"几乎不发你这类"的刊直接剔出候选 */
      const minShare = Number.isFinite(args.minTopicShare) ? args.minTopicShare : null
      const filteredOut = { reach: 0, target: 0, safe: 0 }
      if (minShare !== null) {
        for (const tier of ['reach', 'target', 'safe']) {
          const before = ranked[tier].length
          ranked[tier] = ranked[tier].filter((s) => !s.topicFootprint || s.topicFootprint.hitShare >= minShare)
          filteredOut[tier] = before - ranked[tier].length
        }
      }

      const verifiedAt = meta.verifiedAt
      const ageDays = verifiedAt ? Math.round((Date.now() - Date.parse(verifiedAt)) / 86400000) : null
      const confidence = ageDays == null ? 'unknown' : (ageDays > 365 ? 'low' : (ageDays > 180 ? 'medium' : 'high'))

      /* only 模式下三档可能只命中一本，补一份逐刊打分，避免"看不到自己查的那本" */
      let others = []
      if (Array.isArray(args.only) && args.only.length > 0) {
        const shown = new Set([...ranked.reach, ...ranked.target, ...ranked.safe].map((s) => s.id))
        others = pool
          .filter((j) => !shown.has(j.id))
          .map((j) => shape(scoreJournal(j, q, { intel: intelFor ? intelFor(j) : null }), 'unranked'))
          .sort((a, b) => b.score - a.score)
      }

      return {
        considered: ranked.considered,
        intel: intelEnabled ? 'empirical' : 'declared',
        intelCoverage: `${coveredCount}/${pool.length}`,
        ...(intelNote ? { intelNote } : {}),
        ...(minShare !== null ? { minTopicShare: minShare, filteredOut } : {}),
        ...(verifiedAt ? { dataVerifiedAt: verifiedAt } : {}),
        confidence,
        reach: ranked.reach.map((s) => shape(s, 'reach')),
        target: ranked.target.map((s) => shape(s, 'target')),
        safe: ranked.safe.map((s) => shape(s, 'safe')),
        ...(others.length > 0 ? { others } : {}),
      }
    },
  }))

  /* ── 1b. 单刊情报卡 ─────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_journal_intel',
    description:
      'Deep intel card for one journal, merged from three real sources: (1) OpenAlex topic footprint — what the '
      + 'journal actually published in the last two years, by subfield, so you see its real preference rather than '
      + 'its stated aims; (2) SciRev crowdsourced review reality — first-round duration, handling time, review '
      + 'rounds, comment difficulty, sample size; (3) LetPub Chinese-author experience — review speed band, '
      + 'accept-rate wording, CAS zone, impact factor. Pass a title/keywords to also compute how much of that '
      + "journal's recent output falls in your own subfield, and to rank every journal by that share. "
      + 'Never returns an acceptance probability.',
    parameters: {
      journalId: { type: 'string', description: 'Journal id from science_journal_fit (e.g. "nature").' },
      issn: { type: 'string', description: 'ISSN, when you only know the journal by its ISSN.' },
      name: { type: 'string', description: 'Journal name, used when no id or ISSN is known.' },
      title: { type: 'string', description: 'Your manuscript title; enables the footprint hit calculation.' },
      keywords: { type: 'array', description: 'Your field keywords, used together with the title.', items: { type: 'string' } },
      refresh: { type: 'boolean', description: 'Fetch fresh data for this journal now instead of reading the cache.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          journal: {
            type: 'object', additionalProperties: false, required: true,
            properties: {
              id: { type: 'string', required: true }, name: { type: 'string', required: true },
              band: { type: 'integer' }, issn: { type: 'string' },
            },
          },
          confidence: { type: 'string', required: true },
          degraded: { type: 'array', required: true, items: { type: 'string' } },
          stale: { type: 'boolean' },
          topicFootprint: {
            type: 'object', additionalProperties: false,
            properties: {
              windowFrom: { type: 'string' }, windowTo: { type: 'string' },
              totalWorks: { type: 'integer' }, coverage: { type: 'number' },
              topSubfields: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    name: { type: 'string', required: true }, share: { type: 'number', required: true },
                    count: { type: 'integer' },
                  },
                },
              },
              hitShare: { type: 'number' },
              hitSubfields: {
                type: 'array',
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    name: { type: 'string', required: true }, share: { type: 'number', required: true },
                    count: { type: 'integer' },
                  },
                },
              },
            },
          },
          reviewReality: {
            type: 'object', additionalProperties: false,
            properties: {
              firstReviewMonths: { type: 'number' }, handlingMonths: { type: 'number' },
              immediateRejectDays: { type: 'number' }, reviewRounds: { type: 'number' },
              commentDifficulty: { type: 'number' }, difficultyLabel: { type: 'string' },
              reportsPerRound: { type: 'number' }, reportQuality: { type: 'number' },
              overallRating: { type: 'number' }, reviewCount: { type: 'integer' },
              url: { type: 'string' }, confidence: { type: 'string' },
            },
          },
          chinaIntel: {
            type: 'object', additionalProperties: false,
            properties: {
              reviewSpeedBand: { type: 'string' }, reviewSpeedRaw: { type: 'string' },
              weeksMin: { type: 'number' }, weeksMax: { type: 'number' },
              acceptRateKind: { type: 'string' }, acceptRateRaw: { type: 'string' },
              acceptPercent: { type: 'number' },
              impactFactor: { type: 'number' }, casZone: { type: 'string' },
              url: { type: 'string' }, confidence: { type: 'string' },
            },
          },
          risks: { type: 'array', items: { type: 'string' } },
          crossJournal: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true }, name: { type: 'string', required: true },
                band: { type: 'integer' }, share: { type: 'number', required: true },
              },
            },
          },
          note: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = [`${v.journal.name}（${v.journal.id}，档${v.journal.band ?? '?'}）｜置信度 ${v.confidence}${v.stale ? '｜⚠ 数据陈旧' : ''}`]
        if (v.degraded.length > 0) lines.push(`缺源：${v.degraded.join(', ')}`)

        if (v.topicFootprint) {
          const tf = v.topicFootprint
          lines.push('', `【近两年实际产出】${tf.totalWorks ?? '?'} 篇，覆盖 ${((tf.coverage || 0) * 100).toFixed(1)}%（OpenAlex ${tf.windowFrom || ''} → ${tf.windowTo || ''}）`)
          for (const s of (tf.topSubfields || []).slice(0, 6)) {
            lines.push(`  ${(s.share * 100).toFixed(1).padStart(5)}%  ${s.name}`)
          }
          if (tf.hitShare !== undefined) {
            const hits = tf.hitSubfields || []
            lines.push(`  你的子领域命中：${(tf.hitShare * 100).toFixed(1)}%${hits.length ? `（${hits.map((h) => `${h.name} ${(h.share * 100).toFixed(1)}%`).join('、')}）` : '（未命中任何 top 子领域）'}`)
          }
        } else {
          lines.push('', '【近两年实际产出】无数据（该刊缺 ISSN 或 OpenAlex 未收录）')
        }

        if (v.reviewReality) {
          const r = v.reviewReality
          lines.push('', '【评审现实 · SciRev 众包】')
          lines.push(`  首轮 ${r.firstReviewMonths ?? '?'} 月 · 总量 ${r.handlingMonths ?? '?'} 月 · 即时拒 ${r.immediateRejectDays ?? '?'} 天`)
          lines.push(`  ${r.reviewRounds ?? '?'} 轮 · 每轮 ${r.reportsPerRound ?? '?'} 份报告 · 意见难度 ${r.commentDifficulty ?? '?'}/5${r.difficultyLabel ? `（${r.difficultyLabel}）` : ''} · ${r.reviewCount} 条样本`)
        } else {
          lines.push('', '【评审现实 · SciRev】该刊无众包数据')
        }

        if (v.chinaIntel) {
          const c = v.chinaIntel
          lines.push('', '【中国作者视角 · LetPub】')
          if (c.reviewSpeedRaw) lines.push(`  审稿速度：${c.reviewSpeedRaw}${c.weeksMin ? `（约 ${c.weeksMin}–${c.weeksMax} 周）` : ''}`)
          if (c.acceptRateRaw) lines.push(`  录用比例：${c.acceptRateRaw}${c.acceptRateKind === 'invited-only' ? ' ← 以约稿为主，自由投稿慎投' : ''}`)
          if (c.impactFactor) lines.push(`  IF ${c.impactFactor}${c.casZone ? ` · ${c.casZone}` : ''}`)
        } else {
          lines.push('', '【中国作者视角 · LetPub】无数据')
        }

        if (v.risks.length > 0) lines.push('', '风险：', ...v.risks.map((r) => `  · ${r}`))
        if (v.crossJournal && v.crossJournal.length > 0) {
          lines.push('', '同类工作最常出现在（按你的子领域占该刊产出比例）：')
          for (const j of v.crossJournal.slice(0, 8)) {
            lines.push(`  ${(j.share * 100).toFixed(1).padStart(5)}%  档${j.band ?? '?'}  ${j.name}`)
          }
        }
        if (v.note) lines.push('', v.note)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const rt = runtimeOf(ctx, { needs: ['client', 'store'] })
      const { journals } = loadJournals()
      let journal = null
      if (args.journalId) journal = journals.find((j) => j.id === args.journalId)
      if (!journal && args.issn) {
        const want = String(args.issn).replace(/-/g, '')
        journal = journals.find((j) => (j.issn || '').replace(/-/g, '') === want)
      }
      if (!journal && args.name) {
        const t = String(args.name).toLowerCase()
        journal = journals.find((j) => j.name.toLowerCase() === t) || journals.find((j) => j.name.toLowerCase().includes(t))
      }
      if (!journal) throw new Error(`找不到期刊：${args.journalId || args.issn || args.name}`)

      if (args.refresh) {
        await refreshIntel({
          journals: [journal], client: rt.client, store: rt.store,
          mailto: rt.config?.mailto || null,
        })
      }

      const card = await buildIntelCard(rt.store, journal, {
        doc: args.title ? { title: args.title, keywords: args.keywords } : null,
        client: rt.client,
        mailto: rt.config?.mailto || null,
      })

      const cross = card.manuscriptMap ? rankJournalsByFootprint(rt.store, journals, card.manuscriptMap) : []
      const tf = card.topicFootprint
      const rr = card.reviewReality
      const ci = card.chinaIntel

      return {
        journal: card.journal,
        confidence: card.confidence,
        degraded: card.degraded,
        stale: card.stale,
        ...(tf ? {
          topicFootprint: {
            ...(tf.window ? { windowFrom: tf.window.from, windowTo: tf.window.to } : {}),
            totalWorks: tf.totalWorks,
            coverage: tf.coverage,
            topSubfields: tf.topSubfields.map((s) => ({ name: s.name, share: s.share, count: s.count })),
            ...(tf.hitShare !== undefined ? {
              hitShare: tf.hitShare,
              hitSubfields: tf.hitSubfields.map((s) => ({ name: s.name, share: s.share, count: s.count })),
            } : {}),
          },
        } : {}),
        ...(rr ? {
          reviewReality: {
            ...(rr.firstReviewMonths !== null ? { firstReviewMonths: rr.firstReviewMonths } : {}),
            ...(rr.handlingMonths !== null ? { handlingMonths: rr.handlingMonths } : {}),
            ...(rr.immediateRejectDays !== null ? { immediateRejectDays: rr.immediateRejectDays } : {}),
            ...(rr.reviewRounds !== null ? { reviewRounds: rr.reviewRounds } : {}),
            ...(rr.commentDifficulty !== null ? { commentDifficulty: rr.commentDifficulty } : {}),
            ...(rr.difficultyLabel ? { difficultyLabel: rr.difficultyLabel } : {}),
            ...(rr.reportsPerRound !== null ? { reportsPerRound: rr.reportsPerRound } : {}),
            ...(rr.reportQuality !== null ? { reportQuality: rr.reportQuality } : {}),
            ...(rr.overallRating !== null ? { overallRating: rr.overallRating } : {}),
            reviewCount: rr.reviewCount,
            ...(rr.url ? { url: rr.url } : {}),
            confidence: rr.confidence,
          },
        } : {}),
        ...(ci ? {
          chinaIntel: {
            ...(ci.reviewSpeed ? { reviewSpeedBand: ci.reviewSpeed.band, reviewSpeedRaw: ci.reviewSpeed.raw } : {}),
            ...(ci.reviewSpeed?.weeksMin !== null && ci.reviewSpeed?.weeksMin !== undefined ? { weeksMin: ci.reviewSpeed.weeksMin } : {}),
            ...(ci.reviewSpeed?.weeksMax !== null && ci.reviewSpeed?.weeksMax !== undefined ? { weeksMax: ci.reviewSpeed.weeksMax } : {}),
            ...(ci.acceptRate ? { acceptRateKind: ci.acceptRate.kind, acceptRateRaw: ci.acceptRate.raw } : {}),
            ...(ci.acceptRate?.percent !== null && ci.acceptRate?.percent !== undefined ? { acceptPercent: ci.acceptRate.percent } : {}),
            ...(ci.impactFactor ? { impactFactor: ci.impactFactor } : {}),
            ...(ci.casZone ? { casZone: ci.casZone } : {}),
            ...(ci.url ? { url: ci.url } : {}),
            confidence: ci.confidence,
          },
        } : {}),
        risks: card.risks,
        ...(cross.length > 0 ? { crossJournal: cross.slice(0, 10) } : {}),
        note: card.note,
      }
    },
  }))

  /* ── 1c. 情报刷新 ───────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_journal_refresh',
    description:
      'Fetch fresh journal intel from the three sources. dryRun defaults to true and only reports the request '
      + 'budget and estimated duration — set dryRun:false to actually run it. OpenAlex costs 2 requests per journal, '
      + 'SciRev 1, LetPub 1-2. Sources fail independently; a failure downgrades that source only.',
    parameters: {
      journalIds: { type: 'array', description: 'Journal ids to refresh. Omit to refresh all 53.', items: { type: 'string' } },
      sources: { type: 'array', description: 'Subset of: openalex, scirev, letpub. Defaults to all three.', items: { type: 'string' } },
      dryRun: { type: 'boolean', description: 'Defaults to true: report the plan without sending requests.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          dryRun: { type: 'boolean', required: true },
          plannedJournals: { type: 'integer', required: true },
          estimatedRequests: { type: 'integer', required: true },
          estimatedSeconds: { type: 'integer' },
          sources: { type: 'array', required: true, items: { type: 'string' } },
          journals: { type: 'array', required: true, items: { type: 'string' } },
          sourcesOk: { type: 'integer' },
          sourcesFailed: { type: 'integer' },
          elapsedSeconds: { type: 'integer' },
          failures: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = [
          v.dryRun ? '【预演】未发送任何请求' : '【已完成】',
          `目标刊 ${v.plannedJournals} 刊 × 源 ${v.sources.join(',')}`,
          `预计请求 ${v.estimatedRequests} 个${v.estimatedSeconds ? `，约 ${v.estimatedSeconds} 秒` : ''}`,
        ]
        if (!v.dryRun) {
          lines.push(`成功 ${v.sourcesOk} 条源记录，失败 ${v.sourcesFailed} 条，用时 ${v.elapsedSeconds}s`)
          if (v.failures.length > 0) {
            lines.push('失败明细：')
            for (const f of v.failures.slice(0, 12)) lines.push(`  ${f}`)
          }
        }
        if (v.note) lines.push('', v.note)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const rt = runtimeOf(ctx, { needs: ['client', 'store'] })
      const { journals } = loadJournals()
      const pool = Array.isArray(args.journalIds) && args.journalIds.length > 0
        ? journals.filter((j) => args.journalIds.includes(j.id))
        : journals
      if (pool.length === 0) throw new Error(`journalIds 没有匹配的刊：${(args.journalIds || []).join(',')}`)
      const sources = Array.isArray(args.sources) && args.sources.length > 0
        ? args.sources.filter((s) => INTEL_SOURCE_IDS.includes(s))
        : INTEL_SOURCE_IDS
      if (sources.length === 0) throw new Error(`sources 只能是 ${INTEL_SOURCE_IDS.join('/')}`)

      const requestsPerJournal = sources.reduce((n, s) => n + (s === 'openalex' ? 2 : (s === 'letpub' ? 2 : 1)), 0)
      const estimatedRequests = pool.length * requestsPerJournal
      /* 限速：openalex 1rps / scirev 0.5 / letpub 0.3，按最慢的那条串行估算 */
      const estimatedSeconds = Math.round(pool.length * (sources.includes('letpub') ? 6.7 : (sources.includes('scirev') ? 3.3 : 2.5)))

      if (args.dryRun !== false) {
        return {
          dryRun: true,
          plannedJournals: pool.length,
          estimatedRequests,
          estimatedSeconds,
          sources,
          journals: pool.map((j) => j.id),
          note: '确认后传 dryRun:false 执行。单刊也可用 science_journal_intel({refresh:true}) 现场抓。',
        }
      }

      const started = Date.now()
      const report = await refreshIntel({
        journals: pool, client: rt.client, store: rt.store,
        mailto: rt.config?.mailto || null, sources,
      })
      const failures = report.reports.flatMap((r) =>
        Object.entries(r.sources)
          .filter(([, s]) => !s.ok && !s.skipped)
          .map(([id, s]) => `${r.journalId}/${id}: ${s.error}`))
      return {
        dryRun: false,
        plannedJournals: pool.length,
        estimatedRequests,
        sources,
        journals: pool.map((j) => j.id),
        sourcesOk: report.sourcesOk,
        sourcesFailed: report.sourcesFailed,
        elapsedSeconds: Math.round((Date.now() - started) / 1000),
        ...(failures.length > 0 ? { failures } : {}),
      }
    },
  }))

  /* ── 2. 投稿前门禁 ──────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_paper_audit',
    description:
      'Run the pre-submission gate over a manuscript: title/abstract/structure checks, statistics reporting, '
      + 'data and code availability, ethics, COI, author contributions, figure-reference coverage, plus '
      + 'discipline-specific reporting standards (CONSORT, PRISMA, STROBE, ARRIVE, TRIPOD, TOP). '
      + 'When a manuscriptId is given it also checks the evidence chain: claims with no attached evidence and '
      + 'claims contradicted by their own evidence. Every finding carries the rule source and a concrete fix. '
      + 'Returns blocking / warning / pass / skipped counts; skipped means the section was absent, not that it passed.',
    parameters: {
      manuscriptId: { type: 'string', description: 'Stored manuscript id; enables evidence-chain checks and persists the audit run.' },
      title: { type: 'string', description: 'Manuscript title.' },
      abstract: { type: 'string', description: 'Abstract text.' },
      intro: { type: 'string', description: 'Introduction text.' },
      methods: { type: 'string', description: 'Methods text (also covers data/code availability, ethics, COI statements).' },
      results: { type: 'string', description: 'Results text.' },
      discussion: { type: 'string', description: 'Discussion text.' },
      fulltext: { type: 'string', description: 'Whole manuscript, used when sections are not split.' },
      figures: { type: 'integer', description: 'Declared figure + table count, used for reference-coverage checks.' },
      words: { type: 'integer', description: 'Main-text word count.' },
      refs: { type: 'integer', description: 'Reference count.' },
      profiles: {
        type: 'array',
        description: 'Reporting standards to apply: general, consort, prisma, strobe, arrive, tripod, open-science. Defaults to ["general"].',
        items: { type: 'string' },
      },
      save: { type: 'boolean', description: 'Persist this run to audit_run (needs manuscriptId). Defaults to true when manuscriptId is set.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          blocking: { type: 'integer', required: true },
          warning: { type: 'integer', required: true },
          pass: { type: 'integer', required: true },
          skipped: { type: 'integer', required: true },
          manual: { type: 'integer', required: true },
          total: { type: 'integer', required: true },
          profiles: { type: 'array', required: true, items: { type: 'string' } },
          verdict: { type: 'string', required: true },
          findings: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                severity: { type: 'string', required: true },
                status: { type: 'string', required: true },
                profile: { type: 'string', required: true },
                message: { type: 'string', required: true },
                fix: { type: 'string' },
                source: { type: 'string' },
                evidence: { type: 'string' },
                auto: { type: 'boolean' },
              },
            },
          },
          skippedRules: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => {
        const lines = [
          `判定：${value.verdict}｜阻断 ${value.blocking} · 警告 ${value.warning} · 通过 ${value.pass} · 无法检查 ${value.skipped} · 待人工 ${value.manual}`,
          `规范：${value.profiles.join(', ')}`,
        ]
        const blocking = value.findings.filter((f) => f.severity === 'blocking')
        const warns = value.findings.filter((f) => f.severity !== 'blocking' && f.status === 'fail')
        const manuals = value.findings.filter((f) => f.status === 'manual')
        if (blocking.length > 0) {
          lines.push('', '必须先解决（审稿人几乎必然要求补）：')
          for (const f of blocking) {
            lines.push(`  ✗ ${f.id} ${f.message}${f.evidence ? ` — ${f.evidence}` : ''}`)
            if (f.fix) lines.push(`     改：${f.fix}`)
          }
        }
        if (warns.length > 0) {
          lines.push('', '建议修（影响送审概率，不必然退稿）：')
          for (const f of warns) {
            lines.push(`  ! ${f.id} ${f.message}${f.evidence ? ` — ${f.evidence}` : ''}`)
            if (f.fix) lines.push(`     改：${f.fix}`)
          }
        }
        if (manuals.length > 0) {
          lines.push('', '需要你自己判断（工具不做语义判定）：')
          for (const f of manuals) lines.push(`  ? ${f.id} ${f.evidence || f.message}`)
        }
        if (value.skippedRules && value.skippedRules.length > 0) {
          lines.push('', `以下规则因缺章节无法检查（不等于通过）：${value.skippedRules.slice(0, 8).join(', ')}${value.skippedRules.length > 8 ? ' …' : ''}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const rt = ctx.get('scienceRuntime')
      const store = rt?.store || null

      let doc = {
        title: args.title, abstract: args.abstract, intro: args.intro,
        methods: args.methods, results: args.results, discussion: args.discussion,
        fulltext: args.fulltext,
      }
      let meta = { figures: args.figures, words: args.words, refs: args.refs }

      /* 绑了稿件就用库里的正文与元信息补空，避免重复粘贴 */
      let manuscript = null
      if (args.manuscriptId) {
        if (!store) throw new Error('存储未就绪，无法按 manuscriptId 审计')
        manuscript = store.getManuscript(args.manuscriptId)
        if (!manuscript) throw new Error(`稿件 ${args.manuscriptId} 不存在`)
        doc = {
          title: doc.title || manuscript.title || '',
          abstract: doc.abstract || manuscript.abstract || '',
          intro: doc.intro || '',
          methods: doc.methods || '',
          results: doc.results || '',
          discussion: doc.discussion || '',
          fulltext: doc.fulltext || '',
        }
        meta = {
          figures: meta.figures ?? manuscript.figures ?? null,
          words: meta.words ?? manuscript.words ?? null,
          refs: meta.refs ?? manuscript.refs ?? null,
        }
      }

      const audit = runAudit(doc, {
        profiles: args.profiles,
        meta,
        store,
        manuscriptId: args.manuscriptId || null,
      })

      const verdict = audit.counts.blocking > 0
        ? '不可投（先消阻断项）'
        : (audit.counts.warning > 0 ? '可投但建议先修警告' : '通过')

      const findings = audit.results
        .filter((r) => r.status === 'fail' || r.status === 'manual')
        .sort((a, b) => (a.severity === b.severity ? 0 : (a.severity === 'blocking' ? -1 : 1)))
      const skippedRules = audit.results.filter((r) => r.status === 'skip').map((r) => r.id)

      if (manuscript && args.save !== false) {
        try {
          store.upsertManuscript({
            id: manuscript.id,
            words: meta.words ?? undefined,
            figures: meta.figures ?? undefined,
            refs: meta.refs ?? undefined,
          })
          store.saveAuditRun({
            manuscriptId: manuscript.id,
            profile: audit.profiles.join('+'),
            blocking: audit.counts.blocking,
            warning: audit.counts.warning,
            pass: audit.counts.pass,
            report: { counts: audit.counts, findings, skippedRules },
          })
          if (manuscript.status === 'draft') store.setManuscriptStatus(manuscript.id, 'audited')
        } catch (error) {
          ctx.logger?.warn?.(`science: 审计落库失败 ${error.message}`)
        }
      }

      return {
        ...audit.counts,
        profiles: audit.profiles,
        verdict,
        findings: findings.map((f) => ({
          id: f.id, severity: f.severity, status: f.status, profile: f.profile,
          message: f.message,
          ...(f.fix ? { fix: f.fix } : {}),
          ...(f.source ? { source: f.source } : {}),
          ...(f.evidence ? { evidence: f.evidence } : {}),
          ...(f.auto === false ? { auto: false } : { auto: true }),
        })),
        ...(skippedRules.length > 0 ? { skippedRules } : {}),
      }
    },
  }))

  /* ── 3. 加速路径规划 ─────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_submission_route',
    description:
      'Plan the fastest legitimate route to publication: whether Registered Reports apply (in-principle acceptance '
      + 'before results), whether portable review (Review Commons style) is available, when to post a preprint, '
      + 'which transfer chain to use after rejection, and a day-by-day timeline with cumulative days. '
      + 'Also returns the decision branch for a specific rejection reason. All day counts are order-of-magnitude '
      + 'estimates for scheduling, never promises.',
    parameters: {
      journalId: { type: 'string', description: 'Target journal id from science_journal_fit (e.g. "nature", "elife").' },
      design: { type: 'string', description: 'Study design; Registered Report viability depends on it.' },
      band: { type: 'integer', description: 'Self-assessed work band 1-5.' },
      title: { type: 'string', description: 'Manuscript title, used to judge field fit for portable review.' },
      keywords: { type: 'array', description: 'Field keywords, used to judge field fit.', items: { type: 'string' } },
      field: { type: 'string', description: 'Field label, e.g. "cell biology", "machine learning".' },
      hasPreprint: { type: 'boolean', description: 'Whether a preprint is already posted.' },
      rejectReason: {
        type: 'string',
        description: 'If already rejected, the reason: scope | format | novelty | method | significance | unknown. Returns only that branch.',
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          target: {
            type: 'object', additionalProperties: false,
            properties: {
              id: { type: 'string', required: true }, name: { type: 'string', required: true },
              band: { type: 'integer' }, deskDays: { type: 'integer' }, reviewDays: { type: 'integer' },
              acceptRate: { type: 'number' },
            },
          },
          registeredReport: {
            type: 'object', additionalProperties: false, required: true,
            properties: {
              viable: { type: 'boolean', required: true },
              reasons: { type: 'array', required: true, items: { type: 'string' } },
              journalsThatSupport: { type: 'array', items: { type: 'string' } },
              stage1Days: { type: 'integer' }, stage2Days: { type: 'integer' },
            },
          },
          portableReview: {
            type: 'object', additionalProperties: false, required: true,
            properties: {
              viable: { type: 'boolean', required: true },
              reasons: { type: 'array', required: true, items: { type: 'string' } },
              platforms: { type: 'array', items: { type: 'string' } },
              days: { type: 'integer' },
            },
          },
          preprint: {
            type: 'object', additionalProperties: false, required: true,
            properties: { policy: { type: 'string', required: true }, action: { type: 'string', required: true } },
          },
          transfer: {
            type: 'object', additionalProperties: false, required: true,
            properties: {
              viable: { type: 'boolean', required: true },
              chain: { type: 'array', required: true, items: { type: 'string' } },
              publisher: { type: 'string' },
            },
          },
          timeline: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                step: { type: 'string', required: true }, action: { type: 'string', required: true },
                days: { type: 'integer', required: true }, cumulativeDays: { type: 'integer', required: true },
                note: { type: 'string' },
              },
            },
          },
          totalDays: { type: 'integer', required: true },
          decision: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                reason: { type: 'string', required: true }, signal: { type: 'string' },
                action: { type: 'string', required: true }, rationale: { type: 'string' },
              },
            },
          },
          note: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = []
        lines.push(v.target
          ? `目标：${v.target.name}（档${v.target.band}）· desk 约 ${v.target.deskDays}d · 外审约 ${v.target.reviewDays}d`
          : '未指定目标刊：周期与 transfer 链无法确定')
        lines.push('')
        lines.push(`Registered Reports：${v.registeredReport.viable ? '可行 ✓' : '不可行'}`)
        for (const r of v.registeredReport.reasons) lines.push(`  · ${r}`)
        lines.push('')
        lines.push(`Portable review：${v.portableReview.viable ? '可行 ✓' : '不可行'}`)
        for (const r of v.portableReview.reasons) lines.push(`  · ${r}`)
        lines.push('')
        lines.push(`预印本（${v.preprint.policy}）：${v.preprint.action}`)
        lines.push(`转投链：${v.transfer.viable ? v.transfer.chain.join(' → ') : '无（跨出版商只能重投）'}`)
        lines.push('', `时间线（合计约 ${v.totalDays} 天）：`)
        for (const t of v.timeline) {
          lines.push(`  ${String(t.cumulativeDays).padStart(4)}d  ${t.step.padEnd(13)} ${t.action}${t.note ? `（${t.note}）` : ''}`)
        }
        if (v.decision.length > 0) {
          lines.push('', '决策分支：')
          for (const d of v.decision) lines.push(`  [${d.reason}] ${d.signal || ''} → ${d.action}`)
        }
        if (v.note) lines.push('', v.note)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const out = planRoute({
        journalId: args.journalId, design: args.design, band: args.band,
        title: args.title, keywords: args.keywords, field: args.field,
        hasPreprint: args.hasPreprint, rejectReason: args.rejectReason,
      })
      return {
        ...(out.target ? { target: out.target } : {}),
        registeredReport: out.registeredReport,
        portableReview: out.portableReview,
        preprint: out.preprint,
        transfer: out.transfer,
        timeline: out.timeline,
        totalDays: out.totalDays,
        decision: out.decision,
        note: out.note,
      }
    },
  }))

  /* ── 4. 新颖性 / scoop check ─────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_novelty',
    description:
      'Scoop check before submission: search the ten sources for the closest existing work, rank by title overlap, '
      + 'flag recent high-overlap papers, and check whether the abstract actually states a gap. '
      + 'Returns a risk level and what you must differentiate. It does not judge whether your work is novel — '
      + 'that needs your reading of the closest hits.',
    parameters: {
      title: { type: 'string', description: 'Manuscript title (drives the search and the overlap scoring).', required: true },
      abstract: { type: 'string', description: 'Abstract, used to detect whether a gap is stated.' },
      keywords: { type: 'array', description: 'Author keywords.', items: { type: 'string' } },
      sinceYear: { type: 'integer', description: 'Only consider work from this year onward.' },
      limit: { type: 'integer', description: 'Per-source record count, 10-50. Defaults to 20.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          scoopRisk: { type: 'string', required: true },
          verdict: { type: 'string', required: true },
          maxOverlap: { type: 'number', required: true },
          gapStated: { type: 'boolean', required: true },
          gapEvidence: { type: 'string' },
          closest: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                doi: { type: 'string' },
                year: { type: 'integer' },
                venue: { type: 'string' },
                overlap: { type: 'number', required: true },
                sources: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          searchedTotal: { type: 'integer', required: true },
          searchedMs: { type: 'integer' },
          caveat: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = [
          `scoop 风险：${v.scoopRisk}（最高标题重叠 ${v.maxOverlap}）`,
          v.verdict,
          `摘要中的空白陈述：${v.gapStated ? `有 —「${v.gapEvidence}」` : '没有（先按 5 句模板补第 2 句）'}`,
          '',
          `近邻工作（共检索 ${v.searchedTotal} 条，${v.searchedMs ?? '?'}ms）：`,
        ]
        v.closest.forEach((c, i) => {
          lines.push(`${i + 1}. [${c.overlap}] ${c.title}［${c.year || '?'}${c.venue ? ` · ${c.venue}` : ''}］`)
          if (c.doi) lines.push(`   DOI ${c.doi}`)
        })
        if (v.caveat) lines.push('', v.caveat)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const rt = runtimeOf(ctx)
      try {
        const out = await checkNovelty(
          { title: args.title, abstract: args.abstract, keywords: args.keywords, sinceYear: args.sinceYear, limit: args.limit },
          { pipeline: rt.pipeline },
        )
        return {
          scoopRisk: out.scoopRisk,
          verdict: out.verdict,
          maxOverlap: out.maxOverlap,
          gapStated: out.gap.stated,
          ...(out.gap.evidence ? { gapEvidence: out.gap.evidence } : {}),
          closest: out.closest.map((c) => ({
            title: c.title, overlap: c.overlap,
            ...(c.doi ? { doi: c.doi } : {}), ...(c.year ? { year: c.year } : {}),
            ...(c.venue ? { venue: c.venue } : {}), ...(c.sources.length ? { sources: c.sources } : {}),
          })),
          searchedTotal: out.searched.total,
          ...(out.searched.ms ? { searchedMs: out.searched.ms } : {}),
          caveat: out.caveat,
        }
      } catch (error) { rethrow(error) }
    },
  }))

  /* ── 5. Cover letter 论据骨架 ────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_cover_letter',
    description:
      'Produce the argument skeleton for a cover letter: five slots (why these readers care / why now / what we show / '
      + 'why this journal / declarations), each with the facts you must fill and the phrases to avoid. '
      + 'It deliberately does not write finished prose, because template letters are exactly what editors discount.',
    parameters: {
      title: { type: 'string', description: 'Manuscript title.', required: true },
      abstract: { type: 'string', description: 'Abstract.' },
      journalId: { type: 'string', description: 'Target journal id, so the scope paragraph can be specific.' },
      keyFinding: { type: 'string', description: 'One falsifiable sentence: what you show. Drives the opening line.' },
      whyNow: { type: 'string', description: 'What makes this answerable now (recent advance, new data, new method).' },
      relatedInJournal: { type: 'array', description: '1-2 specific recent papers in that journal your work follows on.', items: { type: 'string' } },
      preprintDoi: { type: 'string', description: 'Preprint DOI if already posted.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          journal: {
            type: 'object', additionalProperties: false,
            properties: { id: { type: 'string', required: true }, name: { type: 'string', required: true }, deskDays: { type: 'integer' } },
          },
          opening: { type: 'string' },
          slots: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                heading: { type: 'string', required: true },
                mustFill: { type: 'array', required: true, items: { type: 'string' } },
                avoid: { type: 'array', items: { type: 'string' } },
                filled: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          missing: { type: 'array', required: true, items: { type: 'string' } },
          checks: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = [v.journal ? `目标刊：${v.journal.name}（desk 约 ${v.journal.deskDays ?? '?'} 天）` : '未指定目标刊']
        if (v.opening) lines.push(`建议开头句：${v.opening}`)
        if (v.missing.length > 0) lines.push('', '缺这些事实，写出来就是套话：', ...v.missing.map((m) => `  · ${m}`))
        for (const s of v.slots) {
          lines.push('', s.heading)
          for (const f of s.mustFill) lines.push(`  必须填：${f}`)
          if (s.filled) for (const f of s.filled) lines.push(`  已有素材：${f}`)
          for (const a of s.avoid || []) lines.push(`  避免：${a}`)
        }
        if (v.checks) lines.push('', '自查：', ...v.checks.map((c) => `  · ${c}`))
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      return buildCoverLetter({
        title: args.title, abstract: args.abstract, journalId: args.journalId,
        keyFinding: args.keyFinding, whyNow: args.whyNow,
        relatedInJournal: args.relatedInJournal, preprintDoi: args.preprintDoi,
      })
    },
  }))

  /* ── 6. 审稿回应分类 ────────────────────────────────────────────────── */
  ctx.tools.register(defineTool({
    name: 'science_rebuttal',
    description:
      'Split reviewer comments into numbered points, classify each (new-experiment / statistics / prior-work / '
      + 'claim-strength / clarity / method-detail / disagreement), and give a response skeleton plus the strategy '
      + 'for that class. Use it right after receiving reviews, before writing a single line of response.',
    parameters: {
      reviews: { type: 'string', description: 'Paste all reviewer comments. Reviewer headings and numbered lists are detected.', required: true },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          total: { type: 'integer', required: true },
          blocking: { type: 'integer', required: true },
          categories: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: { category: { type: 'string', required: true }, count: { type: 'integer', required: true } },
            },
          },
          findings: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                index: { type: 'integer', required: true },
                reviewer: { type: 'string', required: true },
                category: { type: 'string', required: true },
                label: { type: 'string', required: true },
                severity: { type: 'string', required: true },
                excerpt: { type: 'string' },
                action: { type: 'string', required: true },
                skeleton: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          strategy: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
      },
      render: (_args, v) => {
        const lines = [
          `共 ${v.total} 条意见，其中 ${v.blocking} 条必须实质处理`,
          `分布：${v.categories.map((c) => `${c.category}×${c.count}`).join(' ')}`,
        ]
        for (const f of v.findings) {
          lines.push('', `#${f.index} [${f.reviewer} ${f.label}·${f.severity}] ${f.excerpt}`)
          lines.push(`  做法：${f.action}`)
          if (f.skeleton) for (const s of f.skeleton) lines.push(`    - ${s}`)
        }
        if (v.strategy) lines.push('', '总体策略：', ...v.strategy.map((s) => `  · ${s}`))
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args) {
      const out = parseRebuttal(args.reviews)
      const labels = {}
      for (const f of out.findings) labels[f.category] = f.label
      return {
        total: out.counts.total,
        blocking: out.counts.blocking,
        categories: Object.entries(out.counts.byCategory).map(([category, count]) => ({ category, count })),
        findings: out.findings.map((f) => ({
          index: f.index, reviewer: f.reviewer, category: f.category, label: f.label,
          severity: f.severity, action: f.action,
          ...(f.excerpt ? { excerpt: f.excerpt } : {}),
          skeleton: f.skeleton,
        })),
        strategy: out.strategy,
        note: out.note,
      }
    },
  }))

  ctx.logger?.info?.('science: 发表层工具已注册（journal_fit / journal_intel / journal_refresh / paper_audit / submission_route / novelty / cover_letter / rebuttal）')
}
