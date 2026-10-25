# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""DeepScient 官网账号登录（OAuth2 授权码 + PKCE）。

用法速查::

    from jiuwenswarm.common.auth import get_auth_service

    service = get_auth_service()
    req = service.create_authorization_request(origin)   # 打开 req["authorizeUrl"]
    ...                                                  # 官网回调 → service.complete_callback(...)
    session = service.claim(req["state"], req["claimToken"])
"""

from jiuwenswarm.common.auth.deepscient_oauth import (
    Credential,
    DeepScientOAuthConfig,
    DeepScientOAuthFlow,
    LoginOutcome,
    OAuthError,
    login_enabled,
    mask,
)
from jiuwenswarm.common.auth.service import AuthService, get_auth_service
from jiuwenswarm.common.auth.session_store import (
    AuthSession,
    AuthSessionStore,
    get_session_store,
)

__all__ = [
    "AuthService",
    "AuthSession",
    "AuthSessionStore",
    "Credential",
    "DeepScientOAuthConfig",
    "DeepScientOAuthFlow",
    "LoginOutcome",
    "OAuthError",
    "get_auth_service",
    "get_session_store",
    "login_enabled",
    "mask",
]
