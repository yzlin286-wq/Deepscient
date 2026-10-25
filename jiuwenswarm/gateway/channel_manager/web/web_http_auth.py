# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""Gateway Web HTTP 的登录路由（``/api/v1/auth/*``），DeepScient 官网账号。

====================================  ==========================================
``POST /api/v1/auth/authorize``       生成授权地址（后端做 state / PKCE）
``GET  /api/v1/auth/callback``        官网回调落点：换 token + 建会话 + 下 cookie
``GET  /auth/callback``               同上（回调地址的根路径形式，经 Web 通道转发）
``POST /api/v1/auth/claim``           发起方凭 ``{state, claimToken}`` 取回会话
``POST /api/v1/auth/cancel``          发起方凭 ``{state, claimToken}`` 放弃这次登录
``POST /api/v1/auth/password-login``  应用内密码登录（``grant_type=password``）
``POST /api/v1/auth/resend-verification``  重发邮箱验证邮件
``GET  /api/v1/auth/status``          当前登录状态（不含任何凭据）
``POST /api/v1/auth/refresh``         重新拉一次官网用户信息
``POST /api/v1/auth/logout``          撤销官网 token 并清会话
====================================  ==========================================

回调由浏览器直接访问，返回我们自己的落地页而不是 JSON。落地页经 ``BroadcastChannel``
通知同源的应用标签页并自行关闭；通知不到的（不同源、桌面端开在系统浏览器里），
由应用在窗口重新获得焦点时去 ``/claim``。

发起登录 / 密码登录 / 认领 / 取消 / 登出这几个 POST 必须带 ``X-Jiuwen-Auth: 1``
（见 :data:`AUTH_REQUEST_HEADER`）。

会话 id 同时接受 cookie（``jiuwenswarm_auth``）和 ``X-Auth-Session`` 头——
浏览器用 cookie，桌面 WebView / TUI 这类拿不到那份 cookie 的前端用请求头。

密码登录的请求体里带着明文密码：**不记录请求体、不记录密码**，只在本次上游请求里
使用一次，换到 token 后即丢弃（会话里只有 token 与用户字段）。
"""

from __future__ import annotations

import html
import logging
from typing import Annotated, Any
from urllib.parse import urlparse

from fastapi import Body, FastAPI, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel, Field

from jiuwenswarm.common.auth.deepscient_oauth import OAuthError
from jiuwenswarm.common.auth.service import get_auth_service
from jiuwenswarm.common.auth.session_store import AuthSession

logger = logging.getLogger(__name__)

_OPENAPI_TAG = "auth"
AUTH_SESSION_COOKIE = "jiuwenswarm_auth"
AUTH_SESSION_HEADER = "x-auth-session"
#: 回调落地页广播给应用标签页的频道名和消息类型，前端按它们识别（authClient.ts）。
AUTH_CALLBACK_CHANNEL = "jiuwenswarm:auth"
AUTH_CALLBACK_MESSAGE = "jiuwenswarm:auth-callback"
#: 发起登录 / 认领 / 登出必须带的请求头（值为 ``1``）。
#:
#: Gateway 监听在本机端口上，用户浏览的任何网页都能对它发"简单请求"——不带自定义头的
#: POST 不走 CORS 预检，浏览器照发不误，只是读不到响应。``/authorize`` 不需要 cookie，
#: SameSite 挡不住：不设防的话，一个网页就能不停地往内存里塞待登录记录。要求自定义头之后，
#: 跨站请求必须先过预检，而 Gateway 不开 CORS，预检不会通过。
AUTH_REQUEST_HEADER = "x-jiuwen-auth"
# cookie 存活时间与本地会话存档上限一致；token 是否还有效由 status 接口判定。
_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60
#: 这些失败是"连不上官网"，用 502 让前端区分网络问题与授权被拒。
_UPSTREAM_ERROR_CODES = frozenset({"oauth_network_error"})


class AuthClaimBody(BaseModel):
    state: str = Field(..., description="发起授权时返回的 state")
    claimToken: str = Field(..., description="发起授权时返回的 claimToken")  # noqa: N815 — 前端字段名


class AuthCallbackQuery(BaseModel):
    """官网授权回调的 query 参数。"""

    state: str = ""
    code: str = ""
    error: str = ""
    error_description: str = ""


class AuthPasswordLoginBody(BaseModel):
    """应用内密码登录。缺字段由路由判成 400，避免 pydantic 直接回 422。"""

    username: str = Field("", description="官网邮箱或用户名")
    password: str = Field("", description="密码，仅用于本次换取 token")


class AuthResendVerificationBody(BaseModel):
    email: str = Field("", description="注册邮箱")


def resolve_session_id(request: Request) -> str | None:
    """``X-Auth-Session`` 头优先，其次 cookie。"""
    header = (request.headers.get(AUTH_SESSION_HEADER) or "").strip()
    if header:
        return header
    cookie = (request.cookies.get(AUTH_SESSION_COOKIE) or "").strip()
    return cookie or None


def request_origin(request: Request) -> str:
    """回调要回到哪个源：``Origin`` → ``Referer`` 的 scheme://host → 本机 127.0.0.1。"""
    origin = (request.headers.get("origin") or "").strip()
    if origin:
        return origin.rstrip("/")
    referer = (request.headers.get("referer") or "").strip()
    if referer:
        parsed = urlparse(referer)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}"
    port = request.url.port or (443 if request.url.scheme == "https" else 80)
    return f"http://127.0.0.1:{port}"


def _error(message: str, code: str, status: int) -> JSONResponse:
    return JSONResponse({"ok": False, "error": {"code": code, "message": message}}, status_code=status)


def _flat_error(
    message: str,
    code: str,
    status: int,
    *,
    extra: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    """密码登录 / 重发验证邮件的错误体：``{ok,message,error,...}`` 平铺。"""
    body: dict[str, Any] = {"ok": False, "message": message, "error": code}
    if extra:
        body.update(extra)
    return JSONResponse(body, status_code=status, headers=headers or None)


def _oauth_error_response(error: OAuthError) -> JSONResponse:
    """按官网返回的状态码透传，并保留 ``email`` / ``can_resend`` / ``Retry-After``。"""
    if isinstance(error.status, int) and 400 <= error.status <= 599:
        status = error.status
    elif error.code == "login_disabled":
        status = 409
    elif error.code == "session_store_failed":
        status = 500
    else:
        status = 502 if error.code in _UPSTREAM_ERROR_CODES else 400

    payload = error.payload if isinstance(error.payload, dict) else {}
    extra: dict[str, Any] = {}
    email = payload.get("email")
    if isinstance(email, str) and email.strip():
        extra["email"] = email.strip()
    can_resend = payload.get("can_resend")
    if isinstance(can_resend, bool):
        extra["can_resend"] = can_resend

    headers: dict[str, str] = {}
    retry_after = payload.get("retry_after")
    if isinstance(retry_after, int) and not isinstance(retry_after, bool) and retry_after > 0:
        headers["Retry-After"] = str(retry_after)
    return _flat_error(str(error), error.code, status, extra=extra, headers=headers)


def _reject_without_auth_header(request: Request) -> JSONResponse | None:
    if request.headers.get(AUTH_REQUEST_HEADER) == "1":
        return None
    return _error("缺少请求头 X-Jiuwen-Auth", "auth_header_required", 403)


def _attach_session(response: Response, session: AuthSession, request: Request) -> None:
    response.set_cookie(
        AUTH_SESSION_COOKIE,
        session.session_id,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        path="/",
        max_age=_COOKIE_MAX_AGE_S,
    )
    # 拿不到这份cookie的前端（桌面 WebView、TUI）从响应头里取
    response.headers["X-Auth-Session"] = session.session_id


def _landing_page(ok: bool, title: str, detail: str, status: int = 200) -> HTMLResponse:
    """回调落地页，用户在官网授权页之后看到的唯一页面"""
    auto_close = "setTimeout(function(){window.close();},1200);" if ok else ""
    body = f"""<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<style>
body{{margin:0;font:15px/1.7 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
background:#f5f7f9;color:#141a21;display:flex;min-height:100vh;align-items:center;justify-content:center}}
main{{max-width:28rem;padding:2.5rem 2rem;text-align:center}}
h1{{font-size:1.25rem;margin:0 0 .5rem}}p{{margin:0;color:#58646f}}
@media (prefers-color-scheme:dark){{body{{background:#101419;color:#e4e9ef}}p{{color:#a0abb7}}}}
</style></head>
<body><main><h1>{html.escape(title)}</h1><p>{html.escape(detail)}</p></main>
<script>
try{{var c=new BroadcastChannel("{AUTH_CALLBACK_CHANNEL}");c.postMessage({{type:"{AUTH_CALLBACK_MESSAGE}",ok:{str(ok).lower()}}});c.close();}}catch(e){{}}
{auto_close}
</script></body></html>"""
    return HTMLResponse(
        body,
        status_code=status,
        # URL里带着授权码，不能进缓存
        headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"},
    )


def register_auth_routes(app: FastAPI) -> None:

    @app.post(
        "/api/v1/auth/authorize",
        tags=[_OPENAPI_TAG],
        summary="发起登录：返回浏览器要打开的官网授权地址",
    )
    async def auth_authorize(request: Request) -> Response:
        rejected = _reject_without_auth_header(request)
        if rejected is not None:
            return rejected
        service = get_auth_service()

        def _authorize() -> Response:
            if not service.enabled:
                return _error("登录未开启", "login_disabled", 404)
            try:
                return JSONResponse(service.create_authorization_request(request_origin(request)))
            except OAuthError as error:
                logger.warning("[Auth] 无法发起登录: %s (%s)", error, error.code)
                return _error(str(error), error.code, 503)

        return await run_in_threadpool(_authorize)

    @app.post(
        "/api/v1/auth/password-login",
        tags=[_OPENAPI_TAG],
        summary="应用内密码登录（官网 password grant），成功下发会话",
    )
    async def auth_password_login(
        request: Request, body: AuthPasswordLoginBody = Body(...)
    ) -> Response:
        rejected = _reject_without_auth_header(request)
        if rejected is not None:
            return rejected
        username = (body.username or "").strip()
        # 密码只在这条调用链里出现：不落日志、不进响应。
        password = body.password or ""
        if not username or not password:
            return _flat_error("请填写账号与密码", "invalid_request", 400)
        service = get_auth_service()
        if not await run_in_threadpool(lambda: service.enabled):
            return _flat_error("登录未开启", "auth-disabled", 409)
        try:
            session = await run_in_threadpool(service.login_with_password, username, password)
        except OAuthError as err:
            logger.warning("[Auth] 密码登录失败 code=%s status=%s", err.code, err.status)
            return _oauth_error_response(err)
        status = await run_in_threadpool(service.status, session.session_id)
        response = JSONResponse({"ok": True, **status})
        _attach_session(response, session, request)
        return response

    @app.post(
        "/api/v1/auth/resend-verification",
        tags=[_OPENAPI_TAG],
        summary="重发邮箱验证邮件",
    )
    async def auth_resend_verification(
        request: Request, body: AuthResendVerificationBody = Body(...)
    ) -> Response:
        rejected = _reject_without_auth_header(request)
        if rejected is not None:
            return rejected
        email = (body.email or "").strip()
        if not email:
            return _flat_error("请填写邮箱", "invalid_request", 400)
        service = get_auth_service()
        if not await run_in_threadpool(lambda: service.enabled):
            return _flat_error("登录未开启", "auth-disabled", 409)
        try:
            result = await run_in_threadpool(service.resend_verification, email)
        except OAuthError as err:
            logger.warning("[Auth] 重发验证邮件失败 code=%s status=%s", err.code, err.status)
            return _oauth_error_response(err)
        resend_after = result.get("resend_after") if isinstance(result, dict) else None
        if not isinstance(resend_after, int) or isinstance(resend_after, bool) or resend_after <= 0:
            resend_after = 60
        return JSONResponse({"ok": True, "resend_after": resend_after})

    async def _handle_callback(request: Request, query: AuthCallbackQuery) -> Response:
        service = get_auth_service()
        if not await run_in_threadpool(lambda: service.enabled):
            return _landing_page(False, "登录未开启", "请回到应用。", 404)
        if query.error:
            logger.warning(
                "[Auth] 官网回调带错误 error=%s error_description=%s",
                query.error,
                query.error_description or "-",
            )
        try:
            session = await run_in_threadpool(
                service.complete_callback,
                query.state.strip(),
                query.code.strip(),
                query.error.strip(),
                query.error_description.strip(),
            )
        except OAuthError as err:
            logger.warning("[Auth] 回调处理失败: %s (%s)", err, err.code)
            if err.code == "oauth_state_invalid":
                # 不回显细节：这不是任何人发起的登录（或已过期），统一一个中性页面
                return _landing_page(False, "登录链接已失效", "请回到应用重新发起登录。", 400)
            status = 502 if err.code in _UPSTREAM_ERROR_CODES else 400
            return _landing_page(False, "登录未完成", f"{err}", status)

        response = _landing_page(True, "官网账号登录成功", "请回到应用继续使用，这个页面可以关闭。")
        _attach_session(response, session, request)
        return response

    @app.get(
        "/api/v1/auth/callback",
        tags=[_OPENAPI_TAG],
        summary="官网授权回调（浏览器访问，返回落地页）",
        response_class=HTMLResponse,
    )
    @app.get(
        "/auth/callback",
        tags=[_OPENAPI_TAG],
        summary="官网授权回调（根路径形式，经 Web 通道转发）",
        response_class=HTMLResponse,
        include_in_schema=False,
    )
    async def auth_callback(
        request: Request,
        query: Annotated[AuthCallbackQuery, Query()],
    ) -> Response:
        return await _handle_callback(request, query)

    @app.post(
        "/api/v1/auth/claim",
        tags=[_OPENAPI_TAG],
        summary="取回登录结果（202=授权还没完成，200=登录成功并下发会话）",
    )
    async def auth_claim(request: Request, body: AuthClaimBody = Body(...)) -> Response:
        rejected = _reject_without_auth_header(request)
        if rejected is not None:
            return rejected
        service = get_auth_service()
        if not await run_in_threadpool(lambda: service.enabled):
            return _error("登录未开启", "login_disabled", 404)
        try:
            session = await run_in_threadpool(service.claim, body.state.strip(), body.claimToken.strip())
        except OAuthError as err:
            return _error(str(err), err.code, 400)
        if session is None:
            return JSONResponse({"ok": True, "pending": True}, status_code=202)
        status = await run_in_threadpool(service.status, session.session_id)
        response = JSONResponse({"ok": True, **status})
        _attach_session(response, session, request)
        return response

    @app.post(
        "/api/v1/auth/cancel",
        tags=[_OPENAPI_TAG],
        summary="放弃这次登录",
    )
    async def auth_cancel(request: Request, body: AuthClaimBody = Body(...)) -> Response:
        rejected = _reject_without_auth_header(request)
        if rejected is not None:
            return rejected
        # 不区分state存不存在、对不对得上：不给探测留信号
        get_auth_service().cancel(body.state.strip(), body.claimToken.strip())
        return JSONResponse({"ok": True})

    @app.get(
        "/api/v1/auth/status",
        tags=[_OPENAPI_TAG],
        summary="当前登录状态（不含任何凭据）",
    )
    async def auth_status(request: Request) -> Response:
        service = get_auth_service()
        return JSONResponse(await run_in_threadpool(service.status, resolve_session_id(request)))

    @app.post(
        "/api/v1/auth/refresh",
        tags=[_OPENAPI_TAG],
        summary="向官网重新拉一次用户信息",
    )
    async def auth_refresh(request: Request) -> Response:
        service = get_auth_service()
        session_id = resolve_session_id(request)
        if await run_in_threadpool(lambda: service.resolve_session(session_id)) is None:
            return _error("请先登录", "not_logged_in", 401)
        try:
            session = await run_in_threadpool(service.refresh_user, session_id)
        except OAuthError as err:
            status = 502 if err.code in _UPSTREAM_ERROR_CODES else 400
            return _error(str(err), err.code, status)
        if session is None:
            return _error("登录已过期，请重新登录", "oauth_unauthorized", 401)
        status = await run_in_threadpool(service.status, session.session_id)
        return JSONResponse({"ok": True, **status})

    @app.post("/api/v1/auth/logout", tags=[_OPENAPI_TAG], summary="退出登录")
    async def auth_logout(request: Request) -> Response:
        rejected = _reject_without_auth_header(request)
        if rejected is not None:
            return rejected
        service = get_auth_service()
        await run_in_threadpool(service.logout, resolve_session_id(request))
        response = JSONResponse({"ok": True, "islogin": False})
        response.delete_cookie(AUTH_SESSION_COOKIE, path="/")
        return response

    logger.info("[Auth] 已注册 /api/v1/auth/* 登录路由")
