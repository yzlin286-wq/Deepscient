# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""DeepScient 官网账号 OAuth2 流程（PKCE / 回调 / userinfo / 撤销）。"""

from __future__ import annotations

import base64
import hashlib
import time
from urllib.parse import parse_qs, urlparse

import pytest

from jiuwenswarm.common.auth import deepscient_oauth as oauth
from jiuwenswarm.common.auth.deepscient_oauth import (
    Credential,
    DeepScientOAuthConfig,
    DeepScientOAuthFlow,
    LoginOutcome,
    OAuthError,
)
from jiuwenswarm.common.auth.service import AuthService
from jiuwenswarm.common.auth.session_store import AuthSessionStore

REDIRECT_ORIGIN = "http://127.0.0.1:19000"


class _Response:

    def __init__(self, status_code: int = 200, payload: object = None) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class _FakeHttp:
    """按 URL 后缀分派的假 HTTP 客户端，记录每次调用。"""

    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.discovery: _Response | None = None
        self.discovery_error: Exception | None = None
        self.token_response = _Response(
            200,
            {
                "access_token": "AT-1",
                "refresh_token": "RT-1",
                "expires_in": 3600,
                "user": {
                    "id": 42,
                    "username": "alice",
                    "email": "alice@example.com",
                    "role": "admin",
                    "balance": 12.5,
                    "created_at": "2026-01-01T00:00:00Z",
                    "disabled": False,
                },
            },
        )
        self.userinfo_response = _Response(
            200, {"user": {"id": 42, "username": "alice", "balance": 99}}
        )
        self.revoke_response = _Response(200, {"ok": True})
        self.revoke_error: Exception | None = None

    def __call__(self, method: str, url: str, **kwargs):
        self.calls.append({"method": method, "url": url, **kwargs})
        if method == "GET" and url.endswith("/.well-known/deepscient-oauth"):
            if self.discovery_error is not None:
                raise self.discovery_error
            return self.discovery if self.discovery is not None else _Response(404, {})
        if "/api/oauth/token" in url or url.endswith("/oauth/token"):
            return self.token_response
        if "/api/oauth/userinfo" in url:
            return self.userinfo_response
        if "/api/oauth/revoke" in url:
            if self.revoke_error is not None:
                raise self.revoke_error
            return self.revoke_response
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
    return DeepScientOAuthFlow(
        DeepScientOAuthConfig(base_url="https://deepscient.test", **overrides)
    )


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def test_begin_authorization_builds_pkce_s256_url(http):
    flow = _flow()
    started = flow.begin_authorization(REDIRECT_ORIGIN)

    url = urlparse(started["authorizeUrl"])
    query = {key: value[0] for key, value in parse_qs(url.query).items()}
    assert f"{url.scheme}://{url.netloc}{url.path}" == "https://deepscient.test/oauth/authorize"
    assert query["client_id"] == "deepscient-desktop"
    assert query["redirect_uri"] == "http://127.0.0.1:19000/auth/callback"
    assert query["state"] == started["state"]
    assert query["code_challenge_method"] == "S256"

    pending = flow.pending.get(started["state"])
    assert pending is not None
    assert query["code_challenge"] == _challenge(pending.code_verifier)
    assert started["redirectUri"] == pending.redirect_uri
    assert started["expiresIn"] == 300
    assert started["claimToken"] not in started["authorizeUrl"]


def test_state_mismatch_is_rejected(http):
    flow = _flow()
    flow.begin_authorization(REDIRECT_ORIGIN)
    with pytest.raises(OAuthError) as caught:
        flow.pending.begin_callback("not-the-state")
    assert caught.value.code == "oauth_state_invalid"


def test_expired_state_is_rejected(http):
    flow = _flow()
    started = flow.begin_authorization(REDIRECT_ORIGIN)
    pending = flow.pending.get(started["state"])
    assert pending is not None
    pending.expires_at = time.time() - 1
    with pytest.raises(OAuthError) as caught:
        flow.pending.begin_callback(started["state"])
    assert caught.value.code == "oauth_state_invalid"


def test_exchange_code_returns_user_and_credential(http):
    flow = _flow()
    started = flow.begin_authorization(REDIRECT_ORIGIN)
    flow.pending.begin_callback(started["state"])

    outcome = flow.exchange_code(started["state"], "the-code")

    sent = http.last("POST")
    assert sent["url"] == "https://deepscient.test/api/oauth/token"
    assert sent["json"] == {
        "grant_type": "authorization_code",
        "client_id": "deepscient-desktop",
        "code": "the-code",
        "redirect_uri": "http://127.0.0.1:19000/auth/callback",
        "code_verifier": flow.pending.get(started["state"]).code_verifier,
    }
    assert outcome.user_id == "42"
    assert outcome.user_name == "alice"
    assert outcome.credential.access_token == "AT-1"
    assert outcome.credential.refresh_token == "RT-1"
    assert outcome.credential.expires_at > time.time()
    assert outcome.extra == {
        "email": "alice@example.com",
        "role": "admin",
        "balance": 12.5,
        "createdAt": "2026-01-01T00:00:00Z",
        "disabled": False,
    }


def test_exchange_code_failure_raises(http):
    http.token_response = _Response(400, {"error": "invalid_grant"})
    flow = _flow()
    started = flow.begin_authorization(REDIRECT_ORIGIN)
    with pytest.raises(OAuthError) as caught:
        flow.exchange_code(started["state"], "bad-code")
    assert caught.value.code == "oauth_token_exchange_failed"


def test_userinfo_401_clears_the_session(http):
    http.userinfo_response = _Response(401, {})
    flow = _flow()
    store = AuthSessionStore(persist=False)
    service = AuthService(flow=flow, store=store)
    session = store.create(
        LoginOutcome(
            credential=Credential(access_token="AT-1", expires_at=time.time() + 3600),
            user_id="42",
            user_name="alice",
            extra={"email": "alice@example.com"},
        )
    )

    assert service.refresh_user(session.session_id) is None
    assert store.get(session.session_id) is None
    assert http.last("GET")["headers"]["Authorization"] == "Bearer AT-1"


def test_userinfo_updates_extra(http):
    flow = _flow()
    store = AuthSessionStore(persist=False)
    service = AuthService(flow=flow, store=store)
    session = store.create(
        LoginOutcome(
            credential=Credential(access_token="AT-1", expires_at=time.time() + 3600),
            user_id="42",
            user_name="alice",
            extra={"balance": 1},
        )
    )

    updated = service.refresh_user(session.session_id)
    assert updated is not None
    assert updated.extra["balance"] == 99
    assert updated.public_view()["balance"] == 99


def test_revoke_posts_the_token(http):
    flow = _flow()
    flow.revoke("AT-1")
    sent = http.last("POST")
    assert sent["url"] == "https://deepscient.test/api/oauth/revoke"
    assert sent["json"] == {"token": "AT-1"}
    assert sent["headers"]["Authorization"] == "Bearer AT-1"


def test_revoke_failure_is_swallowed(http):
    http.revoke_error = RuntimeError("network down")
    _flow().revoke("AT-1")  # 不抛


def test_discovery_failure_falls_back_to_default_endpoints(http):
    http.discovery_error = RuntimeError("offline")
    endpoints = _flow().config.endpoints()
    assert endpoints == {
        "authorization_endpoint": "https://deepscient.test/oauth/authorize",
        "token_endpoint": "https://deepscient.test/api/oauth/token",
        "userinfo_endpoint": "https://deepscient.test/api/oauth/userinfo",
        "revocation_endpoint": "https://deepscient.test/api/oauth/revoke",
        "registration_endpoint": "https://deepscient.test/api/auth/register",
        "verify_email_endpoint": "https://deepscient.test/api/auth/verify-email",
        "verify_email_resend_endpoint": "https://deepscient.test/api/auth/verify-email/resend",
    }


def test_discovery_document_overrides_endpoints(http):
    http.discovery = _Response(
        200,
        {
            "authorization_endpoint": "https://login.example.com/authorize",
            "token_endpoint": "https://login.example.com/token",
            "userinfo_endpoint": "/custom/userinfo",
            "revocation_endpoint": "https://login.example.com/revoke",
        },
    )
    flow = _flow()
    endpoints = flow.config.endpoints()
    assert endpoints["authorization_endpoint"] == "https://login.example.com/authorize"
    assert endpoints["token_endpoint"] == "https://login.example.com/token"
    assert endpoints["userinfo_endpoint"] == "https://deepscient.test/custom/userinfo"

    started = flow.begin_authorization(REDIRECT_ORIGIN)
    assert started["authorizeUrl"].startswith("https://login.example.com/authorize?")


def test_login_enabled_follows_provider_and_base_url():
    assert oauth.login_enabled(DeepScientOAuthConfig()) is True
    assert oauth.login_enabled(DeepScientOAuthConfig(provider="off")) is False
    assert oauth.login_enabled(DeepScientOAuthConfig(base_url="")) is False


def test_config_from_config_uses_section_and_env(monkeypatch):
    monkeypatch.delenv(oauth.ENV_BASE, raising=False)
    monkeypatch.delenv(oauth.ENV_CLIENT_ID, raising=False)
    config = DeepScientOAuthConfig.from_config(
        {"base_url": "deepscient.test/", "client_id": "cid", "state_ttl_seconds": 120}
    )
    assert config.base_url == "https://deepscient.test"
    assert config.client_id == "cid"
    assert config.state_ttl_seconds == 120.0

    monkeypatch.setenv(oauth.ENV_BASE, "http://127.0.0.1:9999")
    monkeypatch.setenv(oauth.ENV_CLIENT_ID, "env-client")
    overridden = DeepScientOAuthConfig.from_config({})
    assert overridden.base_url == "http://127.0.0.1:9999"
    assert overridden.client_id == "env-client"


def test_public_view_exposes_user_fields_but_not_tokens():
    store = AuthSessionStore(persist=False)
    session = store.create(
        LoginOutcome(
            credential=Credential(access_token="SECRET-AT", expires_at=123456.0),
            user_id="42",
            user_name="alice",
            extra={"email": "a@b.c", "role": "admin", "balance": 3},
        )
    )
    view = session.public_view()
    assert view["sessionId"] == session.session_id
    assert view["userId"] == "42"
    assert view["userName"] == "alice"
    assert view["email"] == "a@b.c"
    assert view["role"] == "admin"
    assert view["balance"] == 3
    assert view["expiresAt"] == 123456.0
    assert "SECRET-AT" not in str(view)
