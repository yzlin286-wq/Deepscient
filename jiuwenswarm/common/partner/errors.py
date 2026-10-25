# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""中转站调用的统一错误。"""

from __future__ import annotations


class PartnerError(Exception):
    """中转站相关失败。

    Attributes:
        message: 给人看的说明（不含 secret / 明文 Key）。
        code: 业务码。上游业务码按字符串保留（``40101`` / ``40401`` / ``40403``）；
            本机产生的失败用 ``not_configured`` / ``rate_limited`` / ``network_error``。
        status: HTTP 状态；连请求都没发出去（没配 secret、网络失败）时为 0。
        upstream_code: 上游返回的业务码（没有时为空串），便于排查时区分本机映射。
    """

    def __init__(
        self,
        message: str,
        code: str = "",
        status: int = 0,
        upstream_code: str = "",
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = str(code or "")
        self.status = int(status or 0)
        self.upstream_code = str(upstream_code or "")

    def __str__(self) -> str:
        return self.message
