# Getting started: from a working install to your first project

This document mirrors the six-step onboarding that pops up automatically on first open. Onboarding progress is stored in this instance's data root (`onboardingDone` / `onboardingStep` in `%USERPROFILE%\.deepscient\science\ui-settings.json`), so switching browsers shows it once more, and clicking "skip onboarding" means it will not bother you again. To start over: Settings → Research → reopen the usage guide.

## 1. First confirm the stack is really up

The first onboarding step reads `/deepscient/api/health`; all three items must be right:

| Item | What counts as right |
| --- | --- |
| Product | `DeepScient` plus a version number, not some other instance |
| Research library | `available: true`; `source: runtime` means dsh-science is running, `package` means reading straight from the package (read-only panel) |
| Data root | `%USERPROFILE%\.deepscient` (not `~/.dsh` — that is a different instance) |

When the research library is not ready, the workbench tells you exactly what is missing instead of showing an empty list.

## 2. Model and key decide whose account is charged

The second onboarding step lists the current default model and the credential source (masked only, e.g. `sk-…4f2a`). Three things to know:

1. The default model is set by `agentDefaultModel`; switching models does not affect existing sessions, only new ones.
2. One key is one billing subject. With a relay station, the actual charge lands on **your key**; this page only does same-basis accounting.
3. Tokens are visible even without a price table, only the "≈ amount" is not shown. Prices are entered in Settings → Billing price list.

For details see the "Billing and accounting" page.

## 3. Literature / search APIs can wait

Of the eight data sources, three need only an email to enter the polite pool (OpenAlex, Unpaywall, Crossref), and arXiv needs no credentials at all. Everything runs with all fields empty, just with a lower rate limit and slightly worse metadata. For how to fill them in, how to verify them, and which fields the tools in this version really read, see the "Connecting literature and search APIs" page.

## 4. Create a project

The title is the only required field. Once it is created, the workbench shows a progress bar with twelve stages. Discipline and target journal can be changed at any time; they affect default assumptions, reporting norms and the target journal template, not capability switches.

Creating a project calls `createProject` in dsh-science and lands under `<data root>/science/projects/<id>/`. If the panel reports `root-mismatch`, the two processes disagree about `DSH_HOME` — do not point `DSH_HOME` somewhere else when restarting.

## 5. Open a session and paste any one of these

These three templates are the same three given in step five of onboarding; copy them directly:

**Topic positioning**

```
I am working on "<direction>". Please first scan the frontier anchors of the past two years with science_frontier,
then score three candidate topics with science_topic_score,
and finally tell me only which one is worth turning into a paper, and why.
```

**Literature map**

```
Build a literature map around "<research question>": 15 core papers, 5 method lines;
for each conclusion mark the strength of evidence, whether it is reproducible, and where it appears in the original text.
```

**Hypotheses and sample size**

```
Turn "<phenomenon>" into a testable hypothesis: H1 must state the independent variable, the dependent variable and the expected direction;
use science_exp_plan to give the minimally reproducible sample size and experimental steps, and list the preregistration points.
```

The session must be opened under the "Research mode" (科研模式) preset, otherwise the tools are not at hand — this instance has only that one preset, and new sessions use it by default.

## 6. Three iron rules

1. Every conclusion must be pointable in the original text; an assertion without a source counts as blocking, not as "close enough".
2. Data, code, figures and environment fingerprints are all left as a trail; a rerun must reproduce the same figure.
3. A stage that has not passed is a door that has not opened, not a lazy model: look at the "Workflow" page of the workbench to see which door it is, and it tells you what to supply.

For which doors each of the twelve stages has and how the 55 doors are judged, see the "Twelve stages and their doors" page.
