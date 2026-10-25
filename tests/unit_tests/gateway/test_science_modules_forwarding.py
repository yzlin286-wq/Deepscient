# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""science_modules.* 必须被 Web 网关转发到 AgentServer。

回归背景：``ReqMethod.SCIENCE_MODULES_LIST`` / ``SCIENCE_MODULES_ENTER`` 与
AgentServer 的 ``_PACKAGE_ROUTES`` 早已实现，但 Web 网关的
``_FORWARD_REQ_METHODS`` 漏登记，首页科研模块的请求在网关即被回
``unknown method: science_modules.list``。
"""

from __future__ import annotations

import json

from jiuwenswarm.common.schema.message import ReqMethod
from jiuwenswarm.gateway.channel_manager.base import RobotMessageRouter
from jiuwenswarm.gateway.channel_manager.web import app_web_handlers
from jiuwenswarm.gateway.channel_manager.web.web_connect import (
    WebChannel,
    WebChannelConfig,
)
from jiuwenswarm.server.runtime.agent_adapter import interface as agent_interface

SCIENCE_MODULE_METHODS = frozenset(
    {"science_modules.list", "science_modules.enter"}
)


class _FakeWs:
    """最小 ws 替身：仅需 connection user id 读取与 closed 标志。"""

    closed = False


def test_science_modules_in_web_forward_whitelists() -> None:
    assert SCIENCE_MODULE_METHODS.issubset(app_web_handlers._FORWARD_REQ_METHODS)
    # 无本地 handler，必须同时登记到 no-local 集合，否则转发后仍会落到
    # web_connect 的 ``unknown method`` 兜底分支。
    assert SCIENCE_MODULE_METHODS.issubset(
        app_web_handlers._FORWARD_NO_LOCAL_HANDLER_METHODS
    )


def test_science_modules_recognized_by_web_req_method_parser() -> None:
    assert WebChannel._parse_req_method("science_modules.list") is (
        ReqMethod.SCIENCE_MODULES_LIST
    )
    assert WebChannel._parse_req_method("science_modules.enter") is (
        ReqMethod.SCIENCE_MODULES_ENTER
    )


def test_science_modules_routed_by_agent_server_package_routes() -> None:
    routed = {method.value for method in agent_interface._PACKAGE_ROUTES}
    assert SCIENCE_MODULE_METHODS.issubset(routed)


async def _drive_web_request(method: str) -> tuple[list[str], list[dict]]:
    """用最小 WebChannel 走一遍 ``_handle_raw_message``。

    回调复刻 app_gateway ``_make_norm_and_forward`` 的判定：命中
    ``_FORWARD_REQ_METHODS`` 即视为已转发，并仅在同时命中 no-local 集合时
    返回 True 以中断后续本地兜底分支。
    """
    channel = WebChannel(WebChannelConfig(), RobotMessageRouter())
    forwarded: list[str] = []
    responses: list[dict] = []

    async def _on_message(msg) -> bool:
        value = getattr(getattr(msg, "req_method", None), "value", None) or ""
        if value not in app_web_handlers._FORWARD_REQ_METHODS:
            return False
        forwarded.append(value)
        return value in app_web_handlers._FORWARD_NO_LOCAL_HANDLER_METHODS

    async def _send_response(ws, req_id, *, ok, payload=None, error=None, code=None):
        responses.append(
            {"id": req_id, "ok": ok, "error": error, "code": code}
        )

    channel._on_message_cb = _on_message
    channel.send_response = _send_response

    raw = json.dumps({"type": "req", "id": "req-1", "method": method, "params": {}})
    await channel._handle_raw_message(_FakeWs(), raw, {})
    return forwarded, responses


async def test_science_modules_request_not_rejected_as_unknown_method() -> None:
    for method in sorted(SCIENCE_MODULE_METHODS):
        forwarded, responses = await _drive_web_request(method)
        assert forwarded == [method]
        assert responses == []


async def test_unregistered_method_still_rejected_as_unknown_method() -> None:
    forwarded, responses = await _drive_web_request("science_modules.unknown")
    assert forwarded == []
    assert len(responses) == 1
    assert responses[0]["code"] == "METHOD_NOT_FOUND"
    assert "unknown method" in (responses[0]["error"] or "")
