# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""模型名的通用处理（与具体接入方无关）。"""

from __future__ import annotations


def bare_model_name(model_name: str | None) -> str:
    """去掉 ``#<index>`` 后缀（通道侧全局序号），返回模型本名。"""
    name = str(model_name or "").strip()
    return name.rsplit("#", 1)[0] if "#" in name else name
