# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.
from __future__ import annotations

import base64
import hashlib
import json
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from jiuwenswarm.common.auth import deepscient_oauth as oauth
from jiuwenswarm.common.auth import service as service_mod
from jiuwenswarm.common.auth import session_store as store_mod
from jiuwenswarm.common.auth.deepscient_oauth import DeepScientOAuthConfig, DeepScientOAuthFlow
from jiuwenswarm.common.auth.service import AuthService
from jiuwenswarm.gateway.channel_manager.web import web_http_auth

BASE = "https://deepscient.test"
ORIGIN = "http://127.0.0.1:19000"
ACCESS_TOKEN = "ACCESS-TOKEN-LEAK"


class _Response:

    def __init__(self, status_code: int = 200, payload: object = None) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


class _FakeHttp:

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.token_status = 200
        self.token_payload: dict = {
            "access_token": ACCESS_TOKEN,
            "refresh_token": "REFRESH-LEAK",
            "expires_in": 3600,
            "user": {
                "id": 42,
                "username": "alice",
                "email": "alice@example.com",
                "role": "admin",
                "balance": 12.5,
            },
        }
        self.userinfo_status = 200
        self.userinfo_payload: dict = {
            "user": {"id": 42, "username": "alice", "email": "new@example.com", "balance": 99}
        }

    def __call__(self, method: str, url: str, **kwargs):
        self.calls.append({"method": method, "url": url, **kwargs})
        if method == "GET" and url.endswith("/.well-known/deepscient-oauth"):
            return _Response(404, {})
        if method == "POST" and url == f"{BASE}/api/oauth/token":
            return _Response(self.token_status, self.token_payload)
        if method == "GET" and url == f"{BASE}/api/oauth/userinfo":
            return _Response(self.userinfo_status, self.userinfo_payload)
        if method == "POST" and url == f"{BASE}/api/oauth/revoke":
            return _Response(200, {"ok": True})
        raise AssertionError(f"unexpected request: {method} {url}")

    def posts(self) -> list[dict]:
        return [call for call in self.calls if call["method"] == "POST"]


@pytest.fixture
def http(monkeypatch) -> _FakeHttp:
    fake = _FakeHttp()
    monkeypatch.setattr(oauth, "requests_request", fake)
    return fake


def _make_client(tmp_path, monkeypatch, http: _FakeHttp, *, provider: str = "deepscient") -> TestClient:
    monkeypatch.setattr(store_mod, "auth_dir", lambda: tmp_path)
    flow = DeepScientOAuthFlow(
        DeepScientOAuthConfig(base_url=BASE, provider=provider)
    )
    service = AuthService(flow=flow, store=store_mod.AuthSessionStore())
    monkeypatch.setattr(service_mod, "_service", service)
    monkeypatch.setattr(web_http_auth, "get_auth_service", lambda: service)

    app = FastAPI()
    web_http_auth.register_auth_routes(app)
    return TestClient(app, headers={web_http_auth.AUTH_REQUEST_HEADER: "1"})


@pytest.fixture
def client(tmp_path, monkeypatch, http) -> TestClient:
    return _make_client(tmp_path, monkeypatch, http)


def _authorize(client, origin: str = ORIGIN) -> dict:
    response = client.post("/api/v1/auth/authorize", headers={"Origin": origin})
    assert response.status_code == 200, response.text
    return response.json()


def _callback(client, state: str, path: str = "/api/v1/auth/callback", **params):
    return client.get(path, params={"state": state, **params})


def _claim(client, started: dict, claim_token: str | None = None):
    return client.post(
        "/api/v1/auth/claim",
        json={"state": started["state"], "claimToken": claim_token or started["claimToken"]},
    )


def test_authorize_builds_the_deepscient_url(client):
    started = _authorize(client)
    url = urlparse(started["authorizeUrl"])
    query = {key: value[0] for key, value in parse_qs(url.query).items()}
    assert f"{url.scheme}://{url.netloc}{url.path}" == f"{BASE}/oauth/authorize"
    assert query["client_id"] == "deepscient-desktop"
    assert query["redirect_uri"] == f"{ORIGIN}/auth/callback"
    assert query["state"] == started["state"]
    assert query["code_challenge_method"] == "S256"
    assert started["redirectUri"] == f"{ORIGIN}/auth/callback"
    assert started["claimToken"] not in started["authorizeUrl"]
    challenge = query["code_challenge"]
    verifier = started["claimToken"]  # 只用来确认两者不相等；verifier 在服务端
    assert challenge and verifier


def test_authorize_derives_origin_from_referer(client):
    response = client.post(
        "/api/v1/auth/authorize", headers={"Referer": f"{ORIGIN}/chat?session=1"}
    )
    assert response.status_code == 200
    assert response.json()["redirectUri"] == f"{ORIGIN}/auth/callback"


def test_authorize_falls_back_to_loopback_without_origin_or_referer(client):
    response = client.post("/api/v1/auth/authorize")
    assert response.status_code == 200
    assert response.json()["redirectUri"] == "http://127.0.0.1:80/auth/callback"


def test_login_disabled_returns_404(tmp_path, monkeypatch, http):
    client = _make_client(tmp_path, monkeypatch, http, provider="off")
    assert client.post("/api/v1/auth/authorize").status_code == 404
    body = client.get("/api/v1/auth/status").json()
    assert body["enabled"] is False
    assert body["islogin"] is False


def test_full_login_flow(client, http):
    started = _authorize(client)
    assert _claim(client, started).status_code == 202

    landing = _callback(client, started["state"], code="auth-code-1")
    assert landing.status_code == 200
    assert "text/html" in landing.headers["content-type"]
    assert "jiuwenswarm_auth=" in landing.headers.get("set-cookie", "")
    assert landing.headers["cache-control"] == "no-store"
    assert web_http_auth.AUTH_CALLBACK_MESSAGE in landing.text
    assert web_http_auth.AUTH_CALLBACK_CHANNEL in landing.text
    assert "Secure" not in landing.headers["set-cookie"]

    token_call = http.posts()[0]
    assert token_call["url"] == f"{BASE}/api/oauth/token"
    body = token_call["json"]
    assert body["grant_type"] == "authorization_code"
    assert body["client_id"] == "deepscient-desktop"
    assert body["code"] == "auth-code-1"
    assert body["redirect_uri"] == f"{ORIGIN}/auth/callback"

    claimed = _claim(client, started)
    assert claimed.status_code == 200
    payload = claimed.json()
    assert payload["ok"] is True
    assert payload["islogin"] is True
    assert payload["provider"] == "deepscient"
    assert payload["userId"] == "42"
    assert payload["userName"] == "alice"
    assert payload["email"] == "alice@example.com"
    assert payload["role"] == "admin"
    assert payload["balance"] == 12.5
    assert payload["expiresAt"] > 0
    session_id = claimed.headers["X-Auth-Session"]
    assert f"jiuwenswarm_auth={session_id}" in claimed.headers.get("set-cookie", "")

    assert _claim(client, started).status_code == 400

    status = client.get("/api/v1/auth/status", headers={"X-Auth-Session": session_id}).json()
    assert status["islogin"] is True
    assert status["userId"] == "42"
    assert status["accountCenterUrl"] == "https://deepscient.com"
    assert status["registerUrl"] == "https://deepscient.com"

    for text in (landing.text, claimed.text, json.dumps(status)):
        assert ACCESS_TOKEN not in text and "REFRESH-LEAK" not in text


def test_callback_also_served_on_root_path(client, http):
    started = _authorize(client)
    landing = _callback(client, started["state"], path="/auth/callback", code="c")
    assert landing.status_code == 200
    assert _claim(client, started).status_code == 200


def test_status_without_session_is_logged_out(client):
    body = client.get("/api/v1/auth/status").json()
    assert body == {
        "enabled": True,
        "provider": "deepscient",
        "accountCenterUrl": "https://deepscient.com",
        "registerUrl": "https://deepscient.com",
        "islogin": False,
        "userId": None,
    }


def test_wrong_claim_token_is_rejected_without_burning_the_login(client):
    started = _authorize(client)
    _callback(client, started["state"], code="c")

    bad = _claim(client, started, claim_token="guessed")
    assert bad.status_code == 400
    assert bad.json()["error"]["code"] == "oauth_state_invalid"
    assert _claim(client, started).status_code == 200


def test_unknown_state_gets_a_neutral_page_and_no_exchange(client, http):
    landing = _callback(client, "not-a-real-state", code="c")
    assert landing.status_code == 400
    assert "登录链接已失效" in landing.text
    assert http.posts() == []


def test_user_denies_authorization(client, http):
    started = _authorize(client)
    landing = _callback(client, started["state"], error="access_denied")
    assert landing.status_code == 400

    claimed = _claim(client, started)
    assert claimed.status_code == 400
    assert claimed.json()["error"]["code"] == "oauth_access_denied"


def test_error_description_reaches_the_claimer(client):
    started = _authorize(client)
    landing = _callback(client, started["state"], error="server_error", error_description="boom")
    assert landing.status_code == 400
    assert "boom" in landing.text
    message = _claim(client, started).json()["error"]["message"]
    assert "server_error" in message and "boom" in message


def test_token_exchange_failure_reaches_the_claimer(client, http):
    http.token_status = 400
    http.token_payload = {"error": "invalid_grant"}
    started = _authorize(client)
    assert _callback(client, started["state"], code="c").status_code == 400
    claimed = _claim(client, started)
    assert claimed.status_code == 400
    assert claimed.json()["error"]["code"] == "oauth_token_exchange_failed"


def test_replayed_callback_does_not_exchange_twice(client, http):
    started = _authorize(client)
    assert _callback(client, started["state"], code="c").status_code == 200
    assert _callback(client, started["state"], code="c").status_code == 400
    assert len(http.posts()) == 1
    assert _claim(client, started).status_code == 200


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", "/api/v1/auth/authorize", None),
        ("post", "/api/v1/auth/claim", {"state": "s", "claimToken": "t"}),
        ("post", "/api/v1/auth/cancel", {"state": "s", "claimToken": "t"}),
        ("post", "/api/v1/auth/logout", None),
    ],
)
def test_state_changing_routes_require_the_auth_header(client, method, path, body):
    response = getattr(client, method)(path, json=body, headers={web_http_auth.AUTH_REQUEST_HEADER: ""})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "auth_header_required"


def test_cancelled_login_can_no_longer_be_claimed(client, http):
    started = _authorize(client)
    response = client.post("/api/v1/auth/cancel", json={"state": started["state"], "claimToken": "wrong"})
    assert response.status_code == 200
    assert _claim(client, started).status_code == 202

    response = client.post(
        "/api/v1/auth/cancel", json={"state": started["state"], "claimToken": started["claimToken"]}
    )
    assert response.status_code == 200
    assert _callback(client, started["state"], code="c").status_code == 400
    assert http.posts() == []
    assert _claim(client, started).json()["error"]["code"] == "oauth_state_invalid"


def test_non_ascii_claim_token_is_not_a_server_error(client):
    started = _authorize(client)
    body = {"state": started["state"], "claimToken": "令牌"}
    assert client.post("/api/v1/auth/cancel", json=body).status_code == 200
    assert client.post("/api/v1/auth/claim", json=body).status_code == 400
    assert _claim(client, started).status_code == 202


def test_session_cookie_is_secure_over_https(client):
    started = _authorize(client)
    _callback(client, started["state"], code="c")
    claimed = client.post(
        "https://testserver/api/v1/auth/claim",
        json={"state": started["state"], "claimToken": started["claimToken"]},
    )
    assert claimed.status_code == 200
    assert "Secure" in claimed.headers["set-cookie"]


def test_landing_page_escapes_error_text(client):
    started = _authorize(client)
    landing = _callback(client, started["state"], error="<img src=x onerror=alert(1)>")
    assert "<img src=x" not in landing.text
    assert "&lt;img src=x" in landing.text


def test_logout_revokes_and_clears_session(client, http):
    started = _authorize(client)
    _callback(client, started["state"], code="c")
    session_id = _claim(client, started).headers["X-Auth-Session"]

    response = client.post("/api/v1/auth/logout", headers={"X-Auth-Session": session_id})
    assert response.json()["islogin"] is False
    assert 'jiuwenswarm_auth=""' in response.headers.get("set-cookie", "")
    revoke = [call for call in http.posts() if call["url"].endswith("/api/oauth/revoke")]
    assert len(revoke) == 1
    assert revoke[0]["json"] == {"token": ACCESS_TOKEN}
    assert client.get("/api/v1/auth/status", headers={"X-Auth-Session": session_id}).json()["islogin"] is False


def test_logout_without_session_does_nothing(client):
    assert client.post("/api/v1/auth/logout").status_code == 200


def test_refresh_requires_a_session(client):
    response = client.post("/api/v1/auth/refresh")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "not_logged_in"


def test_refresh_updates_user_fields(client):
    started = _authorize(client)
    _callback(client, started["state"], code="c")
    session_id = _claim(client, started).headers["X-Auth-Session"]

    response = client.post("/api/v1/auth/refresh", headers={"X-Auth-Session": session_id})
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "new@example.com"
    assert body["balance"] == 99


def test_refresh_401_from_upstream_clears_the_session(client, http):
    started = _authorize(client)
    _callback(client, started["state"], code="c")
    session_id = _claim(client, started).headers["X-Auth-Session"]

    http.userinfo_status = 401
    response = client.post("/api/v1/auth/refresh", headers={"X-Auth-Session": session_id})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "oauth_unauthorized"
    assert client.get("/api/v1/auth/status", headers={"X-Auth-Session": session_id}).json()["islogin"] is False


def test_models_and_quota_routes_are_gone(client):
    assert client.get("/api/v1/auth/models").status_code == 404
    assert client.get("/api/v1/auth/quota").status_code == 404


def test_pkce_challenge_matches_the_verifier_used_in_exchange(client, http):
    started = _authorize(client)
    query = parse_qs(urlparse(started["authorizeUrl"]).query)
    _callback(client, started["state"], code="c")

    verifier = http.posts()[0]["json"]["code_verifier"]
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    expected = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    assert query["code_challenge"] == [expected]
