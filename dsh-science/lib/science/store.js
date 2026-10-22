/**
 * SQLite 存储：科研数据根的唯一写入口。
 *
 * 原则：
 *   - 工具与 UI 都走 store，不许 ad-hoc SQL（否则 schema 一改全崩）
 *   - 迁移幂等：`schema_meta.version` 只能前进，重复执行无副作用
 *   - 论文主键由指纹决定，多源命中同一篇只落一行、sources 合并
 */
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export const SCHEMA_VERSION = 8

/** 子领域 id 的历史形态有 `subfields/1312` 与 `1312` 两种，入库与查询前统一取尾段。 */
function normaliseIds(ids = []) {
  const out = new Set()
  for (const raw of ids) {
    const s = String(raw ?? '')
    if (!s) continue
    const cut = s.lastIndexOf('/')
    out.add(cut === -1 ? s : s.slice(cut + 1))
  }
  return [...out]
}

const MIGRATIONS = [
  {
    version: 1,
    note: 'M0 基线：仅 schema_meta 存在（JSON 侧布局由 host 插件维护）',
    up(db) {
      db.exec(`CREATE TABLE IF NOT EXISTS schema_meta(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, note TEXT);`)
    },
  },
  {
    version: 2,
    note: 'M1 检索层：paper / paper_source / paper_fts / query_log / source_state',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS paper(
          id TEXT PRIMARY KEY,
          fingerprint TEXT NOT NULL UNIQUE,
          doi TEXT, arxiv_id TEXT, pmid TEXT, pmcid TEXT,
          title TEXT, authors_json TEXT, year INTEGER, venue TEXT,
          volume TEXT, issue TEXT, pages TEXT, abstract TEXT,
          lang TEXT, type TEXT, oa_status TEXT, oa_pdf_url TEXT, oa_landing_url TEXT,
          cited_by_count INTEGER, ref_count INTEGER, license TEXT, url TEXT,
          sources_json TEXT NOT NULL,
          score REAL, project_id TEXT,
          added_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS paper_doi ON paper(doi);
        CREATE INDEX IF NOT EXISTS paper_year ON paper(year);
        CREATE INDEX IF NOT EXISTS paper_project ON paper(project_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS paper_fts USING fts5(paper_id UNINDEXED, title, abstract);
        CREATE TABLE IF NOT EXISTS query_log(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT, dsl_json TEXT NOT NULL, sources_json TEXT,
          started_at INTEGER NOT NULL, ms INTEGER,
          hits_per_source_json TEXT, total INTEGER, cost_usd REAL, error TEXT
        );
        CREATE TABLE IF NOT EXISTS source_state(
          id TEXT PRIMARY KEY, host TEXT, ok INTEGER, cooldown_until INTEGER,
          consecutive_failures INTEGER, last_error TEXT, last_ms INTEGER,
          total_runs INTEGER, total_hits INTEGER, updated_at INTEGER,
          budget_used_usd REAL
        );
      `)
    },
  },
  {
    version: 3,
    note: 'M2 发表层：claim / evidence / manuscript / submission_event / audit_run',
    up(db) {
      db.exec(`
        /* 断言：稿件里每一句"我们证明了 X"都要落成一行，并绑证据 */
        CREATE TABLE IF NOT EXISTS claim(
          id TEXT PRIMARY KEY,
          project_id TEXT, manuscript_id TEXT,
          text TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'primary',   -- primary|secondary|mechanistic|correlative
          status TEXT NOT NULL DEFAULT 'unsupported', -- unsupported|supported|contradicted|partial
          strength TEXT,                           -- 一句话写清证据强度（设计+效应量+n）
          section TEXT,                            -- abstract|intro|results|discussion
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS claim_ms ON claim(manuscript_id);
        CREATE INDEX IF NOT EXISTS claim_status ON claim(status);

        /* 证据：claim ↔ paper/实验，带定位与哈希，保证"可复核" */
        CREATE TABLE IF NOT EXISTS evidence(
          id TEXT PRIMARY KEY,
          claim_id TEXT NOT NULL,
          paper_id TEXT,                           -- 引用文献（对应 paper 表）
          experiment_id TEXT,                      -- 自有实验
          kind TEXT NOT NULL DEFAULT 'literature', -- literature|experiment|dataset
          quote TEXT,                              -- 原文摘句（≤500 字）
          page_from INTEGER, page_to INTEGER,
          locator TEXT,                            -- 如 "Fig.2c" / "Table 1" / "JATS sec=results p3"
          file_hash TEXT,                          -- sha256，证明读过的是同一份文件
          source_url TEXT,
          supports INTEGER NOT NULL DEFAULT 1,     -- 1 支持 / 0 反驳
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS evidence_claim ON evidence(claim_id);
        CREATE INDEX IF NOT EXISTS evidence_paper ON evidence(paper_id);

        /* 稿件：状态机 + 目标刊，id 在整个转投链里保持不变 */
        CREATE TABLE IF NOT EXISTS manuscript(
          id TEXT PRIMARY KEY,
          project_id TEXT,
          title TEXT, abstract TEXT, keywords_json TEXT,
          target_journal TEXT,
          band INTEGER,                            -- 1..5 自评档位
          design TEXT,                             -- experimental|observational|computational|theory|clinical-trial|meta-analysis
          status TEXT NOT NULL DEFAULT 'draft',    -- draft|audited|submitted|under_review|rejected|transferred|accepted|published
          version INTEGER NOT NULL DEFAULT 1,
          words INTEGER, figures INTEGER, refs INTEGER,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS manuscript_project ON manuscript(project_id);

        /* 投稿时间线：把"更快"变成可测指标（desk 天数、总周期、transfer 节省） */
        CREATE TABLE IF NOT EXISTS submission_event(
          id TEXT PRIMARY KEY,
          manuscript_id TEXT NOT NULL,
          ts INTEGER NOT NULL,
          kind TEXT NOT NULL,   -- preprint|submit|desk_reject|review_invited|review_returned|decision|transfer|accept|publish
          journal_id TEXT,
          detail TEXT,
          days_from_prev INTEGER
        );
        CREATE INDEX IF NOT EXISTS submission_event_ms ON submission_event(manuscript_id, ts);

        /* 自检快照：谁在哪一版拦下了什么 */
        CREATE TABLE IF NOT EXISTS audit_run(
          id TEXT PRIMARY KEY,
          manuscript_id TEXT, ts INTEGER NOT NULL,
          profile TEXT,                 -- 学科/报告规范 profile
          blocking_n INTEGER, warning_n INTEGER, pass_n INTEGER,
          report_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS audit_run_ms ON audit_run(manuscript_id, ts);
      `)
    },
  },
  {
    version: 4,
    note: '期刊情报：三源快照 + 产出分布 + 评审语料',
    up(db) {
      db.exec(`
        /* 每刊 × 每源一条最新快照。payload 是源原始归一化结果，字段随源而异，故用 JSON。 */
        CREATE TABLE IF NOT EXISTS journal_intel(
          journal_id TEXT NOT NULL,
          source TEXT NOT NULL,            -- openalex|scirev|letpub
          fetched_at INTEGER NOT NULL,
          sample_size INTEGER,             -- SciRev 的众包条数 / OpenAlex 的载文量
          confidence TEXT,                 -- high|medium|low
          window_from TEXT, window_to TEXT, -- OpenAlex 的时间窗口（ISO 日期）
          payload_json TEXT NOT NULL,
          PRIMARY KEY(journal_id, source)
        );
        CREATE INDEX IF NOT EXISTS journal_intel_source ON journal_intel(source, fetched_at);

        /* 产出分布单独建表：跨刊比较（哪本刊最常发我这个 topic）用 SQL 一句就能答 */
        CREATE TABLE IF NOT EXISTS journal_topic(
          journal_id TEXT NOT NULL,
          topic_id TEXT NOT NULL,
          topic_name TEXT,
          subfield TEXT, field TEXT, domain TEXT,
          count INTEGER NOT NULL,
          share REAL NOT NULL,             -- count / 该刊该窗口总载文
          window_from TEXT, window_to TEXT,
          PRIMARY KEY(journal_id, topic_id, window_from)
        );
        CREATE INDEX IF NOT EXISTS journal_topic_share ON journal_topic(journal_id, share DESC);
        CREATE INDEX IF NOT EXISTS journal_topic_name ON journal_topic(topic_name);

        /* 公开评审语料（P4 预留）：主题化后的短文本，不存全文 */
        CREATE TABLE IF NOT EXISTS review_corpus(
          id TEXT PRIMARY KEY,
          journal_id TEXT,
          venue TEXT,
          kind TEXT,                       -- assessment|report|recommendation|post_publication
          theme TEXT,
          text TEXT NOT NULL,
          source TEXT, source_url TEXT,
          fetched_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS review_corpus_journal ON review_corpus(journal_id, theme);
      `)
    },
  },

  {
    version: 5,
    note: 'M4 知识转化层：外部知识条目 → 可证伪 claim → 缺口 → 贡献方案',
    up(db) {
      db.exec(`
        /* 发现层：GitHub repo 或 arXiv 预印本。payload 保留源原始字段，便于将来换源。 */
        CREATE TABLE IF NOT EXISTS frontier_item(
          id TEXT PRIMARY KEY,              -- g:owner/repo | a:arxiv_id
          source TEXT NOT NULL,             -- github | arxiv
          kind TEXT NOT NULL,               -- repo | preprint
          title TEXT, url TEXT, author TEXT,
          stars INTEGER, forks INTEGER,
          pushed_at INTEGER, created_at INTEGER,
          commits_52w INTEGER, releases INTEGER,
          topics_json TEXT, description TEXT,
          domain TEXT,                      -- optimization | llm-training | ...
          credibility REAL,                 -- 0-1，可解释
          credibility_note TEXT,            -- 分项依据，人能复核
          payload_json TEXT,
          fetched_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS frontier_item_domain ON frontier_item(domain, credibility DESC);
        CREATE INDEX IF NOT EXISTS frontier_item_fresh ON frontier_item(pushed_at DESC);

        /* 提炼层：可证伪 claim。needs_human_review 恒为 1 —— 工具只结构化，不判真假。 */
        CREATE TABLE IF NOT EXISTS knowledge_claim(
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          mechanism TEXT NOT NULL,          -- 「X 通过 Y 导致 Z」
          prediction TEXT,                  -- 可检验的预测
          falsifier TEXT,                   -- 什么结果会推翻它
          evidence_kind TEXT,               -- theorem | experiment | anecdote | none
          confidence TEXT,                  -- high | medium | low
          needs_human_review INTEGER DEFAULT 1,
          excerpt TEXT,                     -- 原文片段，用于人工复核
          source_url TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS knowledge_claim_item ON knowledge_claim(item_id);

        /* 定位层：缺口。statement 必须是「别人做到 A，缺 B」的完整句，不接受关键词。 */
        CREATE TABLE IF NOT EXISTS gap_entry(
          id TEXT PRIMARY KEY,
          claim_id TEXT NOT NULL,
          gap_type TEXT NOT NULL,           -- theory | scale | transfer | benchmark | reproduction
          statement TEXT NOT NULL,
          what_exists TEXT,
          what_missing TEXT NOT NULL,
          evidence_json TEXT,               -- [{source, id, title, year, doi}]
          is_publishable INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS gap_entry_type ON gap_entry(gap_type, is_publishable DESC);

        /* 设计层：贡献方案。status 未到 ready 前不许生成 manuscript。 */
        CREATE TABLE IF NOT EXISTS contribution_plan(
          id TEXT PRIMARY KEY,
          claim_id TEXT, gap_id TEXT,
          contribution_type TEXT NOT NULL,
          target_band INTEGER,              -- 3 | 4 | 5
          required_evidence_json TEXT,      -- [{kind, item, have, how}]
          gate_gaps_json TEXT,              -- 距该 band 还缺什么
          candidate_journals_json TEXT,
          status TEXT DEFAULT 'draft',      -- draft | designing | ready
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS contribution_plan_status ON contribution_plan(status, updated_at DESC);
      `)
    },
  },
  {
    version: 6,
    note: 'M6 实验层：project / experiment / experiment_run / analysis / figure_spec / provenance',
    up(db) {
      db.exec(`
        /* 课题：一个课题 = 一个可写完的故事。domain 存学科包 id，决定后面所有默认值。 */
        CREATE TABLE IF NOT EXISTS project(
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          domain TEXT,                      -- biomed | psychology | ... 学科包 id
          question TEXT,                    -- 研究问题原文
          design_id TEXT,                   -- 学科包里的 design id
          target_journal TEXT,
          status TEXT DEFAULT 'open',       -- open | designing | running | analyzing | writing | done
          match_json TEXT,                  -- 学科匹配结果快照 {id, matchedBy, confidence}
          plan_json TEXT,                   -- 冻结的方案（plan.js 产出，含样本量与威胁）
          prereg_ref TEXT,                  -- OSF / PROSPERO / ClinicalTrials 的 DOI 或编号
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS project_status ON project(status, updated_at DESC);
        CREATE INDEX IF NOT EXISTS project_domain ON project(domain);

        /* 实验：一个课题下可以有多个实验。status 未到 approved 前不许跑 run。 */
        CREATE TABLE IF NOT EXISTS experiment(
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          design TEXT,                      -- 学科包 design id
          hypothesis TEXT,
          primary_outcome TEXT,
          n_planned INTEGER,
          power_json TEXT,                  -- {alpha, power, effect, effectKind, n, design_effect, method}
          prereg_json TEXT,                 -- 预注册草稿（含与注册库字段的映射）
          threats_json TEXT,                -- 该设计的 threats，逐条带 mitigation
          status TEXT DEFAULT 'planned',    -- planned | approved | running | done | abandoned
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS experiment_project ON experiment(project_id, created_at DESC);

        /* 一次执行 = 一个目录。目录之外不动，越界即拒绝（runner 里硬校验）。
           experiment_id 可以为空：探索性的 run 不必先挂到一个正式实验上，
           但 project_id 一定有——否则这次执行无法归到任何课题，等于没有溯源。 */
        CREATE TABLE IF NOT EXISTS experiment_run(
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          experiment_id TEXT,
          run_no INTEGER NOT NULL,
          dir TEXT NOT NULL,
          command TEXT,
          inputs_json TEXT,                 -- [{path, sha256, bytes}]
          outputs_json TEXT,                -- [{path, sha256, bytes}]
          env_json TEXT,                    -- {python, numpy, scipy, platform, seed}
          seed INTEGER,
          network INTEGER DEFAULT 0,        -- 默认 0：不给网络
          status TEXT NOT NULL,             -- ok | failed | refused
          error TEXT,
          ms INTEGER,
          started_at INTEGER NOT NULL, finished_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS run_experiment ON experiment_run(experiment_id, run_no DESC);
        CREATE INDEX IF NOT EXISTS run_project ON experiment_run(project_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS run_status ON experiment_run(status, started_at DESC);

        /* 分析：统计与作图都落在这里。method 区分库调用与解析兜底，写方法段时必须看这个字段。 */
        CREATE TABLE IF NOT EXISTS analysis(
          id TEXT PRIMARY KEY,
          project_id TEXT, run_id TEXT,
          kind TEXT NOT NULL,               -- stats | figure
          test_id TEXT,                     -- statistics.json 里的检验 id
          spec_json TEXT NOT NULL,          -- 完整请求
          result_json TEXT,                 -- 结构化结果（含 effectSize / ci / p）
          method TEXT,                      -- lib | fallback
          seed INTEGER,
          assumptions_json TEXT,            -- 假设检查逐项结果
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS analysis_project ON analysis(project_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS analysis_test ON analysis(test_id);

        /* 图：spec 与产物分开存。spec 可重画，产物可换格式，两者都能追溯。 */
        CREATE TABLE IF NOT EXISTS figure_spec(
          id TEXT PRIMARY KEY,
          project_id TEXT, analysis_id TEXT,
          kind TEXT NOT NULL,               -- scatter | bar | line | box | paired | ...
          spec_json TEXT NOT NULL,
          path TEXT, width_mm REAL, height_mm REAL, dpi INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS figure_project ON figure_spec(project_id, created_at DESC);

        /* 溯源：链式 hash。prev_hash 让删除/改写中间记录可被检出。 */
        CREATE TABLE IF NOT EXISTS provenance(
          id TEXT PRIMARY KEY,
          project_id TEXT,
          subject TEXT NOT NULL,            -- project | experiment | run | analysis | figure
          subject_id TEXT NOT NULL,
          action TEXT NOT NULL,             -- create | update | run | analyze | figure | build | archive
          actor TEXT,                       -- agent | user
          detail_json TEXT,
          seq INTEGER NOT NULL,
          prev_hash TEXT,
          hash TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS provenance_project ON provenance(project_id, seq);
        CREATE INDEX IF NOT EXISTS provenance_subject ON provenance(subject, subject_id, seq);
      `)
    },
  },
  {
    /* 7：伦理与数据许可。
       人体/动物/受限数据的研究，伦理批号和数据使用协议必须在开工前落库——
       不是写进正文就够，因为半年后写方法段时没人记得批号是多少。 */
    version: 7,
    note: 'project.ethics_json：伦理批号与数据许可落库',
    up(db) {
      const cols = new Set(db.prepare('PRAGMA table_info(project)').all().map((r) => r.name))
      if (!cols.has('ethics_json')) db.exec('ALTER TABLE project ADD COLUMN ethics_json TEXT')
    },
  },
  {
    /* 8：orchestra 战役层（add-only）。
       调度器需要持久化「计划 → 工作流 → 任务 → 分片 → 租约」这条链，
       并把投票/产物/事件留在同一库里，才能在中途崩溃后按库恢复而不是靠内存。 */
    version: 8,
    note: 'orchestra 战役层：campaign / workstream / task / shard / agent / vote / artifact / event',
    up(db) {
      db.exec(`
        /* 一份冻结的方案 = 一个战役。plan_hash 唯一，重复提交同一方案直接拒绝。 */
        CREATE TABLE IF NOT EXISTS campaign(
          id TEXT PRIMARY KEY,
          project_id TEXT,
          question TEXT NOT NULL,
          discipline TEXT,
          constraints_json TEXT,
          plan_hash TEXT,
          seed INTEGER,
          state TEXT NOT NULL DEFAULT 'planned',
          budget_json TEXT,
          spend_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS campaign_plan_hash ON campaign(plan_hash);

        /* 工作流：舞台内的有序分组，order_index 决定串行顺序。 */
        CREATE TABLE IF NOT EXISTS campaign_workstream(
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL,
          stage_id TEXT,
          title TEXT,
          depends_on_json TEXT,
          order_index INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS campaign_workstream_campaign ON campaign_workstream(campaign_id, order_index);

        /* 任务：一个任务可被投票决定票数，再拆成多个分片并行跑。 */
        CREATE TABLE IF NOT EXISTS campaign_task(
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL,
          workstream_id TEXT,
          title TEXT,
          role TEXT,
          executor TEXT,
          gate_json TEXT,
          depends_on_json TEXT,
          priority INTEGER NOT NULL DEFAULT 100,
          votes INTEGER NOT NULL DEFAULT 1,
          shards INTEGER NOT NULL DEFAULT 0,
          state TEXT NOT NULL DEFAULT 'planned',
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS campaign_task_campaign ON campaign_task(campaign_id, workstream_id);

        /* 分片：调度与租约的最小单位。idempotency_key 保证重放只落一次。 */
        CREATE TABLE IF NOT EXISTS campaign_shard(
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          shard_index INTEGER NOT NULL DEFAULT 0,
          role TEXT,
          executor TEXT,
          kind TEXT,
          payload_json TEXT,
          idempotency_key TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'queued',
          priority INTEGER NOT NULL DEFAULT 100,
          attempt INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 3,
          lease_owner TEXT,
          lease_until INTEGER,
          next_run_at INTEGER NOT NULL DEFAULT 0,
          output_json TEXT,
          error TEXT,
          gate_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS campaign_shard_idem ON campaign_shard(idempotency_key);
        CREATE INDEX IF NOT EXISTS campaign_shard_queue ON campaign_shard(state, next_run_at, priority, created_at);
        CREATE INDEX IF NOT EXISTS campaign_shard_campaign ON campaign_shard(campaign_id, state);
        CREATE INDEX IF NOT EXISTS campaign_shard_task ON campaign_shard(task_id, state);
        CREATE INDEX IF NOT EXISTS campaign_shard_lease ON campaign_shard(lease_until);

        /* 角色槽位：谁在跑哪个分片，靠 last_heartbeat 判断存活。 */
        CREATE TABLE IF NOT EXISTS campaign_agent(
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL,
          role TEXT,
          preset TEXT,
          slot_index INTEGER,
          state TEXT NOT NULL DEFAULT 'idle',
          current_shard TEXT,
          started_at INTEGER,
          last_heartbeat INTEGER
        );
        CREATE INDEX IF NOT EXISTS campaign_agent_campaign ON campaign_agent(campaign_id, role);

        /* 投票：判决与证据权重分开存，便于事后重算共识。 */
        CREATE TABLE IF NOT EXISTS campaign_vote(
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL,
          task_id TEXT,
          shard_id TEXT,
          voter TEXT,
          verdict TEXT NOT NULL,
          evidence_weight REAL NOT NULL DEFAULT 1,
          payload_json TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS campaign_vote_task ON campaign_vote(task_id, verdict);

        /* 产物：path + sha256 是可复核的最小凭据。 */
        CREATE TABLE IF NOT EXISTS campaign_artifact(
          id TEXT PRIMARY KEY,
          campaign_id TEXT NOT NULL,
          task_id TEXT,
          shard_id TEXT,
          kind TEXT NOT NULL,
          path TEXT NOT NULL,
          sha256 TEXT,
          bytes INTEGER,
          producer_role TEXT,
          tool TEXT,
          input_hash TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS campaign_artifact_campaign ON campaign_artifact(campaign_id, kind);

        /* 事件流：自增 id 即时间线，detail 用 JSON 保留扩展字段。 */
        CREATE TABLE IF NOT EXISTS campaign_event(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id TEXT NOT NULL,
          shard_id TEXT,
          kind TEXT NOT NULL,
          detail_json TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS campaign_event_campaign ON campaign_event(campaign_id, id);
      `)
    },
  },
]

/** 把用户查询串成 FTS5 安全的 MATCH 表达式。 */
export function ftsQuery(input) {
  if (!input) return null
  const words = String(input)
    /* 引号与括号是词内噪声，直接删（否则 pro"tein 会被切成 pro/tein） */
    .replace(/["'()]/g, '')
    /* 运算符与通配符变空格 */
    .replace(/[*:^-]/g, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1)
  if (words.length === 0) return null
  return words.map((w) => `"${w}"`).join(' OR ')
}

export class ScienceStore {
  constructor({ dbPath, logger = null }) {
    mkdirSync(dirname(dbPath), { recursive: true })
    this.dbPath = dbPath
    this.logger = logger
    this.db = new DatabaseSync(dbPath)
    this.db.exec('PRAGMA journal_mode = WAL;')
    this.db.exec('PRAGMA synchronous = NORMAL;')
    this.db.exec('PRAGMA busy_timeout = 5000;')
    this.migrated = this.migrate()
  }

  /** 依次应用未执行的迁移，返回本次执行到哪个版本。 */
  migrate() {
    const MIGRATIONS_LOCAL = MIGRATIONS
    // 版本 1 必须先建 schema_meta 表，才有地方读版本
    this.db.exec('CREATE TABLE IF NOT EXISTS schema_meta(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL, note TEXT);')
    const row = this.db.prepare('SELECT MAX(version) AS v FROM schema_meta').get()
    let current = Number(row?.v) || 0
    for (const step of MIGRATIONS_LOCAL) {
      if (step.version <= current) continue
      this.db.exec('BEGIN')
      try {
        step.up(this.db)
        this.db.prepare('INSERT OR REPLACE INTO schema_meta(version, applied_at, note) VALUES(?,?,?)')
          .run(step.version, Date.now(), step.note)
        this.db.exec('COMMIT')
        current = step.version
        if (this.logger) this.logger.info?.(`science/store: 迁移到 v${step.version} — ${step.note}`)
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw new Error(`science/store: 迁移 v${step.version} 失败: ${error.message}`)
      }
    }
    return current
  }

  version() {
    const row = this.db.prepare('SELECT MAX(version) AS v FROM schema_meta').get()
    return Number(row?.v) || 0
  }

  static paperId(fingerprint) {
    return createHash('sha1').update(String(fingerprint)).digest('hex').slice(0, 16)
  }

  /**
   * 落库一批记录。
   * @returns {{inserted:number, updated:number, ids:string[]}}
   */
  upsertPapers(records, { projectId = null, score = null } = {}) {
    if (!Array.isArray(records) || records.length === 0) return { inserted: 0, updated: 0, ids: [] }
    const now = Date.now()
    const insert = this.db.prepare(`
      INSERT INTO paper(id,fingerprint,doi,arxiv_id,pmid,pmcid,title,authors_json,year,venue,
        volume,issue,pages,abstract,lang,type,oa_status,oa_pdf_url,oa_landing_url,
        cited_by_count,ref_count,license,url,sources_json,score,project_id,added_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        doi=COALESCE(paper.doi, excluded.doi),
        arxiv_id=COALESCE(paper.arxiv_id, excluded.arxiv_id),
        pmid=COALESCE(paper.pmid, excluded.pmid),
        pmcid=COALESCE(paper.pmcid, excluded.pmcid),
        title=COALESCE(paper.title, excluded.title),
        authors_json=CASE WHEN paper.authors_json IS NULL OR paper.authors_json='[]'
                          THEN excluded.authors_json ELSE paper.authors_json END,
        year=COALESCE(paper.year, excluded.year),
        venue=COALESCE(paper.venue, excluded.venue),
        abstract=CASE WHEN paper.abstract IS NULL OR length(paper.abstract) < length(COALESCE(excluded.abstract,''))
                      THEN excluded.abstract ELSE paper.abstract END,
        oa_status=COALESCE(paper.oa_status, excluded.oa_status),
        oa_pdf_url=COALESCE(paper.oa_pdf_url, excluded.oa_pdf_url),
        cited_by_count=MAX(COALESCE(paper.cited_by_count,0), COALESCE(excluded.cited_by_count,0)),
        license=COALESCE(paper.license, excluded.license),
        url=COALESCE(paper.url, excluded.url),
        sources_json=excluded.sources_json,
        score=MAX(COALESCE(paper.score,0), COALESCE(excluded.score,0)),
        project_id=COALESCE(paper.project_id, excluded.project_id),
        updated_at=excluded.updated_at
    `)
    const ftsInsert = this.db.prepare('INSERT INTO paper_fts(paper_id, title, abstract) VALUES(?,?,?)')
    const ftsDelete = this.db.prepare('DELETE FROM paper_fts WHERE paper_id = ?')
    const existsStmt = this.db.prepare('SELECT id FROM paper WHERE fingerprint = ?')

    let inserted = 0
    let updated = 0
    const ids = []
    this.db.exec('BEGIN')
    try {
      for (const r of records) {
        const fp = r.fingerprint
        if (!fp) continue
        const id = ScienceStore.paperId(fp)
        const before = existsStmt.get(fp)
        insert.run(
          id, fp, r.doi || null, r.arxivId || null, r.pmid || null, r.pmcid || null,
          r.title || null, JSON.stringify(r.authors || []), r.year || null, r.venue || null,
          r.volume || null, r.issue || null, r.pages || null, r.abstract || null,
          r.lang || null, r.type || null, r.oaStatus || null, r.oaPdfUrl || null, r.oaLandingUrl || null,
          Number.isFinite(r.citedByCount) ? r.citedByCount : null,
          Number.isFinite(r.refCount) ? r.refCount : null,
          r.license || null, r.url || null,
          JSON.stringify(r.sources || (r.source ? [r.source] : [])),
          Number.isFinite(r.score) ? r.score : score,
          projectId, now, now,
        )
        if (before) updated += 1
        else inserted += 1

        // FTS 与主表同步（用最终行内容，保证摘要更新后索引也新）
        const row = this.db.prepare('SELECT title, abstract FROM paper WHERE id = ?').get(id)
        ftsDelete.run(id)
        if (row) ftsInsert.run(id, row.title || '', row.abstract || '')
        ids.push(id)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return { inserted, updated, ids }
  }

  /** 全文检索论文表。 */
  searchPapers({ q = null, projectId = null, yearFrom = null, oaOnly = false, limit = 50 } = {}) {
    const params = []
    let sql
    const match = ftsQuery(q)
    if (match) {
      sql = `SELECT p.* FROM paper_fts f JOIN paper p ON p.id = f.paper_id WHERE paper_fts MATCH ?`
      params.push(match)
    } else {
      sql = `SELECT p.* FROM paper p WHERE 1=1`
    }
    if (projectId) { sql += ' AND p.project_id = ?'; params.push(projectId) }
    if (yearFrom) { sql += ' AND p.year >= ?'; params.push(yearFrom) }
    if (oaOnly) { sql += " AND p.oa_status IS NOT NULL AND p.oa_status <> 'closed'" }
    sql += ' ORDER BY COALESCE(p.score,0) DESC, COALESCE(p.cited_by_count,0) DESC, p.year DESC LIMIT ?'
    params.push(Math.max(1, Math.min(500, limit)))
    const rows = this.db.prepare(sql).all(...params)
    return rows.map((row) => ({
      ...row,
      authors: safeJson(row.authors_json, []),
      sources: safeJson(row.sources_json, []),
    }))
  }

  getPaper(id) {
    const row = this.db.prepare('SELECT * FROM paper WHERE id = ? OR doi = ? OR fingerprint = ?').get(id, id, id)
    if (!row) return null
    return { ...row, authors: safeJson(row.authors_json, []), sources: safeJson(row.sources_json, []) }
  }

  logQuery(entry) {
    this.db.prepare(`
      INSERT INTO query_log(project_id,dsl_json,sources_json,started_at,ms,hits_per_source_json,total,cost_usd,error)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(
      entry.projectId || null,
      JSON.stringify(entry.dsl || {}),
      JSON.stringify(entry.sources || []),
      entry.startedAt || Date.now(),
      entry.ms || null,
      JSON.stringify(entry.hitsPerSource || {}),
      entry.total || 0,
      entry.costUsd ?? null,
      entry.error || null,
    )
  }

  /** 把一轮检索里每个源的状态写回 source_state（供 science_source_status 读）。 */
  saveSourceStates(rows) {
    const stmt = this.db.prepare(`
      INSERT INTO source_state(id,host,ok,cooldown_until,consecutive_failures,last_error,last_ms,
        total_runs,total_hits,updated_at,budget_used_usd)
      VALUES(?,?,?,?,?,?,?,1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        host=excluded.host, ok=excluded.ok, cooldown_until=excluded.cooldown_until,
        consecutive_failures=excluded.consecutive_failures, last_error=excluded.last_error,
        last_ms=excluded.last_ms, total_runs=source_state.total_runs+1,
        total_hits=source_state.total_hits+excluded.total_hits,
        updated_at=excluded.updated_at, budget_used_usd=excluded.budget_used_usd
    `)
    const now = Date.now()
    for (const row of rows) {
      stmt.run(
        row.id, row.host || null, row.ok ? 1 : 0, row.cooldownUntil || 0,
        row.failures || 0, row.error ? String(row.error).slice(0, 300) : null,
        row.ms || null, row.count || 0, now, row.budgetUsedUsd ?? null,
      )
    }
  }

  sourceStates() {
    return this.db.prepare('SELECT * FROM source_state ORDER BY id').all()
  }

  recentQueries(limit = 20) {
    return this.db.prepare('SELECT * FROM query_log ORDER BY id DESC LIMIT ?').all(Math.max(1, Math.min(200, limit)))
  }

  /* ══════════════ v3：稿件 / 断言 / 证据 / 投稿时间线 ══════════════ */

  /** 建或更新稿件。转投不改 id，只加 submission_event。 */
  upsertManuscript(input = {}) {
    const now = Date.now()
    const existing = input.id
      ? this.db.prepare('SELECT * FROM manuscript WHERE id = ?').get(input.id)
      : null
    const id = existing ? existing.id : (input.id || newId('ms'))
    if (existing) {
      this.db.prepare(`
        UPDATE manuscript SET title=COALESCE(?,title), abstract=COALESCE(?,abstract),
          keywords_json=COALESCE(?,keywords_json), target_journal=COALESCE(?,target_journal),
          band=COALESCE(?,band), design=COALESCE(?,design), status=COALESCE(?,status),
          version=COALESCE(?,version), words=COALESCE(?,words), figures=COALESCE(?,figures),
          refs=COALESCE(?,refs), project_id=COALESCE(?,project_id), updated_at=?
        WHERE id=?
      `).run(
        input.title ?? null, input.abstract ?? null,
        input.keywords ? JSON.stringify(input.keywords) : null,
        input.targetJournal ?? null,
        Number.isFinite(input.band) ? input.band : null,
        input.design ?? null, input.status ?? null,
        Number.isFinite(input.version) ? input.version : null,
        Number.isFinite(input.words) ? input.words : null,
        Number.isFinite(input.figures) ? input.figures : null,
        Number.isFinite(input.refs) ? input.refs : null,
        input.projectId ?? null, now, id,
      )
      return { id, inserted: false }
    }
    this.db.prepare(`
      INSERT INTO manuscript(id,project_id,title,abstract,keywords_json,target_journal,band,design,
        status,version,words,figures,refs,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, input.projectId ?? null, input.title ?? null, input.abstract ?? null,
      JSON.stringify(input.keywords || []), input.targetJournal ?? null,
      Number.isFinite(input.band) ? input.band : null, input.design ?? null,
      input.status || 'draft', Number.isFinite(input.version) ? input.version : 1,
      Number.isFinite(input.words) ? input.words : null,
      Number.isFinite(input.figures) ? input.figures : null,
      Number.isFinite(input.refs) ? input.refs : null, now, now,
    )
    return { id, inserted: true }
  }

  getManuscript(id) {
    const row = this.db.prepare('SELECT * FROM manuscript WHERE id = ?').get(id)
    if (!row) return null
    return { ...row, keywords: safeJson(row.keywords_json, []) }
  }

  listManuscripts({ projectId = null, status = null, limit = 50 } = {}) {
    let sql = 'SELECT * FROM manuscript WHERE 1=1'
    const params = []
    if (projectId) { sql += ' AND project_id = ?'; params.push(projectId) }
    if (status) { sql += ' AND status = ?'; params.push(status) }
    sql += ' ORDER BY updated_at DESC LIMIT ?'
    params.push(Math.max(1, Math.min(200, limit)))
    return this.db.prepare(sql).all(...params).map((r) => ({ ...r, keywords: safeJson(r.keywords_json, []) }))
  }

  setManuscriptStatus(id, status) {
    this.db.prepare('UPDATE manuscript SET status=?, updated_at=? WHERE id=?').run(status, Date.now(), id)
    return this.getManuscript(id)
  }

  /** 记一条断言。默认 unsupported——必须先有证据才算 supported。 */
  addClaim({ manuscriptId = null, projectId = null, text, kind = 'primary', section = null, strength = null }) {
    if (!text || !String(text).trim()) throw new Error('claim.text 不能为空')
    const id = newId('cl')
    const now = Date.now()
    this.db.prepare(`
      INSERT INTO claim(id,project_id,manuscript_id,text,kind,status,strength,section,created_at,updated_at)
      VALUES(?,?,?,?,?,'unsupported',?,?,?,?)
    `).run(id, projectId, manuscriptId, String(text).trim(), kind, strength, section, now, now)
    return { id }
  }

  /** 加一条证据，并按证据重算 claim 状态。 */
  addEvidence({ claimId, paperId = null, experimentId = null, kind = 'literature', quote = null,
    pageFrom = null, pageTo = null, locator = null, fileHash = null, sourceUrl = null, supports = true }) {
    const claim = this.db.prepare('SELECT id FROM claim WHERE id = ?').get(claimId)
    if (!claim) throw new Error(`claim ${claimId} 不存在`)
    const id = newId('ev')
    this.db.prepare(`
      INSERT INTO evidence(id,claim_id,paper_id,experiment_id,kind,quote,page_from,page_to,
        locator,file_hash,source_url,supports,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, claimId, paperId, experimentId, kind,
      quote ? String(quote).slice(0, 500) : null,
      Number.isFinite(pageFrom) ? pageFrom : null,
      Number.isFinite(pageTo) ? pageTo : null,
      locator, fileHash, sourceUrl, supports ? 1 : 0, Date.now())
    const status = this.recomputeClaimStatus(claimId)
    return { id, status }
  }

  recomputeClaimStatus(claimId) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS n,
             SUM(CASE WHEN supports=1 THEN 1 ELSE 0 END) AS pro,
             SUM(CASE WHEN supports=0 THEN 1 ELSE 0 END) AS con
      FROM evidence WHERE claim_id=?
    `).get(claimId)
    const pro = Number(row?.pro) || 0
    const con = Number(row?.con) || 0
    let status = 'unsupported'
    if (pro > 0 && con > 0) status = 'partial'
    else if (con > 0) status = 'contradicted'
    else if (pro > 0) status = 'supported'
    this.db.prepare('UPDATE claim SET status=?, updated_at=? WHERE id=?').run(status, Date.now(), claimId)
    return status
  }

  claimsForManuscript(manuscriptId) {
    const rows = this.db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM evidence e WHERE e.claim_id=c.id) AS evidence_n
      FROM claim c WHERE c.manuscript_id=? ORDER BY c.created_at
    `).all(manuscriptId)
    return rows
  }

  evidenceForClaim(claimId) {
    return this.db.prepare('SELECT * FROM evidence WHERE claim_id=? ORDER BY created_at').all(claimId)
  }

  /** 孤儿断言：写了结论但没有任何证据（audit 的 blocking 来源）。 */
  orphanClaims(manuscriptId) {
    return this.db.prepare(`
      SELECT c.id, c.text, c.section, c.status FROM claim c
      WHERE c.manuscript_id=? AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.claim_id=c.id)
      ORDER BY c.created_at
    `).all(manuscriptId)
  }

  /** 记一条投稿时间线事件，并算与上一条的间隔天数。 */
  logSubmissionEvent({ manuscriptId, kind, journalId = null, detail = null, ts = null }) {
    const at = ts || Date.now()
    const prev = this.db.prepare(
      'SELECT ts FROM submission_event WHERE manuscript_id=? ORDER BY ts DESC LIMIT 1',
    ).get(manuscriptId)
    const days = prev ? Math.max(0, Math.round((at - prev.ts) / 86400000)) : null
    const id = newId('se')
    this.db.prepare(`
      INSERT INTO submission_event(id,manuscript_id,ts,kind,journal_id,detail,days_from_prev)
      VALUES(?,?,?,?,?,?,?)
    `).run(id, manuscriptId, at, kind, journalId, detail, days)
    return { id, daysFromPrev: days }
  }

  /** 时间线 + 关键指标（desk 决定天数、总周期、transfer 次数）。 */
  submissionTimeline(manuscriptId) {
    const events = this.db.prepare(
      'SELECT * FROM submission_event WHERE manuscript_id=? ORDER BY ts',
    ).all(manuscriptId)
    const firstSubmit = events.find((e) => e.kind === 'submit')
    const firstDesk = events.find((e) => e.kind === 'desk_reject')
    const accepted = events.find((e) => e.kind === 'accept' || e.kind === 'publish')
    return {
      events,
      metrics: {
        deskDecisionDays: firstSubmit && firstDesk
          ? Math.round((firstDesk.ts - firstSubmit.ts) / 86400000) : null,
        totalDays: firstSubmit
          ? Math.max(0, Math.round(((accepted ? accepted.ts : Date.now()) - firstSubmit.ts) / 86400000)) : null,
        transfers: events.filter((e) => e.kind === 'transfer').length,
        submissions: events.filter((e) => e.kind === 'submit').length,
        deskRejections: events.filter((e) => e.kind === 'desk_reject').length,
      },
    }
  }

  saveAuditRun({ manuscriptId = null, profile = 'general', blocking = 0, warning = 0, pass = 0, report = {} }) {
    const id = newId('au')
    this.db.prepare(`
      INSERT INTO audit_run(id,manuscript_id,ts,profile,blocking_n,warning_n,pass_n,report_json)
      VALUES(?,?,?,?,?,?,?,?)
    `).run(id, manuscriptId, Date.now(), profile, blocking, warning, pass, JSON.stringify(report))
    return { id }
  }

  recentAudits(manuscriptId, limit = 10) {
    return this.db.prepare(
      'SELECT * FROM audit_run WHERE manuscript_id=? ORDER BY ts DESC LIMIT ?',
    ).all(manuscriptId, Math.max(1, Math.min(50, limit)))
      .map((r) => ({ ...r, report: safeJson(r.report_json, {}) }))
  }

  /* ══════════ 期刊情报（schema v4） ══════════ */

  /** 写入/更新某刊某源的快照。payload 必须是可 JSON 序列化的归一化结果。 */
  saveJournalIntel({ journalId, source, fetchedAt = Date.now(), sampleSize = null, confidence = null, windowFrom = null, windowTo = null, payload = {} }) {
    this.db.prepare(`
      INSERT INTO journal_intel(journal_id, source, fetched_at, sample_size, confidence, window_from, window_to, payload_json)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(journal_id, source) DO UPDATE SET
        fetched_at=excluded.fetched_at, sample_size=excluded.sample_size, confidence=excluded.confidence,
        window_from=excluded.window_from, window_to=excluded.window_to, payload_json=excluded.payload_json
    `).run(journalId, source, fetchedAt, sampleSize, confidence, windowFrom, windowTo, JSON.stringify(payload))
    return this.getJournalIntel(journalId)[source] || null
  }

  /** 取某刊全部源快照，按 source 键归类。 */
  getJournalIntel(journalId) {
    const rows = this.db.prepare('SELECT * FROM journal_intel WHERE journal_id = ?').all(journalId)
    const out = {}
    for (const row of rows) {
      let payload = {}
      try { payload = JSON.parse(row.payload_json) } catch { payload = { parseError: true } }
      out[row.source] = {
        source: row.source,
        fetchedAt: row.fetched_at,
        ageDays: Math.floor((Date.now() - row.fetched_at) / 86400000),
        sampleSize: row.sample_size,
        confidence: row.confidence,
        windowFrom: row.window_from,
        windowTo: row.window_to,
        payload,
      }
    }
    return out
  }

  /** 哪些刊的情报超过 maxAgeDays 没刷新。 */
  staleIntel(maxAgeDays = 90) {
    const cutoff = Date.now() - maxAgeDays * 86400000
    return this.db.prepare('SELECT journal_id, source, fetched_at FROM journal_intel WHERE fetched_at < ? ORDER BY fetched_at ASC').all(cutoff)
  }

  /** 覆盖某刊某窗口的产出分布（同窗口先删后插，避免半新半旧）。 */
  saveJournalTopics({ journalId, topics = [], windowFrom = null, windowTo = null }) {
    this.db.prepare('DELETE FROM journal_topic WHERE journal_id = ? AND window_from = ?').run(journalId, windowFrom)
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO journal_topic(journal_id, topic_id, topic_name, subfield, field, domain, count, share, window_from, window_to)
      VALUES(?,?,?,?,?,?,?,?,?,?)
    `)
    let n = 0
    for (const t of topics) {
      if (!t?.id || !Number.isFinite(t.count)) continue
      stmt.run(journalId, t.id, t.name || null, t.subfield || null, t.field || null, t.domain || null,
        t.count, Number(t.share) || 0, windowFrom, windowTo)
      n += 1
    }
    return n
  }

  /** 某刊产出分布，按 share 降序。 */
  journalTopics(journalId, limit = 25) {
    return this.db.prepare(`
      SELECT topic_id AS id, topic_name AS name, subfield, field, domain, count, share
      FROM journal_topic WHERE journal_id = ? ORDER BY share DESC LIMIT ?
    `).all(journalId, limit)
  }

  /**
   * 稿件 topic 命中该刊产出分布的比例。
   * @param topicIds 稿件映射到的 OpenAlex topic id 数组
   */
  journalTopicShare(journalId, topicIds = []) {
    const ids = normaliseIds(topicIds)
    if (ids.length === 0) return { share: 0, hits: [] }
    const placeholders = ids.map(() => '?').join(',')
    const hits = this.db.prepare(`
      SELECT topic_id AS id, topic_name AS name, share FROM journal_topic
      WHERE journal_id = ? AND topic_id IN (${placeholders}) ORDER BY share DESC
    `).all(journalId, ...ids)
    return { share: hits.reduce((s, h) => s + h.share, 0), hits }
  }

  /**
   * 跨刊比较：给定一组 topic，哪本刊最常发这类工作。
   * 这是"我这个方向该投哪本刊"的 SQL 版答案。
   */
  topJournalsForTopics(topicIds = [], limit = 15) {
    const ids = normaliseIds(topicIds)
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    return this.db.prepare(`
      SELECT journal_id, SUM(share) AS share, MAX(count) AS peak_count
      FROM journal_topic WHERE topic_id IN (${placeholders})
      GROUP BY journal_id ORDER BY share DESC LIMIT ?
    `).all(...ids, limit)
  }

  /** 评审语料统计：主题分布 + 覆盖的刊数。 */
  reviewCorpusStats() {
    const byTheme = this.db.prepare('SELECT theme, COUNT(*) AS n FROM review_corpus GROUP BY theme ORDER BY n DESC').all()
    const total = this.db.prepare('SELECT COUNT(*) AS n FROM review_corpus').get()?.n || 0
    const journals = this.db.prepare('SELECT COUNT(DISTINCT journal_id) AS n FROM review_corpus').get()?.n || 0
    return { total, journals, byTheme }
  }

  addReviewNote({ journalId = null, venue = null, kind = 'report', theme = null, text, source = null, sourceUrl = null }) {
    const id = newId('rv')
    this.db.prepare(`
      INSERT INTO review_corpus(id, journal_id, venue, kind, theme, text, source, source_url, fetched_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(id, journalId, venue, kind, theme, text, source, sourceUrl, Date.now())
    return id
  }

  /* ── M4 知识转化层 ───────────────────────────────────────────────────── */

  saveFrontierItem({
    id, source, kind = 'repo', title = null, url = null, author = null,
    stars = null, forks = null, pushedAt = null, createdAt = null,
    commits52w = null, releases = null, topics = null, description = null,
    domain = null, credibility = null, credibilityNote = null, payload = null,
    fetchedAt = Date.now(),
  }) {
    this.db.prepare(`
      INSERT INTO frontier_item(id, source, kind, title, url, author, stars, forks,
        pushed_at, created_at, commits_52w, releases, topics_json, description,
        domain, credibility, credibility_note, payload_json, fetched_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, url=excluded.url, author=excluded.author,
        stars=excluded.stars, forks=excluded.forks, pushed_at=excluded.pushed_at,
        commits_52w=excluded.commits_52w, releases=excluded.releases,
        topics_json=excluded.topics_json, description=excluded.description,
        domain=excluded.domain, credibility=excluded.credibility,
        credibility_note=excluded.credibility_note, payload_json=excluded.payload_json,
        fetched_at=excluded.fetched_at
    `).run(id, source, kind, title, url, author, stars, forks, pushedAt, createdAt,
      commits52w, releases, topics ? JSON.stringify(topics) : null, description,
      domain, credibility, credibilityNote, payload ? JSON.stringify(payload) : null, fetchedAt)
    return id
  }

  getFrontierItem(id) {
    const row = this.db.prepare('SELECT * FROM frontier_item WHERE id = ?').get(id)
    return row ? hydrateFrontierItem(row) : null
  }

  frontierItems({ domain = null, limit = 50, minCredibility = 0 } = {}) {
    const rows = domain
      ? this.db.prepare('SELECT * FROM frontier_item WHERE domain = ? AND credibility >= ? ORDER BY credibility DESC, stars DESC LIMIT ?').all(domain, minCredibility, limit)
      : this.db.prepare('SELECT * FROM frontier_item WHERE credibility >= ? ORDER BY credibility DESC, stars DESC LIMIT ?').all(minCredibility, limit)
    return rows.map(hydrateFrontierItem)
  }

  /** 哪些条目太久没刷新。GitHub 数据 24h 就该重抓，其余 7 天。 */
  staleFrontierItems(maxAgeDays = 1) {
    const cutoff = Date.now() - maxAgeDays * 86400000
    return this.db.prepare('SELECT id, source, fetched_at FROM frontier_item WHERE fetched_at < ? ORDER BY fetched_at ASC LIMIT 200').all(cutoff)
  }

  saveKnowledgeClaim({ id = null, itemId, mechanism, prediction = null, falsifier = null, evidenceKind = 'none', confidence = 'low', excerpt = null, sourceUrl = null }) {
    const claimId = id || newId('kc')
    this.db.prepare(`
      INSERT OR REPLACE INTO knowledge_claim(id, item_id, mechanism, prediction, falsifier,
        evidence_kind, confidence, needs_human_review, excerpt, source_url, created_at)
      VALUES(?,?,?,?,?,?,?,1,?,?,?)
    `).run(claimId, itemId, mechanism, prediction, falsifier, evidenceKind, confidence, excerpt, sourceUrl, Date.now())
    return claimId
  }

  getKnowledgeClaim(id) {
    return this.db.prepare('SELECT * FROM knowledge_claim WHERE id = ?').get(id) || null
  }

  claimsForItem(itemId, limit = 20) {
    return this.db.prepare('SELECT * FROM knowledge_claim WHERE item_id = ? ORDER BY created_at ASC LIMIT ?').all(itemId, limit)
  }

  saveGap({ id = null, claimId, gapType, statement, whatExists = null, whatMissing, evidence = [], isPublishable = null }) {
    const gapId = id || newId('gap')
    this.db.prepare(`
      INSERT OR REPLACE INTO gap_entry(id, claim_id, gap_type, statement, what_exists,
        what_missing, evidence_json, is_publishable, created_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(gapId, claimId, gapType, statement, whatExists, whatMissing,
      evidence.length > 0 ? JSON.stringify(evidence) : null,
      isPublishable === null ? null : (isPublishable ? 1 : 0), Date.now())
    return gapId
  }

  gapsForClaim(claimId, limit = 20) {
    return this.db.prepare('SELECT * FROM gap_entry WHERE claim_id = ? ORDER BY is_publishable DESC, created_at ASC LIMIT ?')
      .all(claimId, limit)
      .map((r) => ({ ...r, evidence: safeJson(r.evidence_json, []) }))
  }

  saveContributionPlan({ id = null, claimId = null, gapId = null, contributionType, targetBand = 4, requiredEvidence = [], gateGaps = [], candidateJournals = [], status = 'draft' }) {
    const planId = id || newId('cp')
    const now = Date.now()
    const existing = this.db.prepare('SELECT created_at FROM contribution_plan WHERE id = ?').get(planId)
    this.db.prepare(`
      INSERT OR REPLACE INTO contribution_plan(id, claim_id, gap_id, contribution_type, target_band,
        required_evidence_json, gate_gaps_json, candidate_journals_json, status, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)
    `).run(planId, claimId, gapId, contributionType, targetBand,
      JSON.stringify(requiredEvidence), JSON.stringify(gateGaps),
      JSON.stringify(candidateJournals), status, existing?.created_at || now, now)
    return planId
  }

  getContributionPlan(id) {
    const row = this.db.prepare('SELECT * FROM contribution_plan WHERE id = ?').get(id)
    if (!row) return null
    return {
      id: row.id,
      claimId: row.claim_id,
      gapId: row.gap_id,
      contributionType: row.contribution_type,
      targetBand: row.target_band,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      requiredEvidence: safeJson(row.required_evidence_json, []),
      gateGaps: safeJson(row.gate_gaps_json, []),
      candidateJournals: safeJson(row.candidate_journals_json, []),
    }
  }

  /** status 只前进一步：draft → designing → ready。跳级与倒退都拒。 */
  advanceContributionPlan(id, status) {
    const order = ['draft', 'designing', 'ready']
    const plan = this.getContributionPlan(id)
    if (!plan) throw new Error(`贡献方案 ${id} 不存在`)
    const from = order.indexOf(plan.status)
    const to = order.indexOf(status)
    if (to === -1) throw new Error(`未知状态 ${status}`)
    if (to === from) return plan.status
    if (to > from + 1) throw new Error(`状态不能从 ${plan.status} 直接跳到 ${status}`)
    if (to < from) throw new Error(`状态不能从 ${plan.status} 倒退到 ${status}；要重做请新建方案`)
    this.db.prepare('UPDATE contribution_plan SET status = ?, updated_at = ? WHERE id = ?').run(status, Date.now(), id)
    return status
  }

  /* ══════════ v8：orchestra 战役仓储 ══════════ */

  /** 建战役。plan_hash 唯一是调度幂等闸门：同一方案重复提交必须失败而不是跑两遍。 */
  createCampaign({ id = null, projectId = null, question, discipline = null, constraints = null,
    planHash = null, seed = null, state = 'planned', budget = null, spend = null } = {}) {
    const cid = id || `cmp_${randomBytes(4).toString('hex')}`
    const now = Date.now()
    try {
      this.db.prepare(`
        INSERT INTO campaign(id, project_id, question, discipline, constraints_json, plan_hash, seed,
          state, budget_json, spend_json, created_at, updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(
        cid, projectId, String(question ?? ''), discipline,
        constraints === null ? null : JSON.stringify(constraints),
        planHash, Number.isFinite(seed) ? seed : null, state,
        budget === null ? null : JSON.stringify(budget),
        spend === null ? null : JSON.stringify(spend),
        now, now,
      )
    } catch (error) {
      if (planHash && /UNIQUE/i.test(String(error.message))) {
        throw new Error(`plan-hash-exists: ${planHash}`)
      }
      throw error
    }
    return cid
  }

  getCampaign(id) {
    const row = this.db.prepare('SELECT * FROM campaign WHERE id = ?').get(id)
    return row ? hydrateCampaign(row) : null
  }

  getCampaignByPlanHash(planHash) {
    const row = this.db.prepare('SELECT * FROM campaign WHERE plan_hash = ?').get(planHash)
    return row ? hydrateCampaign(row) : null
  }

  listCampaigns({ limit = 20 } = {}) {
    return this.db.prepare('SELECT * FROM campaign ORDER BY created_at DESC LIMIT ?')
      .all(Math.max(1, Math.min(500, limit)))
      .map(hydrateCampaign)
  }

  /** 只允许改调度关心的字段，其余键忽略，避免仓储层被当成通用 UPDATE。 */
  updateCampaign(id, patch = {}) {
    const sets = []
    const params = []
    const put = (col, val) => { sets.push(`${col}=?`); params.push(val) }
    if (patch.state !== undefined) put('state', patch.state)
    if (patch.spend !== undefined) put('spend_json', patch.spend === null ? null : JSON.stringify(patch.spend))
    if (patch.budget !== undefined) put('budget_json', patch.budget === null ? null : JSON.stringify(patch.budget))
    if (patch.planHash !== undefined) put('plan_hash', patch.planHash)
    if (patch.plan_hash !== undefined) put('plan_hash', patch.plan_hash)
    put('updated_at', patch.updated_at ?? patch.updatedAt ?? Date.now())
    params.push(id)
    const res = this.db.prepare(`UPDATE campaign SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    return Number(res.changes) > 0
  }

  upsertWorkstream({ id = null, campaignId, stageId = null, title = null, dependsOn = [], orderIndex = 0 }) {
    const wid = id || `ws_${randomBytes(4).toString('hex')}`
    this.db.prepare(`
      INSERT OR REPLACE INTO campaign_workstream(id, campaign_id, stage_id, title, depends_on_json, order_index, created_at)
      VALUES(?,?,?,?,?,?,?)
    `).run(wid, campaignId, stageId, title, JSON.stringify(dependsOn || []), orderIndex, Date.now())
    return wid
  }

  insertTasks(tasks = []) {
    if (!Array.isArray(tasks) || tasks.length === 0) return 0
    const now = Date.now()
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO campaign_task(id, campaign_id, workstream_id, title, role, executor,
        gate_json, depends_on_json, priority, votes, shards, state, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    let n = 0
    this.db.exec('BEGIN')
    try {
      for (const t of tasks) {
        if (!t?.id || !t.campaignId) continue
        stmt.run(
          t.id, t.campaignId, t.workstreamId ?? null, t.title ?? null, t.role ?? null,
          t.executor ?? null,
          t.gate === undefined || t.gate === null ? null : JSON.stringify(t.gate),
          JSON.stringify(t.dependsOn || []),
          Number.isFinite(t.priority) ? t.priority : 100,
          Number.isFinite(t.votes) ? t.votes : 1,
          Number.isFinite(t.shards) ? t.shards : 0,
          t.state || 'planned', now,
        )
        n += 1
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return n
  }

  /** 分片重放是常态（崩溃恢复），幂等键冲突按已存在处理，不报错也不重复计数。 */
  insertShards(shards = []) {
    if (!Array.isArray(shards) || shards.length === 0) return 0
    const now = Date.now()
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO campaign_shard(id, campaign_id, task_id, shard_index, role, executor, kind,
        payload_json, idempotency_key, state, priority, attempt, max_attempts, next_run_at,
        gate_json, created_at, updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,'queued',?,0,?,?,?,?,?)
    `)
    let n = 0
    this.db.exec('BEGIN')
    try {
      for (const s of shards) {
        if (!s?.id || !s.campaignId || !s.taskId || !s.idempotencyKey) continue
        const res = stmt.run(
          s.id, s.campaignId, s.taskId, Number.isFinite(s.shardIndex) ? s.shardIndex : 0,
          s.role ?? null, s.executor ?? null, s.kind ?? null,
          s.payload === undefined || s.payload === null ? null : JSON.stringify(s.payload),
          s.idempotencyKey,
          Number.isFinite(s.priority) ? s.priority : 100,
          Number.isFinite(s.maxAttempts) ? s.maxAttempts : 3,
          Number.isFinite(s.nextRunAt) ? s.nextRunAt : 0,
          s.gate === undefined || s.gate === null ? null : JSON.stringify(s.gate),
          now, now,
        )
        n += Number(res.changes) || 0
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return n
  }

  /**
   * 领取分片。BEGIN IMMEDIATE 先拿写锁，再选 id、再按 state='queued' 条件更新，
   * 这样并发调用只会有一方把同一行改成 leased。
   *
   * executorIn / kindIn 是可选过滤器：调度器按模式分工（local 只跑 local、
   * delegate 只挑 llm），不传或传空数组时 WHERE 与旧版完全一致。
   */
  claimShards({ campaignId, owner, limit = 100, now = Date.now(), leaseMs = 120000,
    executorIn = null, kindIn = null } = {}) {
    const n = Math.max(1, Math.min(1000, Number(limit) || 100))
    const leaseUntil = now + Math.max(1000, Number(leaseMs) || 120000)
    const clauses = ['campaign_id = ?', "state = 'queued'", 'next_run_at <= ?']
    const params = [campaignId, now]
    if (Array.isArray(executorIn) && executorIn.length > 0) {
      clauses.push(`executor IN (${executorIn.map(() => '?').join(',')})`)
      params.push(...executorIn)
    }
    if (Array.isArray(kindIn) && kindIn.length > 0) {
      clauses.push(`kind IN (${kindIn.map(() => '?').join(',')})`)
      params.push(...kindIn)
    }
    let rows = []
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const picked = this.db.prepare(`
        SELECT id FROM campaign_shard
        WHERE ${clauses.join(' AND ')}
        ORDER BY priority ASC, created_at ASC LIMIT ?
      `).all(...params, n)
      if (picked.length > 0) {
        const ids = picked.map((r) => r.id)
        const marks = ids.map(() => '?').join(',')
        this.db.prepare(`
          UPDATE campaign_shard SET state='leased', lease_owner=?, lease_until=?, updated_at=?
          WHERE id IN (${marks}) AND state='queued'
        `).run(owner, leaseUntil, now, ...ids)
        rows = this.db.prepare(`
          SELECT * FROM campaign_shard
          WHERE id IN (${marks}) AND state='leased' AND lease_owner=? AND lease_until=?
          ORDER BY priority ASC, created_at ASC
        `).all(...ids, owner, leaseUntil)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return rows.map(hydrateShard)
  }

  heartbeat({ owner, shardIds = [], now = Date.now(), leaseMs = 120000 } = {}) {
    if (!owner || !Array.isArray(shardIds) || shardIds.length === 0) return 0
    const marks = shardIds.map(() => '?').join(',')
    const res = this.db.prepare(`
      UPDATE campaign_shard SET lease_until=?, updated_at=?
      WHERE id IN (${marks}) AND state='leased' AND lease_owner=?
    `).run(now + Math.max(1000, Number(leaseMs) || 120000), now, ...shardIds, owner)
    return Number(res.changes) || 0
  }

  /** 回收过期租约：还能重试就回队列，超过上限直接 failed，避免坏分片无限循环。 */
  reapExpiredLeases({ campaignId = null, now = Date.now() } = {}) {
    let sql = "SELECT * FROM campaign_shard WHERE state='leased' AND lease_until < ?"
    const params = [now]
    if (campaignId) { sql += ' AND campaign_id = ?'; params.push(campaignId) }
    const expired = this.db.prepare(sql).all(...params)
    if (expired.length === 0) return []
    const fail = this.db.prepare(`
      UPDATE campaign_shard SET state='failed', attempt=?, error='lease-expired',
        lease_owner=NULL, lease_until=NULL, updated_at=? WHERE id=?
    `)
    const requeue = this.db.prepare(`
      UPDATE campaign_shard SET state='queued', attempt=?, lease_owner=NULL, lease_until=NULL,
        next_run_at=?, updated_at=? WHERE id=?
    `)
    const out = []
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of expired) {
        const attempt = (Number(row.attempt) || 0) + 1
        if (attempt >= (Number(row.max_attempts) || 1)) {
          fail.run(attempt, now, row.id)
          out.push({ ...row, state: 'failed', attempt, error: 'lease-expired', lease_owner: null, lease_until: null })
        } else {
          requeue.run(attempt, now, now, row.id)
          out.push({ ...row, state: 'queued', attempt, lease_owner: null, lease_until: null, next_run_at: now })
        }
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    return out.map(hydrateShard)
  }

  /** 只认 leased/queued 的分片；带 owner 时校验租约归属，防止过期 worker 覆盖结果。 */
  completeShard({ shardId, owner = null, output = null, gate = null } = {}) {
    const sets = ["state='done'", 'output_json=?', 'updated_at=?']
    const params = [output === null ? null : JSON.stringify(output), Date.now()]
    if (gate !== null && gate !== undefined) {
      sets.push('gate_json=?')
      params.push(JSON.stringify(gate))
    }
    let sql = `UPDATE campaign_shard SET ${sets.join(', ')} WHERE id = ? AND state IN ('queued','leased')`
    params.push(shardId)
    if (owner !== null) { sql += ' AND lease_owner = ?'; params.push(owner) }
    const res = this.db.prepare(sql).run(...params)
    return Number(res.changes) > 0
  }

  /** 指数退避封顶 5 分钟，避免下游故障时把队列打成全速重试。 */
  failShard({ shardId, owner = null, error = null, now = Date.now(), retryAt = null, maxAttempts = null } = {}) {
    const row = this.db.prepare('SELECT * FROM campaign_shard WHERE id = ?').get(shardId)
    if (!row) return { state: null, attempt: 0 }
    const prevAttempt = Number(row.attempt) || 0
    const attempt = prevAttempt + 1
    const limit = Number.isFinite(maxAttempts) ? maxAttempts : (Number(row.max_attempts) || 3)
    const state = attempt >= limit ? 'failed' : 'queued'
    const backoff = Math.min(300000, 1000 * (2 ** prevAttempt))
    const nextRunAt = state === 'failed' ? row.next_run_at : (retryAt ?? (now + backoff))
    let sql = `
      UPDATE campaign_shard SET state=?, attempt=?, error=?, next_run_at=?,
        lease_owner=NULL, lease_until=NULL, updated_at=? WHERE id=?
    `
    const params = [state, attempt, error === null ? null : String(error), nextRunAt, now, shardId]
    if (owner !== null) { sql += ' AND lease_owner = ?'; params.push(owner) }
    const res = this.db.prepare(sql).run(...params)
    if (Number(res.changes) === 0) return { state: row.state, attempt: prevAttempt }
    return { state, attempt }
  }

  /** 给 needs-review / needs-human 这类「停在等人」的状态留的窄入口。 */
  setShardState({ shardId, state, output = null, error = null } = {}) {
    const res = this.db.prepare(`
      UPDATE campaign_shard SET state=?, output_json=COALESCE(?, output_json),
        error=COALESCE(?, error), updated_at=? WHERE id=?
    `).run(state, output === null ? null : JSON.stringify(output), error, Date.now(), shardId)
    return Number(res.changes) > 0
  }

  recordVote({ id = null, campaignId, taskId = null, shardId = null, voter = null, verdict,
    evidenceWeight = 1, payload = null } = {}) {
    const vid = id || `cv_${randomBytes(4).toString('hex')}`
    this.db.prepare(`
      INSERT INTO campaign_vote(id, campaign_id, task_id, shard_id, voter, verdict,
        evidence_weight, payload_json, created_at)
      VALUES(?,?,?,?,?,?,?,?,?)
    `).run(vid, campaignId, taskId, shardId, voter, String(verdict),
      Number.isFinite(evidenceWeight) ? evidenceWeight : 1,
      payload === null ? null : JSON.stringify(payload), Date.now())
    return vid
  }

  listVotes({ taskId = null, campaignId = null } = {}) {
    const params = []
    let sql = 'SELECT * FROM campaign_vote WHERE 1=1'
    if (taskId) { sql += ' AND task_id = ?'; params.push(taskId) }
    if (campaignId) { sql += ' AND campaign_id = ?'; params.push(campaignId) }
    sql += ' ORDER BY created_at ASC'
    return this.db.prepare(sql).all(...params).map(hydrateVote)
  }

  recordArtifact({ id = null, campaignId, taskId = null, shardId = null, kind, path, sha256 = null,
    bytes = null, producerRole = null, tool = null, inputHash = null } = {}) {
    const aid = id || `ca_${randomBytes(4).toString('hex')}`
    this.db.prepare(`
      INSERT INTO campaign_artifact(id, campaign_id, task_id, shard_id, kind, path, sha256,
        bytes, producer_role, tool, input_hash, created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(aid, campaignId, taskId, shardId, String(kind), String(path), sha256,
      Number.isFinite(bytes) ? bytes : null, producerRole, tool, inputHash, Date.now())
    return aid
  }

  listArtifacts({ campaignId, kind = null } = {}) {
    const params = [campaignId]
    let sql = 'SELECT * FROM campaign_artifact WHERE campaign_id = ?'
    if (kind) { sql += ' AND kind = ?'; params.push(kind) }
    sql += ' ORDER BY created_at DESC'
    return this.db.prepare(sql).all(...params)
  }

  appendEvent({ campaignId, shardId = null, kind, detail = null } = {}) {
    const res = this.db.prepare(`
      INSERT INTO campaign_event(campaign_id, shard_id, kind, detail_json, created_at)
      VALUES(?,?,?,?,?)
    `).run(campaignId, shardId, String(kind), detail === null ? null : JSON.stringify(detail), Date.now())
    return Number(res.lastInsertRowid)
  }

  /** 先取最新 N 条再正序返回：调用方拿到的是时间线，不是倒序日志。 */
  listEvents({ campaignId, limit = 200 } = {}) {
    const rows = this.db.prepare(`
      SELECT * FROM campaign_event WHERE campaign_id = ? ORDER BY id DESC LIMIT ?
    `).all(campaignId, Math.max(1, Math.min(2000, limit)))
    return rows.reverse().map(hydrateEvent)
  }

  campaignStats({ campaignId } = {}) {
    const campaign = this.getCampaign(campaignId)
    const t = this.db.prepare(`
      SELECT COUNT(*) AS total, SUM(CASE WHEN state='done' THEN 1 ELSE 0 END) AS done
      FROM campaign_task WHERE campaign_id = ?
    `).get(campaignId)
    const states = this.db.prepare(
      'SELECT state, COUNT(*) AS n FROM campaign_shard WHERE campaign_id = ? GROUP BY state',
    ).all(campaignId)
    const byState = {}
    for (const row of states) byState[row.state] = Number(row.n) || 0
    const ev = this.db.prepare('SELECT COUNT(*) AS n FROM campaign_event WHERE campaign_id = ?').get(campaignId)
    return {
      campaign,
      tasks: { total: Number(t?.total) || 0, done: Number(t?.done) || 0 },
      shards: {
        queued: byState.queued || 0,
        leased: byState.leased || 0,
        done: byState.done || 0,
        failed: byState.failed || 0,
        needsReview: byState['needs-review'] || 0,
        needsHuman: byState['needs-human'] || 0,
      },
      spend: campaign?.spend ?? {},
      events: Number(ev?.n) || 0,
    }
  }

  /** 调度器决定要不要再拉 worker 的信号。 */
  claimableCount({ campaignId, now = Date.now() } = {}) {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS n FROM campaign_shard
      WHERE campaign_id = ? AND state='queued' AND next_run_at <= ?
    `).get(campaignId, now)
    return Number(row?.n) || 0
  }

  stats() {
    const paper = this.db.prepare('SELECT COUNT(*) AS n FROM paper').get()
    const oa = this.db.prepare("SELECT COUNT(*) AS n FROM paper WHERE oa_pdf_url IS NOT NULL").get()
    const withDoi = this.db.prepare('SELECT COUNT(*) AS n FROM paper WHERE doi IS NOT NULL').get()
    const queries = this.db.prepare('SELECT COUNT(*) AS n FROM query_log').get()
    const state = this.db.prepare('SELECT COUNT(*) AS n FROM source_state').get()
    const ms = this.db.prepare('SELECT COUNT(*) AS n FROM manuscript').get()
    const claims = this.db.prepare('SELECT COUNT(*) AS n FROM claim').get()
    const orphans = this.db.prepare(`
      SELECT COUNT(*) AS n FROM claim c
      WHERE NOT EXISTS (SELECT 1 FROM evidence e WHERE e.claim_id=c.id)
    `).get()
    const intel = this.db.prepare('SELECT COUNT(*) AS n FROM journal_intel').get()
    const journalTopics = this.db.prepare('SELECT COUNT(DISTINCT journal_id) AS n FROM journal_topic').get()
    const reviews = this.db.prepare('SELECT COUNT(*) AS n FROM review_corpus').get()
    const frontier = this.db.prepare('SELECT COUNT(*) AS n FROM frontier_item').get()
    const kclaims = this.db.prepare('SELECT COUNT(*) AS n FROM knowledge_claim').get()
    const gaps = this.db.prepare('SELECT COUNT(*) AS n FROM gap_entry').get()
    const plans = this.db.prepare('SELECT COUNT(*) AS n FROM contribution_plan').get()
    return {
      schemaVersion: this.version(),
      papers: paper.n,
      openAccessWithPdf: oa.n,
      withDoi: withDoi.n,
      queries: queries.n,
      trackedSources: state.n,
      manuscripts: ms.n,
      claims: claims.n,
      orphanClaims: orphans.n,
      journalIntelRows: intel.n,
      journalsWithTopics: journalTopics.n,
      reviewNotes: reviews.n,
      frontierItems: frontier.n,
      knowledgeClaims: kclaims.n,
      gaps: gaps.n,
      contributionPlans: plans.n,
      dbPath: this.dbPath,
    }
  }

  close() {
    try { this.db.close() } catch { /* ignore */ }
  }
}

function safeJson(text, fallback) {
  if (!text) return fallback
  try { return JSON.parse(text) } catch { return fallback }
}

/** frontier_item 行 → 对外结构（topics/payload 解 JSON）。 */
function hydrateFrontierItem(row) {
  return {
    id: row.id,
    source: row.source,
    kind: row.kind,
    title: row.title,
    url: row.url,
    author: row.author,
    stars: row.stars,
    forks: row.forks,
    pushedAt: row.pushed_at,
    createdAt: row.created_at,
    commits52w: row.commits_52w,
    releases: row.releases,
    topics: safeJson(row.topics_json, []),
    description: row.description,
    domain: row.domain,
    credibility: row.credibility,
    credibilityNote: row.credibility_note,
    payload: safeJson(row.payload_json, null),
    fetchedAt: row.fetched_at,
  }
}

/** campaign 行 → 对外结构（三份 JSON 解成对象；坏数据给 null，不让读取方炸）。 */
function hydrateCampaign(row) {
  return {
    ...row,
    constraints: safeJson(row.constraints_json, null),
    budget: safeJson(row.budget_json, null),
    spend: safeJson(row.spend_json, null),
  }
}

/** campaign_shard 行 → 对外结构。payload/gate/output 都可能不存在。 */
function hydrateShard(row) {
  return {
    ...row,
    payload: safeJson(row.payload_json, null),
    gate: safeJson(row.gate_json, null),
    output: safeJson(row.output_json, null),
  }
}

function hydrateVote(row) {
  return { ...row, payload: safeJson(row.payload_json, null) }
}

function hydrateEvent(row) {
  return { ...row, detail: safeJson(row.detail_json, null) }
}

/** 短 id：前缀 + 时间 + 随机，便于肉眼区分实体类型。 */
function newId(prefix) {
  const buf = `${prefix}:${Date.now()}:${Math.random()}`
  return `${prefix}_${createHash('sha1').update(buf).digest('hex').slice(0, 12)}`
}

export default { ScienceStore, SCHEMA_VERSION, ftsQuery }
