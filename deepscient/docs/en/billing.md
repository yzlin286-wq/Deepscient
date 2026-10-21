# Billing and accounting: where tokens come from, and why the money figure is an "estimate"

## In one sentence

Token counts are **ground truth**, read entry by entry from the local session log; the money amount is an **estimate computed from the price table you fill in**. The real charge lands on your key, and the bill lives at the relay station. The page keeps the two apart and never merges them into a single number.

## Where token counts come from

For every model reply, the provider writes one usage record into the session log:

```
<sessions>/<date>/<session>.jsonl.zstd
  → assistant/message   .data.usage = { inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens, totalTokens }
  → request/header      .data.header.config = { provider, model }     ← aligned with the record above by (turn, step)
```

- `totalTokens = inputTokens + cacheReadTokens + outputTokens` (`cacheWriteTokens` is listed separately and is not counted twice).
- The panel caches this same log set by `(size, mtimeMs)` into an index at `<data root>/science/usage-index.json`; only new or changed files are re-parsed, and reopening within 60 seconds does not rescan the disk.
- A single log larger than 64 MB is skipped and named under "parts skipped during accounting" instead of being swallowed silently.
- Lines that cannot be parsed go into `quality.badLines`, and replies without usage go into `quality.withoutUsage`; they mean "there really is no number on this machine" and are never spread over other entries.

`totalTokens` follows whatever the provider reports. If a provider stops writing usage one day, that reply only increments `withoutUsage`; every other number stays as it was.

## How the money is computed

The price table lives in settings, is entered **per million tokens**, and may have as many rows as you need:

| Field | Meaning |
| --- | --- |
| `provider` | `tree` / `ccagent` / … ; `*` means wildcard |
| `model` | model name; `*` means wildcard |
| `inputPerM` | unit price for input that misses the cache |
| `cacheReadPerM` | unit price for input that hits the cache (usually an order of magnitude cheaper) |
| `outputPerM` | unit price for output |

The match order is "exact provider + model" → "exact provider + wildcard model" → full wildcard. For a model that matches nothing, the money column shows `—`; the price of another model is never substituted. When `cacheReadPerM` is missing it falls back to `inputPerM`, so cache hits are at least not treated as free.

Money = Σ(tokens of each kind ÷ 1e6 × the matching unit price), computed per token kind and then summed — so a session with a high cache hit rate costs noticeably less than "all input at the miss price".

## Why it says "estimate"

1. The price table is yours; change it and the number changes. Upstream price changes are not synced automatically.
2. The relay station may have its own discounts, granted credit, tiered pricing, or per-call capabilities (search, embeddings) that this machine cannot see.
3. Some providers fold "thinking tokens" into the output, others list them separately; this machine can only aggregate the numbers it is given.

That is why the bottom pill and the billing page write "≈" and point explicitly to the relay station's billing page. **Reconcile against the relay station.**

## The bottom pill

The bottom shows one number only: today's token consumption (`today 128.4k tokens`). Money is not shown there — the bottom strip is small and one number is enough; click the pill to jump straight to the "Billing" page of the workbench when you want the amount and the breakdown.
The stock pill also shows the "cache hit rate", which the first-screen styling removed — hit rate carries no decision value for research work, and keeping it only makes people think it is the bill.

## Why the relay station link is empty

`billingBaseUrl` (relay station address) and `billingConsoleUrl` (billing/balance page) are two reserved fields, empty by default. Until they are filled in, the billing page shows "link pending: https://<relay station address>"; only then does it become a clickable link.

The reason is practical: this instance can be pointed at any New API relay station, so hardcoding one address would be wrong. When filling them in:

- enter only the site root or the panel path, never a key;
- billing page paths differ between deployments (common ones are `/panel/token`, `/console/topup`), so use the ones from your own deployment;
- these two fields only affect whether a link can be opened, never any statistic.

## Where the charge happens

Your actual usage is charged against this key:

- when the key is injected through an environment variable, "charged to" on the billing page shows the source and the mask (`TREE_API_KEY`, `CCAGENT_API_KEY`, `DEEPSEEK_API_KEY`);
- when the key comes from the DSH credential store, it shows that provider's mask and note;
- switching keys on the same machine changes the billing subject; past sessions stay attributed to the provider/model recorded when they were written and are not recomputed because the key changed.

Secrets are read only on the host side, the frontend receives only masks, and no plaintext appears in logs, the index or the tarball.
