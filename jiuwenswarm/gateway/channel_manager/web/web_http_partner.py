# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""ccagent 中转站路由。

==========================================  ==========================================
``GET  /api/v1/partner/status``              配置 + 绑定 + 在售套餐 + 最近订单（需登录）
``POST /api/v1/partner/ping``                连通自检（返回服务端量到的耗时，需登录）
``POST /api/v1/partner/sync``                同步账号，返回绑定投影（需登录）
``POST /api/v1/partner/refresh-models``      重新同步并下发全部 ccagent 模型（需登录）
``POST /api/v1/partner/backfill-model``      旧版单条目回填（需登录，保留兼容）
``POST /api/v1/partner/models``              拉取中转站可用模型（需登录）
``POST /api/v1/partner/buy-url``             换一次性购买页地址（需登录）
``POST /api/v1/partner/account-url``         换一次性额度页地址（需登录）
``GET  /api/v1/partner/binding``             本地绑定 + 上游是否存在（需登录）
``GET  /api/v1/partner/orders/{trade_no}``   订单（本地 + 上游合并，需登录）
``POST /partner/webhook``                    支付回填（公开，原始字节验签）
``GET  /partner/return``                     购买回跳页（公开，HTML）
==========================================  ==========================================

身份一律取自本机会话（``resolve_session_id`` + ``AuthService.resolve_session``），
**不接受客户端传来的 uid**。webhook 用原始 body 验签，绝不 ``json()`` 后再序列化。

错误映射：未配置 secret → ``409 partner-not-configured``；上游 ``401xx`` → ``502
relay-error``；``429`` → ``429 relay-rate-limited``；``40401/40403`` → ``404 not-found``；
其余 → ``502 relay-error``。日志只记 event_id / trade_no / 业务码 / 耗时。
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import Body, FastAPI, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from jiuwenswarm.common.auth.service import get_auth_service
from jiuwenswarm.common.partner import client as partner_client
from jiuwenswarm.common.partner import service
from jiuwenswarm.common.partner import store as partner_store
from jiuwenswarm.common.partner.errors import PartnerError
from jiuwenswarm.gateway.channel_manager.web.web_http_auth import resolve_session_id

logger = logging.getLogger(__name__)

_OPENAPI_TAG = "partner"


class PartnerSyncBody(BaseModel):
    displayName: str = ""  # noqa: N815 — 前端字段名


class PartnerBuyUrlBody(BaseModel):
    planId: Any = None  # noqa: N815 — 前端字段名，非法值交给 client 丢弃


class PartnerBackfillBody(BaseModel):
    modelName: str = ""  # noqa: N815 — 前端字段名；空则用 partner.default_model
    force: bool = False


def _error(message: str, code: str, status: int) -> JSONResponse:
    return JSONResponse(
        {"ok": False, "error": {"code": code, "message": message}}, status_code=status
    )


def _not_logged_in() -> JSONResponse:
    return _error("请先登录", "not_logged_in", 401)


def _map_error(error: PartnerError) -> JSONResponse:
    """上游/本机失败 → 本机语义化状态码。"""
    code = error.code
    if code in ("not_configured", "disabled"):
        return _error("中转站未配置", "partner-not-configured", 409)
    if code == "rate_limited" or error.status == 429:
        return _error(str(error), "relay-rate-limited", 429)
    if code in ("40401", "40403"):
        return _error(str(error), "not-found", 404)
    # 401xx 一律按「配置或时钟问题」归到 relay-error；重试没有意义。
    return _error(str(error), "relay-error", 502)


def _session_user_id(request: Request) -> str | None:
    session = get_auth_service().resolve_session(resolve_session_id(request))
    if session is None:
        return None
    return str(session.user_id or "").strip()


def register_partner_routes(app: FastAPI) -> None:

    @app.get(
        "/api/v1/partner/status",
        tags=[_OPENAPI_TAG],
        summary="中转站状态：配置 / 绑定 / 在售套餐 / 最近订单",
    )
    async def partner_status(request: Request) -> Response:
        uid = _session_user_id(request)
        if uid is None:
            return _not_logged_in()
        try:
            payload = await run_in_threadpool(service.status_for_user, uid)
        except PartnerError as error:
            logger.warning("[Partner] 状态查询失败 code=%s", error.code)
            return _map_error(error)
        return JSONResponse({"ok": True, **payload})

    @app.post(
        "/api/v1/partner/ping",
        tags=[_OPENAPI_TAG],
        summary="中转站连通自检",
    )
    async def partner_ping(request: Request) -> Response:
        uid = _session_user_id(request)
        if uid is None:
            return _not_logged_in()
        started = time.perf_counter()
        try:
            data = await run_in_threadpool(partner_client.ping)
        except PartnerError as error:
            logger.warning("[Partner] 连通自检失败 code=%s", error.code)
            return _map_error(error)
        latency_ms = int((time.perf_counter() - started) * 1000)
        logger.info("[Partner] 连通自检完成 latency_ms=%s", latency_ms)
        return JSONResponse(
            {
                "ok": True,
                "appId": data.get("app_id") or "",
                "ts": data.get("ts"),
                "latencyMs": latency_ms,
            }
        )

    @app.post(
        "/api/v1/partner/sync",
        tags=[_OPENAPI_TAG],
        summary="同步账号到中转站",
    )
    async def partner_sync(
        request: Request, body: PartnerSyncBody | None = Body(default=None)
    ) -> Response:
        uid = _session_user_id(request)
        if uid is None:
            return _not_logged_in()
        display_name = (body.displayName if body else "") or ""
        try:
            binding = await run_in_threadpool(service.sync_for_user, uid, display_name)
        except PartnerError as error:
            logger.warning("[Partner] 账号同步失败 code=%s", error.code)
            return _map_error(error)
        return JSONResponse({"ok": True, "binding": binding})

    @app.post(
        "/api/v1/partner/refresh-models",
        tags=[_OPENAPI_TAG],
        summary="重新同步中转站账号并下发全部可用模型",
    )
    async def partner_refresh_models(request: Request) -> Response:
        uid = _session_user_id(request)
        if uid is None:
            return _not_logged_in()
        try:
            payload = await run_in_threadpool(service.refresh_models_for_user, uid)
        except PartnerError as error:
            logger.warning("[Partner] 模型刷新失败 code=%s", error.code)
            return _map_error(error)
        return JSONResponse({"ok": True, **payload})

    @app.post(
        "/api/v1/partner/backfill-model",
        tags=[_OPENAPI_TAG],
        summary="把中转站凭据回填进 ccagent 模型条目（旧版兼容）",
    )
    async def partner_backfill_model(
        request: Request, body: PartnerBackfillBody | None = Body(default=None)
    ) -> Response:
        uid = _session_user_id(request)
        if uid is None:
            return _not_logged_in()
        model_name = (body.modelName if body else "") or ""
        force = bool(body.force) if body else False
        try:
            payload = await run_in_threadpool(
                service.backfill_for_user, uid, model_name, force
            )
        except PartnerError as error:
            logger.warning("[Partner] 模型回填失败 code=%s", error.code)
            return _map_error(error)
        return JSONResponse({"ok": True, **payload})

    @app.post(
        "/api/v1/partner/models",
        tags=[_OPENAPI_TAG],
        summary="拉取中转站可用模型列表",
    )
    async def partner_models(request: Request) -> Response:
        uid = _session_user_id(request)
        if uid is None:
            return _not_logged_in()
        try:
            payload = await run_in_threadpool(service.models_for_user, uid)
        except PartnerError as error:
            logger.warning("[Partner] 模型列表拉取失败 code=%s", error.code)
            return _map_error(error)
        return JSONResponse({"ok": True, **payload})

    @app.post(
        "/api/v1/partner/buy-url",
        tags=[_OPENAPI_TAG],
        summary="换一次性购买页地址",
    )
    async def partner_buy_url(
        request: Request, body: PartnerBuyUrlBody | None = Body(default=None)
    ) -> Response:
        uid = _session_user_id(request)
        if uid is None:
            return _not_logged_in()
        plan_id = body.planId if body else None
        try:
            data = await run_in_threadpool(service.buy_url_for_user, uid, plan_id)
        except PartnerError as error:
            logger.warning("[Partner] 生成购买链接失败 code=%s", error.code)
            return _map_error(error)
        return JSONResponse({"ok": True, **data})

    @app.post(
        "/api/v1/partner/account-url",
        tags=[_OPENAPI_TAG],
        summary="换一次性额度页地址",
    )
    async def partner_account_url(request: Request) -> Response:
        uid = _session_user_id(request)
        if uid is None:
            return _not_logged_in()
        try:
            data = await run_in_threadpool(service.account_url_for_user, uid)
        except PartnerError as error:
            logger.warning("[Partner] 生成额度页失败 code=%s", error.code)
            return _map_error(error)
        return JSONResponse({"ok": True, **data})

    @app.get(
        "/api/v1/partner/binding",
        tags=[_OPENAPI_TAG],
        summary="本地绑定 + 上游是否存在（没同步过仍是 200）",
    )
    async def partner_binding(request: Request) -> Response:
        uid = _session_user_id(request)
        if uid is None:
            return _not_logged_in()
        binding = await run_in_threadpool(partner_store.get_binding, uid)
        try:
            remote = await run_in_threadpool(partner_client.get_user, uid)
        except PartnerError as error:
            logger.warning("[Partner] 上游绑定查询失败 code=%s", error.code)
            return _map_error(error)
        return JSONResponse(
            {
                "ok": True,
                "binding": service.binding_projection(binding),
                "remote": remote,
            }
        )

    @app.get(
        "/api/v1/partner/orders/{trade_no}",
        tags=[_OPENAPI_TAG],
        summary="订单查询（不属于当前用户时 404）",
    )
    async def partner_order(request: Request, trade_no: str) -> Response:
        uid = _session_user_id(request)
        if uid is None:
            return _not_logged_in()
        started = time.perf_counter()
        try:
            payload = await run_in_threadpool(service.order_for_user, uid, trade_no)
        except PartnerError as error:
            logger.warning(
                "[Partner] 订单查询失败 trade_no=%s code=%s", trade_no, error.code
            )
            return _map_error(error)
        logger.info(
            "[Partner] 订单查询完成 trade_no=%s latency_ms=%s",
            trade_no,
            int((time.perf_counter() - started) * 1000),
        )
        return JSONResponse({"ok": True, **payload})

    @app.post(
        "/partner/webhook",
        tags=[_OPENAPI_TAG],
        summary="中转站支付回填（原始字节验签）",
        include_in_schema=False,
    )
    async def partner_webhook(request: Request) -> Response:
        # 必须用原始 body：先 json() 再序列化会改变键序/空白，验签必然失败。
        raw = await request.body()
        code, payload = await run_in_threadpool(service.handle_webhook, request.headers, raw)
        return JSONResponse(payload, status_code=code)

    @app.get(
        "/partner/return",
        tags=[_OPENAPI_TAG],
        summary="中转站购买回跳页",
        response_class=HTMLResponse,
        include_in_schema=False,
    )
    async def partner_return(
        trade_no: str = "", status: str = "success", sign: str = ""
    ) -> Response:
        code, html = await run_in_threadpool(service.return_page, trade_no, status, sign)
        return HTMLResponse(
            html, status_code=code, headers={"Cache-Control": "no-store"}
        )

    logger.info("[Partner] 已注册 /api/v1/partner/* 与 /partner/* 路由")
