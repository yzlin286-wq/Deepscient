# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""ccagent 批量下发：基址归一化、模型收敛、默认模型与失败不落盘。"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml

import jiuwenswarm.common.config as cfg_mod
from jiuwenswarm.common.context_window import DEFAULT_CONTEXT_WINDOW_TOKENS
from jiuwenswarm.common.partner import model_backfill
from jiuwenswarm.common.partner.errors import PartnerError

KEY = "sk-test-1234567890"


class _FakeCrypto:
    def __init__(self) -> None:
        self.encrypted: list[str] = []

    def encrypt(self, plaintext: str, **kwargs: Any) -> str:
        self.encrypted.append(plaintext)
        return f"cipher::{plaintext[::-1]}"

    def decrypt(self, ciphertext: str, **kwargs: Any) -> str:
        return ciphertext.removeprefix("cipher::")[::-1]


class _StubRegistry:
    def __init__(self, crypto: Any) -> None:
        self._crypto = crypto

    def get_crypto_provider(self) -> Any:
        return self._crypto


class _Response:
    def __init__(self, status_code: int, payload: Any = None) -> None:
        self.status_code = status_code
        self.text = "" if payload is None else json.dumps(payload)


@pytest.fixture
def config_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    path = tmp_path / "config.yaml"
    path.write_text(yaml.safe_dump({"models": {"defaults": []}}), encoding="utf-8")
    monkeypatch.setattr(cfg_mod, "CONFIG_YAML_PATH", path)
    return path


@pytest.fixture
def crypto(monkeypatch: pytest.MonkeyPatch) -> _FakeCrypto:
    provider = _FakeCrypto()
    from jiuwenswarm.extensions.registry import ExtensionRegistry

    monkeypatch.setattr(
        ExtensionRegistry,
        "get_instance",
        classmethod(lambda cls: _StubRegistry(provider)),
    )
    return provider


def _read_defaults(path: Path) -> list[dict[str, Any]]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))["models"]["defaults"]


def _write_defaults(path: Path, entries: list[dict[str, Any]]) -> None:
    path.write_text(
        yaml.safe_dump({"models": {"defaults": entries}}, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )


def _serve_models(
    monkeypatch: pytest.MonkeyPatch,
    ids: list[str] | None = None,
    *,
    status: int = 200,
    payload: Any = None,
) -> list[dict[str, Any]]:
    calls: list[dict[str, Any]] = []

    def _fake(method: str, url: str, **kwargs: Any) -> _Response:
        calls.append({"method": method, "url": url, **kwargs})
        if payload is not None:
            return _Response(status, payload)
        return _Response(status, {"data": [{"id": model_id} for model_id in (ids or [])]})

    monkeypatch.setattr(model_backfill, "requests_request", _fake)
    return calls


def _entry(
    uid: str,
    model_name: str,
    *,
    vendor_key: str = "ccagent",
    is_default: bool = False,
) -> dict[str, Any]:
    return {
        "model_client_config": {
            "api_base": "https://other.test/v1",
            "api_key": "old-cipher",
            "model_name": model_name,
            "client_provider": "OpenAI",
            "vendor_key": vendor_key,
        },
        "model_config_obj": {"partner_external_uid": uid},
        "is_default": is_default,
        "alias": "",
    }


# ── 基址归一化 ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://api.ccagent.cn", "https://api.ccagent.cn/v1"),
        ("https://api.ccagent.cn/", "https://api.ccagent.cn/v1"),
        ("https://api.ccagent.cn/v1", "https://api.ccagent.cn/v1"),
        ("https://api.ccagent.cn/v1/", "https://api.ccagent.cn/v1"),
        ("https://api.ccagent.cn/openai", "https://api.ccagent.cn/openai/v1"),
        ("https://api.ccagent.cn/openai/", "https://api.ccagent.cn/openai/v1"),
    ],
)
def test_normalize_api_base(raw: str, expected: str) -> None:
    assert model_backfill.normalize_api_base(raw) == expected


def test_normalize_api_base_rejects_empty() -> None:
    with pytest.raises(PartnerError) as excinfo:
        model_backfill.normalize_api_base("   ")
    assert excinfo.value.code == "bad-request"


def test_fetch_models_uses_normalized_v1_base(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = _serve_models(monkeypatch, ["deepseek-chat"])

    assert model_backfill.fetch_models("https://api.ccagent.cn/", KEY) == ["deepseek-chat"]
    assert calls[0]["url"] == "https://api.ccagent.cn/v1/models"
    assert calls[0]["headers"]["Authorization"] == f"Bearer {KEY}"


# ── 批量下发 ────────────────────────────────────────────────────────────


def test_provision_downloads_deepseek_models_only(config_path, crypto, monkeypatch) -> None:
    calls = _serve_models(monkeypatch, ["deepseek-chat", "deepseek-reasoner", "gpt-4o"])

    result = model_backfill.provision_models("u_1", KEY, "https://api.ccagent.cn")

    assert calls[0]["url"] == "https://api.ccagent.cn/v1/models"
    assert result["applied"] is True
    assert result["modelCount"] == 2
    assert result["modelNames"] == ["deepseek-chat", "deepseek-reasoner"]
    assert result["defaultModel"] == "deepseek-chat"
    assert result["apiBaseUrl"] == "https://api.ccagent.cn/v1"
    assert result["maskedKey"] == "sk-•••7890"
    assert result["syncedAt"]

    entries = _read_defaults(config_path)
    assert len(entries) == 2
    assert [entry["alias"] for entry in entries] == result["modelNames"]
    for entry in entries:
        mcc = entry["model_client_config"]
        assert mcc["vendor_key"] == "ccagent"
        assert mcc["api_base"] == "https://api.ccagent.cn/v1"
        assert mcc["api_key"] == f"cipher::{KEY[::-1]}"
        assert mcc["client_provider"] == "OpenAI"
        assert entry["model_config_obj"] == {
            "context_window": DEFAULT_CONTEXT_WINDOW_TOKENS,
            "partner_external_uid": "u_1",
            "partner_synced_at": result["syncedAt"],
        }
    assert [entry["is_default"] for entry in entries] == [True, False]
    assert crypto.encrypted == [KEY]


def test_repeated_provision_does_not_duplicate(config_path, crypto, monkeypatch) -> None:
    _serve_models(monkeypatch, ["deepseek-chat", "deepseek-reasoner"])

    model_backfill.provision_models("u_1", KEY, "https://api.ccagent.cn")
    model_backfill.provision_models("u_1", KEY, "https://api.ccagent.cn/")

    entries = _read_defaults(config_path)
    assert len(entries) == 2
    assert [entry["model_client_config"]["model_name"] for entry in entries] == [
        "deepseek-chat",
        "deepseek-reasoner",
    ]
    assert sum(1 for entry in entries if entry["is_default"]) == 1


def test_old_ccagent_entries_are_converged(config_path, crypto, monkeypatch) -> None:
    _write_defaults(
        config_path,
        [
            _entry("u_1", "legacy-a", is_default=True),
            _entry("u_other", "other-account", is_default=True),
            _entry("u_1", "other-vendor-model", vendor_key="deepseek"),
        ],
    )
    _serve_models(monkeypatch, ["deepseek-chat", "deepseek-reasoner"])

    model_backfill.provision_models("u_1", KEY, "https://api.ccagent.cn")

    entries = _read_defaults(config_path)
    names = [entry["model_client_config"]["model_name"] for entry in entries]
    assert "legacy-a" not in names
    assert names == ["other-account", "other-vendor-model", "deepseek-chat", "deepseek-reasoner"]
    # 其它账号的默认标记原样保留，新条目不再抢默认
    assert entries[0]["is_default"] is True
    assert [entry["is_default"] for entry in entries[2:]] == [False, False]


def test_default_falls_back_to_first_deepseek_model_when_preferred_missing(
    config_path, crypto, monkeypatch
) -> None:
    _serve_models(monkeypatch, ["qwen3-max", "deepseek-reasoner"])

    result = model_backfill.provision_models("u_1", KEY, "https://api.ccagent.cn")

    assert result["defaultModel"] == "deepseek-reasoner"
    entries = _read_defaults(config_path)
    assert len(entries) == 1
    assert entries[0]["model_client_config"]["model_name"] == "deepseek-reasoner"
    assert entries[0]["is_default"] is True


def test_provision_falls_back_to_all_models_when_no_deepseek(
    config_path, crypto, monkeypatch
) -> None:
    _serve_models(monkeypatch, ["qwen3-max", "gpt-4o"])

    result = model_backfill.provision_models("u_1", KEY, "https://api.ccagent.cn")

    assert result["modelNames"] == ["qwen3-max", "gpt-4o"]
    assert result["defaultModel"] == "qwen3-max"


def test_existing_default_of_this_user_is_preserved(config_path, crypto, monkeypatch) -> None:
    _write_defaults(
        config_path,
        [_entry("u_1", "manual-model", vendor_key="deepseek", is_default=True)],
    )
    _serve_models(monkeypatch, ["deepseek-chat", "deepseek-reasoner"])

    result = model_backfill.provision_models("u_1", KEY, "https://api.ccagent.cn")

    assert result["defaultModel"] == "manual-model"
    entries = _read_defaults(config_path)
    assert entries[0]["model_client_config"]["model_name"] == "manual-model"
    assert entries[0]["is_default"] is True
    assert [entry["is_default"] for entry in entries[1:]] == [False, False]


def test_existing_default_of_another_user_is_not_overridden(
    config_path, crypto, monkeypatch
) -> None:
    _write_defaults(
        config_path,
        [_entry("u_other", "other-account", is_default=True)],
    )
    _serve_models(monkeypatch, ["deepseek-chat"])

    result = model_backfill.provision_models("u_new", KEY, "https://api.ccagent.cn")

    assert result["defaultModel"] == "other-account"
    entries = _read_defaults(config_path)
    assert len(entries) == 2
    assert entries[0]["model_config_obj"]["partner_external_uid"] == "u_other"
    assert entries[0]["is_default"] is True
    assert entries[1]["is_default"] is False


def test_api_key_is_persisted_encrypted(config_path, crypto, monkeypatch) -> None:
    _serve_models(monkeypatch, ["deepseek-chat"])

    model_backfill.provision_models("u_1", KEY, "https://api.ccagent.cn")

    raw = config_path.read_text(encoding="utf-8")
    assert KEY not in raw
    assert f"cipher::{KEY[::-1]}" in raw


# ── 校验失败不写盘 ──────────────────────────────────────────────────────


def test_fetch_failure_does_not_write(config_path, crypto, monkeypatch) -> None:
    sentinel = [_entry("u_keep", "keep-model", is_default=True)]
    _write_defaults(config_path, sentinel)
    _serve_models(monkeypatch, status=503, payload={"message": "boom"})

    with pytest.raises(PartnerError) as excinfo:
        model_backfill.provision_models("u_1", KEY, "https://api.ccagent.cn")

    assert excinfo.value.code == "models_fetch_failed"
    assert _read_defaults(config_path) == sentinel


def test_empty_model_list_does_not_write(config_path, crypto, monkeypatch) -> None:
    sentinel = [_entry("u_keep", "keep-model", is_default=True)]
    _write_defaults(config_path, sentinel)
    _serve_models(monkeypatch, [])

    with pytest.raises(PartnerError) as excinfo:
        model_backfill.provision_models("u_1", KEY, "https://api.ccagent.cn")

    assert excinfo.value.code == "models_empty"
    assert _read_defaults(config_path) == sentinel


def test_missing_key_does_not_write(config_path, crypto, monkeypatch) -> None:
    sentinel = [_entry("u_keep", "keep-model", is_default=True)]
    _write_defaults(config_path, sentinel)

    with pytest.raises(PartnerError) as excinfo:
        model_backfill.provision_models("u_1", "  ", "https://api.ccagent.cn")

    assert excinfo.value.code == "not_configured"
    assert _read_defaults(config_path) == sentinel
