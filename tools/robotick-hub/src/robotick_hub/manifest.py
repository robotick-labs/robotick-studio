from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, ConfigDict
import yaml


class ManifestProject(BaseModel):
    project_dir: str
    launch_script: str


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
    parsed = yaml.safe_load(manifest_path.read_text(encoding="utf-8")) or {}
    return Manifest.model_validate(parsed)
