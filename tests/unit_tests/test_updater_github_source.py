import json
import sys

import pytest

from jiuwenswarm.common import updater


@pytest.fixture(autouse=True)
def desktop_mode(monkeypatch):
    monkeypatch.delattr(sys, "frozen", raising=False)
    monkeypatch.setenv("JIUWENSWARM_DESKTOP", "1")
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    monkeypatch.delenv("DEEPSCIENT_GITHUB_TOKEN", raising=False)


def test_load_config_defaults_to_github_deepscient_repository(monkeypatch):
    monkeypatch.setattr(updater, "get_config_raw", lambda: {"updater": {}})

    config = updater.UpdaterService._load_config()

    assert config["install_mode"] == "desktop"
    assert config["release_api_type"] == "github"
    assert config["repo_owner"] == "yzlin286-wq"
    assert config["repo_name"] == "Deepscient"
    assert config["release_api_url"] == (
        "https://api.github.com/repos/yzlin286-wq/Deepscient/releases/latest"
    )


def test_default_source_config_targets_github(monkeypatch):
    assert updater.DEFAULT_SOURCE_CONFIG["desktop_release_api_type"] == "github"
    assert updater.DEFAULT_SOURCE_CONFIG["repo_owner"] == "yzlin286-wq"
    assert updater.DEFAULT_SOURCE_CONFIG["repo_name"] == "Deepscient"
    assert updater.DEFAULT_SOURCE_CONFIG["release_api_url"] == ""
    assert updater.DEFAULT_SOURCE_CONFIG["pypi_mirror"] == ""
    assert updater.DEFAULT_SOURCE_CONFIG["asset_name_pattern_windows"] == (
        "DeepScient-{version}-windows.exe"
    )
    assert updater.DEFAULT_SOURCE_CONFIG["asset_name_pattern_macos"] == (
        "DeepScient-{version}-macos.dmg"
    )
    assert updater.DEFAULT_SOURCE_CONFIG["asset_name_pattern_linux"] == (
        "DeepScient-{version}.tar.gz"
    )


def test_default_asset_patterns_are_deepscient(monkeypatch):
    monkeypatch.setattr(updater, "get_config_raw", lambda: {"updater": {}})

    config = updater.UpdaterService._load_config()

    assert config["asset_name_pattern_windows"] == "DeepScient-{version}-windows.exe"
    assert config["asset_name_pattern_macos"] == "DeepScient-{version}-macos.dmg"
    assert config["asset_name_pattern_linux"] == "DeepScient-{version}.tar.gz"


def test_pip_install_mode_still_uses_pypi(monkeypatch):
    monkeypatch.delenv("JIUWENSWARM_DESKTOP", raising=False)
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    monkeypatch.setattr(updater, "get_config_raw", lambda: {"updater": {}})

    config = updater.UpdaterService._load_config()

    assert config["install_mode"] == "pip"
    assert config["release_api_type"] == "pypi"
    assert config["desktop_release_api_type"] == "github"


def test_get_access_token_prefers_github_token(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "  github-token  ")
    monkeypatch.setenv("DEEPSCIENT_GITHUB_TOKEN", "deepscient-token")

    assert updater.get_access_token() == "github-token"


def test_get_access_token_falls_back_to_deepscient_token(monkeypatch):
    monkeypatch.setenv("DEEPSCIENT_GITHUB_TOKEN", "  deepscient-token  ")

    assert updater.get_access_token() == "deepscient-token"


def test_get_access_token_returns_empty_without_env(monkeypatch):
    assert updater.get_access_token() == ""
    assert not hasattr(updater, "DEFAULT_TEXT")


def test_github_source_receives_environment_token(monkeypatch):
    monkeypatch.setenv("DEEPSCIENT_GITHUB_TOKEN", "deepscient-token")
    monkeypatch.setattr(updater, "get_config_raw", lambda: {"updater": {}})

    config = updater.UpdaterService._load_config()
    source = updater.UpdaterService._create_version_source(config)

    assert source._token == "deepscient-token"
    assert source._api_url == (
        "https://api.github.com/repos/yzlin286-wq/Deepscient/releases/latest"
    )


def test_reset_source_defaults_stay_on_github(monkeypatch):
    # updater.reset_source writes DEFAULT_SOURCE_CONFIG back to config.yaml.
    monkeypatch.setattr(
        updater,
        "get_config_raw",
        lambda: {"updater": dict(updater.DEFAULT_SOURCE_CONFIG)},
    )

    config = updater.UpdaterService._load_config()

    assert config["release_api_type"] == "github"
    assert config["repo_owner"] == "yzlin286-wq"
    assert config["repo_name"] == "Deepscient"
    assert "api.github.com/repos/yzlin286-wq/Deepscient/releases/latest" in (
        config["release_api_url"]
    )


def test_runtime_config_and_status_do_not_expose_token(monkeypatch):
    monkeypatch.setenv("GITHUB_TOKEN", "super-secret-token")
    monkeypatch.setattr(updater, "get_config_raw", lambda: {"updater": {}})

    service = updater.UpdaterService()
    runtime_config = service.get_runtime_config()
    status = service.get_status()

    assert "access_token" not in runtime_config
    assert "super-secret-token" not in json.dumps(runtime_config)
    assert "super-secret-token" not in json.dumps(status)


def test_desktop_asset_resolution_prefers_configured_pattern(monkeypatch, tmp_path):
    from jiuwenswarm.common.version_source import ReleaseAsset, ReleaseInfo

    monkeypatch.setattr(updater, "get_user_workspace_dir", lambda: tmp_path)
    monkeypatch.setattr(sys, "platform", "darwin")
    release = ReleaseInfo(
        version="0.2.0",
        assets=[
            ReleaseAsset(
                name="OtherApp-0.2.0.dmg",
                download_url="https://example.test/other",
            ),
            ReleaseAsset(
                name="DeepScient-0.2.0-macos.dmg",
                download_url="https://example.test/preferred",
            ),
        ],
    )

    service = updater.UpdaterService()
    service._resolve_desktop_asset(
        {"asset_name_pattern_macos": "DeepScient-{version}-macos.dmg"},
        release,
    )

    status = service.get_status()
    assert status["matched_asset"] == "DeepScient-0.2.0-macos.dmg"
    assert status["download_url"] == "https://example.test/preferred"
