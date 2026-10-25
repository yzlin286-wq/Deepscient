# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""ccagent 中转站（un.ccagent.cn）合作方接口。

模块划分（签名、HTTP、落盘、业务各一层，互不越界）：

* :mod:`~jiuwenswarm.common.partner.config`   —— config.yaml ``partner`` 段 + app_secret 来源
* :mod:`~jiuwenswarm.common.partner.signing`  —— 请求签名 / Webhook 与回跳验签
* :mod:`~jiuwenswarm.common.partner.client`   —— ``/partner/v1`` 上游调用（重试、错误码）
* :mod:`~jiuwenswarm.common.partner.store`    —— 绑定 / 订单 / 事件本地库（只存 Key 掩码）
* :mod:`~jiuwenswarm.common.partner.model_backfill` —— 模型条目回填与 ``/models`` 拉取
* :mod:`~jiuwenswarm.common.partner.service`  —— 给 Gateway 用到的业务组合

对外只暴露业务函数；``app_secret`` 不出本包，用户 ``api_key`` 只落掩码。
"""

from __future__ import annotations

__all__ = [
    "client",
    "config",
    "errors",
    "model_backfill",
    "service",
    "signing",
    "store",
]
