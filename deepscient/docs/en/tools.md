# Which step each tool is used in

36 tools are defined: 23 are attached to specific stages and 13 span stages (history lookup, provenance, coach, journal intelligence, frontier scanning). Tools are callable only in sessions of the "Research mode" preset — they are part of the preset, not global functions.

One thing to clear up first: the core table in `dsh-science/docs/tool-registry.md` has 33, three fewer than the code (`science_reproducibility`, `science_statistics_choice` and `science_top_journal_writing` are a knowledge-transformation layer added later). The "Tools" tab of the panel scans the tool definitions in the package directly, so it shows 36. Trust the panel; the document lags behind.

| Stage | Tool | What it answers |
|---|---|---|
| S0 Topic | `science_project_open` | What is this project called, which discipline does it belong to, are ethics and data licence filled in |
| S0 | `science_discipline_profile` | How this discipline usually works, which items must be reported |
| S0 | `science_discipline_list` | Which discipline packages are available |
| S0 | `science_preflight` | Is the local environment enough to run (Python / LaTeX / statistics libraries) |
| S1 Literature | `science_lit_query` | Fetch from databases by query, deduplicate, store |
| S1 | `science_search` | Search across the library (title / abstract / full-text snippets) |
| S1 | `science_gap_matrix` | Matrix of existing work × gaps |
| S1 | `science_review_corpus` | Review corpus and topic clustering |
| S2 Design | `science_exp_plan` | Produce the plan: preconditions, threats and countermeasures, the points reviewers will attack |
| S2 | `science_journal_fit` | Which journal this belongs in (tier, cycle time, basis for acceptance rate) |
| S3 Sample size | `science_exp_plan` (`effect` or `n`) | Compute n, or compute the MDE |
| S3 | `science_power` | Power functions for the various tests |
| S4 Measurement | `science_discipline_profile` | Measurement definitions and unit conventions |
| S5 Collection | `science_exp_run` | Execute a script, keeping command, environment, seed and hashes |
| S6 Management | `science_exp_run` | Cleaning scripts go through it too, for later reproducibility |
| S7 Analysis | `science_stats` | Hypothesis tests + effect sizes + assumption diagnostics + robustness fallback |
| S7 | `science_prereg_check` | Whether the current analysis matches the preregistration |
| S8 Figures | `science_figure` | Journal-dimension figures (9 chart types) |
| S9 Writing | `science_manuscript_new` | Create a manuscript (attached to the project) |
| S9 | `science_manuscript_lint` | Check requirements and format |
| S9 | `science_manuscript_build` | Produce PDF / DOCX / JATS / HTML |
| S9 | `science_format_check` | Word, figure, abstract and reference limits of the target journal |
| S10 Internal review | `science_paper_audit` | Score against the review dimensions one by one + evidence-chain checks |
| S10 | `science_manuscript_audit` | Self-check of structure and argument chain |
| S10 | `science_stats_report` | Statistical reporting requirements (effect size, CI, test assumptions) |
| S11 Submission | `science_submission_route` | Which route is fastest, and how to transfer after rejection |
| S11 | `science_cover_letter` | Argument skeleton for the cover letter |
| All stages | `science_study_coach` | Which step you are on, where you are stuck, what to do next |
| All stages | `science_workflow_stages` | Explain what a step needs and why |
| All stages | `science_exp_query` | Look up past runs and analysis records |
| All stages | `science_provenance` | Provenance-chain validation (what changed, are the hashes right) |
| All stages | `science_frontier_scan` | Frontier scan: new preprints, new methods |
| All stages | `science_intel` | Journal intelligence (cycle time, basis, policies) |

## How to read this table

- A stage that appears twice is not a duplicate: the same tool answers different questions at different stages (`science_exp_plan` produces a plan once and computes n once).
- The "Tools" tab of the panel lists the same data, sourced from each stage's `tools` array in `workflow.json` — no separate catalog is kept, so they cannot disagree.
- Tool names do not change, but the stage boundaries may be adjusted; trust the output of `science_workflow_stages`.
