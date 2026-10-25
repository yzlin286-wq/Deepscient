# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.
from __future__ import annotations

import pytest

from jiuwenswarm.common import config as config_mod
from jiuwenswarm.common.config import get_available_models


def _configured(model_name: str, api_key: str = "user-key") -> dict:
    return {
        "model_client_config": {
            "model_name": model_name,
            "api_base": "https://user.example.com/v1",
            "api_key": api_key,
            "client_provider": "OpenAI",
        },
        "model_config_obj": {"temperature": 0.7},
    }


@pytest.fixture
def patched(monkeypatch):
    def _apply(configured: list[dict]):
        monkeypatch.setattr(config_mod, "get_default_models", lambda _c=None: list(configured))

    return _apply


def test_returns_configured_models(patched):
    patched([_configured("a"), _configured("b")])
    assert [e["model_client_config"]["model_name"] for e in get_available_models(None)] == ["a", "b"]


def test_empty_config_returns_empty_list(monkeypatch):
    monkeypatch.setattr(config_mod, "get_default_models", lambda _c=None: [])
    assert get_available_models(None) == []
