# robotick/launcher/discover_deps.py

from pathlib import Path
from typing import List, Optional, Set, Tuple
import yaml

from robotick.launcher.discover_workloads import discover_workload_sources_map
from robotick.launcher.schema.workload_yaml_model import WorkloadSpec, Dependency


def parse_workload_yaml(path: Path) -> Optional[WorkloadSpec]:
    if not path.exists():
        return None
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        return WorkloadSpec.model_validate(raw)
    except Exception as e:
        print(f"[yellow]⚠️ Failed to parse workload YAML at {path}: {e}")
        return None


def _dep_identity(dep: Dependency) -> Tuple:
    src = dep.source
    repo = getattr(src, "repo", None)
    asset = getattr(src, "asset", None)
    identifier = (
        getattr(src, "package", None)
        or getattr(src, "module", None)
        or getattr(src, "url", None)
        or ((repo or "") + (f"#{asset}" if asset else ""))
        or getattr(src, "component", None)
        or getattr(src, "path", None)
    )
    return (
        dep.name,
        src.type,
        identifier,
        getattr(src, "pin", None),
        dep.find_package,
        tuple(dep.components or []),
        tuple(dep.include_dirs or []),
        tuple(dep.link_libraries or []),
        dep.link_target,
    )


def _dep_sort_key(dep: Dependency) -> Tuple:
    src = dep.source
    repo = getattr(src, "repo", None)
    asset = getattr(src, "asset", None)
    identifier = (
        getattr(src, "package", None)
        or getattr(src, "module", None)
        or getattr(src, "url", None)
        or ((repo or "") + (f"#{asset}" if asset else ""))
        or getattr(src, "component", None)
        or getattr(src, "path", None)
        or ""
    )
    return (
        dep.name or "",
        src.type,
        identifier,
        getattr(src, "pin", ""),
        dep.find_package or "",
        tuple(dep.components or []),
        dep.link_target or "",
    )


def collect_all_dependencies(
    config,
    platform: Optional[str] = None,
    allowed_types: Optional[Set[str]] = None,
) -> List[Dependency]:
    """
    Aggregate dependencies across discovered workloads for a given platform (e.g., 'linux', 'esp32').

    If `allowed_types` is provided, only workloads whose *type name* is in that set
    will be scanned (recommended: pass the set of workload types used by the model).
    """
    deps: List[Dependency] = []
    seen = set()
    target = platform or getattr(config, "target_platform", "linux")

    sources = discover_workload_sources_map(config)
    for wl_type_name in sorted(sources.keys(), key=str.lower):
        srec = sources[wl_type_name]
        # Filter to only model-used workload types if provided
        if allowed_types is not None and wl_type_name not in allowed_types:
            continue

        yaml_path = Path(srec["abs"]).with_suffix(".yaml")
        spec = parse_workload_yaml(yaml_path)
        if not spec:
            continue
        plat = spec.platforms.get(target)
        if not plat:
            continue

        deps_in_workload = sorted(plat.deps, key=_dep_sort_key)
        for dep in deps_in_workload:
            src = dep.source
            if src.type == "workload_cmake" and not getattr(src, "path", None):
                cmake_path = yaml_path.with_suffix(".cmake")
                dep.source = src.model_copy(update={"path": cmake_path.as_posix()})

            sig = _dep_identity(dep)
            if sig not in seen:
                seen.add(sig)
                deps.append(dep)

    return deps


def list_dependency_names(
    config,
    platform: Optional[str] = None,
    allowed_types: Optional[Set[str]] = None,
) -> List[str]:
    """Convenience: returns just the unique dep names for a given platform (optionally filtered by workload type)."""
    return [
        dep.name for dep in collect_all_dependencies(config, platform, allowed_types)
    ]
