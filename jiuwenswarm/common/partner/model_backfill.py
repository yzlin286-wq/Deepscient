# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""中转站模型的回填、下发与拉取。

账号同步（``POST /partner/v1/users/sync``）会返回一份可直连 ccagent 的
``api_key`` 与 ``api_base_url``。本模块把这份凭据写进 ``models.defaults`` 里
``vendor_key == "ccagent"`` 的条目，让用户不必再手抄一遍。

两条路径：

* :func:`provision_models`：登录/刷新时先拉 ``/models`` 校验，再把**全部**可用
  模型一次性下发；同一账号的旧 ccagent 条目会被收敛（删除后重建），其它供应商
  与其它账号的条目原样保留。
* :func:`backfill_model`：早期单条目回填的兼容入口，保留原有冲突与覆盖语义。

基址统一经 :func:`normalize_api_base` 归一到 ``.../v1`` 后再拼 ``/models``。

凭据纪律：落盘前用 :class:`ExtensionRegistry` 的 crypto provider 加密；provider
不可用时写明文并留一条 **不含 Key** 的 warn。对外只返回前 3 + 后 4 的掩码。
"""

from __future__ import annotations

import copy
import json
import logging
from datetime import datetime, timezone
from typing import Any

from jiuwenswarm.common.auth.net import requests_request
from jiuwenswarm.common.config import get_config_raw, update_default_models_in_config
from jiuwenswarm.common.context_window import DEFAULT_CONTEXT_WINDOW_TOKENS
from jiuwenswarm.common.model_vendor_registry import PlanKind, get_preset
from jiuwenswarm.common.partner.errors import PartnerError
from jiuwenswarm.common.partner.store import mask_key

logger = logging.getLogger(__name__)

#: 与 :mod:`jiuwenswarm.common.model_vendor_registry` 里的预设保持一致。
VENDOR_KEY = "ccagent"
PLAN = PlanKind.CUSTOM_API.value
CLIENT_PROVIDER = "OpenAI"
ENDPOINT_PROFILE = "openai_compatible"
MODEL_TIMEOUT_SECONDS = 360
MODELS_TIMEOUT_SECONDS = 10


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _preset() -> Any:
    return get_preset(VENDOR_KEY, PlanKind.CUSTOM_API)


def _preset_api_base() -> str:
    preset = _preset()
    return preset.api_base if preset else ""


def _default_model_name() -> str:
    preset = _preset()
    return preset.default_model if preset else ""


def build_ccagent_entry(
    binding: Any,
    model_name: str,
    api_key_cipher_or_plain: str,
    is_default: bool,
) -> dict[str, Any]:
    """构造一条与 ``app_web_handlers`` 新建模型一致的 ccagent 条目。

    ``binding`` 是伙伴绑定（``store.get_binding`` / ``client.sync_user`` 的字典），
    ``api_base`` 优先取绑定里的 ``apiBaseUrl``，缺省才回落到预设。
    """
    source = binding if isinstance(binding, dict) else {}
    return {
        "model_client_config": {
            "api_base": _text(source.get("apiBaseUrl")) or _preset_api_base(),
            "api_key": _text(api_key_cipher_or_plain),
            "model_name": _text(model_name) or _default_model_name(),
            "client_provider": CLIENT_PROVIDER,
            "timeout": MODEL_TIMEOUT_SECONDS,
            "verify_ssl": True,
            "vendor_key": VENDOR_KEY,
            "plan": PLAN,
            "endpoint_profile": ENDPOINT_PROFILE,
        },
        "model_config_obj": {
            "context_window": DEFAULT_CONTEXT_WINDOW_TOKENS,
            "partner_external_uid": _text(source.get("externalUid")),
        },
        "is_default": bool(is_default),
        "alias": "",
    }


def _encrypt_api_key(plain: str) -> str:
    """加密凭据；加密组件不可用时拒绝落盘，避免明文 Key 进入配置文件。"""
    if not plain:
        return ""
    provider = None
    try:
        from jiuwenswarm.extensions.registry import ExtensionRegistry

        provider = ExtensionRegistry.get_instance().get_crypto_provider()
    except Exception:  # noqa: BLE001 — 未初始化/扩展缺失都按「不可用」处理
        provider = None
    if provider is None:
        raise PartnerError("加密组件不可用，拒绝写入明文 Key", code="crypto_unavailable", status=0)
    try:
        return str(provider.encrypt(plain))
    except Exception:  # noqa: BLE001 — 加密失败同样拒绝写入明文
        raise PartnerError("api_key 加密失败", code="crypto_unavailable", status=0) from None


def _read_entries() -> list[Any]:
    try:
        raw = get_config_raw()
    except OSError:
        return []
    models = raw.get("models") if isinstance(raw, dict) else None
    defaults = models.get("defaults") if isinstance(models, dict) else None
    if not isinstance(defaults, list):
        return []
    # 深拷贝：避免就地改动读缓存里的对象。非 dict 条目原样保留，不做清理。
    return [copy.deepcopy(entry) for entry in defaults]


def _entry_mcc(entry: Any) -> dict[str, Any]:
    mcc = entry.get("model_client_config") if isinstance(entry, dict) else None
    return mcc if isinstance(mcc, dict) else {}


def _entry_mco(entry: Any) -> dict[str, Any]:
    mco = entry.get("model_config_obj") if isinstance(entry, dict) else None
    return mco if isinstance(mco, dict) else {}


def _entry_uid(entry: Any) -> str:
    return _text(_entry_mco(entry).get("partner_external_uid"))


def _ccagent_indices(entries: list[Any]) -> list[int]:
    return [
        index
        for index, entry in enumerate(entries)
        if _text(_entry_mcc(entry).get("vendor_key")) == VENDOR_KEY
    ]


def _apply_to_entry(entry: dict[str, Any], api_base: str, api_key_cipher: str, model_name: str, uid: str) -> None:
    """只覆盖回填负责的三个字段（外加归属 uid），用户其它设置保持不动。"""
    mcc = entry.get("model_client_config")
    if not isinstance(mcc, dict):
        mcc = {}
        entry["model_client_config"] = mcc
    if api_base:
        mcc["api_base"] = api_base
    if api_key_cipher:
        mcc["api_key"] = api_key_cipher
    if model_name:
        mcc["model_name"] = model_name
    mco = entry.get("model_config_obj")
    if not isinstance(mco, dict):
        mco = {}
        entry["model_config_obj"] = mco
    mco["partner_external_uid"] = uid


def _result(
    *, applied: bool, reason: str = "", model_name: str = "", masked: str = ""
) -> dict[str, Any]:
    return {
        "applied": bool(applied),
        "reason": reason,
        "modelName": model_name,
        "masked": masked,
    }


def backfill_model(
    external_uid: str,
    api_key: str,
    api_base_url: str = "",
    username: str = "",
    model_name: str = "",
    force: bool = False,
) -> dict[str, Any]:
    """把同步拿到的凭据回填到 ``models.defaults``。

    ``api_key`` 必须是**明文**（只在内存里传递，落盘前加密）。``username`` 仅为与
    ``client.sync_user`` 的返回值对齐，不参与落盘。

    Returns:
        ``{"applied": bool, "reason": str, "modelName": str, "masked": str}``。
        ``reason``: ``created`` / ``updated`` / ``overridden`` / ``conflict`` /
        ``no-key`` / ``error``。
    """
    del username  # 凭据之外的用户信息不落进模型条目
    uid = _text(external_uid)
    if not uid:
        raise PartnerError("externalUid 不能为空", code="bad-request", status=0)

    plain_key = _text(api_key)
    base = _text(api_base_url) or _preset_api_base()
    name = _text(model_name) or _default_model_name()
    cipher = _encrypt_api_key(plain_key)
    masked = mask_key(plain_key)

    entries = _read_entries()
    candidates = _ccagent_indices(entries)
    same_uid_index = next(
        (index for index in candidates if _entry_uid(entries[index]) == uid), None
    )

    if same_uid_index is not None:
        entry = entries[same_uid_index]
        if not isinstance(entry, dict):
            entry = build_ccagent_entry(
                {"apiBaseUrl": base, "externalUid": uid}, name, cipher, False
            )
            entries[same_uid_index] = entry
        else:
            _apply_to_entry(entry, base, cipher, name, uid)
        reason = "updated"
    elif candidates:
        if not force:
            existing = entries[candidates[0]]
            return _result(
                applied=False,
                reason="conflict",
                model_name=_text(_entry_mcc(existing).get("model_name")),
                masked=masked,
            )
        if not cipher:
            return _result(applied=False, reason="no-key", masked=masked)
        index = candidates[0]
        kept_default = bool(entries[index].get("is_default") is True) if isinstance(entries[index], dict) else False
        entries[index] = build_ccagent_entry(
            {"apiBaseUrl": base, "externalUid": uid}, name, cipher, kept_default
        )
        reason = "overridden"
    else:
        if not cipher:
            return _result(applied=False, reason="no-key", masked=masked)
        has_default = any(
            isinstance(entry, dict) and entry.get("is_default") is True for entry in entries
        )
        entries.append(
            build_ccagent_entry(
                {"apiBaseUrl": base, "externalUid": uid}, name, cipher, not has_default
            )
        )
        reason = "created"

    update_default_models_in_config(entries)
    logger.info(
        "[Partner] 模型回填完成 reason=%s model=%s vendor=%s", reason, name, VENDOR_KEY
    )
    return _result(applied=True, reason=reason, model_name=name, masked=masked)


def _empty_provision() -> dict[str, Any]:
    return {
        "applied": False,
        "modelCount": 0,
        "modelNames": [],
        "defaultModel": "",
        "apiBaseUrl": "",
        "maskedKey": "",
        "syncedAt": "",
    }


def current_state(external_uid: str) -> dict[str, Any]:
    """只读下发状态（设置页刷新后仍能显示上次下发结果）。永不抛异常。"""
    uid = _text(external_uid)
    if not uid:
        return _empty_provision()
    try:
        entries = _read_entries()
    except Exception:  # noqa: BLE001 — 状态展示不该被配置读取问题打挂
        logger.warning("[Partner] 读取模型下发状态失败")
        return _empty_provision()

    matches = [
        entries[index]
        for index in _ccagent_indices(entries)
        if _entry_uid(entries[index]) == uid
    ]
    if not matches:
        return _empty_provision()

    names = [_text(_entry_mcc(entry).get("model_name")) for entry in matches]
    names = [name for name in names if name]
    default_entry = next(
        (entry for entry in matches if entry.get("is_default") is True), matches[0]
    )
    mcc = _entry_mcc(matches[0])
    synced_at = ""
    for entry in matches:
        stamp = _text(_entry_mco(entry).get("partner_synced_at"))
        if stamp and stamp > synced_at:
            synced_at = stamp
    return {
        "applied": True,
        "modelCount": len(matches),
        "modelNames": names,
        "defaultModel": _text(_entry_mcc(default_entry).get("model_name")),
        "apiBaseUrl": _text(mcc.get("api_base")),
        "maskedKey": "",
        "syncedAt": synced_at,
    }


def normalize_api_base(api_base_url: Any) -> str:
    """把模型调用基址归一到 ``.../v1``。

    规则：去尾斜杠；已经以 ``/v1`` 结尾原样保留；否则在已有路径后追加
    ``/v1``（例如 ``https://api.ccagent.cn/openai`` → ``.../openai/v1``）。
    """
    base = _text(api_base_url).rstrip("/")
    if not base:
        raise PartnerError("api_base_url 不能为空", code="bad-request", status=0)
    if not base.endswith("/v1"):
        base = f"{base}/v1"
    return base


def _model_ids(payload: Any) -> list[str] | None:
    """``data[].id`` 或 ``models[].id``；两种结构都没有时返回 ``None``。"""
    if not isinstance(payload, dict):
        return None
    for field in ("data", "models"):
        items = payload.get(field)
        if isinstance(items, list):
            ids: list[str] = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                model_id = _text(item.get("id"))
                if model_id and model_id not in ids:
                    ids.append(model_id)
            return ids
    return None


def fetch_models(api_base_url: str, api_key: str) -> list[str]:
    """拉取 ``{normalize(api_base)}/models`` 的模型 ID 列表（10 秒超时）。

    Raises:
        PartnerError: 基址为空、网络失败、非 2xx 或响应结构不认识。
    """
    base = normalize_api_base(api_base_url)

    headers = {"Accept": "application/json"}
    key = _text(api_key)
    if key:
        headers["Authorization"] = f"Bearer {key}"

    try:
        response = requests_request(
            "GET", f"{base}/models", headers=headers, timeout=MODELS_TIMEOUT_SECONDS
        )
    except Exception:  # noqa: BLE001 — 网络层错误统一映射
        logger.warning("[Partner] 模型列表拉取失败（网络错误）")
        raise PartnerError("模型列表拉取失败（网络错误）", code="network_error", status=0) from None

    status = int(getattr(response, "status_code", 0) or 0)
    if not 200 <= status < 300:
        logger.warning("[Partner] 模型列表拉取失败 HTTP %s", status)
        raise PartnerError(
            f"模型列表拉取失败（HTTP {status}）", code="models_fetch_failed", status=status
        )

    text = getattr(response, "text", "") or ""
    try:
        payload = json.loads(text) if text else None
    except (TypeError, ValueError):
        payload = None

    ids = _model_ids(payload)
    if ids is None:
        raise PartnerError("模型列表格式不正确", code="models_invalid", status=0)
    return ids


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_ccagent_entry(entry: Any) -> bool:
    return _text(_entry_mcc(entry).get("vendor_key")) == VENDOR_KEY


def _first_default_model_name(entries: list[Any]) -> str:
    for entry in entries:
        if isinstance(entry, dict) and entry.get("is_default") is True:
            return _text(_entry_mcc(entry).get("model_name"))
    return ""


def provision_models(
    external_uid: str,
    api_key: str,
    api_base_url: str,
    username: str = "",
    display_name: str = "",
) -> dict[str, Any]:
    """把中转站返回的全部模型一次性下发到 ``models.defaults``。

    先拉 ``/models`` 校验可用性；列表为空或请求失败时**不写任何内容**。写入时
    只收敛「同一 ``partner_external_uid`` 且 ``vendor_key=ccagent``」的旧条目，
    其它供应商与其它账号的条目原样保留。所有条目通过一次
    ``update_default_models_in_config`` 写回。

    Returns:
        ``{"applied": True, "modelCount": int, "modelNames": list[str],
        "defaultModel": str, "apiBaseUrl": str, "maskedKey": str, "syncedAt": str}``。

    Raises:
        PartnerError: Key/基址缺失、拉取失败、模型列表为空或配置写入失败。
    """
    del username, display_name  # 凭据之外的用户信息不落进模型条目
    uid = _text(external_uid)
    if not uid:
        raise PartnerError("externalUid 不能为空", code="bad-request", status=0)

    plain_key = _text(api_key)
    if not plain_key:
        raise PartnerError("中转站没有返回可用 Key", code="not_configured", status=0)

    try:
        base = normalize_api_base(api_base_url)
        raw_names = fetch_models(base, plain_key)
        if not raw_names:
            raise PartnerError("中转站没有返回可用模型", code="models_empty", status=0)
        # 科研版只下发 DeepSeek 文本模型；若中转站未提供 DeepSeek 型号则回退到全量列表。
        deepseek_names = [name for name in raw_names if "deepseek" in name.lower()]
        names = deepseek_names or raw_names

        cipher = _encrypt_api_key(plain_key)
        synced_at = _now_iso()
        entries = _read_entries()
        kept = [
            entry
            for entry in entries
            if not (_is_ccagent_entry(entry) and _entry_uid(entry) == uid)
        ]

        existing_default = next(
            (
                entry
                for entry in kept
                if isinstance(entry, dict) and entry.get("is_default") is True
            ),
            None,
        )
        preferred = "deepseek-chat" if "deepseek-chat" in names else names[0]
        default_name = _first_default_model_name(kept) or preferred

        fresh: list[dict[str, Any]] = []
        for name in names:
            entry = build_ccagent_entry(
                {"apiBaseUrl": base, "externalUid": uid},
                name,
                cipher,
                existing_default is None and name == preferred,
            )
            entry["alias"] = name
            mco = entry.get("model_config_obj")
            if isinstance(mco, dict):
                mco["partner_synced_at"] = synced_at
            fresh.append(entry)

        update_default_models_in_config(kept + fresh)
    except PartnerError:
        raise
    except Exception as error:  # noqa: BLE001 — 统一收敛成 PartnerError，调用方不写半成品
        logger.warning("[Partner] 模型下发失败 code=%s", type(error).__name__)
        raise PartnerError("模型下发失败", code="provision_failed", status=0) from None

    logger.info(
        "[Partner] 模型下发完成 count=%s default=%s vendor=%s",
        len(names),
        default_name,
        VENDOR_KEY,
    )
    return {
        "applied": True,
        "modelCount": len(names),
        "modelNames": list(names),
        "defaultModel": default_name,
        "apiBaseUrl": base,
        "maskedKey": mask_key(plain_key),
        "syncedAt": synced_at,
    }
