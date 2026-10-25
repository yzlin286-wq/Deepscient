# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""Science homepage modules: catalog validation and idempotent module entry."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest

import jiuwenswarm.common.utils as utils
from jiuwenswarm.server.runtime import extension_package_manager as catalog
from jiuwenswarm.server.runtime import science_modules

# openjiuwen 的导入链会拉入 pysbd（源码含 invalid escape sequence，在
# filterwarnings=error 下变成 SyntaxError）。这是已知的上游依赖问题，
# 与科研模块无关，这里局部放行 SyntaxWarning。
pytestmark = pytest.mark.filterwarnings("ignore::SyntaxWarning")

REPO_ROOT = Path(__file__).resolve().parents[3]
MODULES_PATH = REPO_ROOT / "jiuwenswarm" / "resources" / "science" / "modules.json"

EXPECTED_MODULES = [
    (
        "literature",
        "sci-literature-team",
        [
            "sci-expert-literature-search",
            "sci-expert-systematic-review",
            "sci-expert-topic-framing",
        ],
    ),
    (
        "experiment",
        "sci-experiment-team",
        [
            "sci-expert-experiment-design",
            "sci-expert-statistical-power",
            "sci-expert-ethics-compliance",
        ],
    ),
    (
        "analysis",
        "sci-analysis-team",
        [
            "sci-expert-data-cleaning",
            "sci-expert-statistical-inference",
            "sci-expert-reproducibility",
        ],
    ),
    (
        "writing",
        "sci-writing-team",
        [
            "sci-expert-academic-writing",
            "sci-expert-figure-design",
            "sci-expert-visualization",
        ],
    ),
    (
        "submission",
        "sci-submission-team",
        [
            "sci-expert-journal-selection",
            "sci-expert-cover-letter",
            "sci-expert-rebuttal",
        ],
    ),
    (
        "knowledge",
        "sci-knowledge-team",
        [
            "sci-expert-knowledge-curation",
            "sci-expert-data-cleaning",
            "sci-expert-reproducibility",
        ],
    ),
]


def _empty_catalog(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        science_modules.catalog, "list_agent_groups", lambda params=None: []
    )
    monkeypatch.setattr(
        science_modules.catalog, "list_agent_templates", lambda params=None: []
    )


def _isolated_workspace(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> Path:
    workspace = tmp_path / ".jiuwenswarm"
    monkeypatch.setattr(catalog, "get_user_workspace_dir", lambda: workspace)
    monkeypatch.setattr(utils, "_workspace_base_dir", workspace)
    return workspace


def test_catalog_has_six_modules(monkeypatch: pytest.MonkeyPatch) -> None:
    _empty_catalog(monkeypatch)

    modules = science_modules.list_science_modules()

    assert [module["id"] for module in modules] == [item[0] for item in EXPECTED_MODULES]
    for module, (module_id, agent_group, experts) in zip(modules, EXPECTED_MODULES):
        assert module["id"] == module_id
        assert module["agentGroup"] == agent_group
        assert module["experts"] == experts
        assert module["title"]["zh"] and module["title"]["en"]
        assert module["description"]["zh"] and module["description"]["en"]
        assert module["quickPrompt"]["zh"] and module["quickPrompt"]["en"]
        assert module["icon"]
        assert module["tags"]
        assert module["installed"] is False
        assert module["installedExperts"] == []


def _collect_module_warnings() -> tuple[logging.Handler, list[str]]:
    messages: list[str] = []

    class _Collector(logging.Handler):
        def emit(self, record: logging.LogRecord) -> None:
            messages.append(record.getMessage())

    handler = _Collector()
    science_modules.logger.addHandler(handler)
    return handler, messages


def test_bad_module_records_are_skipped(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    source = json.loads(MODULES_PATH.read_text(encoding="utf-8"))
    valid = source["modules"][0]

    missing_field = {key: value for key, value in source["modules"][1].items()}
    missing_field.pop("tags")
    duplicate_id = json.loads(json.dumps(source["modules"][2]))
    duplicate_id["id"] = valid["id"]
    unknown_group = json.loads(json.dumps(source["modules"][3]))
    unknown_group["agentGroup"] = "sci-missing-team"
    unknown_expert = json.loads(json.dumps(source["modules"][4]))
    unknown_expert["experts"] = ["sci-expert-missing"]

    broken_path = tmp_path / "modules.json"
    broken_path.write_text(
        json.dumps(
            {
                "version": 1,
                "modules": [
                    valid,
                    missing_field,
                    duplicate_id,
                    unknown_group,
                    unknown_expert,
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(science_modules, "_MODULES_PATH", broken_path)
    _empty_catalog(monkeypatch)

    handler, messages = _collect_module_warnings()
    try:
        modules = science_modules.list_science_modules()
    finally:
        science_modules.logger.removeHandler(handler)

    assert [module["id"] for module in modules] == ["literature"]
    assert any("skipping module" in message for message in messages)
    assert any("expected 6 modules" in message for message in messages)


def test_enter_science_module_is_idempotent(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    workspace = _isolated_workspace(monkeypatch, tmp_path)

    first = science_modules.enter_science_module({"moduleId": "literature"})
    second = science_modules.enter_science_module({"moduleId": "literature"})

    assert first == second
    assert first["moduleId"] == "literature"
    assert first["agentGroupName"] == "sci-literature-team"
    assert first["experts"] == EXPECTED_MODULES[0][2]
    assert first["quickPrompt"]["zh"] and first["quickPrompt"]["en"]
    assert first["installed"] is True

    built_in_templates = (
        workspace / "agent" / "workspace" / "plugins" / "agent_templates" / "built_in"
    )
    built_in_groups = workspace / ".agent_teams" / "agent_groups" / "built_in"
    assert sorted(path.name for path in built_in_templates.iterdir()) == sorted(
        EXPECTED_MODULES[0][2]
    )
    assert [path.name for path in built_in_groups.iterdir()] == ["sci-literature-team"]
    assert (built_in_groups / "sci-literature-team" / "manifest.json").is_file()

    listed = {module["id"]: module for module in science_modules.list_science_modules()}
    assert listed["literature"]["installed"] is True
    assert sorted(listed["literature"]["installedExperts"]) == sorted(
        EXPECTED_MODULES[0][2]
    )
    assert listed["experiment"]["installed"] is False


def test_enter_science_module_rejects_unknown_id(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _isolated_workspace(monkeypatch, tmp_path)

    with pytest.raises(ValueError):
        science_modules.enter_science_module({"moduleId": "not-a-module"})
    with pytest.raises(ValueError):
        science_modules.enter_science_module({})
