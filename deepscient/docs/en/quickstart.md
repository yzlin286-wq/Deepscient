# Quick start

This instance is called DeepScient and is a standalone DeepSeek Harness: it has its own data root, its own profile and its own port, and does not interfere with the other dsh.

## Starting and stopping

```
deepscient\bin\deepscient.cmd            # start, default 3081, shifts to the next port if occupied
deepscient\bin\deepscient.cmd -NoOpen    # start without opening a browser
deepscient\bin\deepscient.cmd -Port 3090 # specify the port
```

Closing that window stops the service. Data lives in `%USERPROFILE%\.deepscient`; deleting that directory is a factory reset.

## Ten steps to submission

1. **Health check**: `science_preflight` shows what the environment (Python, LaTeX, statistics libraries) is missing.
2. **Create a project**: `science_project_open`, with `domain` (discipline package id), `question`, `ethics` (ethics approval number) and `dataLicense`.
3. **Look at the discipline**: `science_discipline_profile` tells you the designs common in this discipline, the mandatory reporting items, and the points reviewers usually attack.
4. **Search to locate the gap**: `science_lit_query` → `science_gap_matrix`. Queries, time window and databases must be kept on record.
5. **Produce a plan and a sample size**: `science_exp_plan`. Give an effect size to get n, or give n to get the MDE. Cluster designs must account for the design effect.
6. **Preregistration**: submit the plan to OSF / PROSPERO and fill the registration number back into the project (`prereg_ref`). This door is hard.
7. **Run the data**: raw data goes into `data/`, scripts into `code/`, and everything is executed through `science_exp_run` (it records the command, environment, seed and input/output hashes).
8. **Statistics**: `science_stats`. Read `assumptions` first; if they fail, switch tests per `warnings[].fallback` and rerun — not switching until significant.
9. **Figures**: `science_figure`, output at the target journal's millimetre dimensions.
10. **From writing to build**: `science_manuscript_new` → edit `paper.md` → `science_manuscript_lint` → `science_manuscript_build` (PDF / DOCX / JATS / HTML).

## What are those icons in the sidebar

The sidebar has 6 icons; one icon is one page, clicking goes straight there, and there are no second-level tabs in between:

- **Workbench**: project cards, the S0–S11 stage bar, where you are stuck right now, and what to do next.
- **Workflow**: all 55 doors listed one by one, with severity (blocking / warning / self-check) and "how to pass".
- **Tools**: which step each of the 33 tools belongs to, and what file that step produces.
- **Billing**: token consumption is ground truth; the amount is an estimate from the price table you configured.
- **Connections**: credentials for literature sources and search APIs, written to a single file `.credentials.yaml`.
- **About**: this very page.

Settings has one more page, "Research": default discipline, default target journal, α, multiple-comparison correction, figure units. Changes take effect immediately.

## The three colours on the panel

- green = everything a machine can check has passed;
- red = there are blocking items, stop and fix them;
- grey / dashed = "no record yet" or "you must look at this yourself" (ethics, author contributions, cover letter).

**Grey is not a pass.** The panel will not turn grey into green just because everything else is done.
