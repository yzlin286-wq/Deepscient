# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""中转站签名：请求头签名、Webhook 验签、回跳验签。

公式（与 ``Deepscient/deepscient/docs/relay.md`` 第 4/6/7 节逐条一致）::

    payload_digest = hex(sha256(实际发送的请求体字节))     # POST / PUT / PATCH
                   = canonical_query                      # GET / DELETE
    string_to_sign = app_id + "\\n" + ts + "\\n" + nonce + "\\n" + payload_digest
    signature      = hex(hmac_sha256(app_secret, string_to_sign))

    webhook: hmac_sha256(secret, app_id + "\\n" + ts + "\\n" + event_id + "\\n" + hex(sha256(raw_body)))
    return : hmac_sha256(secret, "return:" + trade_no + ":" + status)

**签名只看原始字节**：POST 的摘要必须基于实际发出去的那份 ``bytes``。
比较一律走 :func:`hmac.compare_digest`。
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
import time
from collections.abc import Iterable, Mapping
from typing import Any
from urllib.parse import parse_qsl, quote, urlsplit, urlencode

from jiuwenswarm.common.partner.config import partner_config
from jiuwenswarm.common.partner.errors import PartnerError

WEBHOOK_TOLERANCE_SECONDS = 300
_BODY_METHODS = frozenset({"POST", "PUT", "PATCH"})
_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_NONCE_ALPHABET = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


def _entries(params: Any) -> list[tuple[str, str]]:
    """把 dict / [(k, v)] / query 字符串统一摊平成 ``[(key, value)]``。"""
    if not params:
        return []
    if isinstance(params, str):
        text = params[1:] if params.startswith("?") else params
        return parse_qsl(text, keep_blank_values=True) if text else []
    if isinstance(params, (bytes, bytearray)):
        return _entries(bytes(params).decode("utf-8", "replace"))
    if isinstance(params, Mapping):
        items: list[tuple[str, str]] = []
        for key, value in params.items():
            if value is None:
                continue
            if isinstance(value, (list, tuple, set)):
                for item in value:
                    if item is not None:
                        items.append((str(key), str(item)))
            else:
                items.append((str(key), str(value)))
        return items
    if isinstance(params, Iterable):
        items = []
        for pair in params:
            try:
                key, value = pair
            except (TypeError, ValueError):
                continue
            if value is None:
                continue
            items.append((str(key), str(value)))
        return items
    return []


def canonical_query(params: Any) -> str:
    """``key`` 升序、同 ``key`` 按 ``value`` 升序，逐项 urlencode 后 ``&`` 连接。

    无参数返回空串（GET 无 query 时的 payload digest 就是 ``""``）。
    """
    items = sorted(_entries(params), key=lambda pair: (pair[0], pair[1]))
    if not items:
        return ""
    return urlencode(items, quote_via=quote, safe="")


def payload_digest(method: str, body_bytes: bytes | bytearray | str | None, query: Any = "") -> str:
    """载荷摘要：写方法用原始字节的 sha256，读方法用 canonical query。"""
    verb = str(method or "GET").upper()
    if verb in _BODY_METHODS:
        if isinstance(body_bytes, str):
            raw = body_bytes.encode("utf-8")
        else:
            raw = bytes(body_bytes or b"")
        return hashlib.sha256(raw).hexdigest()
    return canonical_query(query)


def _header(headers: Any, name: str) -> str:
    """大小写不敏感地取请求头的第一个值。"""
    if not headers:
        return ""
    target = name.lower()
    try:
        items = headers.items()
    except AttributeError:
        return ""
    for key, value in items:
        if str(key).lower() != target:
            continue
        if isinstance(value, (list, tuple)):
            value = value[0] if value else ""
        return str(value or "").strip()
    return ""


def sign_headers(
    method: str,
    path_with_query: str,
    body_bytes: bytes | bytearray | str | None,
    *,
    ts: int | str | None = None,
    nonce: str | None = None,
) -> dict[str, str]:
    """生成四个签名头（``X-Partner-App-Id/Timestamp/Nonce/Signature``）。"""
    config = partner_config()
    if not config.app_id:
        raise PartnerError("中转站未配置 app_id", code="not_configured", status=0)
    if not config.secret:
        raise PartnerError("中转站未配置 app_secret", code="not_configured", status=0)

    timestamp = str(int(time.time())) if ts is None else str(ts).strip()
    if not timestamp.isdigit():
        raise PartnerError("中转站时间戳不合法", code="bad_timestamp", status=0)
    nonce_value = secrets.token_hex(8) if nonce is None else str(nonce).strip()
    if not _NONCE_ALPHABET.match(nonce_value):
        raise PartnerError("中转站 nonce 不合法", code="bad_nonce", status=0)

    query = urlsplit(path_with_query or "/").query
    digest = payload_digest(method, body_bytes, query)
    string_to_sign = f"{config.app_id}\n{timestamp}\n{nonce_value}\n{digest}"
    signature = hmac.new(
        config.secret.encode("utf-8"),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return {
        "X-Partner-App-Id": config.app_id,
        "X-Partner-Timestamp": timestamp,
        "X-Partner-Nonce": nonce_value,
        "X-Partner-Signature": signature,
    }


def verify_webhook(headers: Any, raw_body: bytes | bytearray | str) -> tuple[bool, str]:
    """Webhook 验签：原始字节 + 300 秒时间窗 + 头体 ``event_id`` 一致。

    Returns:
        ``(ok, reason)``；通过时 reason 为空串。
    """
    config = partner_config()
    if not config.secret:
        return False, "not-configured"

    event_id = _header(headers, "X-Partner-Event-Id")
    timestamp = _header(headers, "X-Partner-Timestamp")
    signature = _header(headers, "X-Partner-Signature").lower()

    if not event_id:
        return False, "missing-event-id"
    if not timestamp:
        return False, "missing-timestamp"
    if not signature:
        return False, "missing-signature"
    if not timestamp.isdigit():
        return False, "bad-timestamp"
    if abs(time.time() - int(timestamp)) > WEBHOOK_TOLERANCE_SECONDS:
        return False, "timestamp-out-of-range"

    raw = raw_body.encode("utf-8") if isinstance(raw_body, str) else bytes(raw_body or b"")
    digest = hashlib.sha256(raw).hexdigest()
    string_to_sign = f"{config.app_id}\n{timestamp}\n{event_id}\n{digest}"
    expected = hmac.new(
        config.secret.encode("utf-8"),
        string_to_sign.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not _HEX64.match(signature) or not hmac.compare_digest(expected, signature):
        return False, "bad-signature"

    # 头与正文必须指向同一个事件：只验签不核对，"合法签名 + 换正文" 就有缝可钻。
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return False, "bad-json"
    body_event_id = payload.get("event_id") if isinstance(payload, dict) else None
    if str(body_event_id or "").strip() != event_id:
        return False, "event-id-mismatch"
    return True, ""


def verify_return_sign(trade_no: str, status: str, sign: str) -> bool:
    """回跳签名：``return:<trade_no>:<status>``，不掺 app_id。"""
    config = partner_config()
    if not config.secret:
        return False
    trade = str(trade_no or "").strip()
    state = str(status or "").strip() or "success"
    got = str(sign or "").strip().lower()
    if not trade or not _HEX64.match(got):
        return False
    expected = hmac.new(
        config.secret.encode("utf-8"),
        f"return:{trade}:{state}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, got)
