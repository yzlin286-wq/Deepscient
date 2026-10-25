# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""登录服务：各 channel 共用的唯一入口。

把「流程」(:class:`~jiuwenswarm.common.auth.deepscient_oauth.DeepScientOAuthFlow`)
和「会话」(:class:`~jiuwenswarm.common.auth.session_store.AuthSessionStore`) 粘起来：

* 发起授权 / 浏览器回调 / 发起方认领 / 刷新用户 / 登出 —— 接在 HTTP 路由上
  （``jiuwenswarm/gateway/channel_manager/web/web_http_auth.py``）

token 只在服务端流转：会话里保存官网签发的 access_token，前端只看得到用户与余额。
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from jiuwenswarm.common.auth.deepscient_oauth import (
    DeepScientOAuthFlow,
    OAuthError,
    extra_from_user,
    login_enabled,
    mask,
)
from jiuwenswarm.common.auth.session_store import (
    AuthSession,
    AuthSessionStore,
    get_session_store,
)

logger = logging.getLogger(__name__)


class AuthService:
    def __init__(
        self,
        flow: DeepScientOAuthFlow | None = None,
        store: AuthSessionStore | None = None,
    ) -> None:
        self._flow = flow or DeepScientOAuthFlow()
        self._store = store or get_session_store()

    @property
    def flow(self) -> DeepScientOAuthFlow:
        return self._flow

    @property
    def store(self) -> AuthSessionStore:
        return self._store

    @property
    def enabled(self) -> bool:
        return login_enabled(self._flow.config)

    def create_authorization_request(self, origin: str) -> dict[str, Any]:
        """返回 ``{authorizeUrl, state, claimToken, expiresIn, redirectUri}``。"""
        return self._flow.begin_authorization(origin)

    def complete_callback(
        self,
        state: str,
        code: str = "",
        error: str = "",
        error_description: str = "",
    ) -> AuthSession:
        """回调结果到手：换 token → 建会话 → 登记结果等发起方来认领。

        失败也要登记：发起方在等这个 state 的结果，不告诉它就只能干等到过期。
        state 本身无效的情况例外——那不是任何人发起的登录，没有人在等。
        """
        self._flow.pending.begin_callback(state)
        try:
            if error:
                if error == "access_denied":
                    raise OAuthError("已取消授权，请重新发起登录", "oauth_access_denied")
                detail = f"（{error_description}）" if error_description else ""
                raise OAuthError(f"官网账号授权失败：{error}{detail}", "oauth_callback_failed")
            if not code:
                raise OAuthError("回调里没有授权码", "oauth_callback_missing_params")
            outcome = self._flow.exchange_code(state, code)
        except OAuthError as err:
            self._flow.pending.finish(state, error=err)
            raise

        try:
            session = self._store.create(outcome)
        except Exception as exc:  # noqa: BLE001 — 存档写失败也得告诉发起方，否则它一直等到过期
            err = OAuthError("登录会话保存失败，请重试", "session_store_failed")
            self._flow.pending.finish(state, error=err)
            logger.warning("[Auth] 登录会话保存失败: %s", exc, exc_info=True)
            raise err from exc
        self._flow.pending.finish(state, session_id=session.session_id)
        self._schedule_partner_sync(session)
        return session

    def login_with_password(self, username: str, password: str) -> AuthSession:
        """应用内密码登录：换 token → 建会话。

        密码只在本次调用里往下传，``AuthSession`` 里只有 token 与用户字段。
        """
        if not self.enabled:
            raise OAuthError("登录未开启", "login_disabled")
        outcome = self._flow.exchange_password(username, password)
        try:
            session = self._store.create(outcome)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Auth] 登录会话保存失败: %s", exc, exc_info=True)
            raise OAuthError("登录会话保存失败，请重试", "session_store_failed") from exc
        self._schedule_partner_sync(session)
        return session

    def resend_verification(self, email: str) -> dict[str, Any]:
        """重发官网验证邮件；错误由流程层按官网错误体抛出。"""
        return self._flow.resend_verification(email)

    def _schedule_partner_sync(self, session: AuthSession) -> None:
        """中转站静默建号：后台线程，失败只留 warn/debug，绝不影响登录。"""
        try:
            from jiuwenswarm.common.partner.service import schedule_sync_after_login

            schedule_sync_after_login(session.user_id, session.user_name or "")
        except Exception:  # noqa: BLE001 — 登录成功不该被中转站拖垮
            logger.debug("[Auth] 中转站账号同步调度失败", exc_info=True)

    def claim(self, state: str, claim_token: str) -> AuthSession | None:
        """发起方取回登录结果。回调还没到返回 ``None``；登录失败抛 :class:`OAuthError`。"""
        session_id = self._flow.pending.claim(state, claim_token)
        if session_id is None:
            return None
        session = self._store.get(session_id)
        if session is None:
            # 回调和认领之间被登出了（或同账号在别处又登了一次，把它顶掉了）
            raise OAuthError("登录会话已失效，请重新登录", "session_expired")
        return session

    def cancel(self, state: str, claim_token: str) -> None:
        self._flow.pending.discard(state, claim_token)

    def logout(self, session_id: str | None) -> None:
        """登出**这个**会话：先撤销官网 token（失败不挡），再清本地。

        不能把"没带会话 id"当成"全部登出"：cookie 丢了的浏览器点一下退出，就会把这台
        机器上别的浏览器正在用的登录全清掉。
        """
        if not session_id:
            return
        session = self._store.get(session_id)
        if session is not None:
            try:
                self._flow.revoke(session.credential.access_token)
            except Exception:  # noqa: BLE001 — 撤销失败不该挡住本地登出
                logger.warning("[Auth] 撤销官网 token 失败，继续清本地会话", exc_info=True)
        self._store.remove(session_id)

    def resolve_session(self, session_id: str | None = None) -> AuthSession | None:
        """**严格**按 session id 取会话；没有 id 就是没有会话。"""
        if not session_id:
            return None
        return self._store.get(session_id)

    def status(self, session_id: str | None = None) -> dict[str, Any]:
        base: dict[str, Any] = {
            "enabled": self.enabled,
            "provider": self._flow.config.provider or "deepscient",
            "accountCenterUrl": self._flow.account_center_url(),
            "registerUrl": self._flow.register_url(),
        }
        session = self.resolve_session(session_id)
        if session is None:
            return {**base, "islogin": False, "userId": None}
        session = self.ensure_fresh(session)
        if session is None:
            return {**base, "islogin": False, "userId": None}
        return {**base, "islogin": True, **session.public_view()}

    def refresh_user(self, session_id: str | None) -> AuthSession | None:
        """向官网重新拉一次用户信息；官网说 401 就当作登出。"""
        session = self.resolve_session(session_id)
        if session is None:
            return None
        try:
            user = self._flow.fetch_user(session.credential.access_token)
        except OAuthError as error:
            if error.code == "oauth_unauthorized":
                self._store.remove(session.session_id)
                logger.info("[Auth] 官网判定登录已过期，已清本地会话 user=%s", mask(session.user_id))
                return None
            raise
        updated = self._store.update_extra(session.session_id, extra_from_user(user))
        if updated is None:
            logger.info("[Auth] 刷新用户信息时会话已注销 session=%s", mask(session.session_id))
        return updated

    def ensure_fresh(self, session: AuthSession) -> AuthSession | None:
        """只判断是否过期。官网没有给我方 refresh token 的续期约定，过期就重新登录。"""
        if session.credential.is_expired():
            logger.info("[Auth] 凭据已过期，需要重新登录 user=%s", mask(session.user_id))
            return None
        return session


_service: AuthService | None = None
_service_lock = threading.Lock()


def get_auth_service() -> AuthService:
    """进程级单例。"""
    global _service
    if _service is None:
        with _service_lock:
            if _service is None:
                _service = AuthService()
    return _service
