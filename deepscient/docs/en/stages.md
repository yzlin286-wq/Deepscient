# The twelve stages and their doors

The workflow is defined in `dsh-science/data/workflow.json`, with 12 stages and 55 doors. Every door's verdict is made against the real state in the library, not against "how far the conversation got".

| Stage | Name | In one sentence | Typical artifact |
|---|---|---|---|
| S0 | Topic and scope | Narrow "I want to work on this direction" into one sentence that can be falsified | `project.json` |
| S1 | Literature and state of the art | Search, locate the gap, and leave the search scope behind | literature library, gap matrix |
| S2 | Design and protocol | Choose a design, write the protocol, list threats and countermeasures | `plan.json` |
| S3 | Sample size and preregistration | Compute n or the MDE; obtain a preregistration number | `prereg_ref` |
| S4 | Measurement and instruments | Measurement definitions, units, instruments, calibration | `protocols/` |
| S5 | Collection | Where the data comes from, how it is numbered, how it is protected against loss | raw files in `data/` |
| S6 | Data management | Cleaning scripts, variable dictionary, missing-data handling | `code/`, `data/clean.*` |
| S7 | Analysis | Hypothesis tests + effect sizes + robustness | `analysis` records |
| S8 | Figures and tables | Journal dimensions, colour-blind friendly, error-bar definition | `figures/` |
| S9 | Writing | One `paper.md`, from which four artifacts come | manuscript |
| S10 | Internal review | Self-check against the review dimensions, one by one | audit records |
| S11 | Submission | Cover letter, requirements, submission-system format | PDF / DOCX / JATS |

## The four door states

- `pass`: the machine checked it, and it passed.
- `fail`: the machine checked it, and it did not pass. If it is blocking, the stage cannot count as complete until it is fixed.
- `skip`: **there is no evidence to check** (it never ran, no record was left, or the library has no such column). Skip does not equal pass.
- `manual`: a human has to judge it (is ethics in place, are the author contributions genuine, is the cover letter on point). It never becomes pass, and it never disappears either.

A stage counts as "complete" when there is no blocking item, no warning and no skip. `manual` is not counted in the completion verdict, but is always displayed.

## Why some doors are always skip

Three common reasons, none of them a bug:

1. **This design does not apply**: a non-cluster design will not have the "design effect computed" item.
2. **The library has no such column**: for example "key references have full text" needs `oa_pdf_url`; if no record in the library has it, the honest answer is that there is none.
3. **This step is meant to be done outside**: preregistration requires you to submit at OSF, get the number and fill it back in.

The panel and the coach report the same thing. When you see a skip, read the plain-language sentence in `detail`.
