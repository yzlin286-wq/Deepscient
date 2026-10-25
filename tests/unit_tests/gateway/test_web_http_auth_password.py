# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""``/api/v1/auth/password-login`` 与 ``/api/v1/auth/resend-verification`` 路由。"""

from __future__ import annotations

import contextlib
import json
import logging

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
ACCESS_TOKEN = "PASSWORD-ACCESS-TOKEN-LEAK"
#: 只在本测试里存在的口令，用来搜日志与落盘内容。
SECRET = "unit-test-password-7b2e4d"

SUCCESS_BODY = {
    "ok": True,
    "token_type": "Bearer",
    "access_token": ACCESS_TOKEN,
    "expires_in": 2592000,
    "user": {
        "id": 42,
        "username": "alice",
        "email": "alice@example.com",
        "email_verified": True,
        "role": "admin",
        "balance": 12.5,
        "created_at": "2026-01-01T00:00:00Z",
        "disabled": False,
    },
}


class _Response:

    def __init__(
        self, status_code: int = 200, payload: object = None, headers: dict | None = None
    ) -> None:
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def json(self):
        return self._payload


class _FakeHttp:

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.token_response = _Response(200, dict(SUCCESS_BODY))
        self.resend_response = _Response(200, {"ok": True, "resend_after": 60})

    def __call__(self, method: str, url: str, **kwargs):
        self.calls.append({"method": method, "url": url, **kwargs})
        if method == "GET" and url.endswith("/.well-known/deepscient-oauth"):
            return _Response(404, {})
        if method == "POST" and url == f"{BASE}/api/oauth/token":
            return self.token_response
        if method == "POST" and url == f"{BASE}/api/auth/verify-email/resend":
            return self.resend_response
        raise AssertionError(f"unexpected request: {method} {url}")

    def posts(self) -> list[dict]:
        return [call for call in self.calls if call["method"] == "POST"]


@pytest.fixture
def http(monkeypatch) -> _FakeHttp:
    fake = _FakeHttp()
    monkeypatch.setattr(oauth, "requests_request", fake)
    return fake


def _make_client(
    tmp_path, monkeypatch, *, provider: str = "deepscient"
) -> TestClient:
    monkeypatch.setattr(store_mod, "auth_dir", lambda: tmp_path)
    flow = DeepScientOAuthFlow(DeepScientOAuthConfig(base_url=BASE, provider=provider))
    service = AuthService(flow=flow, store=store_mod.AuthSessionStore())
    monkeypatch.setattr(service_mod, "_service", service)
    monkeypatch.setattr(web_http_auth, "get_auth_service", lambda: service)

    app = FastAPI()
    web_http_auth.register_auth_routes(app)
    return TestClient(app, headers={web_http_auth.AUTH_REQUEST_HEADER: "1"})


@pytest.fixture
def client(tmp_path, monkeypatch, http) -> TestClient:
    return _make_client(tmp_path, monkeypatch)


def _login(client, username: str = "alice@example.com", password: str = SECRET):
    return client.post(
        "/api/v1/auth/password-login",
        json={"username": username, "password": password},
    )


@contextlib.contextmanager
def _collect_logs(level: int = logging.DEBUG):
    """``jiuwenswarm`` 这一层 propagate=False，caplog 抓不到，直接挂 handler。"""
    logger = logging.getLogger("jiuwenswarm")
    records: list[logging.LogRecord] = []

    class _Collect(logging.Handler):
        def emit(self, record):
            records.append(record)

    handler = _Collect(level)
    original = logger.level
    logger.setLevel(level)
    logger.addHandler(handler)
    try:
        yield records
    finally:
        logger.removeHandler(handler)
        logger.setLevel(original)


def test_password_login_creates_a_session(client, http):
    response = _login(client)
    assert response.status_code == 200, response.text

    sent = http.posts()[0]
    assert sent["url"] == f"{BASE}/api/oauth/token"
    assert sent["timeout"] == 10.0
    assert sent["json"] == {
        "grant_type": "password",
        "client_id": "deepscient-desktop",
        "username": "alice@example.com",
        "password": SECRET,
    }

    body = response.json()
    assert body["ok"] is True
    assert body["islogin"] is True
    assert body["provider"] == "deepscient"
    assert body["userId"] == "42"
    assert body["userName"] == "alice"
    assert body["email"] == "alice@example.com"
    assert body["role"] == "admin"
    assert body["balance"] == 12.5
    assert body["expiresAt"] > 0

    session_id = response.headers["X-Auth-Session"]
    assert f"jiuwenswarm_auth={session_id}" in response.headers.get("set-cookie", "")
    assert ACCESS_TOKEN not in response.text
    assert SECRET not in response.text

    status = client.get("/api/v1/auth/status", headers={"X-Auth-Session": session_id})
    assert status.json()["islogin"] is True


def test_password_and_token_never_reach_the_session_archive(tmp_path, monkeypatch, http):
    client = _make_client(tmp_path, monkeypatch)
    assert _login(client).status_code == 200

    archive = (tmp_path / "sessions.json").read_text(encoding="utf-8")
    assert json.loads(archive)["v"] == 2
    assert SECRET not in archive
    assert ACCESS_TOKEN not in archive
    assert "alice@example.com" not in archive


def test_missing_fields_return_invalid_request(client, http):
    for body in ({}, {"username": "alice@example.com"}, {"password": SECRET}):
        response = client.post("/api/v1/auth/password-login", json=body)
        assert response.status_code == 400
        payload = response.json()
        assert payload["ok"] is False
        assert payload["error"] == "invalid_request"
    assert http.posts() == []


def test_password_login_requires_the_auth_header(client, http):
    response = client.post(
        "/api/v1/auth/password-login",
        json={"username": "alice@example.com", "password": SECRET},
        headers={web_http_auth.AUTH_REQUEST_HEADER: ""},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "auth_header_required"
    assert http.posts() == []


@pytest.mark.parametrize(
    ("status", "body", "code"),
    [
        (401, {"ok": False, "message": "账号或密码错误", "error": "invalid_credentials"}, "invalid_credentials"),
        (401, {"ok": False, "message": "账号已被禁用", "error": "account_disabled"}, "account_disabled"),
        (429, {"ok": False, "message": "请稍后再试", "error": "too_many_requests"}, "too_many_requests"),
    ],
)
def test_upstream_errors_are_passed_through(client, http, status, body, code):
    http.token_response = _Response(status, body)
    response = _login(client)

    assert response.status_code == status
    payload = response.json()
    assert payload == {"ok": False, "message": body["message"], "error": code}
    assert ACCESS_TOKEN not in response.text
    assert SECRET not in response.text


def test_email_not_verified_keeps_email_and_can_resend(client, http):
    http.token_response = _Response(
        403,
        {
            "ok": False,
            "message": "邮箱尚未验证",
            "error": "email_not_verified",
            "email": "alice@example.com",
            "can_resend": True,
        },
    )
    response = _login(client)

    assert response.status_code == 403
    assert response.json() == {
        "ok": False,
        "message": "邮箱尚未验证",
        "error": "email_not_verified",
        "email": "alice@example.com",
        "can_resend": True,
    }


def test_rate_limit_keeps_retry_after(client, http):
    http.token_response = _Response(
        429, {"error": "too_many_requests"}, headers={"Retry-After": "30"}
    )
    response = _login(client)

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "30"
    assert response.json()["error"] == "too_many_requests"


def test_password_login_is_rejected_when_auth_is_disabled(tmp_path, monkeypatch, http):
    client = _make_client(tmp_path, monkeypatch, provider="off")
    response = _login(client)

    assert response.status_code == 409
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"] == "auth-disabled"
    assert http.posts() == []


def test_resend_verification_returns_resend_after(client, http):
    response = client.post(
        "/api/v1/auth/resend-verification", json={"email": "alice@example.com"}
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "resend_after": 60}
    sent = http.posts()[0]
    assert sent["url"] == f"{BASE}/api/auth/verify-email/resend"
    assert sent["json"] == {"email": "alice@example.com"}


def test_resend_verification_requires_email(client, http):
    response = client.post("/api/v1/auth/resend-verification", json={})
    assert response.status_code == 400
    assert response.json()["error"] == "invalid_request"
    assert http.posts() == []


def test_resend_verification_rate_limit_is_passed_through(client, http):
    http.resend_response = _Response(
        429, {"error": "too_many_requests"}, headers={"Retry-After": "60"}
    )
    response = client.post(
        "/api/v1/auth/resend-verification", json={"email": "alice@example.com"}
    )

    assert response.status_code == 429
    assert response.headers["Retry-After"] == "60"
    payload = response.json()
    assert payload["ok"] is False
    assert payload["error"] == "too_many_requests"
    assert "请求过于频繁" in payload["message"]


def test_password_never_appears_in_logs(client, http):
    with _collect_logs() as records:
        assert _login(client).status_code == 200
        http.token_response = _Response(
            401, {"ok": False, "message": "账号或密码错误", "error": "invalid_credentials"}
        )
        assert _login(client).status_code == 401

    text = "\n".join(record.getMessage() for record in records)
    assert text
    assert SECRET not in text
