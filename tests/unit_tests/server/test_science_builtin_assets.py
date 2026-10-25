# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""Built-in science expert templates, groups and shared skills."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import jiuwenswarm.common.utils as utils
from jiuwenswarm.agents.swarm.agent_group import load_agent_group_package
from jiuwenswarm.server.runtime import extension_package_manager as catalog

REPO_ROOT = Path(__file__).resolve().parents[3]
RESOURCES_ROOT = REPO_ROOT / "jiuwenswarm" / "resources" / "agent" / "workspace"
TEMPLATES_DIR = RESOURCES_ROOT / "plugins" / "agent_templates"
GROUPS_DIR = RESOURCES_ROOT / "plugins" / "agent_groups"
SKILLS_DIR = RESOURCES_ROOT / "skills"

LEADER_TEMPLATES = [
    "sci-lead-literature",
    "sci-lead-experiment",
    "sci-lead-analysis",
    "sci-lead-writing",
    "sci-lead-submission",
    "sci-lead-knowledge",
]

MEMBER_TEMPLATES = [
    "sci-expert-literature-search",
    "sci-expert-systematic-review",
    "sci-expert-topic-framing",
    "sci-expert-experiment-design",
    "sci-expert-statistical-power",
    "sci-expert-ethics-compliance",
    "sci-expert-data-cleaning",
    "sci-expert-statistical-inference",
    "sci-expert-reproducibility",
    "sci-expert-visualization",
    "sci-expert-academic-writing",
    "sci-expert-figure-design",
    "sci-expert-journal-selection",
    "sci-expert-cover-letter",
    "sci-expert-rebuttal",
    "sci-expert-knowledge-curation",
]

TEAMS = {
    "sci-literature-team": (
        "sci-lead-literature",
        [
            "sci-expert-literature-search",
            "sci-expert-systematic-review",
            "sci-expert-topic-framing",
        ],
        "sci-literature-review",
    ),
    "sci-experiment-team": (
        "sci-lead-experiment",
        [
            "sci-expert-experiment-design",
            "sci-expert-statistical-power",
            "sci-expert-ethics-compliance",
        ],
        "sci-experiment-design",
    ),
    "sci-analysis-team": (
        "sci-lead-analysis",
        [
            "sci-expert-data-cleaning",
            "sci-expert-statistical-inference",
            "sci-expert-reproducibility",
        ],
        "sci-statistics-repro",
    ),
    "sci-writing-team": (
        "sci-lead-writing",
        [
            "sci-expert-academic-writing",
            "sci-expert-figure-design",
            "sci-expert-visualization",
        ],
        "sci-paper-writing",
    ),
    "sci-submission-team": (
        "sci-lead-submission",
        [
            "sci-expert-journal-selection",
            "sci-expert-cover-letter",
            "sci-expert-rebuttal",
        ],
        "sci-submission-pack",
    ),
    "sci-knowledge-team": (
        "sci-lead-knowledge",
        [
            "sci-expert-knowledge-curation",
            "sci-expert-data-cleaning",
            "sci-expert-reproducibility",
        ],
        "sci-research-asset",
    ),
}

SHARED_SKILLS = [
    "sci-literature-review",
    "sci-experiment-design",
    "sci-statistics-repro",
    "sci-paper-writing",
    "sci-submission-pack",
    "sci-research-asset",
]


def _read_manifest(package_dir: Path) -> dict:
    return json.loads((package_dir / "manifest.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("team_id", sorted(TEAMS))
def test_builtin_science_teams_load(team_id: str) -> None:
    leader_id, member_ids, skill_id = TEAMS[team_id]
    package_dir = GROUPS_DIR / team_id

    templates = load_agent_group_package(package_dir)

    assert list(templates) == ["leader", *member_ids]
    assert len(templates) == 4
    assert templates["leader"].agent_card.id == "leader"
    for member_id in member_ids:
        assert templates[member_id].agent_card.id == member_id
        assert [Path(skill.dir).name for skill in templates[member_id].skills] == [
            skill_id
        ]

    manifest = _read_manifest(package_dir)
    assert manifest["package_type"] == "agent_group"
    assert manifest["name"] == team_id
    assert manifest["agents"] == ["leader", *member_ids]
    assert manifest["skills"] == [skill_id]
    assert leader_id in LEADER_TEMPLATES

    assert (package_dir / "agents" / "leader" / "AGENT.md").is_file()
    for member_id in member_ids:
        assert not (package_dir / "agents" / member_id / "AGENT.md").exists()


@pytest.mark.parametrize("template_id", LEADER_TEMPLATES + MEMBER_TEMPLATES)
def test_builtin_science_templates_are_loadable_packages(template_id: str) -> None:
    package_dir = TEMPLATES_DIR / template_id
    manifest = _read_manifest(package_dir)

    assert package_dir.name == template_id
    assert manifest["package_type"] == "agent_template"
    assert manifest["name"]
    assert manifest["display_name"]
    assert manifest["description"]
    assert manifest["category"] == "科研"
    assert "科研" in manifest["tags"]
    assert manifest["display_description"]["zh"]
    assert manifest["display_description"]["en"]
    assert manifest["persona"]["dir"] == "./persona"

    persona_dir = package_dir / manifest["persona"]["dir"]
    assert persona_dir.is_dir()
    assert sorted(path.suffix for path in persona_dir.iterdir() if path.is_file()) == [
        ".md"
    ]


@pytest.mark.parametrize("template_id", MEMBER_TEMPLATES)
def test_builtin_science_members_have_no_agent_md(template_id: str) -> None:
    assert (TEMPLATES_DIR / template_id / "persona").is_dir()
    assert not (TEMPLATES_DIR / template_id / "AGENT.md").exists()


@pytest.mark.parametrize("template_id", LEADER_TEMPLATES)
def test_builtin_science_leaders_ship_agent_md(template_id: str) -> None:
    agent_md = TEMPLATES_DIR / template_id / "AGENT.md"
    assert agent_md.is_file()
    text = agent_md.read_text(encoding="utf-8")
    assert "Leader" in text
    assert "拆解任务" in text
    assert "核验证据链" in text
    assert "汇总交付" in text


def test_catalog_lists_builtin_science_assets(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setattr(utils, "_workspace_base_dir", tmp_path / ".jiuwenswarm")

    template_cards = catalog.list_agent_templates({"filter": "builtin"})
    science_templates = [
        card for card in template_cards if str(card.get("id", "")).startswith("sci-")
    ]
    assert len(science_templates) == 22
    assert {card["id"] for card in science_templates} == set(
        LEADER_TEMPLATES + MEMBER_TEMPLATES
    )
    assert {card["source"] for card in science_templates} == {"builtin"}

    group_cards = catalog.list_agent_groups({"filter": "builtin"})
    science_teams = [
        card
        for card in group_cards
        if str(card.get("id", "")).startswith("sci-")
        and str(card.get("id", "")).endswith("-team")
    ]
    assert len(science_teams) == 6
    assert {card["id"] for card in science_teams} == set(TEAMS)
    assert {card["source"] for card in science_teams} == {"builtin"}


@pytest.mark.parametrize("skill_id", SHARED_SKILLS)
def test_builtin_science_skills_have_front_matter(skill_id: str) -> None:
    skill_md = SKILLS_DIR / skill_id / "SKILL.md"
    assert skill_md.is_file()

    text = skill_md.read_text(encoding="utf-8")
    assert text.startswith("---\n")
    front_matter, _, body = text[4:].partition("\n---\n")
    assert f"name: {skill_id}" in front_matter.splitlines()
    assert any(line.startswith("description: ") for line in front_matter.splitlines())
    assert len(text.splitlines()) >= 15
    assert body.strip()


@pytest.mark.parametrize("team_id", sorted(TEAMS))
def test_builtin_science_team_skills_match_shared_skills(team_id: str) -> None:
    _, _, skill_id = TEAMS[team_id]
    team_skill = GROUPS_DIR / team_id / "skills" / skill_id / "SKILL.md"
    shared_skill = SKILLS_DIR / skill_id / "SKILL.md"

    assert team_skill.is_file()
    assert team_skill.read_text(encoding="utf-8") == shared_skill.read_text(
        encoding="utf-8"
    )


def test_builtin_science_resources_have_no_symlinks() -> None:
    for root in (TEMPLATES_DIR, GROUPS_DIR):
        for path in root.rglob("*"):
            if path.name.startswith("sci-"):
                assert not path.is_symlink()
