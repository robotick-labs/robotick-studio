from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from rich import print
import typer
import yaml


class DotDict(dict):
    """A dictionary that supports dot-access like an object."""

    def __getattr__(self, name):
        value = self.get(name)
        if isinstance(value, dict):
            return DotDict(value)
        if isinstance(value, list):
            return [DotDict(v) if isinstance(v, dict) else v for v in value]
        return value

    def __setattr__(self, name, value):
        self[name] = value

    def __delattr__(self, name):
        if name in self:
            del self[name]


@dataclass(frozen=True)
class PythonRootConfig:
    """Represents a declared python_roots entry from <robot>.project.yaml."""

    id: str
    relative_path: Path
    absolute_path: Path
    requirements_file: Optional[Path]
    requirements_absolute: Optional[Path]


class Config:
    """Shared launcher configuration parsed from project/model YAML files."""

    def __init__(
        self,
        project: str,
        model: Optional[str],
        target: Optional[str],
        base_dir: Path,
        dry_run: bool,
        stub_install: bool,
        *,
        launcher_path_getter: Optional[
            Callable[[str, str, str, Path], Tuple[Path, Path, Path]]
        ] = None,
    ):
        from robotick.launcher.utils import get_launcher_paths

        self.project_name = project
        self.model_name = model
        self.model_name_safe = (model or "").replace("-", "_")
        self.target = target
        self.base_dir = base_dir
        self.dry_run = dry_run
        self.stub_install = stub_install
        self.project_file = base_dir / f"{project}.project.yaml"

        # Load YAMLs
        self.project = self._load_yaml(self.project_file)
        self.tooling = DotDict({})
        self.runtime = DotDict({})
        self._normalize_project_schema()
        self.model = DotDict({})
        if model:
            self.model = self._load_yaml(self._find_model_yaml(base_dir, model))

        # Derived helpers
        self.python_roots: List[PythonRootConfig] = self._parse_python_roots()

        launcher_getter = launcher_path_getter or get_launcher_paths
        if model and target:
            self.launcher_dir, _, _ = launcher_getter(project, model, target, base_dir)
        else:
            self.launcher_dir = None

    def _find_model_yaml(self, base_dir: Path, model: str) -> Path:
        model_file_name = f"{model}.model.yaml"
        matches = list(base_dir.rglob(model_file_name))
        if not matches:
            raise FileNotFoundError(
                f"Could not find model file '{model_file_name}' under {base_dir}"
            )
        if len(matches) > 1:
            raise RuntimeError(
                f"Multiple '{model_file_name}' model files found: {matches}"
            )
        return matches[0]

    def _load_yaml(self, path: Path) -> DotDict:
        if not path.exists():
            print(f"[red]❌ Missing YAML file:[/] {path}")
            raise typer.Exit(1)

        try:
            content = yaml.safe_load(path.read_text()) or {}
            return DotDict(content)
        except Exception as exc:  # pragma: no cover - defensive
            print(f"[red]❌ Failed to parse YAML file:[/] {path}")
            print(f"[red]Reason:[/] {exc}")
            raise typer.Exit(1)

    def _normalize_project_schema(self) -> None:
        """Backfill schema defaults and validate `tooling` + `runtime` sections."""

        project_dict: Dict[str, Any] = dict(self.project)

        tooling_dict = project_dict.get("tooling") or {}
        self.tooling = DotDict(tooling_dict)
        self._validate_tooling_schema(self.tooling)
        self.project["tooling"] = self.tooling

        runtime_dict = project_dict.get("runtime") or {}
        self.runtime = DotDict(runtime_dict)
        self._validate_runtime_schema(self.runtime)
        self.project["runtime"] = self.runtime

        # Keep legacy keys aligned so existing callers keep working.
        if self.runtime.get("local_python_roots") and not self.project.get(
            "local_python_roots"
        ):
            self.project["local_python_roots"] = self.runtime.local_python_roots
        elif self.project.get("local_python_roots") and not self.runtime.get(
            "local_python_roots"
        ):
            self.runtime["local_python_roots"] = self.project.local_python_roots

        if self.runtime.get("local_workload_roots") and not self.project.get(
            "local_workload_roots"
        ):
            self.project["local_workload_roots"] = self.runtime.local_workload_roots
        elif self.project.get("local_workload_roots") and not self.runtime.get(
            "local_workload_roots"
        ):
            self.runtime["local_workload_roots"] = self.project.local_workload_roots

    def _validate_tooling_schema(self, tooling: DotDict) -> None:
        if not tooling:
            return

        robotick = tooling.get("robotick")
        if not isinstance(robotick, dict):
            raise ValueError("'tooling.robotick' must be a mapping with repo/ref fields.")
        repo = robotick.get("repo")
        ref = robotick.get("ref")
        if not repo or not isinstance(repo, str):
            raise ValueError("'tooling.robotick.repo' must be a non-empty string.")
        if not ref or not isinstance(ref, str):
            raise ValueError("'tooling.robotick.ref' must be a non-empty string.")

        bootstrap = tooling.get("bootstrap")
        if bootstrap is not None and not isinstance(bootstrap, str):
            raise ValueError("'tooling.bootstrap' must be a string path if provided.")

    def _validate_runtime_schema(self, runtime: DotDict) -> None:
        if not runtime:
            return

        engine = runtime.get("engine")
        if engine is not None:
            self._validate_repo_entry(engine, "runtime.engine")

        for field in ("workload_repos", "shared_repos"):
            entries = runtime.get(field) or []
            if not isinstance(entries, list):
                raise ValueError(f"'{field}' must be a list when provided.")
            for idx, entry in enumerate(entries):
                self._validate_repo_entry(entry, f"{field}[{idx}]")
            runtime[field] = entries

        for list_field in ("local_workload_roots",):
            entries = runtime.get(list_field)
            if entries is None:
                continue
            if not isinstance(entries, list) or any(
                not isinstance(item, str) for item in entries
            ):
                raise ValueError(f"'{list_field}' must be a list of strings.")

        python_entries = runtime.get("local_python_roots")
        if python_entries is not None and not isinstance(python_entries, list):
            raise ValueError("'local_python_roots' must be a list when provided.")

    def _validate_repo_entry(self, entry: Any, label: str) -> None:
        if not isinstance(entry, dict):
            raise ValueError(f"'{label}' must be a mapping.")
        repo = entry.get("repo")
        ref = entry.get("ref")
        if not repo or not isinstance(repo, str):
            raise ValueError(f"'{label}.repo' must be a non-empty string.")
        if not ref or not isinstance(ref, str):
            raise ValueError(f"'{label}.ref' must be a non-empty string.")

    def _parse_python_roots(self) -> List[PythonRootConfig]:
        """Normalize python_roots entries from the project yaml."""

        project_dir = self.project_file.parent
        entries = self.project.get("local_python_roots")
        if not entries:
            entries = self.project.get("python_roots", [])
        entries = entries or []
        python_roots: List[PythonRootConfig] = []
        seen_ids: set[str] = set()

        for idx, entry in enumerate(entries):
            if not isinstance(entry, dict):
                raise ValueError(
                    f"python_roots[{idx}] must be a mapping with id/path fields"
                )

            root_id = entry.get("id")
            relative = entry.get("path")

            if not root_id or not isinstance(root_id, str):
                raise ValueError("Each python_roots entry must provide a string 'id'.")
            if root_id in seen_ids:
                raise ValueError(f"Duplicate python_roots id detected: {root_id}")
            if not relative or not isinstance(relative, str):
                raise ValueError(
                    f"python_roots[{root_id}] must provide a string 'path' relative to the project root."
                )

            requirements_value = entry.get("requirements")
            if requirements_value is not None and not isinstance(
                requirements_value, str
            ):
                raise ValueError(
                    f"python_roots[{root_id}] 'requirements' must be a relative path string if provided."
                )

            relative_path = Path(relative)
            absolute_path = (project_dir / relative_path).resolve()

            requirements_rel = Path(requirements_value) if requirements_value else None
            requirements_abs = (
                (absolute_path / requirements_rel).resolve()
                if requirements_rel is not None
                else None
            )

            python_roots.append(
                PythonRootConfig(
                    id=root_id,
                    relative_path=relative_path,
                    absolute_path=absolute_path,
                    requirements_file=requirements_rel,
                    requirements_absolute=requirements_abs,
                )
            )
            seen_ids.add(root_id)

        return python_roots
