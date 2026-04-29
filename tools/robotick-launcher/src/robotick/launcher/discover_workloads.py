# robotick/launcher/discover_workloads.py

import re
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple
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
    registration_index = _build_registration_index(config)
    resolved_type_cache: Dict[str, Optional[Dict[str, object]]] = {}
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

        try:
            referenced_leaves = _extend_structs_recursively(
                structs_filtered,
                registration_index=registration_index,
                resolved_type_cache=resolved_type_cache,
            )
            primitives_meta = _build_referenced_primitives_metadata(
                referenced_leaves, registration_index
            )
            schema_error: Optional[str] = None
        except ValueError as exc:
            primitives_meta = {}
            schema_error = str(exc)

        item = {
            "name": wl_name,
            "source": {
                "workload_root": srec["workload_root"],
                "path_from_root": srec["path_from_root"],
            },
            "structs": structs_filtered,
            "primitives": primitives_meta,
        }
        if schema_error:
            item["schema_error"] = schema_error
        out.append(item)

    return out
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
    if _SIMPLE_INT.match(init):
        return init
    if _SIMPLE_FLOAT.match(init):
        # Normalize C/C++ float literal suffixes in schema output.
        return re.sub(r"[fF]$", "", init)
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


_BUILTIN_LEAF_TYPES = {
    "bool",
    "char",
    "signed char",
    "unsigned char",
    "short",
    "short int",
    "unsigned short",
    "unsigned short int",
    "int",
    "unsigned",
    "unsigned int",
    "long",
    "unsigned long",
    "long long",
    "unsigned long long",
    "size_t",
    "float",
    "double",
    "long double",
    "std::string",
    "string",
}


def _canonical_type_name(cpp_type: str) -> str:
    t = cpp_type.strip()
    t = re.sub(r"\bconst\b", "", t)
    t = re.sub(r"\bvolatile\b", "", t)
    t = t.replace("&", " ").replace("*", " ")
    t = re.sub(r"\s+", " ", t).strip()
    if "::" in t:
        t = t.split("::")[-1].strip()
    return t


def _is_intrinsic_leaf_type(cpp_type: str) -> bool:
    t = _canonical_type_name(cpp_type).lower()
    if t in _BUILTIN_LEAF_TYPES:
        return True
    if re.match(r"^(u?int(8|16|32|64)_t)$", t):
        return True
    if re.match(r"^(float|double|bool|char)$", t):
        return True
    return False


def _build_registration_index(config) -> Dict[str, object]:
    roots = _resolve_registration_search_roots(config)
    files: List[Path] = []
    exts = {".h", ".hh", ".hpp", ".hxx", ".ipp", ".inl", ".c", ".cc", ".cpp", ".cxx"}
    for root in roots:
        if not root.exists() or not root.is_dir():
            continue
        for p in root.rglob("*"):
            if p.suffix.lower() in exts and p.is_file():
                files.append(p)

    structs: Dict[str, Dict[str, object]] = {}
    known_leaf_types: Dict[str, Dict[str, str]] = {}

    for path in files:
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        _index_struct_registrations(text, path, structs)
        _index_known_leaf_type_registrations(text, known_leaf_types)

    return {
        "structs": structs,
        "known_leaf_types": known_leaf_types,
    }


def _resolve_registration_search_roots(config) -> List[Path]:
    runtime_cfg = getattr(config, "runtime", {}) or {}
    resolver = getattr(config, "resolve_project_path", None)
    base_dir = Path(getattr(config, "base_dir", Path(".")))
    roots: List[Path] = []

    def resolve(raw: Optional[str]) -> Optional[Path]:
        if not raw:
            return None
        if callable(resolver):
            return Path(resolver(raw)).resolve()
        return (base_dir / raw).resolve()

    for entry in runtime_cfg.get("workload_sources") or []:
        base = resolve(entry.get("local_path") or entry.get("path_override"))
        if not base:
            continue
        root_paths = entry.get("root_paths") or []
        if root_paths:
            for rel in root_paths:
                roots.append((base / rel).resolve())
        else:
            roots.append(base)

    engine = runtime_cfg.get("engine") or {}
    engine_root = resolve(engine.get("local_path") or engine.get("path_override"))
    if engine_root:
        roots.append(engine_root)

    for shared in runtime_cfg.get("shared") or []:
        shared_root = resolve(shared.get("local_path") or shared.get("path_override"))
        if shared_root:
            roots.append(shared_root)

    seen: Set[Path] = set()
    out: List[Path] = []
    for p in roots:
        if p in seen:
            continue
        seen.add(p)
        out.append(p)
    return out


def _index_struct_registrations(text: str, source_path: Path, out_structs: Dict[str, Dict[str, object]]) -> None:
    block_pat = re.compile(
        r"ROBOTICK_REGISTER_STRUCT_BEGIN\s*\(\s*(?P<name>[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*)\s*\)(?P<body>.*?)ROBOTICK_REGISTER_STRUCT_END\s*\(\s*(?P=name)\s*\)",
        re.S,
    )
    field_pat = re.compile(
        r"ROBOTICK_STRUCT_FIELD\s*\(\s*[^,]+,\s*(?P<type>[^,]+),\s*(?P<field>[A-Za-z_]\w*)\s*\)"
    )
    fixed_array_pat = re.compile(
        r"ROBOTICK_STRUCT_FIXED_ARRAY_FIELD\s*\(\s*[^,]+,\s*(?P<type>[^,]+),\s*(?P<count>[^,]+),\s*(?P<field>[A-Za-z_]\w*)\s*\)"
    )

    for m in block_pat.finditer(text):
        raw_name = m.group("name").strip()
        if _is_macro_placeholder_name(raw_name):
            continue
        key = _canonical_type_name(raw_name)
        fields: List[Dict[str, str]] = []
        for fm in field_pat.finditer(m.group("body")):
            fields.append(
                {
                    "name": fm.group("field").strip(),
                    "type": " ".join(fm.group("type").strip().split()),
                }
            )
        for fa in fixed_array_pat.finditer(m.group("body")):
            fields.append(
                {
                    "name": fa.group("field").strip(),
                    "type": " ".join(fa.group("type").strip().split()),
                }
            )
        candidate = {"name": key, "fields": fields}
        existing = out_structs.get(key)
        if existing is None:
            out_structs[key] = candidate
            continue
        if existing.get("fields") != candidate.get("fields"):
            raise ValueError(
                f"Conflicting struct registrations for type '{key}' while indexing '{source_path}'."
            )


def _index_known_leaf_type_registrations(
    text: str, out_leaf_types: Dict[str, Dict[str, str]]
) -> None:
    for m in re.finditer(r"ROBOTICK_REGISTER_ENUM_BEGIN\s*\(\s*(?P<name>[^)]+)\)", text):
        key = _canonical_type_name(m.group("name").strip())
        if key and not _is_macro_placeholder_name(key):
            out_leaf_types[key] = {"category": "enum"}

    for m in re.finditer(
        r"ROBOTICK_REGISTER_DYNAMIC_STRUCT(?:_[24])?\s*\(\s*(?P<name>[^,\)]+)", text
    ):
        key = _canonical_type_name(m.group("name").strip())
        if key and not _is_macro_placeholder_name(key):
            out_leaf_types[key] = {"category": "dynamic_struct"}

    for m in re.finditer(
        r"ROBOTICK_REGISTER_FIXED_VECTOR\s*\(\s*(?P<name>[^,\)]+)", text
    ):
        key = _canonical_type_name(m.group("name").strip())
        if key and not _is_macro_placeholder_name(key):
            out_leaf_types[key] = {"category": "container"}

    for m in re.finditer(
        r"ROBOTICK_REGISTER_PRIMITIVE_WITH_MIME_TYPE\s*\(\s*(?P<name>[^,\)]+)\s*,\s*(?P<mime>[^)]+)\)",
        text,
    ):
        key = _canonical_type_name(m.group("name").strip())
        if key and not _is_macro_placeholder_name(key):
            out_leaf_types[key] = {
                "category": "primitive",
                "primitive_kind": _infer_primitive_kind(key),
                "mime_type": m.group("mime").strip().strip('"'),
            }

    for m in re.finditer(r"ROBOTICK_REGISTER_PRIMITIVE\s*\(\s*(?P<name>[^,\)]+)\)", text):
        key = _canonical_type_name(m.group("name").strip())
        if key and not _is_macro_placeholder_name(key):
            out_leaf_types[key] = {
                "category": "primitive",
                "primitive_kind": _infer_primitive_kind(key),
            }
    # PrimitiveTypes.cpp style helper macro expansion:
    # ROBOTICK_REGISTER_FIXED_STRING(256) -> FixedString256
    for m in re.finditer(r"\bROBOTICK_REGISTER_FIXED_STRING\s*\(\s*(\d+)\s*\)", text):
        key = f"FixedString{m.group(1)}"
        out_leaf_types[key] = {
            "category": "primitive",
            "primitive_kind": "string",
            "format": "fixed_string",
            "capacity": m.group(1),
            "mime_type": "text/plain",
        }


def _is_macro_placeholder_name(name: str) -> bool:
    cleaned = _canonical_type_name(name)
    placeholders = {
        "StructType",
        "EnumType",
        "TypeName",
        "WorkloadTypeName",
        "FieldType",
        "ElementType",
    }
    return cleaned in placeholders


def _extend_structs_recursively(
    structs_filtered: Dict[str, Dict],
    registration_index: Dict[str, object],
    resolved_type_cache: Dict[str, Optional[Dict[str, object]]],
) -> Set[str]:
    structs_index = registration_index.get("structs", {})
    known_leaf_types = registration_index.get("known_leaf_types", set())
    if not isinstance(structs_index, dict):
        return
    if not isinstance(known_leaf_types, dict):
        known_leaf_types = {}

    queue: List[Tuple[str, str]] = []
    for entry in structs_filtered.values():
        for field in entry.get("fields", []):
            queue.append((field.get("type", ""), entry.get("name", "<unknown>")))

    visited: Set[str] = set()
    referenced_leaf_types: Set[str] = set()
    while queue:
        raw_type, owner = queue.pop(0)
        key = _canonical_type_name(raw_type)
        if not key or key in visited:
            continue
        visited.add(key)

        if key in resolved_type_cache:
            resolved = resolved_type_cache[key]
        else:
            if key in structs_index:
                resolved = structs_index[key]
            elif key in known_leaf_types:
                resolved = None
                referenced_leaf_types.add(key)
            else:
                raise ValueError(
                    f"Missing registration for referenced type '{key}' (from '{owner}')."
                )
            resolved_type_cache[key] = resolved

        if not resolved:
            continue

        if key not in structs_filtered:
            structs_filtered[key] = {
                "name": resolved.get("name", key),
                "fields": list(resolved.get("fields", [])),
            }
        for child in resolved.get("fields", []):
            queue.append((child.get("type", ""), key))
    return referenced_leaf_types


def _infer_primitive_kind(type_name: str) -> str:
    t = _canonical_type_name(type_name).lower()
    if t in {"bool"}:
        return "boolean"
    if "string" in t or t.startswith("fixedstring"):
        return "string"
    if "float" in t or "double" in t:
        return "number"
    if "int" in t or "uint" in t or t in {"size_t", "long", "short"}:
        return "integer"
    return "unknown"


def _build_referenced_primitives_metadata(
    referenced_leaves: Set[str], registration_index: Dict[str, object]
) -> Dict[str, Dict[str, str]]:
    known_leaf_types = registration_index.get("known_leaf_types", {})
    if not isinstance(known_leaf_types, dict):
        return {}
    out: Dict[str, Dict[str, str]] = {}
    for leaf in sorted(referenced_leaves):
        meta = known_leaf_types.get(leaf)
        if meta is None:
            continue
        out[leaf] = dict(meta)
    return out
