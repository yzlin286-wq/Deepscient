# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""中转站上游客户端：重试策略、错误码映射、plan_id 清理。"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from jiuwenswarm.common.partner import client
from jiuwenswarm.common.partner import config as config_mod
from jiuwenswarm.common.partner.errors import PartnerError

SECRET = "unit-test-app-secret"
BASE = "https://relay.test"


class _Response:
    def __init__(self, status_code: int, payload: object = None) -> None:
        self.status_code = status_code
        self.text = "" if payload is None else json.dumps(payload)


@pytest.fixture
def relay(monkeypatch, tmp_path) -> SimpleNamespace:
    monkeypatch.setenv(config_mod.SECRET_ENV, SECRET)
    monkeypatch.setattr(config_mod, "_partner_section", lambda: {"base_url": BASE})
    monkeypatch.setattr(config_mod, "data_root", lambda: tmp_path)

    sleeps: list[float] = []
    monkeypatch.setattr(client, "_sleep", lambda seconds: sleeps.append(seconds))

    calls: list[dict] = []
    queue: list[object] = []

    def _fake_request(method: str, url: str, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        if not queue:
            raise AssertionError(f"unexpected request: {method} {url}")
        item = queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    monkeypatch.setattr(client, "requests_request", _fake_request)
    client._plans_cache.update({"at": 0.0, "items": []})
    return SimpleNamespace(calls=calls, queue=queue, sleeps=sleeps)


def test_429_is_retried_with_a_fresh_nonce(relay):
    relay.queue.extend(
        [
            _Response(429, {"code": 42901, "message": "too many"}),
            _Response(200, {"code": 0, "message": "ok", "data": {"app_id": "app", "ts": 7}}),
        ]
    )

    data = client.ping()

    assert data == {"app_id": "app", "ts": 7}
    assert len(relay.calls) == 2
    assert relay.sleeps == [1]
    first, second = relay.calls
    assert first["headers"]["X-Partner-Nonce"] != second["headers"]["X-Partner-Nonce"]
    assert first["headers"]["X-Partner-Signature"] != second["headers"]["X-Partner-Signature"]


def test_500_is_retried(relay):
    relay.queue.extend(
        [
            _Response(500, {"code": 50001, "message": "boom"}),
            _Response(200, {"code": 0, "message": "ok", "data": {}}),
        ]
    )

    assert client.ping() == {}
    assert len(relay.calls) == 2
    assert relay.sleeps == [1]


def test_400_is_not_retried(relay):
    relay.queue.append(_Response(400, {"code": 40001, "message": "bad request"}))

    with pytest.raises(PartnerError) as error:
        client.ping()

    assert len(relay.calls) == 1
    assert relay.sleeps == []
    assert error.value.status == 400
    assert error.value.code == "40001"


def test_get_user_maps_40401_to_found_false(relay):
    relay.queue.append(_Response(404, {"code": 40401, "message": "not synced"}))

    assert client.get_user("u_1") == {"found": False, "externalUid": "u_1"}
    assert len(relay.calls) == 1


def test_exhausted_429_maps_to_rate_limited(relay):
    for _ in range(4):
        relay.queue.append(_Response(429, {"code": 42901, "message": "too many"}))

    with pytest.raises(PartnerError) as error:
        client.ping()

    assert error.value.code == "rate_limited"
    assert error.value.status == 429
    assert len(relay.calls) == 4
    assert relay.sleeps == [1, 2, 4]


def test_create_buy_url_drops_an_invalid_plan_id(relay):
    relay.queue.append(_Response(200, {"code": 0, "data": {"url": "https://pay.test/1"}}))
    client.create_buy_url("u_1", plan_id="not-a-number")
    body = json.loads(relay.calls[-1]["data"])
    assert body == {"external_uid": "u_1"}

    for bad in (0, -3, 1.5, "", None, False):
        relay.queue.append(_Response(200, {"code": 0, "data": {}}))
        client.create_buy_url("u_1", plan_id=bad)
        assert "plan_id" not in json.loads(relay.calls[-1]["data"])


def test_create_buy_url_sends_a_positive_plan_id(relay):
    relay.queue.append(_Response(200, {"code": 0, "data": {"url": "https://pay.test/2"}}))

    assert client.create_buy_url("u_1", plan_id=2, return_url="https://app.test/partner/return") == {
        "url": "https://pay.test/2"
    }
    body = json.loads(relay.calls[-1]["data"])
    assert body == {
        "external_uid": "u_1",
        "plan_id": 2,
        "return_url": "https://app.test/partner/return",
    }
