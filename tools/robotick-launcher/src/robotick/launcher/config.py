from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

from rich import print
import typer
import yaml
from robotick.launcher.runtime_lock import apply_runtime_lock


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
        self.project_dir = self.project_file.parent
        self.project_name_safe = project.replace("-", "_")

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

        tooling_section = project_dict.get("tooling") or {}
        if not isinstance(tooling_section, dict) or not tooling_section:
            raise ValueError("Project file must define a 'tooling' section with tooling_sources.")
        self.tooling = DotDict(dict(tooling_section))
        self._validate_tooling_schema(self.tooling)
        if not self.tooling.get("bootstrap"):
            default_bootstrap = f"./{self.project_name}.setup.sh"
            self.tooling["bootstrap"] = default_bootstrap
        self.project["tooling"] = self.tooling
        runtime_section = project_dict.get("runtime") or {}
        if not isinstance(runtime_section, dict) or not runtime_section:
            raise ValueError("Project file must define a 'runtime' section.")
        self.runtime = DotDict(dict(runtime_section))
        self._validate_runtime_schema(self.runtime)
        self.project["runtime"] = self.runtime
        self._apply_runtime_repo_overrides()

    def _validate_tooling_schema(self, tooling: DotDict) -> None:
        if not tooling:
            return

        sources = tooling.get("tooling_sources") or []
        if not isinstance(sources, list):
            raise ValueError("'tooling.tooling_sources' must be a list when provided.")
        normalized_sources: List[Dict[str, Any]] = []
        for idx, entry in enumerate(sources):
            normalized_sources.append(
                self._validate_repo_entry(entry, f"tooling.tooling_sources[{idx}]")
            )
        tooling["tooling_sources"] = normalized_sources

    def _validate_runtime_schema(self, runtime: DotDict) -> None:
        if runtime is None:
            runtime = DotDict({})

        engine = runtime.get("engine")
        if engine is not None:
            runtime["engine"] = self._validate_repo_entry(engine, "runtime.engine")

        workload_sources = runtime.get("workload_sources") or []
        if workload_sources and not isinstance(workload_sources, list):
            raise ValueError("'runtime.workload_sources' must be a list when provided.")
        normalized_workloads: List[Dict[str, Any]] = []
        for idx, entry in enumerate(workload_sources or []):
            normalized_entry = self._validate_repo_entry(
                entry, f"runtime.workload_sources[{idx}]"
            )
            root_paths = normalized_entry.get("root_paths")
            if root_paths is not None:
                if not isinstance(root_paths, list) or any(
                    not isinstance(rp, str) or not rp for rp in root_paths
                ):
                    raise ValueError(
                        f"'runtime.workload_sources[{idx}].root_paths' must be a list of non-empty strings when provided."
                    )
            normalized_workloads.append(normalized_entry)
        runtime["workload_sources"] = normalized_workloads

        shared_entries = runtime.get("shared") or []
        if shared_entries and not isinstance(shared_entries, list):
            raise ValueError("'runtime.shared' must be a list when provided.")
        normalized_shared: List[Dict[str, Any]] = []
        for idx, entry in enumerate(shared_entries or []):
            normalized_shared.append(
                self._validate_repo_entry(entry, f"runtime.shared[{idx}]")
            )
        runtime["shared"] = normalized_shared

        python_entries = runtime.get("python_roots") or []
        if python_entries and not isinstance(python_entries, list):
            raise ValueError("'runtime.python_roots' must be a list when provided.")
        normalized_python: List[Dict[str, Any]] = []
        seen_ids: set[str] = set()
        for idx, entry in enumerate(python_entries or []):
            if not isinstance(entry, dict):
                raise ValueError(
                    f"'runtime.python_roots[{idx}]' must be a mapping with id/local_path."
                )
            root_id = entry.get("id")
            if not root_id or not isinstance(root_id, str):
                raise ValueError(
                    f"'runtime.python_roots[{idx}]' must include a string 'id'."
                )
            if root_id in seen_ids:
                raise ValueError(f"Duplicate python_roots id detected: {root_id}")
            local_path = entry.get("local_path") or entry.get("path")
            if not local_path or not isinstance(local_path, str):
                raise ValueError(
                    f"'runtime.python_roots[{idx}]' must include a string 'local_path'."
                )
            requirements_value = entry.get("requirements")
            if requirements_value is not None and not isinstance(
                requirements_value, str
            ):
                raise ValueError(
                    f"'runtime.python_roots[{idx}].requirements' must be a string path when provided."
                )
            normalized_python.append(
                {
                    "id": root_id,
                    "local_path": local_path,
                    "requirements": requirements_value,
                }
            )
            seen_ids.add(root_id)
        runtime["python_roots"] = normalized_python

    def _apply_runtime_repo_overrides(self) -> None:
        apply_runtime_lock(
            self.runtime,
            self.project_dir,
            self.project_name_safe,
            self.target,
        )

    def _validate_repo_entry(self, entry: Any, label: str) -> Dict[str, Any]:
        if isinstance(entry, str):
            entry = {"local_path": entry}
        if not isinstance(entry, dict):
            raise ValueError(f"'{label}' must be a mapping.")
        normalized = dict(entry)
        entry_id = normalized.get("id")
        if entry_id is not None and not isinstance(entry_id, str):
            raise ValueError(f"'{label}.id' must be a string if provided.")
        local_path = normalized.get("local_path")
        if local_path is not None and not isinstance(local_path, str):
            raise ValueError(f"'{label}.local_path' must be a string path if provided.")
        repo = normalized.get("repo")
        ref = normalized.get("ref")
        if local_path:
            if repo or ref:
                raise ValueError(
                    f"'{label}' cannot define both 'local_path' and 'repo/ref'."
                )
            normalized["local_path"] = local_path
        else:
            if not repo or not isinstance(repo, str):
                raise ValueError(f"'{label}.repo' must be a non-empty string.")
            if not ref or not isinstance(ref, str):
                raise ValueError(f"'{label}.ref' must be a non-empty string.")
            normalized["repo"] = repo
            normalized["ref"] = ref
        return normalized

    def resolve_project_path(self, raw: str) -> Path:
        if raw is None:
            raise ValueError("Path value cannot be None")
        value = str(raw)
        substitutions = {
            "${PROJECT_DIR}": str(self.project_dir),
        }
        for token, replacement in substitutions.items():
            value = value.replace(token, replacement)
        path = Path(value)
        if not path.is_absolute():
            path = (self.base_dir / path).resolve()
        else:
            path = path.resolve()
        return path

    def _parse_python_roots(self) -> List[PythonRootConfig]:
        """Normalize python_roots entries from the project yaml."""

        entries = (self.runtime.get("python_roots") or []) or []
        python_roots: List[PythonRootConfig] = []
        seen_ids: set[str] = set()

        for idx, entry in enumerate(entries):
            if not isinstance(entry, dict):
                raise ValueError(
                    f"python_roots[{idx}] must be a mapping with id/path fields"
                )

            root_id = entry.get("id")
            relative = entry.get("local_path") or entry.get("path")

            if not root_id or not isinstance(root_id, str):
                raise ValueError("Each python_roots entry must provide a string 'id'.")
            if root_id in seen_ids:
                raise ValueError(f"Duplicate python_roots id detected: {root_id}")
            if not relative or not isinstance(relative, str):
                raise ValueError(
                    f"python_roots[{root_id}] must provide a string path relative to the project root."
                )

            requirements_value = entry.get("requirements")
            if requirements_value is not None and not isinstance(
                requirements_value, str
            ):
                raise ValueError(
                    f"python_roots[{root_id}] 'requirements' must be a relative path string if provided."
                )

            relative_path = Path(relative)
            absolute_path = self.resolve_project_path(relative)

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
