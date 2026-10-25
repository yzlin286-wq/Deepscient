# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""中转站配置：``config.yaml`` 的 ``partner`` 段 + app_secret 的三级来源。

配置每次调用现算，不缓存：设置页 / 用例注入临时数据根后不必重启进程。

读取顺序：

1. 环境变量 ``CCAGENT_PARTNER_APP_SECRET``；
2. ``<数据根>/science/partner-app-secret``（0600，一行）；
3. 安装包内置 ``jiuwenswarm/resources/science/partner-app-secret``（0600，只读兜底）。

首次运行只有内置文件时，会把它复制到数据根（0600），之后按普通本地文件读取；
``secretSource`` 仍如实报 ``bundled``。

三条红线：

* **绝不返回值**，对外只暴露「有没有」与「从哪来」（``env`` / ``file`` /
  ``bundled``）；
* 不把 secret 写进日志 / 状态 / 前端；
* ``PartnerConfig`` 的 ``repr`` 不含 secret，避免对象被顺手打进日志。
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from jiuwenswarm.common.utils import get_user_workspace_dir

logger = logging.getLogger(__name__)

SECRET_ENV = "CCAGENT_PARTNER_APP_SECRET"
SECRET_FILE_NAME = "partner-app-secret"
STORE_FILE_NAME = "partner.json"
WEBHOOK_PATH = "/partner/webhook"
RETURN_PATH = "/partner/return"
PARTNER_PREFIX = "/partner/v1"

DEFAULT_APP_ID = "app_ccagent_prod"
DEFAULT_BASE_URL = "https://un.ccagent.cn"
DEFAULT_MODEL = "deepseek-chat"
DEFAULT_PLANS_CACHE_SECONDS = 60
DEFAULT_REQUEST_TIMEOUT_SECONDS = 10


def data_root() -> Path:
    """数据根（测试里 monkeypatch 这个函数把落盘改到 tmp_path）。"""
    return Path(get_user_workspace_dir())


def science_dir() -> Path:
    return data_root() / "science"


def secret_path() -> Path:
    return science_dir() / SECRET_FILE_NAME


def bundled_secret_path() -> Path:
    """安装包内置密钥（只读兜底）。测试可 monkeypatch 这个函数。"""
    return Path(__file__).resolve().parents[2] / "resources" / "science" / SECRET_FILE_NAME


def store_path() -> Path:
    return science_dir() / STORE_FILE_NAME


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _positive_int(value: Any, default: int) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return number if number > 0 else default


def _partner_section() -> dict[str, Any]:
    """读 ``config.yaml`` 的 ``partner`` 段；读不到就当空段，用默认值。"""
    try:
        from jiuwenswarm.common.config import get_config

        raw = get_config()
    except Exception:  # noqa: BLE001 — 配置读不出来不该让整个功能不可用
        return {}
    section = raw.get("partner") if isinstance(raw, dict) else None
    return section if isinstance(section, dict) else {}


def normalize_base_url(raw: Any) -> str:
    """基址去尾斜杠；误填成带 ``/partner/v1`` 的完整地址时剥掉，避免拼出双前缀。"""
    value = _text(raw) or DEFAULT_BASE_URL
    value = value.rstrip("/")
    if value.endswith(PARTNER_PREFIX):
        value = value[: -len(PARTNER_PREFIX)].rstrip("/")
    return value or DEFAULT_BASE_URL


def normalize_public_base(raw: Any) -> str:
    value = _text(raw)
    if not value:
        return ""
    if not (value.startswith("http://") or value.startswith("https://")):
        return ""
    return value.rstrip("/")


def _read_env_secret() -> str:
    return _text(os.environ.get(SECRET_ENV))


def _read_file_secret() -> str:
    try:
        return _text(secret_path().read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError):
        return ""


def _read_bundled_secret() -> str:
    try:
        return _text(bundled_secret_path().read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError):
        return ""


def _promote_bundled_secret(secret: str) -> None:
    """把内置密钥复制到数据根（0600）。失败只留 warn，不阻断只读兜底。"""
    path = secret_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        tmp.write_text(secret + "\n", encoding="utf-8")
        try:
            os.chmod(tmp, 0o600)
        except OSError:  # pragma: no cover — 平台差异
            pass
        os.replace(tmp, path)
        try:
            os.chmod(path, 0o600)
        except OSError:  # pragma: no cover — 平台差异
            pass
    except OSError:
        logger.warning("[Partner] 内置合作方密钥复制失败，将继续只读使用内置文件")


def secret_source() -> str:
    """``env`` / ``file`` / ``bundled`` / ``""``；只报来源，不返回值。"""
    if _read_env_secret():
        return "env"
    if _read_file_secret():
        return "file"
    if _read_bundled_secret():
        return "bundled"
    return ""


def secret_present() -> bool:
    return bool(secret_source())


def _resolve_secret() -> tuple[str, str]:
    env_secret = _read_env_secret()
    if env_secret:
        return env_secret, "env"
    file_secret = _read_file_secret()
    if file_secret:
        return file_secret, "file"
    bundled = _read_bundled_secret()
    if bundled:
        _promote_bundled_secret(bundled)
        return bundled, "bundled"
    return "", ""


@dataclass(frozen=True)
class PartnerConfig:
    """一次调用期间的配置快照。

    ``secret`` 标了 ``repr=False``：这个对象被顺手 ``logger.info("%s", cfg)`` 时不会泄密。
    """

    enabled: bool
    app_id: str
    base_url: str
    public_base: str
    webhook_url: str
    default_model: str
    plans_cache_seconds: int
    request_timeout_seconds: int
    secret: str = field(default="", repr=False)
    secret_source: str = ""

    @property
    def configured(self) -> bool:
        """功能可用 = 开关打开且拿到 secret。"""
        return bool(self.enabled and self.secret)


def partner_config() -> PartnerConfig:
    section = _partner_section()

    enabled_raw = section.get("enabled", True)
    enabled = bool(enabled_raw) if isinstance(enabled_raw, bool) else True

    app_id = _text(section.get("app_id")) or DEFAULT_APP_ID
    base_url = normalize_base_url(section.get("base_url"))
    public_base = normalize_public_base(section.get("public_base"))
    webhook_url = _text(section.get("webhook_url"))
    if not webhook_url:
        webhook_url = f"{public_base}{WEBHOOK_PATH}" if public_base else WEBHOOK_PATH

    secret, source = _resolve_secret()
    return PartnerConfig(
        enabled=enabled,
        app_id=app_id,
        base_url=base_url,
        public_base=public_base,
        webhook_url=webhook_url,
        default_model=_text(section.get("default_model")) or DEFAULT_MODEL,
        plans_cache_seconds=_positive_int(
            section.get("plans_cache_seconds"), DEFAULT_PLANS_CACHE_SECONDS
        ),
        request_timeout_seconds=_positive_int(
            section.get("request_timeout_seconds"), DEFAULT_REQUEST_TIMEOUT_SECONDS
        ),
        secret=secret,
        secret_source=source,
    )


def configured() -> bool:
    return partner_config().configured


def return_url() -> str:
    """购买跳转的 ``return_url``。没有报备公网基址时不下发，少个按钮好过整次购买失败。"""
    public_base = partner_config().public_base
    return f"{public_base}{RETURN_PATH}" if public_base else ""
