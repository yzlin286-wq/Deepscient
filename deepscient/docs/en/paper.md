# From data to a submission-grade PDF

This document covers one thing only: **how to take a paper from raw data all the way to a PDF/DOCX/JATS/HTML you can hand in**, and where this path is known to break.

Judgment matters (does this conclusion hold up, is the contribution novel enough) live in the `science_paper_audit` layer and are out of scope here. This document only covers the mechanical parts: are the numbers right, is every required element present, does the layout conform.

## The five stages

| Stage | Tool | Output | Where it lands |
|---|---|---|---|
| Data | `science_project_open` → `science_exp_run` | controlled directory, input fingerprints | `<DSH_HOME>/science/projects/<id>/` |
| Statistics | `science_stats` | structured results (statistic/df/p/effect size/interval) + one reporting sentence you can copy directly | `analysis` table in the library + `analysis.json` |
| Figures | `science_figure` | PDF + PNG, 600 dpi, at column width | project directory `figures/` |
| Assembly | `science_manuscript_assemble` | summary table + figure references + reporting sentences | the marked block in the manuscript's `paper.md` |
| Build | `science_manuscript_build` | PDF / DOCX / JATS / HTML | manuscript `build/` |

Citations have a separate path of their own: `science_reference_add` writes entries into `references.yml`, the body cites them with `[@key]`, and the build restyles them to the target journal's citation style. Editing `references.yml` by hand also works, as long as you do not touch `key`.

## How assembly works

`science_manuscript_assemble` writes only this block in `paper.md`:

```markdown
<!-- assemble:results:start -->
…tables, figures, reporting sentences…
<!-- assemble:results:end -->
```

Prose outside the block is not touched at all, so "let the model write the argument, let the tools fill in the numbers" can happen in parallel without overwriting each other. Running it twice produces byte-identical results (there is an assertion for this in `e2e-paper-run.mjs`), so it is safe to put it in a script.

It reads two things from the library:

- records in the `analysis` table with `kind = 'stats'` and `ok = true` — used to generate the summary table and reporting sentences
- the `figure_spec` table — used to generate figure references and to **copy** the figures into the manuscript's `figures/`

The second step is easy to overlook: figures originally land in the project directory, and the manuscript directory is somewhere else. Without the copy, building on another machine or in another directory reports "figure file not found". The assembly tool now copies automatically and prefers PNG (only LaTeX can read PDF, and HTML previews would be missing figures).

## Table and cross-reference syntax

In the Markdown subset, a table caption goes **below** the table, starts with `: `, and the label goes at the end of the sentence:

```markdown
| Test | N | Statistic | p | Effect size |
| --- | --- | --- | --- | --- |
| Welch two-sample t test | a=30, b=30 | t(56.21) = -5.08 | < .001 | Cohen's d = -1.31 |

: Table 1: Summary of the main analysis results {#tab:results}
```

In the body, cite with `\ref{tab:results}` and `\ref{fig:<figure id>}`. **Do not write `@tab:results`** — `@` is the prefix for literature citations, and a wrong one is judged as "cited a reference that does not exist", which is the easiest tripwire to hit.

## How Chinese output works

The front matter needs no switch: when Chinese section headings appear in the body, the build uses `xeCJK` + `SimSun` (bold falls back to `SimHei`), and `ctex`/`fontspec` are available in MiKTeX by default. Chinese fonts are embedded into the PDF; `SimSun` shows up in the font table with ToUnicode.

One pitfall worth recording: on Windows, `pdftotext` outputs in CP936 by default, so extracting Chinese gives strings like `涓庣畝鍗曞弽搴旀椂浠诲姟`. That is not a broken PDF, it is a wrong encoding on the extraction side — encode that string back to bytes as GBK and decode it as UTF-8, and you get the correct "与简单反应时任务".

## Journal families and automatic package top-up

To switch journals, change only `journal` in the front matter. A missing LaTeX class triggers `mpm --install` automatically; if that fails it falls back to `article` and names the missing package in `warnings` rather than degrading silently. `science_format_check { deep: true }` actually compiles a minimal document and lays out the real state of the engine, the packages and python-docx in one pass.

## Numbers from one real run

Running the bundled example data (`data/examples/sleep-wm`, 22 paired observations) through the whole chain, landing on a PLOS ONE manuscript:

| Item | Value |
|---|---|
| Body | 1841 words (Introduction / Results / Discussion / Methods / Data availability) |
| Statistics | 2 successful analyses (Welch t and Mann-Whitney U, reported side by side as a sensitivity analysis) |
| Figures | 1, 600 dpi, PNG copied into the manuscript's `figures/` |
| Tables | 1 summary table, `{#tab:results}`, referenced in the body as `\ref{tab:results}` |
| References | 10, all cited in the body, `cite-undefined` and `cite-uncited` both 0 |
| Requirement check | `blocking = 0`, only one `words-unbounded` notice left (the journal is not indexed, so the word limit cannot be compared) |
| Artifacts | PDF 142 KB / 14 pages (Letter, double spacing, continuous line numbers) · DOCX 82 KB · JATS 22 KB · HTML 19 KB |
| Known residue | 6 `Overfull \hbox` (long table column widths); adjust the column widths before submission |

## Self-check

```powershell
node deepscient/scripts/e2e-paper-run.mjs      # 20 assertions, including idempotence and figure copying
node deepscient/scripts/e2e-paper-run.mjs --keep   # keep the temporary manuscript to inspect the scene on failure
```

This script does not call a model: it creates the manuscript, assembles it, adds references, runs lint, builds all four artifacts, and verifies page count and text with `pdfinfo` and `pdftotext`. Green only means the mechanical parts did not break, not that the paper is well written — that is exactly the boundary it is meant to cover.

## Known breakpoints

| Symptom | Cause | Handling |
|---|---|---|
| `figure-file-missing` | the figure exists only in the project directory | run `science_manuscript_assemble`, it copies them |
| `cite-undefined: tab:xxx` | the body wrote `@tab:xxx` | change it to `\ref{tab:xxx}` |
| `xref-dangling: tab` | the caption was written as a heading row, or the label is not at the end of the `: ` line | follow the table syntax above |
| `cite-undefined: <key>` | the skeleton's front matter does not point to `referencesFile` | since 0.5.0 project creation writes `referencesFile: references.yml` automatically; add the line by hand for older manuscripts |
| `abstract-long` | the abstract has a hard upper limit | delete words as instructed, do not delete structure |
| `Overfull \hbox` | the table is wider than the column | drop a column, or write long numeric columns in magnitude form |
