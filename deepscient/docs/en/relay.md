# Relay partner integration (un.ccagent.cn)

The partner API between DeepScient and the relay (`https://un.ccagent.cn`): after a user signs in on this instance we **silently create an account**, and they buy plans and check quotas under "Billing → Relay", with payment results written back by Webhook and backstopped by the order endpoint. This document only covers "how to configure, how to sign, how to verify"; the signing and persistence implementations both live in `host/relay.js`.

## 1. Capability overview

| Capability | Direction | Upstream endpoint | In this project |
| --- | --- | --- | --- |
| Account sync | Us → Relay | `POST /partner/v1/users/sync` | Called silently after a successful authorized sign-in on the website (a failure does not affect sign-in); can also be filled in manually via "Billing → Relay → Sync account" |
| Plan query | Us → Relay | `GET /partner/v1/plans` | The "Plans on sale" table on the billing page, cached for 60 seconds; the frontend never hard-codes prices |
| Purchase redirect | Us → Relay | `POST /partner/v1/buy-url` | One "Buy" button per plan row; the server exchanges for a one-time URL and then the browser opens it |
| Quota page | Us → Relay | `POST /partner/v1/account-url` | The "My quota" button, a one-time page that needs no login |
| Payment write-back | Relay → Us | `POST <webhook_url>` | `/deepscient/partner/webhook`, signature verification + `event_id` idempotency |
| Order reconciliation | Us → Relay | `GET /partner/v1/orders/{trade_no}` | The "Query" action in "Recent orders", and also the fallback after a dead letter |
| Binding lookup | Us → Relay | `GET /partner/v1/users/{external_uid}` | `GET /deepscient/api/partner/binding`, returns only "whether it has been synced and what the user_id is" |
| Connectivity self-check | Us → Relay | `GET /partner/v1/ping` | "Test connectivity" (with the latency measured server-side) and `partner-probe.mjs --ping` |

In one sentence: **we exchange an `external_uid` for an account and an API Key, the relay takes the money and grants quota, and the Webhook tells us "the money arrived".**

## 2. Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `CCAGENT_PARTNER_APP_ID` | `app_ccagent_prod` | May be public; it is shown on the billing page and in the `--ping` output |
| `CCAGENT_PARTNER_APP_SECRET` | none | **Server-side only**. If it is not set, the whole feature degrades to a "not configured" notice |
| `CCAGENT_PARTNER_BASE` | `https://un.ccagent.cn` | Upstream base URL; if it is mistakenly set to a full address that already contains `/partner/v1`, that suffix is stripped automatically to avoid building `/partner/v1/partner/v1` |
| `CCAGENT_PARTNER_PUBLIC_BASE` | none | The public base URL of this instance, used to build `return_url` and the default Webhook address |
| `CCAGENT_PARTNER_WEBHOOK_URL` | `PUBLIC_BASE + /deepscient/partner/webhook` | Use it when you only want to override the Webhook address; the final value is what gets registered with the relay |

`app_secret` has two sources, **the environment variable takes precedence, then the local file**:

1. the environment variable `CCAGENT_PARTNER_APP_SECRET`;
2. `<DSH_HOME>/science/partner-app-secret` (`DSH_HOME` defaults to `~/.deepscient`), whose content is a single line holding the secret, with mode 0600.

```powershell
# Temporary (only affects the current process tree)
$env:CCAGENT_PARTNER_APP_SECRET = '<app_secret>'

# Or write a file: one line, the trailing newline is optional
New-Item -ItemType Directory -Force "$env:USERPROFILE\.deepscient\science" | Out-Null
Set-Content -NoNewline "$env:USERPROFILE\.deepscient\science\partner-app-secret" '<app_secret>'
icacls "$env:USERPROFILE\.deepscient\science\partner-app-secret" /inheritance:r /grant:r "$env:USERNAME:(R)"
```

Three hard rules (the code is written this way, and reviews check this way):

- the secret **never enters the repository, the frontend or the logs**. `/deepscient/api/partner` only returns `secretPresent` and `secretSource` (`env` / `file`), never the value.
- The browser side can never obtain the secret; all signing is done server-side.
- The user's `api_key` is encrypted with AES-256-GCM and written to `<DSH_HOME>/science/partner.json`, with the key in `<DSH_HOME>/science/partner-key` (0600); the UI and the API only expose a mask.

The typical symptom of a wrong upstream base or wrong credentials is `40101` (signature failure) rather than a network error—check the secret first, then the clock.

## 3. Local endpoints

They all live under `/deepscient/api` and **all require a local session** (they are not in `PUBLIC_API`); the identity comes from `req.deepscientUser.id`, and a uid passed by the client is not accepted.

| Path | Method | Request body | Response highlights | Login |
| --- | --- | --- | --- | --- |
| `/deepscient/api/partner` | GET | — | `configured`, `appId`, `base`, `secretPresent`, `secretSource`, `webhookUrl`, `publicBase`, `binding`, `orders` (the current user's most recent 10), `plans`, `plansError` | Yes |
| `/deepscient/api/partner/ping` | POST | `{}` | `appId`, `ts`, `latencyMs` (timed server-side, including the network round trip) | Yes |
| `/deepscient/api/partner/sync` | POST | `{ "displayName": "optional" }` | The `binding` projection: `externalUid`/`userId`/`username`/`apiBaseUrl`/`apiKeyMasked`/`hasKey`/`syncedAt` | Yes |
| `/deepscient/api/partner/buy-url` | POST | `{ "planId": 1 }` (may be omitted) | `url`, `ticket`, `expiresIn`; `planId` only accepts a positive integer, otherwise 400 `bad-plan-id` | Yes |
| `/deepscient/api/partner/account-url` | POST | `{}` | `url`, `ticket`, `expiresIn` | Yes |
| `/deepscient/api/partner/binding` | GET | — | Local binding projection + upstream `remote` (`{found:false}` when never synced, still 200) | Yes |
| `/deepscient/api/partner/orders/{trade_no}` | GET | — | `order` (local database merged with the upstream result), `webhook` (`event_id`/`status`/`attempts`); 404 when the order does not belong to the current user | Yes |

Two public endpoints **do not require a session**, but both require a signature and still only accept loopback origins:

| Path | Method | Description |
| --- | --- | --- |
| `/deepscient/partner/webhook` | POST | Payment write-back. Signature verification failure 400, persistence failure 500, anything other than `subscription.paid` returns 200 `ignored` directly |
| `/deepscient/partner/return` | GET | The browser return page. Validates `trade_no`/`status`/`sign`, then queries the order once more to decide whether to show "activated" or "pending confirmation" |

> "Loopback only" is decided by `isLoopback(req)` in `host/index.js`, and **it applies to the Webhook as well**. So a reverse proxy or tunnel must forward requests to `127.0.0.1:3081` (Nginx/Caddy initiate from the local machine by default, and frp/ngrok clients also run locally), otherwise the relay will receive a 403.

## 4. Signing

### 4.1 Formula

```
payload_digest =
    POST/PUT/PATCH : hex(sha256(the actual raw request body bytes sent))
    GET/DELETE     : canonical_query (an empty string "" when there are no parameters)

string_to_sign = app_id + "\n" + timestamp + "\n" + nonce + "\n" + payload_digest
signature      = hex(hmac_sha256(app_secret, string_to_sign))
```

Four request headers, none may be missing:

| Header | Value |
| --- | --- |
| `X-Partner-App-Id` | `app_id` |
| `X-Partner-Timestamp` | 10-digit Unix seconds; a deviation of more than 300 seconds from the server is rejected |
| `X-Partner-Nonce` | 8–64 characters, only `A-Z a-z 0-9 _ -`; must not repeat within 10 minutes (this project uses 16 hex characters) |
| `X-Partner-Signature` | 64 lowercase hex characters |

### 4.2 canonical query example

Rules: keys in ascending order; for equal keys, values in ascending order; for each item `encodeURIComponent(k) + "=" + encodeURIComponent(v)`, then join with `&`.

```
?b=2&a=1         →  a=1&b=2
?tag=z&tag=a     →  tag=a&tag=z
(no parameters)  →  ""
```

### 4.3 POST only looks at the bytes

The digest must be based on the **actual Buffer that is sent**. This project calls `JSON.stringify` only once inside `relayRequest`, and the same string is used both to compute the signature and to send; do not "build the object first and then let the HTTP library re-serialize it"—one character of difference in key order or whitespace is `40101`.

The key order of the request body does not have to match the documentation examples, as long as the signature and the send use the same bytes.

## 5. The eight upstream endpoints

The wrappers all live in `host/relay.js`, and the business layer only calls these functions:

| Function | Upstream | Purpose and notes |
| --- | --- | --- |
| `ping()` | `GET /partner/v1/ping` | Step one of integration. Returns `{app_id, ts}`; if it works, the app_id, the secret and the clock are all correct |
| `syncUser(uid, {displayName})` | `POST /partner/v1/users/sync` | Idempotent: the same `external_uid` always returns the same `user_id` and the same `api_key`. Call `saveBinding` with the result immediately (the Key is encrypted at rest) |
| `getUser(uid)` | `GET /partner/v1/users/{uid}` | Checks "has it been synced or not". The upstream uses `40401` to mean not synced, and this function translates it into `{found:false}` instead of throwing it as an exception |
| `listPlans()` | `GET /partner/v1/plans` | Plan price/quota/duration/group. Cached in-process for 60 seconds; `force:true` bypasses the cache |
| `createBuyUrl({externalUid, planId, returnUrl})` | `POST /partner/v1/buy-url` | Exchanges for a one-time purchase page address (300 seconds, can only be opened once). A `planId` that is not a positive integer is dropped, never sent as `NaN` |
| `createAccountUrl(uid)` | `POST /partner/v1/account-url` | Exchanges for a one-time "My quota" page address (also 300 seconds, one-time) |
| `getOrder(tradeNo)` | `GET /partner/v1/orders/{trade_no}` | Reconciliation fallback. A missing order and an order belonging to another app both return `40403`, with no distinction, to prevent probing |
| Webhook (inbound) | `POST <webhook_url>` | Handled by `verifyWebhookSignature` + `applyPaidEvent`, see section 6 |

Retries only cover failures that "might fix themselves": `429`, `5xx`, network errors, with backoff `1s → 2s → 4s` (at most 3 retries, i.e. 4 attempts); every retry **re-signs with a new nonce**, otherwise it will be judged `40103`. A `4xx` (other than 429) fails immediately and is not retried. A single request times out after 10 seconds.

## 6. Payment write-back

### 6.1 Verification formula

```
expected = hex(hmac_sha256(app_secret,
             app_id + "\n" + timestamp + "\n" + event_id + "\n" + hex(sha256(raw_body))))
```

- **You must use the raw request body bytes** (the Buffer assembled from the `req` stream). Calling `JSON.parse` first and then `JSON.stringify` changes the digest because of key order/whitespace, and verification will inevitably fail.
- The time window is 300 seconds, anything beyond that is rejected (blocks replay).
- Comparison uses the fixed-length `timingSafeEqual`.
- Besides verifying the signature, you must also check that the `X-Partner-Event-Id` header matches the `event_id` in the body—otherwise there is a gap for "a valid signature with a swapped body".

### 6.2 Status code semantics

| Scenario | Local response | Relay behavior |
| --- | --- | --- |
| Verification passed, event already processed | 200 `{ok:true, duplicate:true}` | Treated as success, stops retrying |
| Verification passed, first processing | 200 `{ok:true, duplicate:false}` | Treated as success |
| Bad signature / expired timestamp / event_id header-body mismatch | 400 | Will retry, but retrying will not help before the configuration is fixed—go check the secret and the clock first |
| Event type is not `subscription.paid`, or `data.status != success` | 200 `{ok:true, ignored:true}` | Treated as success (we give up processing on purpose; the other side should not keep re-pushing) |
| Persistence failure (disk not writable, etc.) | 500 | Retried on the cadence below |
| No secret on the server | 503 | Will retry; configure the secret first |
| Request body exceeds 512 KB | 413 | No retry |

### 6.3 Idempotency and retry cadence

- The idempotency key is `event_id`: one order produces exactly one `event_id`, and re-pushes carry identical content. `applyPaidEvent` puts "look up the event → write the event → write the order → update the binding" into a single read-modify-write, so two concurrent pushes will not both believe they are the first.
- Relay retry cadence: `10s → 60s → 300s → 900s → 3600s`, **6 deliveries in total**, 5-second timeout per attempt, and success means any 2xx; after 6 failures it is recorded as a dead letter and kept for 7 days.
- After a dead letter, reconcile actively through `orders/{trade_no}`: "Recent orders → Query" on the billing page is exactly that fallback—it merges the upstream result back into the local order table (keeping the first-received time and the `event_id`; `pending → success` does not become a new record).

## 7. Return redirect

If the purchase carried a registered `return_url`, then after payment completes "Return to app" jumps to:

```
https://<public-domain>/deepscient/partner/return?trade_no=<trade_no>&status=success&sign=<sign>
```

The signed string is fixed and **does not include app_id**:

```
sign = hex(hmac_sha256(app_secret, "return:" + trade_no + ":" + status))
```

Three rules:

1. **The return redirect is UX only.** The parameters can be forged, so the page does not declare activation just because `status=success`—it queries `orders/{trade_no}` once more, and only shows "activated" if the upstream `status=success`, otherwise it shows "pending confirmation".
2. The final state **is determined by the Webhook / order query**.
3. The `return_url` host must be in the partner's registered `allowed_return_hosts`. When running locally the origin is `http://127.0.0.1:3081`, which the relay cannot reach and which is not registered, so `partnerReturnUrl()` is only emitted in two cases: `CCAGENT_PARTNER_PUBLIC_BASE` is explicitly configured; or the request's `Origin` matches `Host` and it is not a loopback address. If neither holds, no `return_url` is included—one missing return button is better than failing the whole purchase.

## 8. Webhook deployment

The data endpoint only listens on loopback (`host/index.js` runs the `isLoopback` check on the `/deepscient` prefix), so the Webhook cannot be exposed directly. The approach: **a reverse proxy or tunnel forwards public HTTPS to the local loopback**, and then that public address is registered with the relay.

```
https://<public-domain>/deepscient/partner/webhook
        │  (Nginx / Caddy / frp / ngrok, any one of them)
        ▼
http://127.0.0.1:3081/deepscient/partner/webhook
```

Requirements:

- The public side must be **HTTPS**; the upstream does not accept HTTP;
- Proxy to `127.0.0.1`; do not let requests arrive from a non-loopback source address (otherwise 403);
- Return 2xx within 5 seconds;
- Do not rewrite the request body (no compression, no re-serialization); verification looks at the raw bytes;
- The default port is 3081; when it is taken the launcher moves on to 3099, so the proxy configuration must follow.

Nginx snippet (example only, no need to copy it verbatim):

```nginx
location = /deepscient/partner/webhook {
    proxy_pass         http://127.0.0.1:3081/deepscient/partner/webhook;
    proxy_http_version 1.1;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Partner-Event-Id $http_x_partner_event_id;
    proxy_set_header   X-Partner-Timestamp $http_x_partner_timestamp;
    proxy_set_header   X-Partner-Signature $http_x_partner_signature;
    proxy_request_buffering off;
    proxy_read_timeout 10s;
}
```

(Nginx passes custom request headers through by default; the three lines above are written out explicitly to guard against someone having added whitelist-style `proxy_set_header` configuration.)

For internal testing, use a temporary ngrok / frp mapping, and switch to the production domain before going live. The address is visible on the billing page under "Payment write-back address"; just take it and register it.

## 9. Error codes and their mapping in this project

| code | HTTP | Meaning | Returned by this project | Suggested handling |
| --- | --- | --- | --- | --- |
| `0` | 200 | Success | 200 | — |
| `40001` | 400 | Invalid request content | 400 `relay-bad-request` | Check the JSON, the required fields, `plan_id`/`return_url` |
| `40101` | 401 | Signature verification failed | 502 `relay-error` | Check app_id / secret / raw bytes |
| `40102` | 401 | Timestamp expired (±300s) | 502 `relay-error` | Check NTP |
| `40103` | 401 | Duplicate nonce | 502 `relay-error` | Use a new nonce for every request; do not cache signature headers |
| `40401` | 404 | Endpoint/user not found | 404 `not-found` | A normal result when the user has never been synced |
| `40403` | 404 | Order not found or not owned by this app | 404 `not-found` | No retry |
| `40901` | 409 | Resource conflict | 502 `relay-error` | Sanitize `external_uid` or contact the upstream |
| `42901` | 429 | Too many requests | 429 `relay-rate-limited` | Back off (1s/2s/4s is built in here) |
| `50001` | 500 | Upstream internal error | 502 `relay-error` | Already retried 3 times; contact the upstream if it still fails |

Two other local statuses:

- **409 `partner-not-configured`**: `error.status === 0`, meaning the request was never even sent (usually because no secret is configured). This is a local configuration problem and should not be reported as "the relay is broken".
- **502 `relay-error`**: all other upstream failures and network errors.

Every `401xx` is alerted as a "configuration or clock problem"—retrying these errors is pointless.

## 10. Security checklist

- [ ] `app_secret` exists only server-side: the environment variable or `<DSH_HOME>/science/partner-app-secret` (0600); it never enters Git, the frontend bundle or the logs.
- [ ] `app_id` may be public, but must be paired with the secret; after the secret is rotated the old value is invalid immediately.
- [ ] The user's `api_key` is stored encrypted (AES-256-GCM, key `science/partner-key` 0600), and only a mask is exposed (first 3 + last 4 in this project; short Keys are fully masked).
- [ ] Logs contain only `event_id`, `trade_no` and business codes; never the secret, signature headers or a plaintext Key.
- [ ] Servers run NTP so the signature timestamp error stays < 300 seconds (Webhook verification looks at the same window).
- [ ] A new nonce is generated for every request (16 hex characters in this project); signature headers are never cached or replayed.
- [ ] The Webhook verifies against the raw bytes and is idempotent on `event_id`; the `event_id` in the header and in the body must match.
- [ ] A passing return-redirect signature check still does not trigger fulfillment; the order query is authoritative.
- [ ] The `return_url` domain is registered; `webhook_url` is a public HTTPS address that returns 2xx within 5 seconds.
- [ ] Back off on `429`/`5xx`; alert rather than blindly retry on `401xx`.

## 11. Integration test cases

In the "How to verify in this project" column, "Billing → Relay" refers to that area of the UI; `--xxx` refers to arguments of `scripts/partner-probe.mjs`.

| # | Scenario | Action | Expected | How to verify in this project |
| --- | --- | --- | --- | --- |
| 1 | Correct signature | `GET /partner/v1/ping` | `code=0`, returns `app_id` | The "Test connectivity" button, or `--ping` (prints app_id / ts / latency) |
| 2 | Wrong signature | Tamper with `X-Partner-Signature` | HTTP 401, `code=40101` | Change one character of the secret and run `--ping`; the local endpoint maps it to 502 |
| 3 | Expired timestamp | Set `X-Partner-Timestamp` to 10 minutes ago | HTTP 401, `code=40102` | This CLI does not construct bad requests; if needed, recompute once with `signHeaders({ts})` (expected 40102 → local 502) |
| 4 | nonce replay | Send the same nonce twice in a row | The 2nd one returns 401, `code=40103` | Pin the nonce with `signHeaders({nonce})` and send twice; the local endpoint returns 502 |
| 5 | First sync | `users/sync` with a new `external_uid` | Returns `user_id`, `api_key`, `api_base_url` | The "Sync account" button, or `--sync u_probe_<timestamp> --name integration-test-user` |
| 6 | Repeated sync | Call again with the same `external_uid` | `user_id` and `api_key` match the previous call | Run the same `--sync` again and compare `userId` and `apiKeyMasked` |
| 7 | Plan query | `GET /partner/v1/plans` | 3 plans, prices `19.90/69.90/299.00` | `--plans` prints a table; or look at "Plans on sale" on the billing page |
| 8 | Generate a buy link | `buy-url` (`plan_id=1`) | Returns `url`, `expires_in=300` | `--buy <uid> --plan 1`, or "Buy" on the plan row |
| 9 | Open the purchase page | Open `url` in a browser | Shows the 3 plans, with the Lite plan selected by default | Copy the `url` printed by `--buy` into a browser (this consumes the ticket) |
| 10 | ticket reuse | Open the same link again | HTTP 410 "the link has expired" | Open the same `url` again; in the UI "Buy" issues a new ticket every time |
| 11 | Payment succeeded | Complete a WeChat Pay payment (a small test order is fine) | The return page shows "activated"; `webhook_url` receives `subscription.paid` | This version has no real payment regression yet; use "Query" under "Recent orders" to reconcile and observe `webhook.status` |
| 12 | Webhook verification | Verify the signature with `app_secret` | Passes; `data.status=success` | After a real push, check the server logs (only `event_id`/`trade_no` are logged); offline, use `verifyWebhookSignature` |
| 13 | Order query | `GET /partner/v1/orders/{trade_no}` | `status=success`, `start_time/end_time` non-zero | `--order <trade_no>`, or "Query" under "Recent orders" |
| 14 | Unauthorized query | Query that order with another app | HTTP 404, `code=40403` | Locally filtered by the current user: someone else's trade_no is a straight 404, without confirming that it exists |
| 15 | Quota page | `account-url` → open the link | Shows balance, plan, expiration time and the masked Key | `--account <uid>`, or the "My quota" button |
| 16 | Rate limiting | More than 120 requests in 1 minute | HTTP 429, `code=42901` | Looping `--ping` hits the local rate limit first (local 429 `relay-rate-limited`); exceeding the upstream limit also maps to 429 |

## 12. Integration CLI

`scripts/partner-probe.mjs` has zero dependencies and directly reuses the implementation in `host/relay.js`—**the signatures it produces are the ones the server uses**, not a separate copy.

```powershell
node deepscient\scripts\partner-probe.mjs --help
node deepscient\scripts\partner-probe.mjs --ping
node deepscient\scripts\partner-probe.mjs --plans
node deepscient\scripts\partner-probe.mjs --sync u_probe_001 --name integration-test-user
node deepscient\scripts\partner-probe.mjs --buy u_probe_001 --plan 1
node deepscient\scripts\partner-probe.mjs --account u_probe_001
node deepscient\scripts\partner-probe.mjs --order SUBUSR513NOab12CD1792591714
```

| Argument | Purpose | Output |
| --- | --- | --- |
| `--home <dir>` | Set `DSH_HOME` (used to read the local secret and `partner.json`) | — |
| `--ping` | Connectivity self-check | `app_id`, `ts`, latency |
| `--plans` | Fetch the plans on sale | Table: plan_id, title, actual price, duration, converted quota, group |
| `--sync <external_uid>` | Sync the account (optionally with `--name <display_name>`) | Binding projection: externalUid/userId/username/apiBaseUrl/apiKeyMasked |
| `--buy <external_uid>` | Exchange for a purchase page address (optionally with `--plan <id>`) | `url`, `ticket`, `expires_in` |
| `--account <external_uid>` | Exchange for a quota page address | `url` |
| `--order <trade_no>` | Query an order | Status, amount, plan, effective/expiry times, `webhook.status` |
| `--help` | Usage | — |

Behavior conventions:

- When `DSH_HOME` is not set, the script points it at `~/.deepscient`, so that it reads the same secret file as the server;
- On failure it prints `[code] message` and exits with code 1; an empty `code` means a network-layer failure;
- **It never prints a plaintext `api_key`, `app_secret` or signature headers**—if you need to check a Key, compare the masks;
- The `url` printed by `--buy` is a 300-second one-time link; do not paste it into a chat window for long-term storage.
