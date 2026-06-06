from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict, ValidationError
import yaml

from robotick_cli.app.errors import CliError


class ManifestProject(BaseModel):
    project_dir: str


class ManifestStudio(BaseModel):
    default_path: str
    default_mode: str


class Manifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: int
    studio: ManifestStudio
    projects: dict[str, ManifestProject]


def load_manifest(workspace_root: str | Path) -> Manifest:
    manifest_path = Path(workspace_root) / "robotick.yaml"
    if not manifest_path.exists():
        raise CliError(f"Workspace manifest not found: {manifest_path}")

    raw = manifest_path.read_text(encoding="utf-8")
    parsed = yaml.safe_load(raw) or {}
    try:
        return Manifest.model_validate(parsed)
    except ValidationError as error:
        raise CliError(f"Invalid manifest at {manifest_path}: {error}") from error
