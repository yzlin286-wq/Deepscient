# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""DeepScient 官网账号登录：OAuth2 授权码 + PKCE（S256），以及应用内密码直登。

授权码模式下密码不进入本机：登录走官网授权页，本地只见到 ``code`` 与 token。
密码模式（``grant_type=password``）只在一次 token 请求里作为局部变量使用，换到
token 后立即丢弃：不写日志、不进会话、不落盘。token 只留在服务端会话里，前端
拿到的永远只有用户信息与余额。

端点来自 config.yaml 的 ``auth`` 段，也可以用环境变量临时指到别处：

* ``DEEPSCIENT_OAUTH_BASE`` —— 官网地址（联调时指向本地假服务器）
* ``DEEPSCIENT_OAUTH_CLIENT_ID`` —— OAuth 客户端 id

端点先按 ``/.well-known/deepscient-oauth`` 发现；发现失败或字段缺失时回退到
契约里的固定路径，保证官网暂时没挂发现文档时也能登录。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import os
import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Mapping
from urllib.parse import urlencode

from jiuwenswarm.common.auth.net import requests_request

logger = logging.getLogger(__name__)

ENV_BASE = "DEEPSCIENT_OAUTH_BASE"
ENV_CLIENT_ID = "DEEPSCIENT_OAUTH_CLIENT_ID"

DEFAULT_PROVIDER = "deepscient"
DEFAULT_BASE_URL = "https://deepscient.com"
DEFAULT_CLIENT_ID = "deepscient-desktop"
DEFAULT_DISCOVERY_PATH = "/.well-known/deepscient-oauth"
DEFAULT_AUTHORIZE_PATH = "/oauth/authorize"
DEFAULT_TOKEN_PATH = "/api/oauth/token"
DEFAULT_USERINFO_PATH = "/api/oauth/userinfo"
DEFAULT_REVOKE_PATH = "/api/oauth/revoke"
DEFAULT_CALLBACK_PATH = "/auth/callback"
DEFAULT_REGISTRATION_PATH = "/api/auth/register"
DEFAULT_VERIFY_EMAIL_PATH = "/api/auth/verify-email"
DEFAULT_VERIFY_EMAIL_RESEND_PATH = "/api/auth/verify-email/resend"
DEFAULT_REGISTER_URL = "https://deepscient.com"
DEFAULT_ACCOUNT_CENTER_URL = "https://deepscient.com"
DEFAULT_STATE_TTL_S = 300.0
DEFAULT_TOKEN_TIMEOUT_S = 10.0
DEFAULT_USERINFO_TIMEOUT_S = 8.0
#: 密码直登与重发验证邮件都是短请求，固定 10 秒，别让登录页干等。
PASSWORD_TIMEOUT_S = 10.0

DISCOVERY_TIMEOUT_S = 4.0
REVOKE_TIMEOUT_S = 5.0
#: 官网没给 ``expires_in`` 时的 token 有效期。
DEFAULT_TOKEN_TTL_S = 30 * 24 * 60 * 60.0

_DISABLED_PROVIDERS = ("off", "none", "disabled")
#: 官网统一错误体里的 ``error`` → 给用户看的默认提示（有 ``message`` 时以官网为准）。
_LOGIN_ERROR_MESSAGES = {
    "invalid_credentials": "账号或密码错误",
    "account_disabled": "账号已被禁用",
    "email_not_verified": "邮箱尚未验证，请先完成邮箱验证",
    "too_many_requests": "请求过于频繁",
    "client_not_allowed": "当前客户端不允许登录",
}


class OAuthError(Exception):
    """登录失败的机器可读错误，``code`` 供前端/路由决定提示与状态码。

    ``status`` / ``payload`` / ``upstream_error`` 只在错误来自官网时才有值：
    路由据此透传 HTTP 状态码与 ``email`` / ``can_resend`` 等字段。
    """

    def __init__(
        self,
        message: str,
        code: str = "oauth_error",
        *,
        status: int | None = None,
        payload: Mapping[str, Any] | None = None,
        upstream_error: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        try:
            self.status = int(status) if status is not None else None
        except (TypeError, ValueError):
            self.status = None
        self.payload = dict(payload) if isinstance(payload, Mapping) else {}
        self.upstream_error = str(upstream_error or "")


def mask(value: str | None) -> str:
    if not value:
        return ""
    return "***" if len(value) <= 8 else f"...{value[-8:]}"


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _same_token(expected: str, provided: str) -> bool:
    # 按 bytes 比：compare_digest 的 str 形式遇到非 ASCII 会抛 TypeError
    return hmac.compare_digest(expected.encode("utf-8"), provided.encode("utf-8"))


def _pkce_pair() -> tuple[str, str]:
    """返回 ``(code_verifier, code_challenge)``，S256。"""
    verifier = secrets.token_urlsafe(32)
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def _normalize_base_url(raw: str | None) -> str:
    value = str(raw or "").strip().rstrip("/")
    if not value or value.lower() in _DISABLED_PROVIDERS:
        return ""
    if "://" not in value:
        value = f"https://{value}"
    return value


def _text(section: Mapping[str, Any], key: str, default: str) -> str:
    raw = section.get(key)
    if isinstance(raw, (str, int)) and str(raw).strip():
        return str(raw).strip()
    return default


def _number(section: Mapping[str, Any], key: str, default: float) -> float:
    raw = section.get(key)
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


def _auth_section() -> dict[str, Any]:
    """读 config.yaml 的 ``auth`` 段；读不到就当没配（全用默认值）。"""
    try:
        from jiuwenswarm.common.config import get_config

        section = get_config().get("auth")
    except Exception:  # noqa: BLE001 — 配置不可用不该让登录模块导入失败
        logger.debug("[Auth] 读取 auth 配置失败，使用默认值", exc_info=True)
        return {}
    return section if isinstance(section, dict) else {}


@dataclass
class DeepScientOAuthConfig:
    enabled: bool = True
    provider: str = DEFAULT_PROVIDER
    base_url: str = DEFAULT_BASE_URL
    client_id: str = DEFAULT_CLIENT_ID
    discovery_path: str = DEFAULT_DISCOVERY_PATH
    authorize_path: str = DEFAULT_AUTHORIZE_PATH
    token_path: str = DEFAULT_TOKEN_PATH
    userinfo_path: str = DEFAULT_USERINFO_PATH
    revoke_path: str = DEFAULT_REVOKE_PATH
    callback_path: str = DEFAULT_CALLBACK_PATH
    registration_path: str = DEFAULT_REGISTRATION_PATH
    verify_email_path: str = DEFAULT_VERIFY_EMAIL_PATH
    verify_email_resend_path: str = DEFAULT_VERIFY_EMAIL_RESEND_PATH
    register_url: str = DEFAULT_REGISTER_URL
    account_center_url: str = DEFAULT_ACCOUNT_CENTER_URL
    state_ttl_seconds: float = DEFAULT_STATE_TTL_S
    token_timeout_seconds: float = DEFAULT_TOKEN_TIMEOUT_S
    userinfo_timeout_seconds: float = DEFAULT_USERINFO_TIMEOUT_S
    #: 发现结果按进程缓存：端点很少变，每次登录都拉一遍没必要。
    _endpoints: dict[str, str] | None = field(default=None, init=False, repr=False)

    @classmethod
    def from_config(cls, section: Mapping[str, Any] | None = None) -> "DeepScientOAuthConfig":
        values = section if isinstance(section, Mapping) else _auth_section()
        provider = _text(values, "provider", DEFAULT_PROVIDER).lower()
        enabled_raw = values.get("enabled", True)
        enabled = not (
            enabled_raw is False
            or str(enabled_raw).strip().lower() in {"0", "false", "no", "off", "disabled"}
        )
        base_url = _normalize_base_url(os.environ.get(ENV_BASE) or _text(
            values, "base_url", DEFAULT_BASE_URL
        ))
        client_id = (
            (os.environ.get(ENV_CLIENT_ID) or "").strip()
            or _text(values, "client_id", DEFAULT_CLIENT_ID)
        )
        return cls(
            enabled=enabled,
            provider=provider,
            base_url=base_url,
            client_id=client_id,
            discovery_path=_text(values, "discovery_path", DEFAULT_DISCOVERY_PATH),
            authorize_path=_text(values, "authorize_path", DEFAULT_AUTHORIZE_PATH),
            token_path=_text(values, "token_path", DEFAULT_TOKEN_PATH),
            userinfo_path=_text(values, "userinfo_path", DEFAULT_USERINFO_PATH),
            revoke_path=_text(values, "revoke_path", DEFAULT_REVOKE_PATH),
            callback_path=_text(values, "callback_path", DEFAULT_CALLBACK_PATH),
            registration_path=_text(
                values, "registration_path", DEFAULT_REGISTRATION_PATH
            ),
            verify_email_path=_text(
                values, "verify_email_path", DEFAULT_VERIFY_EMAIL_PATH
            ),
            verify_email_resend_path=_text(
                values, "verify_email_resend_path", DEFAULT_VERIFY_EMAIL_RESEND_PATH
            ),
            register_url=_text(values, "register_url", DEFAULT_REGISTER_URL),
            account_center_url=_text(
                values, "account_center_url", DEFAULT_ACCOUNT_CENTER_URL
            ),
            state_ttl_seconds=_number(values, "state_ttl_seconds", DEFAULT_STATE_TTL_S),
            token_timeout_seconds=_number(
                values, "token_timeout_seconds", DEFAULT_TOKEN_TIMEOUT_S
            ),
            userinfo_timeout_seconds=_number(
                values, "userinfo_timeout_seconds", DEFAULT_USERINFO_TIMEOUT_S
            ),
        )

    def absolute(self, path_or_url: str) -> str:
        if str(path_or_url).startswith("http"):
            return str(path_or_url)
        return f"{self.base_url}{path_or_url}"

    def endpoints(self) -> dict[str, str]:
        """发现端点；拿不到就用契约里的固定路径。"""
        if self._endpoints is not None:
            return dict(self._endpoints)
        found: Mapping[str, Any] = {}
        if self.base_url and self.discovery_path:
            try:
                response = requests_request(
                    "GET",
                    self.absolute(self.discovery_path),
                    timeout=DISCOVERY_TIMEOUT_S,
                )
                if response.status_code == 200:
                    body = response.json()
                    if isinstance(body, dict):
                        found = body
            except Exception as exc:  # noqa: BLE001 — 发现失败按固定路径走
                logger.debug("[Auth] 端点发现失败，使用默认路径: %s", exc)

        fallbacks = {
            "authorization_endpoint": self.authorize_path,
            "token_endpoint": self.token_path,
            "userinfo_endpoint": self.userinfo_path,
            "revocation_endpoint": self.revoke_path,
            "registration_endpoint": self.registration_path,
            "verify_email_endpoint": self.verify_email_path,
            "verify_email_resend_endpoint": self.verify_email_resend_path,
        }
        endpoints: dict[str, str] = {}
        for key, fallback in fallbacks.items():
            value = found.get(key)
            endpoints[key] = self.absolute(value if isinstance(value, str) and value else fallback)
        self._endpoints = endpoints
        return dict(endpoints)


def login_enabled(config: DeepScientOAuthConfig | None = None) -> bool:
    """登录功能是否开启：provider 没被关掉，且有可用的官网地址。"""
    cfg = config or DeepScientOAuthConfig.from_config()
    return cfg.enabled and cfg.provider not in _DISABLED_PROVIDERS and bool(cfg.base_url)


def account_center_url(config: DeepScientOAuthConfig | None = None) -> str:
    return (config or DeepScientOAuthConfig.from_config()).account_center_url


def register_url(config: DeepScientOAuthConfig | None = None) -> str:
    return (config or DeepScientOAuthConfig.from_config()).register_url


@dataclass
class Credential:
    access_token: str = ""
    expires_at: float = 0.0
    refresh_token: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "access_token": self.access_token,
            "expires_at": self.expires_at,
            "refresh_token": self.refresh_token,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "Credential":
        data = data or {}
        try:
            expires_at = float(data.get("expires_at") or 0.0)
        except (TypeError, ValueError):
            expires_at = 0.0
        return cls(
            access_token=str(data.get("access_token") or ""),
            expires_at=expires_at,
            refresh_token=str(data.get("refresh_token") or ""),
        )

    def expires_within(self, seconds: float) -> bool:
        return not self.access_token or self.expires_at - seconds <= time.time()

    def is_expired(self, skew_s: float = 30.0) -> bool:
        return self.expires_within(skew_s)


@dataclass
class LoginOutcome:
    credential: Credential
    user_id: str
    user_name: str | None
    extra: dict[str, Any] = field(default_factory=dict)


def normalize_user(raw: Any) -> dict[str, Any]:
    """官网 user 对象 → 本机统一形状（不保留任何 token）。"""
    if not isinstance(raw, Mapping):
        return {
            "id": None,
            "username": "",
            "email": "",
            "role": "user",
            "balance": None,
            "createdAt": None,
            "disabled": False,
        }
    balance = raw.get("balance")
    return {
        "id": raw.get("id"),
        "username": str(raw.get("username") or ""),
        "email": str(raw.get("email") or ""),
        "role": str(raw.get("role") or "user"),
        "balance": balance if isinstance(balance, (int, float)) and not isinstance(balance, bool) else None,
        "createdAt": raw.get("created_at") or raw.get("createdAt"),
        "disabled": raw.get("disabled") is True,
    }


def extra_from_user(user: Mapping[str, Any]) -> dict[str, Any]:
    """会话 ``extra`` 里保存给前端看的用户字段。"""
    return {
        "email": str(user.get("email") or ""),
        "role": str(user.get("role") or "user"),
        "balance": user.get("balance"),
        "createdAt": user.get("createdAt"),
        "disabled": bool(user.get("disabled")),
    }


@dataclass
class PendingLogin:
    state: str
    code_verifier: str
    redirect_uri: str
    claim_token: str
    created_at: float
    expires_at: float
    callback_seen: bool = False
    session_id: str | None = None
    error: OAuthError | None = None


class PendingLogins:
    """按 state 索引的待完成登录（进程内存：回调和发起必须落到同一个进程）。"""

    def __init__(self, ttl_s: float = DEFAULT_STATE_TTL_S) -> None:
        self._ttl_s = ttl_s
        self._lock = threading.Lock()
        self._items: dict[str, PendingLogin] = {}

    def add(self, code_verifier: str, redirect_uri: str) -> PendingLogin:
        now = time.time()
        pending = PendingLogin(
            state=secrets.token_urlsafe(24),
            code_verifier=code_verifier,
            redirect_uri=redirect_uri,
            claim_token=secrets.token_urlsafe(32),
            created_at=now,
            expires_at=now + self._ttl_s,
        )
        with self._lock:
            self._prune()
            self._items[pending.state] = pending
        return pending

    def get(self, state: str) -> PendingLogin | None:
        with self._lock:
            self._prune()
            return self._items.get(state)

    def begin_callback(self, state: str) -> PendingLogin:
        with self._lock:
            self._prune()
            pending = self._items.get(state)
            if pending is None:
                raise OAuthError("登录请求无效或已过期，请重新发起登录", "oauth_state_invalid")
            if pending.callback_seen:
                raise OAuthError("该登录请求已处理过，请回到应用查看结果", "oauth_callback_replayed")
            pending.callback_seen = True
            return pending

    def finish(
        self, state: str, *, session_id: str | None = None, error: OAuthError | None = None
    ) -> None:
        with self._lock:
            pending = self._items.get(state)
            if pending is None:
                return
            pending.session_id = session_id
            pending.error = error
            # 发起方还要来认领结果，别让 state 的 300 秒把结果一起带走
            pending.expires_at = time.time() + self._ttl_s

    def claim(self, state: str, claim_token: str) -> str | None:
        with self._lock:
            self._prune()
            pending = self._items.get(state)
            if pending is None or not _same_token(
                pending.claim_token, str(claim_token or "")
            ):
                raise OAuthError("登录请求无效或已过期，请重新发起登录", "oauth_state_invalid")
            if pending.error is not None:
                self._items.pop(state, None)
                raise pending.error
            if pending.session_id is None:
                return None
            self._items.pop(state, None)
            return pending.session_id

    def discard(self, state: str, claim_token: str) -> None:
        with self._lock:
            pending = self._items.get(state)
            if pending is not None and _same_token(
                pending.claim_token, str(claim_token or "")
            ):
                self._items.pop(state, None)

    def _prune(self) -> None:
        now = time.time()
        for state in [s for s, p in self._items.items() if p.expires_at <= now]:
            self._items.pop(state, None)


class DeepScientOAuthFlow:
    """DeepScient 官网账号的授权码流程。"""

    def __init__(self, config: DeepScientOAuthConfig | None = None) -> None:
        self.config = config or DeepScientOAuthConfig.from_config()
        self.pending = PendingLogins(self.config.state_ttl_seconds)

    def begin_authorization(self, origin: str) -> dict[str, Any]:
        """返回 ``{authorizeUrl, state, claimToken, expiresIn, redirectUri}``。"""
        if not login_enabled(self.config):
            raise OAuthError("登录未开启", "login_disabled")
        redirect_uri = f"{str(origin or self.config.base_url).strip().rstrip('/')}{self.config.callback_path}"
        code_verifier, code_challenge = _pkce_pair()
        pending = self.pending.add(code_verifier, redirect_uri)
        params = {
            "client_id": self.config.client_id,
            "redirect_uri": redirect_uri,
            "state": pending.state,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        }
        authorize_url = (
            f"{self.config.endpoints()['authorization_endpoint']}?{urlencode(params)}"
        )
        logger.info("[Auth] 已生成授权地址 state=%s", mask(pending.state))
        return {
            "authorizeUrl": authorize_url,
            "state": pending.state,
            "claimToken": pending.claim_token,
            "expiresIn": int(self.config.state_ttl_seconds),
            "redirectUri": redirect_uri,
        }

    def exchange_code(self, state: str, code: str) -> LoginOutcome:
        """用授权码换 token，并把官网返回的用户信息带回来。"""
        pending = self.pending.get(state)
        if pending is None:
            raise OAuthError("登录请求无效或已过期，请重新发起登录", "oauth_state_invalid")
        payload = {
            "grant_type": "authorization_code",
            "client_id": self.config.client_id,
            "code": code,
            "redirect_uri": pending.redirect_uri,
            "code_verifier": pending.code_verifier,
        }
        try:
            response = requests_request(
                "POST",
                self.config.endpoints()["token_endpoint"],
                json=payload,
                timeout=self.config.token_timeout_seconds,
            )
        except Exception as exc:  # noqa: BLE001 — 网络层异常统一转业务错误
            logger.warning("[Auth] 无法连接官网 token 端点: %s", exc)
            raise OAuthError("无法连接登录服务，请检查网络后重试", "oauth_network_error") from exc

        body = _json_body(response)
        if response.status_code != 200 or not isinstance(body, dict) or not body.get("access_token"):
            error = body.get("error") if isinstance(body, dict) else None
            logger.warning(
                "[Auth] token 请求失败 status=%s error=%s", response.status_code, error
            )
            raise OAuthError(
                f"换取登录凭据失败（HTTP {response.status_code}{f'，{error}' if error else ''}）",
                "oauth_token_exchange_failed",
            )

        outcome = _outcome_from_token(body)
        logger.info("[Auth] 授权码已换到 token user=%s", mask(outcome.user_id))
        return outcome

    def exchange_password(self, username: str, password: str) -> LoginOutcome:
        """应用内密码直登（``grant_type=password``）。

        密码只作为本次请求的局部变量：不写日志、不进异常信息、不进返回的会话。
        失败时按官网统一错误体抛 :class:`OAuthError`，``status`` / ``payload``
        留给路由透传（403 ``email_not_verified`` 的 ``email`` / ``can_resend``、
        429 的 ``Retry-After``）。
        """
        if not login_enabled(self.config):
            raise OAuthError("登录未开启", "login_disabled")
        payload = {
            "grant_type": "password",
            "client_id": self.config.client_id,
            "username": str(username or "").strip(),
            "password": password,
        }
        try:
            response = requests_request(
                "POST",
                self.config.endpoints()["token_endpoint"],
                json=payload,
                timeout=PASSWORD_TIMEOUT_S,
            )
        except Exception as exc:  # noqa: BLE001 — 只记异常，不带请求体
            logger.warning("[Auth] 无法连接官网 token 端点: %s", exc)
            raise OAuthError("无法连接登录服务，请检查网络后重试", "oauth_network_error") from exc

        body = _json_body(response)
        status = response.status_code
        if not 200 <= status < 300:
            error = body.get("error") if isinstance(body, Mapping) else None
            logger.warning(
                "[Auth] 密码登录失败 status=%s error=%s", status, error or "-"
            )
            raise _upstream_error(response, body, default_code="oauth_error")
        if not isinstance(body, Mapping) or not body.get("access_token"):
            logger.warning("[Auth] 密码登录响应缺少 access_token status=%s", status)
            raise OAuthError(
                "登录服务返回异常，请稍后重试",
                "oauth_error",
                status=502,
                payload=dict(body) if isinstance(body, Mapping) else {},
            )

        outcome = _outcome_from_token(body)
        logger.info("[Auth] 密码登录已换到 token user=%s", mask(outcome.user_id))
        return outcome

    def resend_verification(self, email: str) -> dict[str, Any]:
        """重发邮箱验证邮件；成功返回官网响应体（含 ``resend_after``）。"""
        if not login_enabled(self.config):
            raise OAuthError("登录未开启", "login_disabled")
        try:
            response = requests_request(
                "POST",
                self.config.endpoints()["verify_email_resend_endpoint"],
                json={"email": str(email or "").strip()},
                timeout=PASSWORD_TIMEOUT_S,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Auth] 无法连接官网重发验证邮件端点: %s", exc)
            raise OAuthError("无法连接登录服务，请稍后重试", "oauth_network_error") from exc

        body = _json_body(response)
        status = response.status_code
        if status == 429:
            logger.warning("[Auth] 重发验证邮件被限流")
            raise _upstream_error(
                response,
                body,
                default_code="too_many_requests",
                message="请求过于频繁",
                use_upstream_message=False,
            )
        if not 200 <= status < 300:
            error = body.get("error") if isinstance(body, Mapping) else None
            logger.warning(
                "[Auth] 重发验证邮件失败 status=%s error=%s", status, error or "-"
            )
            raise _upstream_error(
                response,
                body,
                default_code="oauth_error",
                message="重发验证邮件失败，请稍后重试",
            )
        return dict(body) if isinstance(body, Mapping) else {}

    def fetch_user(self, access_token: str) -> dict[str, Any]:
        """查当前用户信息。官网说 401 就等于这枚 token 没了。"""
        try:
            response = requests_request(
                "GET",
                self.config.endpoints()["userinfo_endpoint"],
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=self.config.userinfo_timeout_seconds,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Auth] 无法连接官网 userinfo 端点: %s", exc)
            raise OAuthError("无法连接登录服务，请稍后重试", "oauth_network_error") from exc
        if response.status_code == 401:
            raise OAuthError("登录已过期", "oauth_unauthorized")
        body = _json_body(response)
        if response.status_code != 200 or not isinstance(body, dict):
            raise OAuthError(
                f"查询账号信息失败（HTTP {response.status_code}）", "oauth_userinfo_failed"
            )
        raw = body.get("user") if isinstance(body.get("user"), dict) else body
        return normalize_user(raw)

    def revoke(self, access_token: str) -> None:
        """撤销官网那枚 token。失败只记日志：本地登出不该被网络挡住。"""
        if not access_token:
            return
        try:
            requests_request(
                "POST",
                self.config.endpoints()["revocation_endpoint"],
                json={"token": access_token},
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=REVOKE_TIMEOUT_S,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Auth] 撤销 token 失败（忽略）: %s", exc)

    def account_center_url(self) -> str:
        return self.config.account_center_url

    def register_url(self) -> str:
        return self.config.register_url


def _json_body(response: Any) -> Any:
    try:
        return response.json()
    except (ValueError, TypeError, AttributeError):
        return None


def _outcome_from_token(body: Mapping[str, Any]) -> LoginOutcome:
    """token 响应 → 登录结果。``refresh_token`` 官网不给时就留空。"""
    seconds = body.get("expires_in")
    try:
        ttl = float(seconds) if float(seconds) > 0 else DEFAULT_TOKEN_TTL_S
    except (TypeError, ValueError):
        ttl = DEFAULT_TOKEN_TTL_S
    credential = Credential(
        access_token=str(body["access_token"]),
        expires_at=time.time() + ttl,
        refresh_token=str(body.get("refresh_token") or ""),
    )
    user = normalize_user(body.get("user"))
    return LoginOutcome(
        credential=credential,
        user_id=str(user["id"]) if user["id"] is not None else "",
        user_name=str(user["username"]),
        extra=extra_from_user(user),
    )


def _retry_after_seconds(response: Any) -> int | None:
    """上游 ``Retry-After``（只认整数秒）；拿不到或不是数字就返回 ``None``。"""
    headers = getattr(response, "headers", None)
    if not headers:
        return None
    try:
        raw = headers.get("Retry-After")
    except AttributeError:
        return None
    text = str(raw or "").strip()
    return int(text) if text.isdigit() else None


def _upstream_error(
    response: Any,
    body: Any,
    *,
    default_code: str,
    message: str = "",
    use_upstream_message: bool = True,
) -> OAuthError:
    """官网统一错误体 → :class:`OAuthError`，状态码与字段原样留给路由。

    ``payload`` 是官网响应体（``email`` / ``can_resend`` 等），限流时额外塞入
    ``retry_after``（来自响应头），供路由回写 ``Retry-After``。
    """
    payload = dict(body) if isinstance(body, Mapping) else {}
    upstream_error = str(payload.get("error") or "").strip()
    code = upstream_error or default_code
    text = str(payload.get("message") or "").strip() if use_upstream_message else ""
    text = text or message
    if not text:
        text = _LOGIN_ERROR_MESSAGES.get(code) or _LOGIN_ERROR_MESSAGES.get(upstream_error, "")
    status = response.status_code
    if not text:
        text = f"登录失败（HTTP {status}）"
    retry_after = _retry_after_seconds(response)
    if retry_after is not None:
        payload["retry_after"] = retry_after
    return OAuthError(text, code, status=status, payload=payload, upstream_error=upstream_error)


__all__ = [
    "Credential",
    "DeepScientOAuthConfig",
    "DeepScientOAuthFlow",
    "LoginOutcome",
    "OAuthError",
    "PendingLogin",
    "PendingLogins",
    "account_center_url",
    "extra_from_user",
    "login_enabled",
    "mask",
    "normalize_user",
    "register_url",
]
