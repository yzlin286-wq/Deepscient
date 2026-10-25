# Copyright (c) Huawei Technologies Co., Ltd. 2026. All rights reserved.

"""Science homepage modules: catalog reader and one-click expert team entry."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from jiuwenswarm.server.runtime import extension_package_manager as catalog

logger = logging.getLogger(__name__)

_RESOURCES_ROOT = Path(__file__).resolve().parents[2] / "resources"
_MODULES_PATH = _RESOURCES_ROOT / "science" / "modules.json"
_PLUGINS_ROOT = _RESOURCES_ROOT / "agent" / "workspace" / "plugins"
_EXPECTED_MODULE_COUNT = 6

_REQUIRED_FIELDS = (
    "id",
    "title",
    "description",
    "icon",
    "agentGroup",
    "experts",
    "quickPrompt",
    "tags",
)
_REQUIRED_LOCALIZED_FIELDS = ("title", "description", "quickPrompt")


def _is_localized_text(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    return all(
        isinstance(value.get(lang), str) and bool(value[lang].strip())
        for lang in ("zh", "en")
    )


def _package_ids(kind: str) -> set[str]:
    root = _PLUGINS_ROOT / kind
    try:
        return {path.name for path in root.iterdir() if path.is_dir()}
    except OSError:
        logger.warning("science modules: cannot read built-in %s packages", kind)
        return set()


def _read_raw_modules() -> list[Any]:
    try:
        data = json.loads(_MODULES_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.warning(
            "science modules: catalog unreadable at %s", _MODULES_PATH, exc_info=True
        )
        return []
    modules = data.get("modules") if isinstance(data, dict) else None
    if not isinstance(modules, list):
        logger.warning("science modules: catalog has no modules list")
        return []
    return modules


def _validate_module(
    item: Any,
    *,
    agent_groups: set[str],
    agent_templates: set[str],
) -> str | None:
    """Return an error message when the module record is invalid."""
    if not isinstance(item, dict):
        return "module record is not an object"
    module_id = item.get("id")
    if not isinstance(module_id, str) or not module_id.strip():
        return "module id is missing"
    missing = [field for field in _REQUIRED_FIELDS if field not in item]
    if missing:
        return f"module {module_id} missing fields: {', '.join(missing)}"
    for field in _REQUIRED_LOCALIZED_FIELDS:
        if not _is_localized_text(item[field]):
            return f"module {module_id} has invalid {field}"
    if not isinstance(item["icon"], str) or not item["icon"].strip():
        return f"module {module_id} has invalid icon"
    agent_group = item["agentGroup"]
    if not isinstance(agent_group, str) or agent_group not in agent_groups:
        return f"module {module_id} references unknown agent group: {agent_group!r}"
    experts = item["experts"]
    if not isinstance(experts, list) or not experts:
        return f"module {module_id} has invalid experts"
    if not all(isinstance(expert, str) and expert.strip() for expert in experts):
        return f"module {module_id} has invalid expert id"
    unknown = [expert for expert in experts if expert not in agent_templates]
    if unknown:
        return f"module {module_id} references unknown experts: {', '.join(unknown)}"
    tags = item["tags"]
    if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
        return f"module {module_id} has invalid tags"
    return None


def _validated_modules() -> list[dict]:
    raw_modules = _read_raw_modules()
    if len(raw_modules) != _EXPECTED_MODULE_COUNT:
        logger.warning(
            "science modules: expected %d modules, catalog has %d",
            _EXPECTED_MODULE_COUNT,
            len(raw_modules),
        )
    agent_groups = _package_ids("agent_groups")
    agent_templates = _package_ids("agent_templates")
    modules: list[dict] = []
    seen: set[str] = set()
    for index, item in enumerate(raw_modules):
        error = _validate_module(
            item, agent_groups=agent_groups, agent_templates=agent_templates
        )
        if error is None:
            module_id = item["id"].strip()
            if module_id in seen:
                error = f"duplicate module id: {module_id}"
            else:
                seen.add(module_id)
                modules.append({**item, "id": module_id})
        if error is not None:
            logger.warning("science modules: skipping module #%d: %s", index, error)
    return modules


def _card_index(cards: list[dict] | None) -> dict[str, dict]:
    return {
        str(card["id"]): card
        for card in cards or []
        if isinstance(card, dict) and card.get("id")
    }


def list_science_modules(params: dict | None = None) -> list[dict]:
    """Return the six science homepage modules with their install state."""
    del params  # Reserved for future filters, keeps the RPC signature uniform.
    group_cards = _card_index(catalog.list_agent_groups(None))
    template_cards = _card_index(catalog.list_agent_templates(None))
    result: list[dict] = []
    for module in _validated_modules():
        experts = list(module["experts"])
        group_card = group_cards.get(module["agentGroup"]) or {}
        installed_experts = [
            expert_id
            for expert_id in experts
            if bool((template_cards.get(expert_id) or {}).get("installed"))
        ]
        result.append(
            {
                "id": module["id"],
                "title": module["title"],
                "description": module["description"],
                "icon": module["icon"],
                "agentGroup": module["agentGroup"],
                "experts": experts,
                "quickPrompt": module["quickPrompt"],
                "tags": list(module["tags"]),
                "installed": bool(group_card.get("installed"))
                and len(installed_experts) == len(experts),
                "installedExperts": installed_experts,
                "source": str(group_card.get("source") or "builtin"),
            }
        )
    return result


def enter_science_module(params: dict) -> dict:
    """Install a module's expert templates and team, then return its entry payload."""
    module_id = params.get("moduleId") if isinstance(params, dict) else None
    if not isinstance(module_id, str) or not module_id.strip():
        raise ValueError("moduleId is required")
    module_id = module_id.strip()
    module = next(
        (item for item in _validated_modules() if item["id"] == module_id), None
    )
    if module is None:
        raise ValueError(f"science module not found: {module_id}")

    agent_group = module["agentGroup"]
    experts = list(module["experts"])
    try:
        for expert_id in experts:
            catalog.install_agent_template({"id": expert_id})
        catalog.install_agent_group({"id": agent_group})
    except Exception as exc:
        raise RuntimeError(
            f"failed to install science module {module_id}: {exc}"
        ) from exc

    return {
        "moduleId": module_id,
        "agentGroupName": agent_group,
        "experts": experts,
        "quickPrompt": module["quickPrompt"],
        "installed": True,
    }
