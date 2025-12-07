# robotick/launcher/discover_workloads.py

import json
import re
from pathlib import Path
from typing import Dict, List, Optional
from .utils import render_template, write_text_if_changed


def discover_workload_sources_map(config) -> Dict[str, Dict[str, object]]:
    """
    Return a dict:
      {
        WorkloadType: {
          "abs": Path,               # absolute path to file
          "workload_root": str,      # the runtime.workloads entry (local_path) that matched
          "path_from_root": str,     # file path relative to that root (POSIX-style)
        },
        ...
      }
    """
    runtime_cfg = getattr(config, "runtime", {})
    roots = [
        entry.get("local_path")
        for entry in runtime_cfg.get("workloads") or []
        if entry.get("local_path")
    ]
    if not roots:
        roots = list(
            config.project.get("local_workload_roots")
            or config.project.get("workload_roots", [])
        )
    seen: Dict[str, Dict[str, object]] = {}

    for root in roots:
        root_str = str(root)
        root_path = (config.base_dir / root).resolve()
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
        parsed = _parse_workload_cpp(abs_path, wl_name)

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


def _parse_workload_cpp(file_path: Path, expected_workload: str) -> Dict:
    source = file_path.read_text(encoding="utf-8")

    wl_name = expected_workload
    if not _has_struct(source, wl_name):
        raise ValueError(f"Expected 'struct {wl_name}' not found in {file_path}.")

    stem = wl_name[: -len("Workload")] if wl_name.endswith("Workload") else wl_name
    cfg_name, ins_name, outs_name = f"{stem}Config", f"{stem}Inputs", f"{stem}Outputs"

    def pack(name: str):
        exists = _has_struct(source, name)
        return {
            "name": name if exists else None,
            "fields": _extract_struct_fields(source, name) if exists else [],
        }

    return {
        "workload_class": wl_name,
        "config": pack(cfg_name),
        "inputs": pack(ins_name),
        "outputs": pack(outs_name),
    }


def _has_struct(source: str, struct_name: str) -> bool:
    pat = rf"\bstruct\b(?:\s+[^\s{{]+)*\s+{re.escape(struct_name)}\b\s*\{{"
    return re.search(pat, source) is not None


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
