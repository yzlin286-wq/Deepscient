# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""中转站签名公式测试（逐条对照 relay.md 第 4/6/7 节）。"""

from __future__ import annotations

import hashlib
import hmac
import json
import time

import pytest

from jiuwenswarm.common.partner import config as config_mod
from jiuwenswarm.common.partner import signing

SECRET = "unit-test-app-secret"
APP_ID = "app_ccagent_prod"


@pytest.fixture(autouse=True)
def _isolated_partner_config(tmp_path, monkeypatch):
    """固定 secret 与数据根，绝不读真实 ~/.jiuwenswarm。"""
    monkeypatch.setenv(config_mod.SECRET_ENV, SECRET)
    monkeypatch.setattr(config_mod, "_partner_section", lambda: {})
    monkeypatch.setattr(config_mod, "data_root", lambda: tmp_path)


def _hmac(payload: str) -> str:
    return hmac.new(SECRET.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def _webhook_headers(
    body: bytes,
    *,
    event_id: str = "evt_1",
    ts: int | None = None,
    signature: str | None = None,
) -> dict[str, str]:
    timestamp = str(int(time.time()) if ts is None else ts)
    digest = hashlib.sha256(body).hexdigest()
    return {
        "X-Partner-App-Id": APP_ID,
        "X-Partner-Timestamp": timestamp,
        "X-Partner-Event-Id": event_id,
        "X-Partner-Signature": signature
        or _hmac(f"{APP_ID}\n{timestamp}\n{event_id}\n{digest}"),
    }


def test_canonical_query_sorts_keys_and_values():
    assert signing.canonical_query({"b": 2, "a": 1}) == "a=1&b=2"
    assert signing.canonical_query([("tag", "z"), ("tag", "a")]) == "tag=a&tag=z"
    assert signing.canonical_query({"b": 2, "tag": ["z", "a"], "a": 1}) == "a=1&b=2&tag=a&tag=z"


def test_canonical_query_without_params_is_empty():
    assert signing.canonical_query(None) == ""
    assert signing.canonical_query({}) == ""
    assert signing.canonical_query("") == ""
    assert signing.canonical_query("?") == ""


def test_canonical_query_accepts_query_string_and_percent_encodes():
    assert signing.canonical_query("?b=2&a=1") == "a=1&b=2"
    assert signing.canonical_query({"q": "a b&c"}) == "q=a%20b%26c"


def test_payload_digest_hashes_the_exact_post_bytes():
    raw = b'{"b": 2,  "a": 1}\n'
    assert signing.payload_digest("POST", raw) == hashlib.sha256(raw).hexdigest()
    assert signing.payload_digest("GET", None, {"b": 2, "a": 1}) == "a=1&b=2"
    assert signing.payload_digest("DELETE", None, "") == ""


def test_sign_headers_matches_the_documented_formula():
    nonce = "0123456789abcdef"
    ts = 1_800_000_000
    body = json.dumps({"external_uid": "u_1", "plan_id": 2}, separators=(",", ":")).encode()

    headers = signing.sign_headers("POST", "/partner/v1/buy-url", body, ts=ts, nonce=nonce)

    digest = hashlib.sha256(body).hexdigest()
    expected = _hmac(f"{APP_ID}\n{ts}\n{nonce}\n{digest}")
    assert headers == {
        "X-Partner-App-Id": APP_ID,
        "X-Partner-Timestamp": str(ts),
        "X-Partner-Nonce": nonce,
        "X-Partner-Signature": expected,
    }


def test_sign_headers_get_uses_canonical_query_from_path():
    headers = signing.sign_headers(
        "GET", "/partner/v1/plans?b=2&a=1", b"", ts=1_800_000_000, nonce="aaaaaaaaaaaaaaaa"
    )
    expected = _hmac(f"{APP_ID}\n1800000000\naaaaaaaaaaaaaaaa\na=1&b=2")
    assert headers["X-Partner-Signature"] == expected


def test_webhook_signature_accepts_a_valid_payload():
    body = json.dumps({"event_id": "evt_1", "event": "subscription.paid"}).encode()
    ok, reason = signing.verify_webhook(_webhook_headers(body), body)
    assert (ok, reason) == (True, "")


def test_webhook_signature_rejects_a_wrong_signature():
    body = json.dumps({"event_id": "evt_1"}).encode()
    headers = _webhook_headers(body, signature="f" * 64)
    assert signing.verify_webhook(headers, body) == (False, "bad-signature")


def test_webhook_signature_rejects_an_expired_timestamp():
    body = json.dumps({"event_id": "evt_1"}).encode()
    headers = _webhook_headers(body, ts=int(time.time()) - 400)
    assert signing.verify_webhook(headers, body) == (False, "timestamp-out-of-range")


def test_webhook_signature_rejects_header_body_event_id_mismatch():
    body = json.dumps({"event_id": "evt_body"}).encode()
    headers = _webhook_headers(body, event_id="evt_header")
    assert signing.verify_webhook(headers, body) == (False, "event-id-mismatch")


def test_return_sign_matches_the_documented_formula():
    trade_no = "SUBUSR513NOab12CD1792591714"
    status = "success"
    sign = _hmac(f"return:{trade_no}:{status}")
    assert signing.verify_return_sign(trade_no, status, sign) is True
    assert signing.verify_return_sign(trade_no, "pending", sign) is False
    assert signing.verify_return_sign(trade_no, status, "not-a-signature") is False
