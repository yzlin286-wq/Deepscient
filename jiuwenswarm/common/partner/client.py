# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""中转站 ``/partner/v1`` 上游调用。

所有请求的唯一出口是 :func:`relay_request`：

* body **只序列化一次**，同一份 ``bytes`` 既用于签名也用于发送；
* 超时取配置（默认 10 秒）；
* 只对 ``429`` / ``5xx`` / 网络错误退避重试 ``1s → 2s → 4s``（最多 4 次尝试），
  每次重试重新生成 nonce（复用 nonce 会被上游判 ``40103``）；``4xx`` 直接失败；
* 解析 ``{code, message, data}``：``code != 0`` 抛 :class:`PartnerError`，
  ``40401`` / ``40403`` 保留业务码，``429`` 映射成 ``rate_limited``。
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

from jiuwenswarm.common.auth.net import requests_request

from jiuwenswarm.common.partner.config import PARTNER_PREFIX, partner_config
from jiuwenswarm.common.partner.errors import PartnerError
from jiuwenswarm.common.partner.signing import canonical_query, sign_headers

logger = logging.getLogger(__name__)

#: 与中转站文档一致的退避序列；长度即最大重试次数（共 4 次尝试）。
RETRY_DELAYS_SECONDS: tuple[int, ...] = (1, 2, 4)

#: 套餐缓存：进程内 60 秒（配置可改）。购买页会被频繁打开，但套餐不会按秒变。
_plans_cache: dict[str, Any] = {"at": 0.0, "items": []}


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _query_string(query: Any) -> str:
    if not query:
        return ""
    if isinstance(query, str):
        return query[1:] if query.startswith("?") else query
    if isinstance(query, dict):
        pairs = [(str(key), str(value)) for key, value in query.items() if value is not None]
        return urlencode(pairs)
    try:
        return urlencode([(str(key), str(value)) for key, value in query])
    except (TypeError, ValueError):
        return canonical_query(query)


def _positive_plan_id(plan_id: Any) -> int:
    """只接受正整数（含整数值浮点与纯数字字符串），其余一律不发。"""
    if plan_id is None or isinstance(plan_id, bool):
        return 0
    if isinstance(plan_id, int):
        return plan_id if plan_id > 0 else 0
    if isinstance(plan_id, float):
        return int(plan_id) if plan_id.is_integer() and plan_id > 0 else 0
    if isinstance(plan_id, str):
        text = plan_id.strip()
        return int(text) if text.isdigit() and int(text) > 0 else 0
    return 0


def _request_body(body: Any) -> bytes:
    """JSON 只序列化一次；调用方给 ``bytes`` 时原样使用。"""
    if body is None:
        return b""
    if isinstance(body, (bytes, bytearray)):
        return bytes(body)
    if isinstance(body, str):
        return body.encode("utf-8")
    return json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _error_from_response(status: int, code: Any, message: str) -> PartnerError:
    code_text = "" if code is None else str(code)
    if status == 429 or code_text == "42901":
        return PartnerError(
            message or "中转站请求过于频繁",
            code="rate_limited",
            status=status or 429,
            upstream_code=code_text,
        )
    if code_text in ("40401", "40403"):
        return PartnerError(message, code=code_text, status=status or 404, upstream_code=code_text)
    if status == 404 and not code_text:
        return PartnerError(message, code="404", status=404)
    return PartnerError(message, code=code_text, status=status)


def relay_request(
    method: str,
    path: str,
    *,
    query: Any = None,
    body: Any = None,
) -> Any:
    """发一次 ``/partner/v1`` 请求并返回 ``data``。"""
    config = partner_config()
    if not config.enabled:
        raise PartnerError("中转站未启用", code="not_configured", status=0)
    if not config.secret:
        raise PartnerError("中转站未配置 app_secret", code="not_configured", status=0)

    verb = str(method or "GET").upper()
    url_path = path if path.startswith("/") else f"/{path}"
    search = _query_string(query)
    path_with_query = f"{url_path}?{search}" if search else url_path
    url = f"{config.base_url}{path_with_query}"

    raw_body = _request_body(body)
    has_body = verb not in ("GET", "DELETE") and body is not None

    attempts = len(RETRY_DELAYS_SECONDS) + 1
    for attempt in range(attempts):
        headers = sign_headers(verb, path_with_query, raw_body)
        if has_body:
            headers["Content-Type"] = "application/json"

        try:
            response = requests_request(
                verb,
                url,
                headers=headers,
                data=raw_body if has_body else None,
                timeout=config.request_timeout_seconds,
            )
        except Exception:  # noqa: BLE001 — 网络层错误统一按可重试处理
            # 只记请求方法与路径：异常对象里可能挂着带签名头的 request。
            if attempt < len(RETRY_DELAYS_SECONDS):
                logger.warning("[Partner] 中转站请求失败，准备重试（%s %s）", verb, url_path)
                _sleep(RETRY_DELAYS_SECONDS[attempt])
                continue
            raise PartnerError(
                "中转站请求失败（网络错误）", code="network_error", status=0
            ) from None

        status = int(getattr(response, "status_code", 0) or 0)
        text = getattr(response, "text", "") or ""
        payload: Any = None
        if text:
            try:
                payload = json.loads(text)
            except (TypeError, ValueError):
                payload = None

        code = payload.get("code") if isinstance(payload, dict) else None
        message = ""
        if isinstance(payload, dict) and isinstance(payload.get("message"), str):
            message = payload["message"].strip()
        if not message:
            message = f"中转站返回 HTTP {status}"

        if 200 <= status < 300 and code == 0:
            return payload.get("data") if isinstance(payload, dict) else None

        retryable = status == 429 or status >= 500 or code in (42901, 50001)
        if retryable and attempt < len(RETRY_DELAYS_SECONDS):
            logger.warning(
                "[Partner] 中转站请求失败，准备重试（%s %s / HTTP %s / code %s）",
                verb,
                url_path,
                status,
                code if code is not None else "-",
            )
            _sleep(RETRY_DELAYS_SECONDS[attempt])
            continue
        raise _error_from_response(status, code, message)

    # 循环一定会 return 或 raise；这里只为了静态可读性。
    raise PartnerError("中转站请求失败", code="network_error", status=0)


def ping() -> dict[str, Any]:
    """连通自检：能通说明 app_id、secret、时钟三者都对。"""
    data = relay_request("GET", f"{PARTNER_PREFIX}/ping")
    return data if isinstance(data, dict) else {}


def sync_user(external_uid: str, display_name: str = "") -> dict[str, Any]:
    """同步账号。上游幂等：同一 ``external_uid`` 返回同一个 ``user_id`` 与 ``api_key``。

    返回的 ``apiKey`` 是明文，**只在内存里交给 service 落掩码**，不写日志、不回前端。
    """
    uid = _text(external_uid)
    if not uid:
        raise PartnerError("externalUid 不能为空", code="bad-request", status=0)

    body: dict[str, Any] = {"external_uid": uid}
    name = _text(display_name)[:30]
    if name:
        body["display_name"] = name

    data = relay_request("POST", f"{PARTNER_PREFIX}/users/sync", body=body)
    source = data if isinstance(data, dict) else {}
    return {
        "externalUid": uid,
        "userId": source.get("user_id"),
        "username": _text(source.get("username")),
        "apiKey": _text(source.get("api_key")),
        "apiBaseUrl": _text(source.get("api_base_url")),
        "syncedAt": _now_iso(),
    }


def get_user(external_uid: str) -> dict[str, Any]:
    """查绑定。「没同步过」在上游是 ``40401``，属于正常业务结果，不往上抛。"""
    uid = _text(external_uid)
    if not uid:
        raise PartnerError("externalUid 不能为空", code="bad-request", status=0)
    try:
        data = relay_request("GET", f"{PARTNER_PREFIX}/users/{uid}")
    except PartnerError as error:
        if error.code == "40401":
            return {"found": False, "externalUid": uid}
        raise
    source = data if isinstance(data, dict) else {}
    return {
        "found": True,
        "externalUid": uid,
        "userId": source.get("user_id"),
        "username": _text(source.get("username")),
        "apiBaseUrl": _text(source.get("api_base_url")),
    }


def list_plans(force: bool = False) -> list[dict[str, Any]]:
    """在售套餐（进程内缓存，默认 60 秒；``force=True`` 绕过）。"""
    config = partner_config()
    now = time.monotonic()
    ttl = float(config.plans_cache_seconds)
    items = _plans_cache.get("items") or []
    if not force and _plans_cache.get("at") and now - float(_plans_cache["at"]) < ttl:
        return [dict(item) for item in items]

    data = relay_request("GET", f"{PARTNER_PREFIX}/plans")
    fresh = [item for item in data if isinstance(item, dict)] if isinstance(data, list) else []
    _plans_cache["at"] = now
    _plans_cache["items"] = fresh
    return [dict(item) for item in fresh]


def create_buy_url(
    external_uid: str,
    plan_id: Any = None,
    return_url: str = "",
) -> dict[str, Any]:
    """换一次性购买页地址（300 秒、只能打开一次）。``plan_id`` 非正整数不发给上游。"""
    uid = _text(external_uid)
    if not uid:
        raise PartnerError("externalUid 不能为空", code="bad-request", status=0)

    body: dict[str, Any] = {"external_uid": uid}
    plan = _positive_plan_id(plan_id)
    if plan:
        body["plan_id"] = plan
    back = _text(return_url)
    if back:
        body["return_url"] = back

    data = relay_request("POST", f"{PARTNER_PREFIX}/buy-url", body=body)
    return data if isinstance(data, dict) else {}


def create_account_url(external_uid: str) -> dict[str, Any]:
    """换一次性「我的额度」页地址（同样 300 秒、一次性）。"""
    uid = _text(external_uid)
    if not uid:
        raise PartnerError("externalUid 不能为空", code="bad-request", status=0)
    data = relay_request("POST", f"{PARTNER_PREFIX}/account-url", body={"external_uid": uid})
    return data if isinstance(data, dict) else {}


def get_order(trade_no: str) -> dict[str, Any]:
    """订单对账兜底。上游对「不存在」和「不属于本 app」都回 ``40403``。"""
    no = _text(trade_no)
    if not no:
        raise PartnerError("tradeNo 不能为空", code="bad-request", status=0)
    data = relay_request("GET", f"{PARTNER_PREFIX}/orders/{no}")
    return data if isinstance(data, dict) else {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
