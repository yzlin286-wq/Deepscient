# Six pitfalls we actually hit

These six are not imagined; they came out of running the end-to-end demo for real. All are recorded here to save you one debugging session.

## 1. A script's working directory is the project root, not the run directory

When `science_exp_run` executes, cwd is the project root. So `open('data/raw.csv')` in a script is exactly the path you have in mind.

To write things into this run's own directory, use the environment variable `DSH_RUN_DIR` (there are also `DSH_PROJECT_DIR`, `DSH_SEED`, `DSH_RUN`).

In early versions cwd was the run directory, so a student writing `open('data/raw.csv')` would inevitably get `FileNotFoundError` — that was a design error and has been changed.

## 2. The Python layer is offline by default

The analysis stage should not be online. `DSH_LAB_NO_NETWORK=1` blocks `socket.connect`, so any script that casually downloads a dataset will fail.

If you really need the network, pass `network: true` explicitly and the run record will say so. Note that it cannot control subprocesses such as `curl` and `wget` — that is another layer.

## 3. Comments in the skeleton manuscript are not body text

`<!-- TODO: 在这里引文献 [@somekey] -->` in a newly created manuscript is an instruction for you. The parser strips HTML comments before judging, so a sample citation inside a comment will not produce "cited a non-existent reference".

If your manuscript does contain comment-form TODOs, they do not enter the PDF and are not counted in the word count.

## 4. A limit of 0 means no limit

Some journals set no limit on the number of figures. If the configuration says 0, the check treats it as "unlimited", so you will not get nonsense like "1 figure, exceeds the limit of 0".

## 5. When assumptions fail, switch the test, not switch until significant

`science_stats` reports `assumptions` first. If normality fails or homogeneity of variance fails, it gives you `warnings[].fallback` — for example falling back to Mann-Whitney U when Welch's t test does not apply.

Two rules:

- if you switch the test, state in the body what you switched and why;
- never keep switching until p < 0.05. That is p-hacking, and reviewers spot it at a glance.

The "assumption check" door of stage S7 checks "did you run the registered fallback", not "how perfect your data is".

## 6. Submission needs the real figure; skip is not a pass

When `lint` checks figures it looks for files in the manuscript's `figures/` directory. A figure sitting in the project's `figures/` does not count — the submission system wants the copy in the manuscript directory. Copy it over.

Also: a grey dot (skip) on the panel means "there is no evidence to check", not "passed". A skip among the twelve stages means this step has not left a record yet.

---

## Two more things that are not pitfalls but are easy to misread

- **Tools are not global**: the 33 tools belong to the "Research mode" preset. Sessions in other presets cannot see them; that is by design.
- **The panel and the assistant read the same data**: the panel does not cache verdicts, it recomputes the doors on every refresh. If the two disagree, something was written in between — and that is exactly what you should investigate.
