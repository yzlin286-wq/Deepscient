# Connecting literature and search APIs

The "Connections" page of the workbench manages eight built-in data sources and additionally lets you add your own. All credentials go into a single file:

```
%USERPROFILE%\.deepscient\science\config.json
  ├─ retrieval.mailto            ← shared by OpenAlex and Crossref
  ├─ retrieval.unpaywallEmail
  ├─ retrieval.s2Key
  ├─ retrieval.coreKey
  ├─ retrieval.zoteroKey
  ├─ retrieval.exaKey
  └─ retrieval.custom[]          ← { name, baseUrl, keyHeader, key }
```

Writing is "read everything → change the specified fields → write a temp file → rename", so other keys are not wiped; saving an empty string clears that field. Keys are written on this machine only, and the UI returns masks only (keys keep the first 3 and last 4 characters, emails keep the first letter and the domain).

## The eight built-in sources

| Source | Credential | Written to | Current tool side | Notes |
| --- | --- | --- | --- | --- |
| Semantic Scholar | key | `retrieval.s2Key` | saved · not read yet | free keys come with a small quota, but raise the rate limit noticeably |
| OpenAlex | email | `retrieval.mailto` | read by the tools | enters the polite pool; the same email also feeds Crossref |
| CORE | key | `retrieval.coreKey` | saved · not read yet | open-access full-text aggregation; request the key in the CORE console |
| Unpaywall | email | `retrieval.unpaywallEmail` | read by the tools | looks up legal open-access versions |
| Crossref | email | `retrieval.mailto` | read by the tools | shares the same field with OpenAlex |
| arXiv | none | — | read by the tools | public endpoint, nothing to fill in |
| Zotero | key | `retrieval.zoteroKey` | saved · not read yet | library sync; read-only permission is enough |
| Exa | key | `retrieval.exaKey` | saved · not read yet | semantic search aimed at researchers |

"Read by the tools" has exactly one criterion: the current dsh-science retrieval runtime **really** takes it from config (it reads `retrieval.mailto` / `retrieval.unpaywallEmail`, plus `retrieval.openalexKey` or the environment variable `OPENALEX_KEY`).
The other four fields can be stored and connectivity-tested, but the tools in this version do not use them automatically — the page states honestly "saved · not read by the tools yet" instead of pretending they are in effect.

## Environment variables work too

An environment variable with the same name as a built-in source takes effect separately, with priority over config, and the UI shows "from environment variable <name>":

`SEMANTIC_SCHOLAR_KEY`, `OPENALEX_KEY`, `CORE_API_KEY`, `UNPAYWALL_EMAIL`, `CROSSREF_MAILTO`, `ZOTERO_API_KEY`, `EXA_API_KEY`.

The priority is: if config has a value, use config; only when it is empty are environment variables consulted. This rule means "temporarily change the email" needs no file edit, and "what exactly is stored in the file" always stays inspectable.

## What the verify (test) button does

Clicking "Test" really sends one minimal request, with an 8-second timeout, and returns only the status and elapsed time, never the response body:

| Result | Meaning |
| --- | --- |
| Reachable 240ms | this request returned 2xx, the credentials are usable |
| Has credentials | only a "there is a value locally" check was done (this source has no safe, side-effect-free test endpoint) |
| Missing credentials | this source needs credentials, but neither config nor environment variables have one |
| Failed | the request was non-2xx or timed out; the grey text below gives the HTTP status or the timeout explanation |

Testing consumes one upstream quota unit (search endpoints are usually metered per call), so do not click it repeatedly as a health check.

## Custom sources

`custom` is an array, each row `{ name, baseUrl, keyHeader, key }`:

- `name` is required, `baseUrl` must be http(s);
- `keyHeader` is the request header name (for example `x-api-key`, `Authorization`);
- these rows are only saved and listed, marked `declared`; making the tools actually use them requires adding a branch in the retrieval runtime.

## FAQ

**Why does the billing page not change after I enter a key?**
Literature API quotas are usually billed separately and are not part of this token accounting. The billing page only counts model tokens.

**Are there side effects if I enter it wrong?**
No. A wrong value only makes requests to that source fail. Clear and save to restore.

**Can I fill in only one?**
Yes. It runs with all eight empty as well: arXiv needs no credentials and the rest use the public rate-limited pool, just slower and with less metadata.
