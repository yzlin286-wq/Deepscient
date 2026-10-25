# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""Gateway 中转站路由：会话鉴权、错误映射、Webhook 幂等。"""

from __future__ import annotations

import hashlib
import hmac
import json
import time

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

from jiuwenswarm.common import config as app_config
from jiuwenswarm.common.auth.deepscient_oauth import Credential
from jiuwenswarm.common.auth.session_store import AuthSession
from jiuwenswarm.common.partner import client as partner_client
from jiuwenswarm.common.partner import config as config_mod
from jiuwenswarm.common.partner import model_backfill
from jiuwenswarm.gateway.channel_manager.web import web_http_partner

SECRET = "unit-test-app-secret"
APP_ID = "app_ccagent_prod"
BASE = "https://relay.test"
SESSION_ID = "partner-session-1"
USER_ID = "u_1"


class _Response:
    def __init__(self, status_code: int = 200, payload: object = None) -> None:
        self.status_code = status_code
        self.text = "" if payload is None else json.dumps(payload)


class _FakeRelay:
    """按 ``(method, path)`` 回包；订单路径允许用模板键匹配。"""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.routes: dict[tuple[str, str], _Response] = {}

    def add(self, method: str, path: str, payload: object, status: int = 200) -> None:
        self.routes[(method, path)] = _Response(status, payload)

    def __call__(self, method: str, url: str, **kwargs):
        path = url[len(BASE) :].split("?")[0]
        self.calls.append({"method": method, "path": path, "url": url, **kwargs})
        response = self.routes.get((method, path))
        if response is None and path.startswith("/partner/v1/orders/"):
            response = self.routes.get((method, "/partner/v1/orders/{trade_no}"))
        if response is None:
            raise AssertionError(f"unexpected request: {method} {path}")
        return response


class _StubAuthService:
    def __init__(self, session: AuthSession) -> None:
        self._session = session

    def resolve_session(self, session_id: str | None) -> AuthSession | None:
        return self._session if session_id == self._session.session_id else None


@pytest.fixture
def session() -> AuthSession:
    now = time.time()
    return AuthSession(
        session_id=SESSION_ID,
        user_id=USER_ID,
        user_name="Alice",
        credential=Credential(access_token="token", expires_at=now + 3600),
        created_at=now,
        updated_at=now,
    )


@pytest.fixture
def relay(monkeypatch, tmp_path) -> _FakeRelay:
    fake = _FakeRelay()
    monkeypatch.setattr(partner_client, "requests_request", fake)
    monkeypatch.setattr(partner_client, "_plans_cache", {"at": 0.0, "items": []})
    monkeypatch.setattr(config_mod, "data_root", lambda: tmp_path)
    monkeypatch.setattr(config_mod, "_partner_section", lambda: {"base_url": BASE})
    # 账号同步会顺手回填 models.defaults：必须把配置写盘改到临时目录，
    # 否则用例会写到真实的 ~/.jiuwenswarm/config.yaml。
    config_path = tmp_path / "config.yaml"
    config_path.write_text("models:\n  defaults: []\n", encoding="utf-8")
    monkeypatch.setattr(app_config, "CONFIG_YAML_PATH", config_path)
    # 模型下发要求加密组件可用；网关用例不启动扩展注册表，用可识别的假密文代替。
    monkeypatch.setattr(model_backfill, "_encrypt_api_key", lambda plain: f"cipher::{plain}")
    return fake


def _client(monkeypatch, session: AuthSession, *, secret: str | None = SECRET) -> TestClient:
    if secret is None:
        monkeypatch.delenv(config_mod.SECRET_ENV, raising=False)
        # 仓库里可能残留构建时的内置密钥；「未配置」用例必须隔离掉它。
        monkeypatch.setattr(config_mod, "_read_bundled_secret", lambda: "")
    else:
        monkeypatch.setenv(config_mod.SECRET_ENV, secret)
    monkeypatch.setattr(
        web_http_partner, "get_auth_service", lambda: _StubAuthService(session)
    )
    app = FastAPI()
    web_http_partner.register_partner_routes(app)
    return TestClient(app)


def _headers() -> dict[str, str]:
    return {"X-Auth-Session": SESSION_ID}


def _webhook_headers(body: bytes, event_id: str) -> dict[str, str]:
    ts = str(int(time.time()))
    digest = hashlib.sha256(body).hexdigest()
    signature = hmac.new(
        SECRET.encode("utf-8"),
        f"{APP_ID}\n{ts}\n{event_id}\n{digest}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Partner-App-Id": APP_ID,
        "X-Partner-Timestamp": ts,
        "X-Partner-Event-Id": event_id,
        "X-Partner-Signature": signature,
    }


def test_status_requires_login(monkeypatch, session, relay):
    client = _client(monkeypatch, session)

    response = client.get("/api/v1/partner/status")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_logged_in"


def test_ping_without_secret_is_409(monkeypatch, session, relay):
    client = _client(monkeypatch, session, secret=None)

    response = client.post("/api/v1/partner/ping", headers=_headers())

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "partner-not-configured"
    assert relay.calls == []


def test_status_sync_and_buy_url(monkeypatch, session, relay):
    relay.add(
        "GET",
        "/partner/v1/plans",
        {
            "code": 0,
            "data": [
                {
                    "plan_id": 1,
                    "title": "轻享版",
                    "amount": "19.90",
                    "duration_days": 30,
                    "quota": "100万 tokens",
                }
            ],
        },
    )
    relay.add(
        "POST",
        "/partner/v1/users/sync",
        {
            "code": 0,
            "data": {
                "user_id": 7,
                "username": "alice",
                "api_key": "sk-test-1234567890",
                "api_base_url": "https://api.ccagent.test",
            },
        },
    )
    relay.add(
        "POST",
        "/partner/v1/buy-url",
        {"code": 0, "data": {"url": "https://pay.test/1", "ticket": "t1", "expires_in": 300}},
    )
    client = _client(monkeypatch, session)
    monkeypatch.setattr(
        model_backfill,
        "requests_request",
        _ModelsFetcher(200, {"data": [{"id": "deepseek-chat"}]}),
    )

    status = client.get("/api/v1/partner/status", headers=_headers())
    assert status.status_code == 200, status.text
    body = status.json()
    assert body["configured"] is True
    assert body["secretPresent"] is True
    assert body["secretSource"] == "env"
    assert body["appId"] == APP_ID
    assert body["base"] == BASE
    assert body["plans"][0]["plan_id"] == 1
    assert body["binding"] is None
    assert body["orders"] == []
    # 状态接口绝不回 secret
    assert SECRET not in status.text

    synced = client.post(
        "/api/v1/partner/sync", headers=_headers(), json={"displayName": "Alice"}
    )
    assert synced.status_code == 200, synced.text
    binding = synced.json()["binding"]
    assert binding["externalUid"] == USER_ID
    assert binding["userId"] == 7
    assert binding["username"] == "alice"
    assert binding["apiKeyMasked"] == "sk-•••7890"
    assert binding["hasKey"] is True
    assert "sk-test-1234567890" not in synced.text

    stored = (config_mod.data_root() / "science" / "partner.json").read_text(encoding="utf-8")
    assert "sk-test-1234567890" not in stored
    assert "sk-•••7890" in stored

    bought = client.post("/api/v1/partner/buy-url", headers=_headers(), json={"planId": 1})
    assert bought.status_code == 200, bought.text
    assert bought.json()["url"] == "https://pay.test/1"
    buy_call = [call for call in relay.calls if call["path"] == "/partner/v1/buy-url"][-1]
    assert json.loads(buy_call["data"]) == {"external_uid": USER_ID, "plan_id": 1}


def test_order_of_another_user_is_404(monkeypatch, session, relay):
    relay.add(
        "GET",
        "/partner/v1/orders/{trade_no}",
        {
            "code": 0,
            "data": {
                "trade_no": "T-other",
                "external_uid": "u_other",
                "status": "success",
                "amount": "19.90",
            },
        },
    )
    client = _client(monkeypatch, session)

    response = client.get("/api/v1/partner/orders/T-other", headers=_headers())

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not-found"


def test_webhook_without_secret_is_503(monkeypatch, session, relay):
    client = _client(monkeypatch, session, secret=None)
    body = b'{"event_id":"evt_1"}'

    response = client.post("/partner/webhook", content=body, headers=_webhook_headers(body, "evt_1"))

    assert response.status_code == 503
    assert response.json()["error"] == "partner-not-configured"


def test_webhook_rejects_oversized_body(monkeypatch, session, relay):
    client = _client(monkeypatch, session)

    response = client.post("/partner/webhook", content=b"x" * (512 * 1024 + 1))

    assert response.status_code == 413
    assert response.json()["error"] == "payload-too-large"


def test_webhook_is_idempotent_on_event_id(monkeypatch, session, relay):
    client = _client(monkeypatch, session)
    payload = {
        "event": "subscription.paid",
        "event_id": "evt_paid_1",
        "occurred_at": "2026-01-01T00:00:00Z",
        "data": {
            "trade_no": "T-paid-1",
            "external_uid": USER_ID,
            "user_id": 7,
            "status": "success",
            "plan_id": 1,
            "plan_title": "轻享版",
            "amount": "19.90",
            "currency": "CNY",
        },
    }
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    headers = _webhook_headers(body, "evt_paid_1")

    first = client.post("/partner/webhook", content=body, headers=headers)
    second = client.post("/partner/webhook", content=body, headers=headers)

    assert first.status_code == 200
    assert first.json() == {"ok": True, "duplicate": False}
    assert second.status_code == 200
    assert second.json() == {"ok": True, "duplicate": True}

    stored = json.loads(
        (config_mod.data_root() / "science" / "partner.json").read_text(encoding="utf-8")
    )
    assert stored["orders"]["T-paid-1"]["status"] == "success"
    assert stored["events"]["evt_paid_1"]["tradeNo"] == "T-paid-1"
    assert "api_key" not in json.dumps(stored)


def test_webhook_rejects_a_bad_signature(monkeypatch, session, relay):
    client = _client(monkeypatch, session)
    body = b'{"event_id":"evt_1"}'
    headers = _webhook_headers(body, "evt_1")
    headers["X-Partner-Signature"] = "f" * 64

    response = client.post("/partner/webhook", content=body, headers=headers)

    assert response.status_code == 400
    assert response.json()["error"] == "bad-signature"


# ── 模型回填 / 模型拉取 ────────────────────────────────────────────────────

_SYNC_DATA = {
    "user_id": 7,
    "username": "alice",
    "api_key": "sk-test-1234567890",
    "api_base_url": "https://api.ccagent.test/v1",
}


def _add_sync(relay: _FakeRelay) -> None:
    relay.add("POST", "/partner/v1/users/sync", {"code": 0, "data": dict(_SYNC_DATA)})


def _config_path(tmp_path):
    return tmp_path / "config.yaml"


def _seed_defaults(tmp_path, entries) -> None:
    _config_path(tmp_path).write_text(
        yaml.safe_dump({"models": {"defaults": entries}}, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )


def test_backfill_model_requires_login(monkeypatch, session, relay):
    client = _client(monkeypatch, session)

    response = client.post("/api/v1/partner/backfill-model", json={})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_logged_in"
    assert relay.calls == []


def test_backfill_model_creates_entry(monkeypatch, session, relay, tmp_path):
    _add_sync(relay)
    client = _client(monkeypatch, session)

    response = client.post(
        "/api/v1/partner/backfill-model",
        headers=_headers(),
        json={"modelName": "deepseek-reasoner"},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    assert body["applied"] is True
    assert body["reason"] == "created"
    assert body["modelName"] == "deepseek-reasoner"
    assert body["masked"] == "sk-•••7890"
    assert body["binding"]["apiKeyMasked"] == "sk-•••7890"
    assert "sk-test-1234567890" not in response.text

    defaults = yaml.safe_load(_config_path(tmp_path).read_text(encoding="utf-8"))["models"]["defaults"]
    assert len(defaults) == 1
    mcc = defaults[0]["model_client_config"]
    assert mcc["vendor_key"] == "ccagent"
    assert mcc["model_name"] == "deepseek-reasoner"
    assert mcc["api_base"] == "https://api.ccagent.test/v1"


def test_backfill_model_conflict_then_force(monkeypatch, session, relay, tmp_path):
    _add_sync(relay)
    client = _client(monkeypatch, session)
    _seed_defaults(
        tmp_path,
        [
            {
                "model_client_config": {
                    "api_base": "https://other.test/v1",
                    "api_key": "other-key-123456",
                    "model_name": "other-model",
                    "client_provider": "OpenAI",
                    "vendor_key": "ccagent",
                    "plan": "custom_api",
                    "endpoint_profile": "openai_compatible",
                },
                "model_config_obj": {"partner_external_uid": "u_other"},
                "is_default": True,
            }
        ],
    )

    conflict = client.post("/api/v1/partner/backfill-model", headers=_headers(), json={})

    assert conflict.status_code == 200, conflict.text
    assert conflict.json()["applied"] is False
    assert conflict.json()["reason"] == "conflict"
    unchanged = yaml.safe_load(_config_path(tmp_path).read_text(encoding="utf-8"))["models"]["defaults"]
    assert unchanged[0]["model_config_obj"]["partner_external_uid"] == "u_other"

    forced = client.post(
        "/api/v1/partner/backfill-model", headers=_headers(), json={"force": True}
    )

    assert forced.status_code == 200, forced.text
    assert forced.json()["applied"] is True
    assert forced.json()["reason"] == "overridden"
    overwritten = yaml.safe_load(_config_path(tmp_path).read_text(encoding="utf-8"))["models"]["defaults"]
    assert overwritten[0]["model_config_obj"]["partner_external_uid"] == USER_ID


def test_sync_provisions_models(monkeypatch, session, relay):
    _add_sync(relay)
    fetcher = _ModelsFetcher(
        200, {"data": [{"id": "deepseek-chat"}, {"id": "deepseek-reasoner"}]}
    )
    monkeypatch.setattr(model_backfill, "requests_request", fetcher)
    client = _client(monkeypatch, session)

    response = client.post("/api/v1/partner/sync", headers=_headers(), json={})

    assert response.status_code == 200, response.text
    provision = response.json()["binding"]["modelProvision"]
    assert provision["applied"] is True
    assert provision["modelCount"] == 2
    assert provision["modelNames"] == ["deepseek-chat", "deepseek-reasoner"]
    assert provision["defaultModel"] in provision["modelNames"]
    assert provision["maskedKey"] == "sk-•••7890"
    assert provision["apiBaseUrl"] == "https://api.ccagent.test/v1"
    assert "sk-test-1234567890" not in response.text


class _ModelsFetcher:
    def __init__(self, status: int = 200, payload: object = None) -> None:
        self.status = status
        self.payload = payload
        self.calls: list[dict] = []

    def __call__(self, method: str, url: str, **kwargs):
        self.calls.append({"method": method, "url": url, **kwargs})
        return _Response(self.status, self.payload)


def test_models_endpoint_returns_candidates(monkeypatch, session, relay):
    _add_sync(relay)
    fetcher = _ModelsFetcher(
        200, {"data": [{"id": "deepseek-chat"}, {"id": "deepseek-reasoner"}]}
    )
    monkeypatch.setattr(model_backfill, "requests_request", fetcher)
    client = _client(monkeypatch, session)

    response = client.post("/api/v1/partner/models", headers=_headers(), json={})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["models"] == ["deepseek-chat", "deepseek-reasoner"]
    assert body["apiBaseUrl"] == "https://api.ccagent.test/v1"
    assert fetcher.calls[0]["url"] == "https://api.ccagent.test/v1/models"
    assert fetcher.calls[0]["headers"]["Authorization"] == "Bearer sk-test-1234567890"
    assert "sk-test-1234567890" not in response.text


def test_models_endpoint_maps_upstream_failure(monkeypatch, session, relay):
    _add_sync(relay)
    monkeypatch.setattr(
        model_backfill, "requests_request", _ModelsFetcher(503, {"message": "boom"})
    )
    client = _client(monkeypatch, session)

    response = client.post("/api/v1/partner/models", headers=_headers(), json={})

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "relay-error"


def test_models_endpoint_requires_login(monkeypatch, session, relay):
    client = _client(monkeypatch, session)

    response = client.post("/api/v1/partner/models", json={})

    assert response.status_code == 401
    assert relay.calls == []


# ── 模型刷新 ──────────────────────────────────────────────────────────────


def test_refresh_models_requires_login(monkeypatch, session, relay):
    client = _client(monkeypatch, session)

    response = client.post("/api/v1/partner/refresh-models", json={})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_logged_in"
    assert relay.calls == []


def test_refresh_models_provisions_all_models(monkeypatch, session, relay, tmp_path):
    _add_sync(relay)
    fetcher = _ModelsFetcher(
        200, {"data": [{"id": "deepseek-chat"}, {"id": "deepseek-reasoner"}]}
    )
    monkeypatch.setattr(model_backfill, "requests_request", fetcher)
    client = _client(monkeypatch, session)

    response = client.post("/api/v1/partner/refresh-models", headers=_headers(), json={})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["ok"] is True
    provision = body["modelProvision"]
    assert provision["applied"] is True
    assert provision["modelCount"] == 2
    assert provision["modelNames"] == ["deepseek-chat", "deepseek-reasoner"]
    assert provision["defaultModel"] in provision["modelNames"]
    assert provision["apiBaseUrl"] == "https://api.ccagent.test/v1"
    assert provision["maskedKey"] == "sk-•••7890"
    assert body["binding"]["modelProvision"]["modelCount"] == 2
    assert "sk-test-1234567890" not in response.text

    assert fetcher.calls[0]["url"] == "https://api.ccagent.test/v1/models"
    assert fetcher.calls[0]["headers"]["Authorization"] == "Bearer sk-test-1234567890"

    defaults = yaml.safe_load(_config_path(tmp_path).read_text(encoding="utf-8"))["models"]["defaults"]
    assert len(defaults) == 2
    assert [entry["model_client_config"]["model_name"] for entry in defaults] == [
        "deepseek-chat",
        "deepseek-reasoner",
    ]
    assert all(entry["model_client_config"]["vendor_key"] == "ccagent" for entry in defaults)


def test_refresh_models_failure_keeps_existing_entries(
    monkeypatch, session, relay, tmp_path
):
    _add_sync(relay)
    sentinel = [
        {
            "model_client_config": {
                "api_base": "https://api.ccagent.test/v1",
                "api_key": "cipher::old",
                "model_name": "deepseek-chat",
                "client_provider": "OpenAI",
                "vendor_key": "ccagent",
            },
            "model_config_obj": {"partner_external_uid": USER_ID},
            "is_default": True,
        }
    ]
    _seed_defaults(tmp_path, sentinel)
    monkeypatch.setattr(
        model_backfill, "requests_request", _ModelsFetcher(503, {"message": "boom"})
    )
    client = _client(monkeypatch, session)

    response = client.post("/api/v1/partner/refresh-models", headers=_headers(), json={})

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "relay-error"
    defaults = yaml.safe_load(_config_path(tmp_path).read_text(encoding="utf-8"))["models"]["defaults"]
    assert defaults == sentinel
