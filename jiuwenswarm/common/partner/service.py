# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""中转站业务组合：设置页要的聚合状态、账号同步、购买/额度链接、Webhook 与回跳。

这里只做「编排 + 投影」，签名在 :mod:`signing`、HTTP 在 :mod:`client`、
落盘在 :mod:`store`。对外返回的结构里不会出现 ``app_secret`` 或明文 ``api_key``。

日志纪律：只记 ``event_id`` / ``trade_no`` / 业务码 / 耗时，绝不记 secret、
签名头与明文 Key。
"""

from __future__ import annotations

import html
import json
import logging
import threading
from typing import Any

from jiuwenswarm.common.partner import client, config as config_mod, store
from jiuwenswarm.common.partner import model_backfill
from jiuwenswarm.common.partner.config import partner_config, return_url
from jiuwenswarm.common.partner.errors import PartnerError
from jiuwenswarm.common.partner.signing import verify_return_sign, verify_webhook

logger = logging.getLogger(__name__)

#: Webhook 请求体上限；超过直接 413，不读进内存也不验签。
WEBHOOK_MAX_BYTES = 512 * 1024


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _error_code(error: BaseException) -> str:
    if isinstance(error, PartnerError):
        return error.code or str(error.status or "error")
    return type(error).__name__


def binding_projection(record: dict[str, Any] | None) -> dict[str, Any] | None:
    """绑定投影：只给掩码，不给 Key。

    ``modelProvision`` 是已落盘的模型下发状态（读 ``models.defaults``，不含
    凭据），设置页刷新后仍能显示「已下发」。``modelBackfill`` 保留给旧面板。
    """
    if not record:
        return None
    masked = _text(record.get("apiKeyMasked"))
    state = model_backfill.current_state(_text(record.get("externalUid")))
    provision = {**state, "maskedKey": masked or _text(state.get("maskedKey"))}
    return {
        "externalUid": _text(record.get("externalUid")),
        "userId": record.get("userId"),
        "username": _text(record.get("username")),
        "apiBaseUrl": _text(record.get("apiBaseUrl")),
        "apiKeyMasked": masked,
        "hasKey": bool(masked),
        "syncedAt": record.get("syncedAt"),
        "modelProvision": provision,
        "modelBackfill": _legacy_backfill(provision, masked),
    }


def _legacy_backfill(provision: dict[str, Any], masked: str = "") -> dict[str, Any]:
    """旧面板使用的单条目回填投影（由下发结果派生）。"""
    applied = bool(provision.get("applied"))
    reason = ""
    if applied:
        reason = "updated"
    elif _text(provision.get("error")):
        reason = "error"
    return {
        "applied": applied,
        "reason": reason,
        "modelName": _text(provision.get("defaultModel")),
        "masked": _text(provision.get("maskedKey")) or masked,
    }


def status_for_user(external_uid: str) -> dict[str, Any]:
    """设置页一次拿全：配置、绑定、在售套餐、最近订单。

    套餐拉取失败只落到 ``plansError``，不影响配置与绑定信息的展示。
    """
    cfg = partner_config()
    uid = _text(external_uid)

    plans: list[dict[str, Any]] = []
    plans_error = ""
    if cfg.configured:
        try:
            plans = client.list_plans()
        except PartnerError as error:
            plans_error = str(error)
        except Exception as error:  # noqa: BLE001 — 状态页不该被未知异常打挂
            plans_error = str(error) or type(error).__name__
            logger.warning("[Partner] 套餐拉取失败 code=%s", _error_code(error))

    return {
        "configured": cfg.configured,
        "appId": cfg.app_id,
        "base": cfg.base_url,
        "secretPresent": bool(cfg.secret),
        "secretSource": cfg.secret_source,
        "webhookUrl": cfg.webhook_url,
        "publicBase": cfg.public_base,
        "binding": binding_projection(store.get_binding(uid) if uid else None),
        "plans": plans,
        "plansError": plans_error,
        "orders": store.list_orders(uid, 10) if uid else [],
    }


def _backfill_from_sync(
    external_uid: str,
    sync: dict[str, Any],
    *,
    model_name: str = "",
    force: bool = False,
) -> dict[str, Any]:
    """用同步结果里的明文 Key 回填模型条目（Key 只在内存里过一手）。"""
    return model_backfill.backfill_model(
        external_uid,
        _text(sync.get("apiKey")),
        _text(sync.get("apiBaseUrl")),
        username=_text(sync.get("username")),
        model_name=_text(model_name) or partner_config().default_model,
        force=force,
    )


def _provision_from_sync(
    external_uid: str,
    sync: dict[str, Any],
    display_name: str = "",
) -> dict[str, Any]:
    """用同步结果里的明文 Key 校验并下发全部 ccagent 模型（Key 不过夜）。"""
    return model_backfill.provision_models(
        external_uid,
        _text(sync.get("apiKey")),
        _text(sync.get("apiBaseUrl")),
        username=_text(sync.get("username")),
        display_name=display_name,
    )


def sync_for_user(external_uid: str, display_name: str = "") -> dict[str, Any]:
    """同步账号并落绑定（只存掩码）。

    同步成功后顺手把凭据与全部可用模型下发进 ``models.defaults``；下发失败只留
    一条不含 Key 的 warn，绝不让账号同步因此失败。失败抛 :class:`PartnerError`。
    """
    uid = _text(external_uid)
    if not uid:
        raise PartnerError("externalUid 不能为空", code="bad-request", status=0)
    result = client.sync_user(uid, display_name)
    record = store.save_binding(
        uid,
        user_id=result.get("userId"),
        username=_text(result.get("username")),
        api_key=_text(result.get("apiKey")),
        api_base_url=_text(result.get("apiBaseUrl")),
        synced_at=_text(result.get("syncedAt")) or None,
    )
    projection = binding_projection(record) or {}
    masked = _text((record or {}).get("apiKeyMasked"))
    try:
        provision = _provision_from_sync(uid, result, display_name)
        projection["modelProvision"] = provision
        projection["modelBackfill"] = _legacy_backfill(provision, masked)
    except Exception as error:  # noqa: BLE001 — 下发失败不该阻塞账号同步
        logger.warning("[Partner] 模型下发失败 code=%s", _error_code(error))
        projection["modelProvision"] = {"applied": False, "error": str(error)}
        projection["modelBackfill"] = {
            "applied": False,
            "reason": "error",
            "modelName": "",
            "masked": masked,
        }
    return projection


def refresh_models_for_user(external_uid: str) -> dict[str, Any]:
    """重新同步账号（幂等拿 Key）并下发全部可用模型。

    本地库只存掩码，所以这里必须回到 ``/users/sync`` 取同一把 Key（上游幂等），
    绝不从 ``partner.json`` 里翻明文。任何下发失败都抛 :class:`PartnerError`。
    """
    uid = _text(external_uid)
    if not uid:
        raise PartnerError("externalUid 不能为空", code="bad-request", status=0)

    result = client.sync_user(uid)
    record = store.save_binding(
        uid,
        user_id=result.get("userId"),
        username=_text(result.get("username")),
        api_key=_text(result.get("apiKey")),
        api_base_url=_text(result.get("apiBaseUrl")),
        synced_at=_text(result.get("syncedAt")) or None,
    )
    try:
        provision = _provision_from_sync(uid, result)
    except PartnerError:
        raise
    except Exception as error:  # noqa: BLE001 — 配置写坏时给前端一个可读的失败
        logger.warning("[Partner] 模型下发失败 code=%s", _error_code(error))
        raise PartnerError("模型下发失败", code="provision_failed", status=0) from None
    return {
        "modelProvision": provision,
        "binding": binding_projection(record),
    }


def backfill_for_user(
    external_uid: str, model_name: str = "", force: bool = False
) -> dict[str, Any]:
    """手动回填：先幂等地重新同步一次拿到明文 Key，再写模型条目。

    本地库只存掩码，所以这里必须回到 ``/users/sync`` 取同一把 Key（上游幂等），
    绝不从 ``partner.json`` 里翻明文。
    """
    uid = _text(external_uid)
    if not uid:
        raise PartnerError("externalUid 不能为空", code="bad-request", status=0)

    result = client.sync_user(uid)
    record = store.save_binding(
        uid,
        user_id=result.get("userId"),
        username=_text(result.get("username")),
        api_key=_text(result.get("apiKey")),
        api_base_url=_text(result.get("apiBaseUrl")),
        synced_at=_text(result.get("syncedAt")) or None,
    )
    try:
        outcome = _backfill_from_sync(uid, result, model_name=model_name, force=force)
    except PartnerError:
        raise
    except Exception as error:  # noqa: BLE001 — 配置写坏时给前端一个可读的失败
        logger.warning("[Partner] 模型回填失败 code=%s", _error_code(error))
        raise PartnerError("模型回填失败", code="backfill_failed", status=0) from None
    return {**outcome, "binding": binding_projection(record)}


def models_for_user(external_uid: str) -> dict[str, Any]:
    """拉取中转站可用模型（同样用幂等同步拿到的明文 Key）。"""
    uid = _text(external_uid)
    if not uid:
        raise PartnerError("externalUid 不能为空", code="bad-request", status=0)

    result = client.sync_user(uid)
    key = _text(result.get("apiKey"))
    stored = store.get_binding(uid) or {}
    base = _text(result.get("apiBaseUrl")) or _text(stored.get("apiBaseUrl"))
    if not key:
        raise PartnerError("中转站没有返回可用 Key", code="not_configured", status=0)
    normalized = model_backfill.normalize_api_base(base)
    return {
        "models": model_backfill.fetch_models(normalized, key),
        "apiBaseUrl": normalized,
    }


def schedule_sync_after_login(external_uid: str, display_name: str = "") -> None:
    """登录成功后的静默同步：后台线程，失败只留一条不含 Key 的 warn。

    业务主流程不该因为中转站挂了而失败，所以这里永不抛，也不阻塞登录。
    """
    uid = _text(external_uid)
    if not uid:
        return

    def _run() -> None:
        try:
            if not config_mod.configured():
                return
            sync_for_user(uid, display_name)
        except Exception as error:  # noqa: BLE001 — 后台任务不能把异常抛给调用方
            logger.warning("[Partner] 中转站账号同步失败 code=%s", _error_code(error))

    threading.Thread(target=_run, name="partner-sync", daemon=True).start()


def buy_url_for_user(external_uid: str, plan_id: Any = None) -> dict[str, Any]:
    """换一次性购买页地址（只由前端立即打开，不落 state）。"""
    return client.create_buy_url(
        _text(external_uid), plan_id=plan_id, return_url=return_url()
    )


def account_url_for_user(external_uid: str) -> dict[str, Any]:
    """换一次性「我的额度」页地址。"""
    return client.create_account_url(_text(external_uid))


def _not_found() -> PartnerError:
    # 不区分「不存在」与「不属于你」，避免用单号探测别人的订单。
    return PartnerError("订单不存在", code="40403", status=404)


def order_for_user(external_uid: str, trade_no: str) -> dict[str, Any]:
    """查订单：本地库 + 上游结果合并；订单不属于当前用户时 404。"""
    uid = _text(external_uid)
    no = _text(trade_no)
    if not no:
        raise _not_found()

    local = store.get_order(no)
    local_uid = _text((local or {}).get("externalUid"))
    if local and local_uid and local_uid != uid:
        raise _not_found()

    remote: dict[str, Any] | None = None
    try:
        remote = client.get_order(no)
    except PartnerError as error:
        if error.code == "40403" and local is None:
            raise
        logger.warning("[Partner] 查询订单失败 trade_no=%s code=%s", no, _error_code(error))

    if remote:
        remote_uid = _text(remote.get("external_uid"))
        if remote_uid and remote_uid != uid:
            raise _not_found()
        order = store.save_order(no, remote, source="query")
    else:
        order = local

    if not order:
        raise _not_found()

    event_id = _text(order.get("eventId"))
    return {
        "order": order,
        "webhook": {
            "eventId": event_id,
            "status": "received" if event_id else "",
        },
    }


def handle_webhook(headers: Any, raw_body: bytes | bytearray | str) -> tuple[int, dict[str, Any]]:
    """支付回填。返回 ``(status_code, payload)``，语义见 relay.md 6.2。"""
    raw = raw_body.encode("utf-8") if isinstance(raw_body, str) else bytes(raw_body or b"")

    if len(raw) > WEBHOOK_MAX_BYTES:
        return 413, {"ok": False, "error": "payload-too-large"}

    cfg = partner_config()
    if not cfg.configured:
        return 503, {"ok": False, "error": "partner-not-configured"}

    ok, reason = verify_webhook(headers, raw)
    if not ok:
        logger.warning("[Partner] Webhook 验签失败 reason=%s", reason)
        return 400, {"ok": False, "error": "bad-signature", "reason": reason}

    try:
        payload = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return 400, {"ok": False, "error": "bad-json"}
    if not isinstance(payload, dict):
        return 400, {"ok": False, "error": "bad-json"}

    event_id = _text(payload.get("event_id"))
    data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    trade_no = _text(data.get("trade_no"))

    if payload.get("event") != "subscription.paid" or _text(data.get("status")) != "success":
        logger.info("[Partner] 忽略中转站事件 event_id=%s", event_id)
        return 200, {"ok": True, "ignored": True}

    try:
        result = store.apply_paid_event(payload)
    except Exception as error:  # noqa: BLE001 — 落库失败回 5xx，让上游按节奏重推
        logger.warning(
            "[Partner] 支付事件落库失败 event_id=%s trade_no=%s code=%s",
            event_id,
            trade_no,
            _error_code(error),
        )
        return 500, {"ok": False, "error": "store-failed"}

    logger.info(
        "[Partner] 支付事件 event_id=%s trade_no=%s duplicate=%s",
        event_id,
        trade_no,
        result["duplicate"],
    )
    return 200, {"ok": True, "duplicate": bool(result["duplicate"])}


def _escape(value: Any) -> str:
    return html.escape(str(value if value is not None else ""))


def _render_page(title: str, lines: list[str]) -> str:
    body = "".join(f"<p>{_escape(line)}</p>" for line in lines)
    return (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{_escape(title)} · JiuwenSwarm</title>"
        "<style>body{margin:0;font-family:system-ui,-apple-system,'PingFang SC',sans-serif;"
        "background:#f5f7f9;color:#141a21}"
        "main{max-width:34rem;margin:12vh auto;padding:32px;background:#fff;border-radius:14px;"
        "box-shadow:0 8px 30px rgba(0,0,0,.06)}"
        "h1{font-size:1.25rem;margin:0 0 16px}p{line-height:1.7;margin:6px 0;color:#3c4450}"
        "a{display:inline-block;margin-top:20px;color:#1d6fd8;text-decoration:none}"
        "a:hover{text-decoration:underline}</style></head>"
        f"<body><main><h1>{_escape(title)}</h1>{body}"
        '<p><a href="/">返回应用</a></p></main></body></html>'
    )


def return_page(trade_no: str, status: str = "success", sign: str = "") -> tuple[int, str]:
    """购买回跳页。验签通过后**再查一次订单**，只有上游 ``success`` 才说「开通成功」。"""
    no = _text(trade_no)
    state = _text(status) or "success"
    cfg = partner_config()

    if not cfg.configured:
        return 503, _render_page("中转站未配置", ["服务端还没有配置合作方密钥，暂时无法确认订单。"])
    if not verify_return_sign(no, state, sign):
        return 400, _render_page("签名校验失败", ["这个回跳链接的签名不对，已停止处理。"])

    remote: dict[str, Any] | None = None
    try:
        remote = client.get_order(no)
        if isinstance(remote, dict):
            store.save_order(no, remote, source="query")
    except PartnerError as error:
        logger.warning("[Partner] 回跳查询订单失败 trade_no=%s code=%s", no, _error_code(error))
    except Exception as error:  # noqa: BLE001 — 回跳页不该 500
        logger.warning("[Partner] 回跳查询订单失败 trade_no=%s code=%s", no, _error_code(error))

    paid = state == "success" and _text((remote or {}).get("status")) == "success"
    title = "开通成功" if paid else "待确认"
    lines = [
        f"订单 {no} 已支付并开通。" if paid else f"订单 {no} 的状态还在确认中，请稍后刷新。"
    ]
    plan_title = _text((remote or {}).get("plan_title"))
    if plan_title:
        lines.append(f"套餐：{plan_title}")
    amount = (remote or {}).get("amount")
    if amount:
        currency = _text((remote or {}).get("currency")) or "CNY"
        lines.append(f"金额：{amount} {currency}")
    return 200, _render_page(title, lines)
