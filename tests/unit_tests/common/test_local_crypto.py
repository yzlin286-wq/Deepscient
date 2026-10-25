# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""默认本地加密组件：密文形态、明文兼容与密钥复用。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import jiuwenswarm.common.utils as utils
from jiuwenswarm.common.security.local_crypto import (
    LocalCryptoProvider,
    get_local_crypto_provider,
)

KEY = "sk-local-crypto-1234567890"


@pytest.fixture(autouse=True)
def data_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """把数据根指到临时目录：密钥落盘绝不能碰真实的 ~/.jiuwenswarm。"""
    root = tmp_path / "data"
    root.mkdir()
    monkeypatch.setattr(utils, "_workspace_base_dir", root)
    return root


def _key_file(root: Path) -> Path:
    return root / "auth" / ".install_key"


def test_encrypt_returns_envelope_instead_of_plaintext() -> None:
    cipher = get_local_crypto_provider().encrypt(KEY)

    assert cipher != KEY
    assert KEY not in cipher
    envelope = json.loads(cipher)
    assert envelope["alg"] == "A256GCM"
    assert envelope["version"] == 1


def test_decrypt_round_trips() -> None:
    provider = get_local_crypto_provider()

    assert provider.decrypt(provider.encrypt(KEY)) == KEY


def test_legacy_plaintext_is_returned_as_is() -> None:
    provider = get_local_crypto_provider()

    assert provider.decrypt(KEY) == KEY
    assert provider.decrypt("") == ""


def test_reinstantiated_provider_still_decrypts(data_root: Path) -> None:
    cipher = LocalCryptoProvider().encrypt(KEY)

    # 同一数据根（同一份 .install_key）下新建的实例必须能解开旧密文
    assert LocalCryptoProvider().decrypt(cipher) == KEY
    assert _key_file(data_root).exists()


def test_ciphertext_has_no_plaintext_leak(data_root: Path) -> None:
    cipher = get_local_crypto_provider().encrypt(KEY)

    assert KEY not in cipher
    assert KEY.encode("utf-8") not in _key_file(data_root).read_bytes()


def test_provider_creation_does_not_create_key(data_root: Path) -> None:
    assert get_local_crypto_provider() is get_local_crypto_provider()

    assert not _key_file(data_root).exists(), "只有真正加解密才应创建密钥"


def test_undecryptable_envelope_is_returned_as_is() -> None:
    garbage = json.dumps({"version": 1, "alg": "A256GCM", "iv": "", "tag": "", "data": ""})

    assert get_local_crypto_provider().decrypt(garbage) == garbage
