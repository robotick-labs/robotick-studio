# robotick/launcher/discover_workloads.py

import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set
from .utils import render_template, write_text_if_changed


def discover_workload_sources_map(config) -> Dict[str, Dict[str, object]]:
    """
    Return a dict:
      {
        WorkloadType: {
          "abs": Path,               # absolute path to file
          "root_abs": Path,          # absolute path to matched workload source root
          "workload_root": str,      # the runtime.workload_sources entry (local_path) that matched
          "path_from_root": str,     # file path relative to that root (POSIX-style)
        },
        ...
      }
    """
    runtime_cfg = getattr(config, "runtime", {})
    roots: List[tuple[str, Path]] = []
    for entry in runtime_cfg.get("workload_sources") or []:
        base = entry.get("local_path") or entry.get("path_override")
        if not base:
            continue
        resolver = getattr(config, "resolve_project_path", None)
        if callable(resolver):
            base_path = resolver(base)
        else:
            base_path = (Path(getattr(config, "base_dir", Path("."))) / base).resolve()
        root_paths = entry.get("root_paths") or []
        if root_paths:
            for rel in root_paths:
                resolved = (base_path / rel).resolve()
                label = f"{entry.get('id') or base}:{rel}"
                roots.append((label, resolved))
        else:
            roots.append((entry.get("id") or base, base_path))
    if not roots:
        raise RuntimeError(
            "No runtime.workload_sources entries provided with a local_path/path_override."
        )
    seen: Dict[str, Dict[str, object]] = {}

    for root_str, root_path in roots:
        if not root_path.exists():
            continue

        for p in root_path.rglob("*Workload.cpp"):
            wl_name = p.stem
            if not wl_name.endswith("Workload"):
                continue
            if wl_name in seen:
                continue  # keep first-found

            abs_path = p.resolve()
            try:
                rel = abs_path.relative_to(root_path).as_posix()
            except ValueError:
                rel = abs_path.name

            seen[wl_name] = {
                "abs": abs_path,
                "root_abs": root_path,
                "workload_root": root_str,
                "path_from_root": rel,
            }

    return seen


def discover_workloads_metadata(config) -> List[Dict]:
    """
    Discover *Workload.cpp sources and parse known struct types.
    Returns: [ { name, source, structs: { config, inputs, outputs } } ]
    """
    sources = discover_workload_sources_map(config)
    out: List[Dict] = []

    for wl_name in sorted(sources.keys(), key=str.lower):
        srec = sources[wl_name]
        abs_path = srec["abs"]
        include_roots = [abs_path.parent]
        root_abs = srec.get("root_abs")
        if isinstance(root_abs, Path):
            include_roots.append(root_abs)
        parsed = _parse_workload_cpp(abs_path, wl_name, include_roots)

        structs_filtered: Dict[str, Dict] = {}
        for which in ("config", "inputs", "outputs"):
            entry = _pack_struct_dict(parsed[which])
            if entry["name"] and entry["fields"]:
                structs_filtered[which] = entry

        out.append(
            {
                "name": wl_name,
                "source": {
                    "workload_root": srec["workload_root"],
                    "path_from_root": srec["path_from_root"],
                },
                "structs": structs_filtered,
            }
        )

    return out


def discover_workloads_metadata_as_json(config) -> str:
    """
    JSON-serialized wrapper for discover_workloads_metadata().
    """
    return json.dumps(discover_workloads_metadata(config), indent=2)


def _parse_workload_cpp(
    file_path: Path, expected_workload: str, include_search_roots: Optional[Sequence[Path]] = None
) -> Dict:
    source = file_path.read_text(encoding="utf-8")

    wl_name = expected_workload
    if not _has_struct(source, wl_name):
        raise ValueError(f"Expected 'struct {wl_name}' not found in {file_path}.")

    stem = wl_name[: -len("Workload")] if wl_name.endswith("Workload") else wl_name
    cfg_name, ins_name, outs_name = f"{stem}Config", f"{stem}Inputs", f"{stem}Outputs"

    roots: List[Path] = []
    if include_search_roots:
        for root in include_search_roots:
            if root and root not in roots:
                roots.append(root)
    if file_path.parent not in roots:
        roots.append(file_path.parent)

    included_sources = _collect_quoted_include_sources(
        source=source,
        source_path=file_path,
        include_search_roots=roots,
    )
    candidate_sources = [source, *included_sources]

    def find_struct(name: str):
        for candidate in candidate_sources:
            if _has_struct(candidate, name):
                return {
                    "name": name,
                    "fields": _extract_struct_fields(candidate, name),
                }
        return {
            "name": None,
            "fields": [],
        }

    def pack(name: str):
        return find_struct(name)

    return {
        "workload_class": wl_name,
        "config": pack(cfg_name),
        "inputs": pack(ins_name),
        "outputs": pack(outs_name),
    }


def _has_struct(source: str, struct_name: str) -> bool:
    pat = rf"\bstruct\b(?:\s+[^\s{{]+)*\s+{re.escape(struct_name)}\b\s*\{{"
    return re.search(pat, source) is not None


_QUOTED_INCLUDE = re.compile(r'^\s*#\s*include\s*"([^"]+)"', re.MULTILINE)
_HEADER_EXTS = {".h", ".hh", ".hpp", ".hxx", ".ipp", ".inl"}


def _collect_quoted_include_sources(source: str, source_path: Path, include_search_roots: Sequence[Path]) -> List[str]:
    visited: Set[Path] = set()
    out: List[str] = []

    def walk(current_source: str, current_path: Path) -> None:
        for inc in _QUOTED_INCLUDE.findall(current_source):
            resolved = _resolve_quoted_include_path(current_path, inc, include_search_roots)
            if not resolved:
                continue
            if resolved in visited:
                continue
            visited.add(resolved)
            try:
                text = resolved.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            out.append(text)
            if resolved.suffix.lower() in _HEADER_EXTS:
                walk(text, resolved)

    walk(source, source_path)
    return out


def _resolve_quoted_include_path(source_path: Path, include_path: str, include_search_roots: Sequence[Path]) -> Optional[Path]:
    include_rel = Path(include_path)
    candidates: List[Path] = [source_path.parent / include_rel]
    for root in include_search_roots:
        candidates.append(root / include_rel)

    for candidate in candidates:
        if candidate.exists() and candidate.is_file():
            return candidate.resolve()

    return None


_SIMPLE_BOOL = re.compile(r"^(true|false)$", re.IGNORECASE)
_SIMPLE_INT = re.compile(r"^[+-]?\d+(?:[uU]?)$")
_SIMPLE_FLOAT = re.compile(
    r"^[+-]?(?:\d+\.\d*|\d*\.\d+|\d+)(?:[eE][+-]?\d+)?(?:[fF]?)$"
)
_SIMPLE_STRING = re.compile(r'^("([^"\\]|\\.)*"|\'([^\'\\]|\\.)*\')$')


def _extract_simple_initializer(init_text: str) -> Optional[str]:
    init = init_text.strip()
    if not init:
        return None
    if _SIMPLE_BOOL.match(init):
        return init.lower()
    if _SIMPLE_INT.match(init) or _SIMPLE_FLOAT.match(init):
        return init
    if _SIMPLE_STRING.match(init):
        return init[1:-1]
    return None


def _extract_struct_fields(source: str, struct_name: str) -> List[Dict[str, str]]:
    body = _get_struct_body(source, struct_name)
    if body is None:
        return []

    seen_names = set()
    fields: List[Dict[str, str]] = []

    for raw in body.splitlines():
        line = raw.strip()
        line = line.split("//", 1)[0].strip()  # Remove C++-style trailing comments
        if (
            not line
            or line.startswith("//")
            or line.endswith(":")
            or line.startswith("#")
        ):
            continue
        if "(" in line and ")" in line:
            continue

        m = re.match(
            r"""^
            (?P<type>
                [A-Za-z_]\w*
                (?:\s*::\s*[A-Za-z_]\w*)*
                (?:\s*<[^;{{}}()]*>)?
                (?:\s*[*&]+)?
            )
            \s+
            (?P<name>[A-Za-z_]\w*)
            (?:\s*=\s*(?P<init>[^;]+))?
            \s*;
            $""",
            line,
            re.X,
        )
        if m:
            t = " ".join(m.group("type").split())
            n = m.group("name")
            init_text = m.group("init")
            if n not in seen_names:
                seen_names.add(n)
                field = {"type": t, "name": n}
                if init_text:
                    default_val = _extract_simple_initializer(init_text)
                    if default_val is not None:
                        field["default_value"] = default_val
                fields.append(field)

    return fields


def _get_struct_body(source: str, struct_name: str) -> Optional[str]:
    start = re.search(rf"\bstruct\s+{re.escape(struct_name)}\b", source)
    if not start:
        return None
    i = source.find("{", start.end())
    if i == -1:
        return None

    depth = 0
    for j in range(i, len(source)):
        c = source[j]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return source[i + 1 : j]
    return None


def _pack_struct_dict(d: Dict) -> Dict:
    packed_fields = []
    for f in d.get("fields", []):
        entry = {"name": f["name"], "type": f["type"]}
        if "default_value" in f:
            entry["default_value"] = f["default_value"]
        packed_fields.append(entry)
    return {
        "name": d.get("name"),
        "fields": packed_fields,
    }
