# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""默认本地加密组件。

仓库里的 ``ExtensionRegistry.register_crypto_utility`` 只有外部扩展会调用，
开源发行版没有任何地方注册，``get_crypto_provider()`` 恒为 ``None``，模型下发
就会以「加密组件不可用」拒绝落盘。这里提供一个开箱即用的兜底实现：复用
``common/auth/session_store.py`` 的 AES-256-GCM 信封，密钥仍是本机
``~/.jiuwenswarm/auth/.install_key``（0600）。

密钥**不在导入时创建**：``session_store`` 内部按需惰性创建，只有真正加解密
才会写盘，避免仅导入本模块就产生副作用。
"""

from __future__ import annotations

import logging
import threading
from typing import Any

from jiuwenswarm.common.auth import session_store

logger = logging.getLogger(__name__)

#: 信封是 JSON 对象，``encrypt_json`` 的输出一定以 ``{`` 开头。旧版本/外部写入的
#: 明文 Key 不会命中这个前缀，据此区分「需要解密的密文」和「原样透传的明文」。
_ENVELOPE_PREFIX = "{"


class LocalCryptoProvider:
    """基于本机 ``.install_key`` 的加解密实现，满足 ``CryptoProvider`` 协议。"""

    def encrypt(self, plaintext: str, **kwargs: Any) -> str:
        del kwargs
        return session_store.encrypt_json(str(plaintext))

    def decrypt(self, ciphertext: str, **kwargs: Any) -> str:
        del kwargs
        raw = (ciphertext or "").strip()
        if not raw.startswith(_ENVELOPE_PREFIX):
            # 兼容历史明文：老配置里的 api_key 就是裸 Key，原样交给调用方。
            return raw
        try:
            value = session_store.decrypt_json(raw)
        except Exception:  # noqa: BLE001 — 解不开的旧数据不该让配置读取整体失败
            # 日志只记「解密失败」本身，不带密文/明文，避免 Key 进日志。
            logger.debug("[Crypto] 本地密文解密失败，按原值返回", exc_info=True)
            return raw
        return value if isinstance(value, str) else str(value)


_provider: LocalCryptoProvider | None = None
_provider_lock = threading.Lock()


def get_local_crypto_provider() -> LocalCryptoProvider:
    """进程级单例。provider 本身无状态，密钥路径在每次加解密时才解析。"""
    global _provider
    if _provider is None:
        with _provider_lock:
            if _provider is None:
                _provider = LocalCryptoProvider()
    return _provider
