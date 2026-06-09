from __future__ import annotations

from pathlib import Path

from robotick_cli.app.errors import CliError
from robotick_cli.hub_client import ensure_hub, fetch_hub_json, restart_hub


RESOURCE_CHILDREN = {
    "studio_instance": "windows",
    "studio_window": "workbenches",
    "studio_workbench": "layouts",
    "studio_layout": "panels",
}


def fetch_instance_status(
    workspace_root: str | Path,
    instance_name: str,
) -> dict[str, object]:
    record = ensure_hub(workspace_root)
    path = f"/v1/studio/instances/{instance_name}/status"
    try:
        payload = fetch_hub_json(record, path)
    except Exception:
        refreshed = restart_hub(workspace_root)
        payload = fetch_hub_json(refreshed, path)
    if not isinstance(payload, dict):
        raise CliError(f"Invalid Studio status payload for {instance_name}.")
    return payload


def child_collection_name(node: dict[str, object]) -> str | None:
    resource_type = node.get("resource_type")
    if not isinstance(resource_type, str):
        return None
    return RESOURCE_CHILDREN.get(resource_type)


def build_collection_node(
    parent: dict[str, object],
    collection_name: str,
    items: list[dict[str, object]],
) -> dict[str, object]:
    parent_id = parent.get("id")
    return {
        "resource_type": f"studio_{collection_name}",
        "id": collection_name,
        "parent_id": parent_id,
        "items": items,
    }


def resolve_studio_node(
    instance_status: dict[str, object],
    path_segments: tuple[str, ...],
) -> dict[str, object]:
    node = instance_status
    index = 0
    while index < len(path_segments):
        segment = path_segments[index]
        collection_name = child_collection_name(node)
        if collection_name is None or segment != collection_name:
            raise CliError(f"Unknown Studio context: {segment}")
        raw_items = node.get(collection_name)
        items = [
            item
            for item in (raw_items if isinstance(raw_items, list) else [])
            if isinstance(item, dict)
        ]
        if index == len(path_segments) - 1:
            return build_collection_node(node, collection_name, items)
        item_id = path_segments[index + 1]
        next_node = next((item for item in items if str(item.get("id")) == item_id), None)
        if next_node is None:
            raise CliError(f"Unknown Studio context: {item_id}")
        node = next_node
        index += 2
    return node


def list_child_contexts(node: dict[str, object]) -> list[str]:
    if node.get("resource_type") in {
        "studio_windows",
        "studio_workbenches",
        "studio_layouts",
        "studio_panels",
    }:
        items = node.get("items")
        if not isinstance(items, list):
            return []
        return [f"{item.get('id')}/" for item in items if isinstance(item, dict)]

    collection_name = child_collection_name(node)
    if collection_name is None:
        return []
    return [f"{collection_name}/"]
