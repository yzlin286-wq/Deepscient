# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""中转站本地库：绑定 / 订单 / 事件。

落盘在 ``<数据根>/science/partner.json``（0600，临时文件 + ``os.replace`` 原子写）。

结构::

    {"version": 1,
     "bindings": {<externalUid>: {externalUid, userId, username, apiBaseUrl, apiKeyMasked, syncedAt}},
     "orders":   {<tradeNo>:     {tradeNo, externalUid, ..., eventId, receivedAt, source}},
     "events":   {<eventId>:     {eventId, event, occurredAt, tradeNo, receivedAt}}}

**绝不存明文 api_key**：绑定里只有掩码（前 3 + 后 4，短 Key 全遮）。
订单与事件的写在同一把锁、同一次读-改-写里完成，``event_id`` 幂等。
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import threading
from datetime import datetime, timezone
from typing import Any

from jiuwenswarm.common.partner.config import store_path
from jiuwenswarm.common.partner.errors import PartnerError

logger = logging.getLogger(__name__)

STORE_VERSION = 1
#: 绑定/订单/事件都在一个文件里，写操作必须串行。
_LOCK = threading.RLock()

#: 上游订单字段（snake_case）→ 本地字段（camelCase）。
_ORDER_FIELDS: tuple[tuple[str, str], ...] = (
    ("tradeNo", "trade_no"),
    ("externalUid", "external_uid"),
    ("userId", "user_id"),
    ("planId", "plan_id"),
    ("planTitle", "plan_title"),
    ("amount", "amount"),
    ("currency", "currency"),
    ("status", "status"),
    ("startTime", "start_time"),
    ("endTime", "end_time"),
    ("group", "group"),
)


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def mask_key(key: Any) -> str:
    """展示/落盘用的 Key 掩码：前 3 + 后 4，长度不足以藏住时全遮。"""
    text = _text(key)
    if not text:
        return ""
    if len(text) <= 8:
        return "••••"
    return f"{text[:3]}•••{text[-4:]}"


def _empty_store() -> dict[str, Any]:
    return {"version": STORE_VERSION, "bindings": {}, "orders": {}, "events": {}}


def _normalize(raw: Any) -> dict[str, Any]:
    store = raw if isinstance(raw, dict) else {}
    for key in ("bindings", "orders", "events"):
        if not isinstance(store.get(key), dict):
            store[key] = {}
    store["version"] = STORE_VERSION
    return store


def _read() -> dict[str, Any]:
    path = store_path()
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return _empty_store()
    try:
        return _normalize(json.loads(text))
    except (TypeError, ValueError):
        # 坏文件当空库，但留一份 .broken：里面可能有还没导出的订单。
        try:
            backup = path.with_name(f"{path.name}.broken")
            backup.write_text(text, encoding="utf-8")
            os.chmod(backup, 0o600)
        except OSError:
            pass
        logger.warning("[Partner] 本地库文件不可解析，已按空库处理 trade=%s", path.name)
        return _empty_store()


def _write(store: dict[str, Any]) -> None:
    path = store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp")
    tmp.write_text(
        json.dumps(store, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    try:
        os.chmod(tmp, 0o600)
    except OSError:  # pragma: no cover — 平台差异
        pass
    os.replace(tmp, path)
    try:
        os.chmod(path, 0o600)
    except OSError:  # pragma: no cover — 平台差异
        pass


def load() -> dict[str, Any]:
    """整库读取（只读快照，修改请走下面的业务函数）。"""
    with _LOCK:
        return _read()


def save(store: dict[str, Any]) -> None:
    """整库写入（原子）。"""
    with _LOCK:
        _write(_normalize(store))


# ── 绑定 ────────────────────────────────────────────────────────────────


def get_binding(external_uid: str) -> dict[str, Any] | None:
    uid = _text(external_uid)
    if not uid:
        return None
    with _LOCK:
        record = _read()["bindings"].get(uid)
    return dict(record) if isinstance(record, dict) else None


def save_binding(
    external_uid: str,
    *,
    user_id: Any = None,
    username: str = "",
    api_key: str = "",
    api_base_url: str = "",
    synced_at: str | None = None,
) -> dict[str, Any]:
    """写绑定。``api_key`` 为空表示这次没拿到新 Key，保留原掩码。"""
    uid = _text(external_uid)
    if not uid:
        raise PartnerError("externalUid 不能为空", code="bad-request", status=0)

    plain_key = _text(api_key)
    with _LOCK:
        store = _read()
        previous = store["bindings"].get(uid)
        previous = previous if isinstance(previous, dict) else {}
        record = {
            "externalUid": uid,
            "userId": user_id if user_id is not None else previous.get("userId"),
            "username": _text(username) or _text(previous.get("username")),
            "apiBaseUrl": _text(api_base_url) or _text(previous.get("apiBaseUrl")),
            "apiKeyMasked": mask_key(plain_key) or _text(previous.get("apiKeyMasked")),
            "syncedAt": synced_at or _text(previous.get("syncedAt")) or _now_iso(),
        }
        store["bindings"][uid] = record
        _write(store)
    return dict(record)


# ── 订单与事件 ──────────────────────────────────────────────────────────


def _order_from_api(data: Any) -> dict[str, Any]:
    source = data if isinstance(data, dict) else {}
    return {key: source[field] for key, field in _ORDER_FIELDS if field in source}


def _order_view(order: Any) -> dict[str, Any] | None:
    if not isinstance(order, dict):
        return None
    return {
        "tradeNo": _text(order.get("tradeNo")),
        "externalUid": _text(order.get("externalUid")),
        "userId": order.get("userId"),
        "planId": order.get("planId"),
        "planTitle": _text(order.get("planTitle")),
        "amount": order.get("amount", ""),
        "currency": _text(order.get("currency")),
        "status": _text(order.get("status")),
        "startTime": order.get("startTime", 0),
        "endTime": order.get("endTime", 0),
        "group": _text(order.get("group")),
        "eventId": order.get("eventId"),
        "receivedAt": order.get("receivedAt"),
        "source": _text(order.get("source")),
    }


def _merge_order(
    store: dict[str, Any],
    trade_no: str,
    data: Any,
    *,
    source: str,
    event_id: Any = None,
) -> dict[str, Any]:
    previous = store["orders"].get(trade_no)
    previous = previous if isinstance(previous, dict) else {}
    merged = {
        **previous,
        **_order_from_api(data),
        "tradeNo": trade_no,
        # 保留首次收到时间与 event_id：pending → success 不该变成一条新记录。
        "eventId": previous.get("eventId") or event_id,
        "receivedAt": previous.get("receivedAt") or _now_iso(),
        "source": source,
    }
    store["orders"][trade_no] = merged
    return merged


def save_order(
    trade_no: str,
    data: Any,
    *,
    source: str = "query",
    event_id: Any = None,
) -> dict[str, Any]:
    """把订单写入/合并进本地库。只覆盖接口确实返回的字段。"""
    no = _text(trade_no)
    if not no:
        raise PartnerError("tradeNo 不能为空", code="bad-request", status=0)
    with _LOCK:
        store = _read()
        merged = _merge_order(store, no, data, source=source, event_id=event_id)
        _write(store)
    return _order_view(merged) or {}


def get_order(trade_no: str) -> dict[str, Any] | None:
    no = _text(trade_no)
    if not no:
        return None
    with _LOCK:
        record = _read()["orders"].get(no)
    return _order_view(record)


def list_orders(external_uid: str, limit: int = 10) -> list[dict[str, Any]]:
    """当前用户最近的订单（按首次收到时间倒序）。"""
    uid = _text(external_uid)
    if not uid:
        return []
    with _LOCK:
        records = list(_read()["orders"].values())
    rows = [
        view
        for view in (_order_view(record) for record in records)
        if view and view.get("externalUid") == uid
    ]
    rows.sort(key=lambda row: str(row.get("receivedAt") or ""), reverse=True)
    size = limit if isinstance(limit, int) and limit >= 0 else 10
    return rows[:size]


def record_event(event_id: str, payload: Any = None) -> bool:
    """记一条事件；``event_id`` 已存在返回 ``False``（幂等）。"""
    eid = _text(event_id)
    if not eid:
        raise PartnerError("event_id 不能为空", code="bad-request", status=0)
    source = payload if isinstance(payload, dict) else {}
    data = source.get("data") if isinstance(source.get("data"), dict) else {}
    with _LOCK:
        store = _read()
        if eid in store["events"]:
            return False
        store["events"][eid] = {
            "eventId": eid,
            "event": _text(source.get("event")),
            "occurredAt": source.get("occurred_at"),
            "tradeNo": _text(data.get("trade_no")),
            "receivedAt": _now_iso(),
        }
        _write(store)
    return True


def apply_paid_event(payload: Any) -> dict[str, Any]:
    """Webhook 落库：事件与订单在同一次读-改-写里完成。

    Returns:
        ``{"duplicate": bool, "order": dict|None}``。
    """
    source = payload if isinstance(payload, dict) else {}
    event_id = _text(source.get("event_id"))
    data = source.get("data") if isinstance(source.get("data"), dict) else {}
    trade_no = _text(data.get("trade_no"))
    if not event_id:
        raise PartnerError("event_id 不能为空", code="bad-request", status=0)
    if not trade_no:
        raise PartnerError("trade_no 不能为空", code="bad-request", status=0)

    with _LOCK:
        store = _read()
        if event_id in store["events"]:
            return {
                "duplicate": True,
                "order": _order_view(store["orders"].get(trade_no)),
            }
        merged = _merge_order(store, trade_no, data, source="webhook", event_id=event_id)
        store["events"][event_id] = {
            "eventId": event_id,
            "event": _text(source.get("event")),
            "occurredAt": source.get("occurred_at"),
            "tradeNo": trade_no,
            "receivedAt": _now_iso(),
        }
        _write(store)
    return {"duplicate": False, "order": _order_view(merged)}
