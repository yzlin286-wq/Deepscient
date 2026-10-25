# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""ccagent 模型回填：条目形状、冲突规则、密文落盘与 ``/models`` 解析。"""

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


class _FakeCrypto:
    """只做可断言的「加密」：密文是明文的倒序，原文不会落盘。"""

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


def test_first_backfill_appends_entry_and_becomes_default(config_path, crypto) -> None:
    result = model_backfill.backfill_model(
        "u_1", "sk-test-1234567890", "https://api.ccagent.test/v1"
    )

    assert result == {
        "applied": True,
        "reason": "created",
        "modelName": "deepseek-chat",
        "masked": "sk-•••7890",
    }

    entries = _read_defaults(config_path)
    assert len(entries) == 1
    entry = entries[0]
    mcc = entry["model_client_config"]
    assert mcc == {
        "api_base": "https://api.ccagent.test/v1",
        "api_key": "cipher::0987654321-tset-ks",
        "model_name": "deepseek-chat",
        "client_provider": "OpenAI",
        "timeout": 360,
        "verify_ssl": True,
        "vendor_key": "ccagent",
        "plan": "custom_api",
        "endpoint_profile": "openai_compatible",
    }
    assert entry["model_config_obj"] == {
        "context_window": DEFAULT_CONTEXT_WINDOW_TOKENS,
        "partner_external_uid": "u_1",
    }
    assert entry["is_default"] is True
    assert entry["alias"] == ""


def test_new_entry_is_not_default_when_one_already_exists(config_path, crypto) -> None:
    _write_defaults(
        config_path,
        [
            {
                "model_client_config": {
                    "api_base": "https://other.test/v1",
                    "api_key": "k",
                    "model_name": "other-model",
                    "client_provider": "OpenAI",
                },
                "model_config_obj": {},
                "is_default": True,
            }
        ],
    )

    result = model_backfill.backfill_model(
        "u_1", "sk-test-1234567890", "https://api.ccagent.test/v1"
    )

    assert result["reason"] == "created"
    entries = _read_defaults(config_path)
    assert len(entries) == 2
    assert entries[1]["is_default"] is False


def test_same_uid_updates_fields_without_duplicating(config_path, crypto) -> None:
    model_backfill.backfill_model(
        "u_1", "sk-aaaaaaaaaaaa", "https://a.test/v1", model_name="deepseek-chat"
    )
    entries = _read_defaults(config_path)
    entries[0]["model_config_obj"]["temperature"] = 0.3
    _write_defaults(config_path, entries)

    result = model_backfill.backfill_model(
        "u_1", "sk-bbbbbbbbbbbb", "https://b.test/v1", model_name="deepseek-reasoner"
    )

    assert result["applied"] is True
    assert result["reason"] == "updated"
    assert result["modelName"] == "deepseek-reasoner"
    entries = _read_defaults(config_path)
    assert len(entries) == 1
    mcc = entries[0]["model_client_config"]
    assert mcc["api_base"] == "https://b.test/v1"
    assert mcc["model_name"] == "deepseek-reasoner"
    assert mcc["api_key"] == "cipher::bbbbbbbbbbbb-ks"
    # 用户自己填的字段保留
    assert entries[0]["model_config_obj"]["temperature"] == 0.3
    assert entries[0]["model_config_obj"]["partner_external_uid"] == "u_1"


def test_other_uid_conflicts_unless_forced(config_path, crypto) -> None:
    model_backfill.backfill_model(
        "u_old", "sk-oldoldoldold", "https://old.test/v1"
    )

    conflict = model_backfill.backfill_model(
        "u_new", "sk-newnewnewnew", "https://new.test/v1"
    )

    assert conflict["applied"] is False
    assert conflict["reason"] == "conflict"
    entries = _read_defaults(config_path)
    assert len(entries) == 1
    assert entries[0]["model_client_config"]["api_base"] == "https://old.test/v1"
    assert entries[0]["model_config_obj"]["partner_external_uid"] == "u_old"

    forced = model_backfill.backfill_model(
        "u_new", "sk-newnewnewnew", "https://new.test/v1", force=True
    )

    assert forced["applied"] is True
    assert forced["reason"] == "overridden"
    entries = _read_defaults(config_path)
    assert len(entries) == 1
    assert entries[0]["model_client_config"]["api_base"] == "https://new.test/v1"
    assert entries[0]["model_config_obj"]["partner_external_uid"] == "u_new"
    assert entries[0]["is_default"] is True  # 覆盖时保留原条目的默认标记


def test_api_key_is_persisted_encrypted(config_path, crypto) -> None:
    plain = "sk-plain-abcdefgh"

    model_backfill.backfill_model("u_1", plain, "https://api.ccagent.test/v1")

    raw = config_path.read_text(encoding="utf-8")
    assert plain not in raw
    assert f"cipher::{plain[::-1]}" in raw
    assert crypto.encrypted == [plain]


def test_fetch_models_parses_data_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    def _fake(method: str, url: str, **kwargs: Any) -> _Response:
        captured.update({"method": method, "url": url, **kwargs})
        return _Response(
            200,
            {
                "data": [
                    {"id": "deepseek-chat"},
                    {"id": "deepseek-reasoner"},
                    {"id": "deepseek-chat"},
                ]
            },
        )

    monkeypatch.setattr(model_backfill, "requests_request", _fake)

    ids = model_backfill.fetch_models("https://api.ccagent.test/v1/", "sk-test")

    assert ids == ["deepseek-chat", "deepseek-reasoner"]
    assert captured["method"] == "GET"
    assert captured["url"] == "https://api.ccagent.test/v1/models"
    assert captured["headers"]["Authorization"] == "Bearer sk-test"
    assert captured["timeout"] == 10


def test_fetch_models_parses_models_ids(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        model_backfill,
        "requests_request",
        lambda *args, **kwargs: _Response(200, {"models": [{"id": "deepseek-chat"}]}),
    )

    assert model_backfill.fetch_models("https://api.ccagent.test/v1", "sk-test") == [
        "deepseek-chat"
    ]


def test_fetch_models_raises_partner_error_on_http_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        model_backfill,
        "requests_request",
        lambda *args, **kwargs: _Response(503, {"message": "boom"}),
    )

    with pytest.raises(PartnerError) as excinfo:
        model_backfill.fetch_models("https://api.ccagent.test/v1", "sk-test")

    assert excinfo.value.code == "models_fetch_failed"
    assert excinfo.value.status == 503


def test_fetch_models_raises_partner_error_on_network_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _boom(*args: Any, **kwargs: Any) -> _Response:
        raise OSError("connection reset")

    monkeypatch.setattr(model_backfill, "requests_request", _boom)

    with pytest.raises(PartnerError) as excinfo:
        model_backfill.fetch_models("https://api.ccagent.test/v1", "sk-test")

    assert excinfo.value.code == "network_error"
