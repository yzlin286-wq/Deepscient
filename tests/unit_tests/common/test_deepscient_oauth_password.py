# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""DeepScient 密码直登（``grant_type=password``）与重发验证邮件。"""

from __future__ import annotations

import contextlib
import logging
import time

import pytest

from jiuwenswarm.common.auth import deepscient_oauth as oauth
from jiuwenswarm.common.auth.deepscient_oauth import (
    DeepScientOAuthConfig,
    DeepScientOAuthFlow,
    OAuthError,
)
from jiuwenswarm.common.auth.service import AuthService
from jiuwenswarm.common.auth.session_store import AuthSessionStore
from jiuwenswarm.common.partner import service as partner_service

BASE = "https://deepscient.test"
#: 只在本测试里存在的口令，用来搜日志与落盘内容。
SECRET = "unit-test-password-9f3c1a"

SUCCESS_BODY = {
    "ok": True,
    "token_type": "Bearer",
    "access_token": "AT-PASSWORD",
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
        if method == "POST" and url.endswith("/api/oauth/token"):
            return self.token_response
        if method == "POST" and (
            url.endswith("/api/auth/verify-email/resend") or url.endswith("/custom/resend")
        ):
            return self.resend_response
        raise AssertionError(f"unexpected request: {method} {url}")

    def last(self, method: str) -> dict:
        for call in reversed(self.calls):
            if call["method"] == method:
                return call
        raise AssertionError(f"no {method} request recorded")


@pytest.fixture
def http(monkeypatch) -> _FakeHttp:
    fake = _FakeHttp()
    monkeypatch.setattr(oauth, "requests_request", fake)
    return fake


def _flow(**overrides) -> DeepScientOAuthFlow:
    return DeepScientOAuthFlow(DeepScientOAuthConfig(base_url=BASE, **overrides))


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


def test_exchange_password_sends_password_grant_and_returns_no_refresh_token(http):
    outcome = _flow().exchange_password("alice@example.com", SECRET)

    sent = http.last("POST")
    assert sent["url"] == f"{BASE}/api/oauth/token"
    assert sent["timeout"] == 10.0
    assert sent["json"] == {
        "grant_type": "password",
        "client_id": "deepscient-desktop",
        "username": "alice@example.com",
        "password": SECRET,
    }
    assert outcome.user_id == "42"
    assert outcome.user_name == "alice"
    assert outcome.credential.access_token == "AT-PASSWORD"
    # 官网密码模式不发 refresh_token
    assert outcome.credential.refresh_token == ""
    assert outcome.credential.expires_at > time.time()
    assert outcome.extra == {
        "email": "alice@example.com",
        "role": "admin",
        "balance": 12.5,
        "createdAt": "2026-01-01T00:00:00Z",
        "disabled": False,
    }


def test_service_login_with_password_creates_the_session(http, monkeypatch):
    synced: list[tuple[str, str]] = []
    monkeypatch.setattr(
        partner_service,
        "schedule_sync_after_login",
        lambda user_id, name="": synced.append((user_id, name)),
    )
    store = AuthSessionStore(persist=False)
    created = []
    original_create = store.create

    def spy_create(outcome):
        created.append(outcome)
        return original_create(outcome)

    monkeypatch.setattr(store, "create", spy_create)
    service = AuthService(flow=_flow(), store=store)

    session = service.login_with_password("alice@example.com", SECRET)

    assert len(created) == 1
    assert created[0].credential.refresh_token == ""
    assert store.get(session.session_id) is session
    assert session.user_id == "42"
    assert session.credential.access_token == "AT-PASSWORD"
    assert SECRET not in repr(session.to_dict())
    assert synced == [("42", "alice")]


def test_correct_credentials_but_store_failure_is_reported(http, monkeypatch):
    store = AuthSessionStore(persist=False)

    def broken_create(outcome):
        raise OSError("disk full")

    monkeypatch.setattr(store, "create", broken_create)
    service = AuthService(flow=_flow(), store=store)

    with pytest.raises(OAuthError) as caught:
        service.login_with_password("alice@example.com", SECRET)
    assert caught.value.code == "session_store_failed"


@pytest.mark.parametrize(
    ("status", "body", "code"),
    [
        (401, {"ok": False, "message": "账号或密码错误", "error": "invalid_credentials"}, "invalid_credentials"),
        (401, {"ok": False, "message": "账号已被禁用", "error": "account_disabled"}, "account_disabled"),
        (429, {"ok": False, "message": "请稍后再试", "error": "too_many_requests"}, "too_many_requests"),
    ],
)
def test_password_login_error_mapping(http, status, body, code):
    http.token_response = _Response(status, body)
    with pytest.raises(OAuthError) as caught:
        _flow().exchange_password("alice@example.com", SECRET)

    error = caught.value
    assert error.code == code
    assert error.status == status
    assert error.upstream_error == code
    assert error.payload["message"] == body["message"]
    assert str(error) == body["message"]


def test_email_not_verified_keeps_email_and_can_resend(http):
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
    with pytest.raises(OAuthError) as caught:
        _flow().exchange_password("alice@example.com", SECRET)

    error = caught.value
    assert error.code == "email_not_verified"
    assert error.status == 403
    assert error.payload["email"] == "alice@example.com"
    assert error.payload["can_resend"] is True


def test_too_many_requests_keeps_retry_after(http):
    http.token_response = _Response(
        429, {"error": "too_many_requests"}, headers={"Retry-After": "30"}
    )
    with pytest.raises(OAuthError) as caught:
        _flow().exchange_password("alice@example.com", SECRET)

    assert caught.value.status == 429
    assert caught.value.payload["retry_after"] == 30
    assert str(caught.value) == "请求过于频繁"


def test_resend_verification_posts_email_and_returns_body(http):
    body = _flow().resend_verification("alice@example.com")

    sent = http.last("POST")
    assert sent["url"] == f"{BASE}/api/auth/verify-email/resend"
    assert sent["json"] == {"email": "alice@example.com"}
    assert sent["timeout"] == 10.0
    assert body == {"ok": True, "resend_after": 60}


def test_resend_verification_path_is_configurable(http):
    _flow(verify_email_resend_path="/custom/resend").resend_verification("alice@example.com")
    assert http.last("POST")["url"] == f"{BASE}/custom/resend"


def test_resend_verification_429_is_mapped(http):
    http.resend_response = _Response(
        429,
        {"error": "too_many_requests", "message": "同一邮箱 60 秒内只能发一次"},
        headers={"Retry-After": "60"},
    )
    with pytest.raises(OAuthError) as caught:
        _flow().resend_verification("alice@example.com")

    error = caught.value
    assert error.code == "too_many_requests"
    assert error.status == 429
    assert str(error) == "请求过于频繁"
    assert error.payload["retry_after"] == 60


def test_resend_verification_other_errors_are_mapped(http):
    http.resend_response = _Response(400, {"error": "email_required", "message": "缺少邮箱"})
    with pytest.raises(OAuthError) as caught:
        _flow().resend_verification("")

    assert caught.value.code == "email_required"
    assert caught.value.status == 400
    assert str(caught.value) == "缺少邮箱"


def test_password_never_appears_in_logs(http):
    with _collect_logs() as records:
        _flow().exchange_password("alice@example.com", SECRET)
        http.token_response = _Response(
            401, {"ok": False, "message": "账号或密码错误", "error": "invalid_credentials"}
        )
        with pytest.raises(OAuthError):
            _flow().exchange_password("alice@example.com", SECRET)
        http.token_response = _Response(200, dict(SUCCESS_BODY))
        AuthService(flow=_flow(), store=AuthSessionStore(persist=False)).login_with_password(
            "alice@example.com", SECRET
        )

    text = "\n".join(record.getMessage() for record in records)
    assert text  # 确实有日志，避免"没打开日志"式假通过
    assert SECRET not in text


def test_oauth_error_constructor_stays_backward_compatible():
    error = OAuthError("登录未开启", "login_disabled")
    assert str(error) == "登录未开启"
    assert error.code == "login_disabled"
    assert error.status is None
    assert error.payload == {}
    assert error.upstream_error == ""
