"""Desktop updater falls back to version comparison when timestamps are missing.

GitHub/GitCode release timestamps are the primary ordering signal for desktop
updates, but a release (or the installed release tag) may be missing its
``published_at`` value.  A missing timestamp must never abort the update check:
the updater logs a warning and compares versions instead.
"""

from __future__ import annotations

import sys

import pytest

from jiuwenswarm.common import updater
from jiuwenswarm.common.version_source import ReleaseAsset, ReleaseInfo


@pytest.fixture(autouse=True)
def desktop_environment(monkeypatch, tmp_path):
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.setenv("JIUWENSWARM_DESKTOP", "1")
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(updater, "get_user_workspace_dir", lambda: tmp_path)
    monkeypatch.setattr(updater, "__version__", "0.2.0")
    monkeypatch.setattr(
        updater,
        "get_config_raw",
        lambda: {"updater": {"enabled": True}},
    )


def _release(
    version: str,
    *,
    published_at: str = "",
    current_release_published_at: str = "",
) -> ReleaseInfo:
    return ReleaseInfo(
        version=version,
        published_at=published_at,
        current_release_published_at=current_release_published_at,
        assets=[
            ReleaseAsset(
                name=f"DeepScient-{version}-macos.dmg",
                download_url=f"https://example.test/DeepScient-{version}-macos.dmg",
            )
        ],
        source_type="github",
    )


def _check_with(monkeypatch, release: ReleaseInfo) -> dict:
    def fake_fetch_latest(self, current_version=""):
        assert current_version == "0.2.0"
        return release

    monkeypatch.setattr(
        updater.GitHubReleasesSource,
        "fetch_latest",
        fake_fetch_latest,
    )
    return updater.UpdaterService().check(manual=True)


@pytest.mark.parametrize(
    ("candidate", "expected"),
    [("0.2.1", True), ("0.3.0", True), ("0.2.0", False), ("0.1.9", False)],
)
def test_is_newer_version_from_0_2_0(candidate, expected):
    assert updater._is_newer_version(candidate, "0.2.0") is expected


def test_missing_current_timestamp_falls_back_to_version_comparison(monkeypatch):
    warnings: list[str] = []
    monkeypatch.setattr(
        updater.logger,
        "warning",
        lambda message, *args, **kwargs: warnings.append(message % args),
    )
    release = _release(
        "0.2.1",
        published_at="2026-10-20T00:00:00Z",
        current_release_published_at="",
    )

    status = _check_with(monkeypatch, release)

    assert status["has_update"] is True
    assert status["state"] == "update_available"
    assert status["latest_version"] == "0.2.1"
    assert status["error"] == ""
    assert any("has no publication timestamp" in message for message in warnings)


def test_missing_current_timestamp_with_same_version_is_up_to_date(monkeypatch):
    release = _release(
        "0.2.0",
        published_at="2026-10-20T00:00:00Z",
        current_release_published_at="",
    )

    status = _check_with(monkeypatch, release)

    assert status["has_update"] is False
    assert status["state"] == "up_to_date"
    assert status["latest_version"] == "0.2.0"
    assert status["error"] == ""


def test_missing_latest_timestamp_falls_back_to_version_comparison(monkeypatch):
    release = _release(
        "0.3.0",
        published_at="",
        current_release_published_at="2026-10-01T00:00:00Z",
    )

    status = _check_with(monkeypatch, release)

    assert status["has_update"] is True
    assert status["state"] == "update_available"
    assert status["latest_version"] == "0.3.0"
    assert status["error"] == ""


def test_same_version_republish_uses_newer_timestamp(monkeypatch):
    release = _release(
        "0.2.0",
        published_at="2026-10-20T00:00:00Z",
        current_release_published_at="2026-10-01T00:00:00Z",
    )

    status = _check_with(monkeypatch, release)

    assert status["has_update"] is True
    assert status["state"] == "update_available"
    assert status["latest_version"] == "0.2.0"
    assert status["error"] == ""
