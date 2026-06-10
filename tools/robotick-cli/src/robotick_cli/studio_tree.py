from __future__ import annotations

from pathlib import Path

from robotick_cli.app.errors import CliError
from robotick_cli.hub_client import ensure_hub, fetch_hub_json, restart_hub
from robotick_cli.app.errors import HubRequestError


def fetch_studio_node_status(
    workspace_root: str | Path,
    instance_name: str,
    path_segments: tuple[str, ...] = (),
) -> dict[str, object]:
    record = ensure_hub(workspace_root)
    resource_path = "/".join(path_segments)
    path = (
        f"/v1/studio/instances/{instance_name}/status"
        if not resource_path
        else f"/v1/studio/instances/{instance_name}/{resource_path}/status"
    )
    try:
        payload = fetch_hub_json(record, path)
    except HubRequestError as error:
        if error.status_code == 404 and path_segments:
            raise CliError(
                f"Unknown Studio context: {path_segments[-1]}",
                code="unknown_studio_context",
            ) from error
        raise
    except Exception:
        refreshed = restart_hub(workspace_root)
        try:
            payload = fetch_hub_json(refreshed, path)
        except HubRequestError as error:
            if error.status_code == 404 and path_segments:
                raise CliError(
                    f"Unknown Studio context: {path_segments[-1]}",
                    code="unknown_studio_context",
                ) from error
            raise
    if not isinstance(payload, dict):
        raise CliError(f"Invalid Studio status payload for {instance_name}.")
    return payload


def list_child_contexts(node: dict[str, object]) -> list[str]:
    child_collections = node.get("child_collections")
    child_resources = node.get("child_resources")
    labels: list[str] = []
    if isinstance(child_collections, list):
        labels.extend(
            f"{collection.get('name')}/"
            for collection in child_collections
            if isinstance(collection, dict) and isinstance(collection.get("name"), str)
        )
    if isinstance(child_resources, list):
        labels.extend(
            f"{resource.get('id')}/"
            for resource in child_resources
            if isinstance(resource, dict) and isinstance(resource.get("id"), str)
        )
    return labels
