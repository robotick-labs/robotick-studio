# robotick/launcher/generate_workloads_registry.py

import os
import re
from collections import OrderedDict
from pathlib import Path
from typing import Dict, List, Optional
from rich import print

from robotick.launcher.utils import render_template, write_text_if_changed
from robotick.launcher.discover_workloads import (
    discover_workloads_metadata,
    discover_workload_sources_map,
)
from robotick.launcher.discover_deps import collect_all_dependencies


_version_tokenizer = re.compile(r"(\d+)")


def _version_tuple(version: str) -> tuple:
    if not version:
        return ()
    parts = [int(token) for token in _version_tokenizer.findall(version)]
    return tuple(parts)


def _is_version_newer(candidate: str, current: str) -> bool:
    cand_tuple = _version_tuple(candidate)
    curr_tuple = _version_tuple(current)
    if cand_tuple != curr_tuple:
        return cand_tuple > curr_tuple
    # Prefer a non-empty version over empty when tuples equal
    if candidate and not current:
        return True
    return False


def generate_workloads_registry(config):
    """
    Generates:
      - registry/generated_workload_registry.cpp   (via template_registry.cpp)
      - registry/workloads/{Type}.gen.cpp          (via template_workload_auto.cpp)
      - registry/generated_workload_deps.cmake     (via template_workload_deps.cmake)
    """
    subdir = getattr(config, "subdir_registry", None)
    registry_path = (
        config.launcher_dir / subdir / "registry"
        if subdir
        else config.launcher_dir / "registry"
    )
    registry_cpp_path = registry_path / "generated_workload_registry.cpp"

    discovered_list = discover_workloads_metadata(config)
    discovered_map: Dict[str, Dict] = {d["name"]: d for d in discovered_list}
    sources_map = discover_workload_sources_map(config)

    seen = set()
    workloads = []
    for w in sorted(config.model.get("workloads", []), key=lambda w: w["type"].lower()):
        if w["type"] in seen:
            continue
        seen.add(w["type"])
        w["var_name"] = w["name"].replace("-", "_")
        w["filename"] = f'{w["type"]}.gen.cpp'
        workloads.append(w)

    # Limit all subsequent outputs to only the workload TYPES used by the model
    used_types = set(seen)

    # Generate .gen.cpp files
    for w in workloads:
        type_name = w["type"]
        src_info = sources_map.get(type_name)
        if not src_info:
            print(f"[yellow]⚠️  Skipping workload: {type_name} (source not found).")
            continue

        include_rel = src_info["path_from_root"]
        discovered = discovered_map.get(type_name)
        _generate_workload_auto_cpp(config, w, include_rel, discovered)

    # Write the registry .cpp
    context = {
        "workloads": workloads,
        # Only include platform extras for used workload types
        "platform_extra_cpp": [f for f in _collect_platform_files(config, used_types)],
    }

    try:
        contents = render_template("template_registry.cpp", context)
        registry_cpp_path.parent.mkdir(parents=True, exist_ok=True)
        if not write_text_if_changed(registry_cpp_path, contents):
            raise RuntimeError(f"Failed to write {registry_cpp_path}")
    except Exception as e:
        print(
            f"[bold red]❌ Failed to generate registry:[/] {registry_cpp_path}\n[red]Reason:[/] {e}"
        )
        raise

    # Emit CMake fragment (deps only for used workload types)
    if config.should_generate_workload_deps:
        _generate_workload_deps_cmake(config, registry_path, used_types)


def _collect_platform_files(config, allowed_types: Optional[set] = None) -> List[str]:
    from robotick.launcher.discover_deps import parse_workload_yaml

    cpp_files = OrderedDict()
    sources = discover_workload_sources_map(config)
    target = getattr(config, "target", "linux")

    # Only gather platform files for allowed (used) workload types
    for type_name, srec in sources.items():
        if allowed_types is not None and type_name not in allowed_types:
            continue
        ypath = Path(srec["abs"]).with_suffix(".yaml")
        spec = parse_workload_yaml(ypath)
        if spec and target in spec.platforms:
            for rel in spec.platforms[target].files:
                cpp_files[rel] = True
    return sorted(cpp_files.keys())


def _generate_workload_deps_cmake(
    config, registry_path: Path, allowed_types: Optional[set] = None
):
    deps = collect_all_dependencies(config, allowed_types=allowed_types)

    agg_pkgs = OrderedDict()
    agg_targets = OrderedDict()
    agg_idf = OrderedDict()
    agg_apt = OrderedDict()
    agg_pkgcfg = OrderedDict()
    agg_workload_cmake = OrderedDict()
    agg_includes = OrderedDict()
    git_subdirs = []
    cmake_options_map = OrderedDict()

    for d in deps:
        src = d.source
        if src.type == "apt" and src.package:
            agg_apt[src.package] = True
        elif src.type == "idf" and (src.package or src.component):
            agg_idf[src.package or src.component] = True
        elif src.type == "pkgconfig" and src.module:
            prefix = d.pkg_prefix or src.module.upper()
            agg_pkgcfg[prefix] = src.module
        elif src.type == "workload_cmake":
            cmake_path = getattr(src, "path", None)
            if cmake_path:
                rel_path = _cmake_relpath(Path(cmake_path), registry_path)
                agg_workload_cmake[rel_path] = True

        if d.find_package:
            comps = tuple(d.components or [])
            key = (d.find_package, comps)
            version = src.pin or ""
            existing = agg_pkgs.get(key)
            if existing is None or _is_version_newer(version, existing):
                agg_pkgs[key] = version
        if d.link_target:
            agg_targets[d.link_target] = True
        for inc in d.include_dirs or []:
            agg_includes[inc] = True
        for lib in d.link_libraries or []:
            agg_targets[lib] = True

        if getattr(src, "type", None) == "git":
            # default clone dest = deps/<name> if not provided by your fetch layer
            default_dest = f"deps/{d.name}"
            dest = getattr(src, "dest", None) or default_dest
            sub = d.cmake_subdir or "."  # top-level by default
            git_subdirs.append((d.name, f"${{CMAKE_CURRENT_SOURCE_DIR}}/{dest}/{sub}"))
            if d.cmake_options:
                cmake_options_map[d.name] = d.cmake_options

    cmake = emit_cmake_fragment(
        find_required=[(name, version, comps) for (name, comps), version in agg_pkgs.items()],
        link_targets=list(agg_targets.keys()),
        idf_components=list(agg_idf.keys()),
        host_apt=list(agg_apt.keys()),
        pkg_config=dict(agg_pkgcfg),
        workload_cmakes=list(agg_workload_cmake.keys()),
        include_dirs=list(agg_includes.keys()),
        git_subdirs=git_subdirs,
        cmake_options=cmake_options_map,
    )
    deps_path = registry_path / "generated_workload_deps.cmake"
    if not write_text_if_changed(deps_path, cmake):
        raise RuntimeError(f"Failed to write {deps_path}")


def emit_cmake_fragment(
    find_required: list,
    link_targets: list,
    idf_components: list,
    host_apt: list,
    pkg_config: dict,
    workload_cmakes: list,
    include_dirs: list,
    git_subdirs: list = None,
    cmake_options: dict = None,
) -> str:

    git_subdirs = git_subdirs or []
    cmake_options = cmake_options or {}

    def sanitize_version(v: str) -> str:
        return v.lstrip("><=~! ").strip()

    find_required_with_sanitized = []
    for item in find_required:
        # Back-compat: items may be (name, version) or (name, version, components)
        if len(item) == 2:
            name, version = item
            components = ()
        else:
            name, version, components = item
        find_required_with_sanitized.append(
            {
                "name": name,
                "version": version,
                "version_sanitized": sanitize_version(version) if version else "",
                "components": list(components),
            }
        )

    context = {
        "find_required": find_required_with_sanitized,
        "link_targets": link_targets,
        "idf_components": idf_components,
        "host_apt": host_apt,
        "pkg_config": pkg_config,
        "workload_cmakes": workload_cmakes,
        "include_dirs": include_dirs,
        "git_subdirs": git_subdirs,
        "cmake_options": cmake_options,
    }
    return render_template("template_workload_deps.cmake", context)


def _cmake_relpath(target: Path, start_dir: Path) -> str:
    """Return POSIX-style path relative to start_dir, or absolute fallback."""
    try:
        rel = os.path.relpath(target.resolve(), start_dir.resolve())
        return Path(rel).as_posix()
    except ValueError:
        return target.resolve().as_posix()


def _generate_workload_auto_cpp(
    config, workload: dict, include_rel: str, discovered: Optional[Dict]
):
    type_name = workload["type"]

    subdir = getattr(config, "subdir_registry", None)
    registry_path = (
        config.launcher_dir / subdir / "registry"
        if subdir
        else config.launcher_dir / "registry"
    )
    out_path = registry_path / "workloads" / f"{type_name}.gen.cpp"

    if not discovered:
        runtime_roots = [
            entry.get("local_path") or entry.get("path_override")
            for entry in getattr(config.runtime, "workload_sources", []) or []
            if entry.get("local_path") or entry.get("path_override")
        ]
        if not runtime_roots:
            runtime_roots = config.project.get("local_workload_roots") or config.project.get(
                "workload_roots", []
            )
        raise FileNotFoundError(
            f"Could not generate auto file for {type_name}: not found in discovered map. "
            f"Looked under workload roots: {runtime_roots}"
        )

    s = discovered["structs"]
    context = {
        "type": type_name,
        "workload_include": include_rel,
        "config_struct": s.get("config", {}).get("name") or "void",
        "config_fields": s.get("config", {}).get("fields", []),
        "inputs_struct": s.get("inputs", {}).get("name") or "void",
        "inputs_fields": s.get("inputs", {}).get("fields", []),
        "outputs_struct": s.get("outputs", {}).get("name") or "void",
        "outputs_fields": s.get("outputs", {}).get("fields", []),
    }

    if config.dry_run:
        print(f"[yellow]📝 Dry run — would create workload auto file:[/] {out_path}")
        return

    try:
        contents = render_template("template_workload_auto.cpp", context)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        if not write_text_if_changed(out_path, contents):
            raise RuntimeError(f"Failed to write {out_path}")
    except Exception as e:
        print(f"[bold red]❌ Failed to write workload auto file:[/] {out_path}")
        print(f"[red]Reason:[/] {e}")
