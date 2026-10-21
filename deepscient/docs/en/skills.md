# Third-party research skills (vendor skills)

In one sentence: there are 1200+ mature research agent skills on GitHub, and DeepScient installs **a curated 81**; they coexist with the 17 bundled research skills, giving 98 selectable skills in a session.

## Why not "take them all"

The skill catalog enters the model context as a system-reminder (`dsh-tool-skill` injects `<available_skills>` every turn). The more entries there are, the more of your real working context gets crowded out:

| Installation | Entries | Catalog cost (measured/estimated) |
|---|---|---|
| 17 bundled | 17 | ≈ 1.9k tokens |
| **Bundled + curated vendor (this version)** | **98** | **≈ 8.5k tokens** |
| Plus flat-installing `GPTomics/bioSkills` | 660 | ≈ 45k tokens |
| All 1200+ | 1200+ | ≈ 80k+ tokens |

So the three giant packages (bioSkills 562 / AlterLab 243 / SciAgent 208) are **not** flat-installed in this version. If you really need them, the right shape is "one routing skill per domain + the rest under nested `references/`" — dsh's skill provider only scans `depth: 1`, so `<root>/<name>/references/**/SKILL.md` does not enter the catalog, and the model reads it by path when needed. (`skills-vendor/README.md` records this for the next round.)

In addition, `catalogDescriptionMaxLength` was lowered to **260** (default 500): descriptions are truncated to 260 characters in the catalog, while the full description stays on disk. This one cut brought the catalog cost of 98 entries from about 13k down to about 8.5k tokens.

## Which 81 are installed

| Repository | Count | License | Coverage |
|---|---|---|---|
| `K-Dense-AI/scientific-agent-skills` | 42 | MIT | search, experimental design, statistics and power, writing and submission, review, figures/posters, platform integration |
| `Aperivue/medsci-skills` | 20 | MIT | protocol → sample size → cleaning → meta → reporting norms → citation verification → submission |
| `ai4s-research/ai4s-skills` | 7 | MIT | topic selection, review, experiment suite, integrity audit, manuscript writing, mind maps |
| `jxtse/scientific-research-skills` | 7 | MIT | search, full-text retrieval, close reading, related work, Zotero, paper triage |
| `anthropics/skills` | 2 | MIT per skill | `skill-creator`, `mcp-builder` |
| `wp-a/nature-academic-search` | 1 | MIT | cross-source search deduplication (explicitly supports DeepSeek Harness) |
| `MrLee2R/Intelligrapher` | 1 | MIT | research illustrations |
| `YuanZHAO321/Scientific-Writing-zh` | 1 | MIT | Chinese research writing |

The full list (including the pinned commit and content hash of every entry) is in `dsh-science/skills-vendor/manifest.json`.

## Where they are installed, and in what order

```
<DSH_HOME>/skills                  ← your own skills (priority 1)
<DSH_HOME>/science/skills          ← 17 bundled research skills (priority 2, synced with the package)
<DSH_HOME>/science/skills-vendor   ← 81 third-party vendor skills (priority 3, new in this version)
```

All three roots are written into the research preset's `customSkillDirs`, with `includeDefaultRoots: false` (so project-level skill packages are not swallowed whole). On a name clash the earlier root wins; the installer adds a `vendor-` prefix when it detects a clash and **never overwrites** skills you already have.

## Install / inspect / update

```powershell
node deepscient/scripts/install-skills.mjs --list        # manifest + whether each is installed
node deepscient/scripts/install-skills.mjs --plan        # print the plan only (dry-run, no disk writes)
node deepscient/scripts/install-skills.mjs --apply       # actually install
node deepscient/scripts/install-skills.mjs --check       # validate installed skills by dsh's rules
node deepscient/scripts/install-skills.mjs --diff        # drift between the index and the disk
node deepscient/scripts/install-skills.mjs --lock        # backfill content hashes (only needed when upstream changed)
node deepscient/scripts/install-skills.mjs --lock-refs   # pin ref to each repository's current HEAD
node deepscient/scripts/install-skills.mjs --remove --only <id> --apply
```

Equivalent entry points in the UI: **Settings → Research → Skill catalog**:

- "See which skills are installed" → source, license and pinned commit for each entry;
- "Check installed skills" → goes through `/deepscient/api/skills/check`, the same rule set as `--check`.

## API

`GET /deepscient/api/skills`

```jsonc
{
  "roots":  { "user": "...", "bundled": "...", "vendor": "..." },
  "preset": { "available": true, "id": "standard", "name": "科研模式",
              "roots": [{ "dir": ".../science/skills-vendor", "exists": true }] },
  "counts": { "user": 0, "bundled": 17, "vendor": 81, "manifest": 81,
              "sessionExpect": 98, "hostCatalog": 1 },
  "catalog": { "session": { "approxTokens": 8477 }, "host": { "rows": 1, "source": "live" } },
  "items": [ { "name": "literature-review", "source": "vendor",
               "vendor": { "repo": "K-Dense-AI/scientific-agent-skills", "ref": "5933…", "license": "MIT" } } ]
}
```

`preset.roots` is the **only trustworthy source of "which directories the session scans"**: it reads the declaration produced by the preset registry's `readDocument`, then evaluates `!!js dshHomePath('…')` semantically. Do not treat `hostCatalog` as session visibility — the host plane only sees the few skills the host itself mounts (on this machine that is the single `diagnose-windows-sandbox-acl`).

`POST /deepscient/api/skills/check` returns `{ok, checked, passed, manifest:{rows,pinned}, failed[], problems[]}`.

## Normalization: what changed at install time

Third-party skills use Claude's frontmatter conventions, while dsh has two hard requirements (`dsh-skill-filesystem` throws outright on violation):

| Original field | Handling |
|---|---|
| `userInvocable: false` | → `user-invocable: false` |
| `modelInvocable: false` | → `disable-model-invocation: true` (semantics inverted to preserve them) |
| `disableModelInvocation` | → `disable-model-invocation` |
| Overlong `description` | flattened to one line and truncated to 480 characters, the original goes into the index `notes` |
| `license` / `allowed-tools` etc. | kept as is; dsh ignores unknown fields |
| BOM, CRLF | stripped / normalized |

**Only syntax is changed, never the body.** The `references/`, `templates/` and `LICENSE.txt` each skill ships with are written alongside (≤ 256 KB per file, ≤ 2 MB per skill; anything larger is skipped with a warning).

## Reproducibility

- `ref` is a 40-character commit (branch names are forbidden): upstream pushing to `main` does not change your behavior;
- `sha256` is the content hash: if upstream quietly changes content, `--diff` finds it immediately;
- the release tarball contains **only** `skills-vendor/manifest.json` and `README.md`, not a single third-party body — the "runs on a clean machine too" baseline must not break just because skills were installed.

## Known boundaries

- The headless one-shot runner **does not compose agent presets**, so it cannot see the 98 preset-plane skills (this is by design). Visibility inside a session is guaranteed jointly by "the three roots declared by the preset + all 81 `SKILL.md` files passing dsh validation", and `e2e-science-run.mjs` verifies both every time it runs.
- MCP tools are not mounted by default (see [mcp.md](mcp.md)).
