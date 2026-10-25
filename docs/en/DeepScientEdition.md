# DeepScient research edition: modules, account, relay

This page summarizes the DeepScient v0.2 additions on top of the general workbench: six research modules, the official website account, the ccagent relay, model API backfill, and the GitHub update source.

## Six research modules

The new-conversation home page shows six module cards driven by `jiuwenswarm/resources/science/modules.json`.

| Module | Agent group |
| --- | --- |
| Literature & Framing | `sci-literature-team` |
| Experiment Design & Execution | `sci-experiment-team` |
| Data Analysis & Reproducibility | `sci-analysis-team` |
| Paper Writing & Figures | `sci-writing-team` |
| Submission & Peer Review | `sci-submission-team` |
| Research Knowledge & Assets | `sci-knowledge-team` |

Selecting a module installs its agent group and experts idempotently, opens a Team conversation bound to that group, and prefills the module prompt. Built-in assets are shipped in `jiuwenswarm/resources/agent/workspace/plugins/` and are available offline.

## Official account

Accounts live on `deepscient.com`; the app never registers users or stores passwords.

- OAuth2 authorization code + PKCE (S256), `client_id=deepscient-desktop`
- Callback: `http://127.0.0.1:<port>/auth/callback`
- Session token is encrypted at `<data root>/auth/sessions.json`; the frontend only receives user fields and balance

Configure it under `auth` in `config.yaml`; `DEEPSCIENT_OAUTH_BASE` and `DEEPSCIENT_OAUTH_CLIENT_ID` override the defaults for testing.

## ccagent relay

The relay (default `https://un.ccagent.cn`) handles account sync, plans, purchase URLs, the quota page, payment callbacks and order reconciliation.

Set the partner secret through `CCAGENT_PARTNER_APP_SECRET` or `<data root>/science/partner-app-secret` (0600). The secret is server-only and is never sent to the browser or written to logs.

Local endpoints: `/api/v1/partner/{status,ping,sync,buy-url,account-url,binding,orders/{trade_no}}`. Public endpoints: `POST /partner/webhook` and `GET /partner/return`. Account sync runs silently after login; failures do not block login.

## Model API backfill

A successful sync returns `api_key` and `api_base_url`. The app writes a `ccagent` model provider entry (`vendor_key=ccagent`, `plan=custom_api`, `client_provider=OpenAI`, `endpoint_profile=openai_compatible`) through the existing encrypted model-config path. The UI only shows a masked key. Existing entries bound to another account are not overwritten without confirmation.

## Update source

Updates come from GitHub Releases in `yzlin286-wq/Deepscient`. Expected assets:

- `DeepScient-{version}-macos.dmg`
- `DeepScient-{version}-windows.exe`
- `DeepScient-{version}.tar.gz`

`GITHUB_TOKEN` or `DEEPSCIENT_GITHUB_TOKEN` may be set to raise the GitHub API rate limit; tokens never appear in logs, status payloads, or the frontend.
