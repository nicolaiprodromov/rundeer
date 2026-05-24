from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

_CONFIG_DIR = Path(__file__).resolve().parent / "config" / "nodes"

KNOWN_SOCKET_TYPES = {
    "text", "image", "video", "number", "boolean", "definition",
    "filepath", "vector", "vector-map", "color", "image-bundle",
    "video-bundle", "run", "any",
}

KIND_ALIASES = {"slider": "range"}

_RE_KIND_BRACKET = re.compile(r"^([a-z]+):\[(.+)\]$")
_RE_KIND_DEFAULT = re.compile(r"^([a-z]+):(.+)$")


def _slugify(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")


def _is_integer_looking(v: Any) -> bool:
    try:
        return float(v) == int(float(v))
    except (TypeError, ValueError):
        return False


def _expand_compact_io(io_val: Any, direction: str) -> List[Dict[str, str]]:
    if isinstance(io_val, list):
        return io_val
    if not isinstance(io_val, dict):
        return []
    result: List[Dict[str, str]] = []
    for label, val in io_val.items():
        val_str = str(val).strip()
        if val_str in KNOWN_SOCKET_TYPES:
            result.append({"id": _slugify(label), "label": str(label), "type": val_str})
    return result


def _expand_compact_props(io_val: Any) -> List[Dict[str, Any]]:
    if not isinstance(io_val, dict):
        return []
    props: List[Dict[str, Any]] = []
    for label, val in io_val.items():
        val_str = str(val).strip()
        if val_str in KNOWN_SOCKET_TYPES:
            continue

        prop: Dict[str, Any] = {"id": _slugify(label), "label": str(label)}

        m_bracket = _RE_KIND_BRACKET.match(val_str)
        if m_bracket:
            kind_raw = m_bracket.group(1)
            kind = KIND_ALIASES.get(kind_raw, kind_raw)
            prop["kind"] = kind
            inner = m_bracket.group(2)
            parts = [p.strip() for p in inner.split(",")]

            if kind == "select":
                prop["options"] = parts
                prop["default"] = parts[0] if parts else ""
            else:
                nums = []
                for p in parts:
                    try:
                        nums.append(float(p))
                    except ValueError:
                        nums.append(0)
                if len(nums) >= 2:
                    prop["min"] = nums[0]
                    prop["max"] = nums[1]
                if len(nums) >= 3:
                    prop["step"] = nums[2]
                elif len(nums) >= 2 and _is_integer_looking(nums[0]) and _is_integer_looking(nums[1]):
                    prop["step"] = 1
                else:
                    prop["step"] = 0.01
                prop["default"] = prop.get("min", 0)
            props.append(prop)
            continue

        m_default = _RE_KIND_DEFAULT.match(val_str)
        if m_default:
            kind_raw = m_default.group(1)
            kind = KIND_ALIASES.get(kind_raw, kind_raw)
            prop["kind"] = kind
            raw_default = m_default.group(2)
            try:
                prop["default"] = float(raw_default)
                if prop["default"] == int(prop["default"]):
                    prop["default"] = int(prop["default"])
            except ValueError:
                prop["default"] = raw_default
            props.append(prop)
            continue

        kind = KIND_ALIASES.get(val_str, val_str)
        prop["kind"] = kind
        prop["default"] = ""
        props.append(prop)

    return props


def _normalize_props(props: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for p in props:
        if not isinstance(p, dict):
            continue
        p = dict(p)
        cat = p.pop("category", None)
        if cat is not None:
            p["group"] = _slugify(str(cat))
        else:
            p.setdefault("group", None)
        out.append(p)
    return out


def _category_from_path(yaml_path: Path) -> str:
    return yaml_path.parent.name.replace("-", " ").replace("_", " ").title()


def _parse_one(yaml_path: Path, data: Dict[str, Any]) -> List[Dict[str, Any]]:
    results: List[Dict[str, Any]] = []
    for key, body in data.items():
        if not isinstance(body, dict):
            continue

        is_canonical = "label" in body
        if is_canonical:
            node_type = str(key)
            label = str(body["label"])
        else:
            label = str(key)
            node_type = _slugify(label)

        in_raw = body.get("in", [])
        out_raw = body.get("out", [])

        if is_canonical or isinstance(in_raw, list):
            inputs = in_raw if isinstance(in_raw, list) else []
            props = body.get("props", [])
        else:
            inputs = _expand_compact_io(in_raw, "inputs")
            props = _expand_compact_props(in_raw)

        if isinstance(out_raw, list):
            outputs = out_raw
        else:
            outputs = _expand_compact_io(out_raw, "outputs")

        props_list = _normalize_props(props if isinstance(props, list) else [])

        node_def: Dict[str, Any] = {
            "type": node_type,
            "label": label,
            "category": str(body.get("category", _category_from_path(yaml_path))),
            "desc": str(body.get("desc", "")),
            "inputs": inputs,
            "outputs": outputs,
            "props": props_list,
        }

        if "src" in body:
            node_def["src"] = str(body["src"])
        if "api" in body:
            node_def["api"] = str(body["api"])
        if "defaultWidth" in body:
            node_def["defaultWidth"] = body["defaultWidth"]
        if "defaultHeight" in body:
            node_def["defaultHeight"] = body["defaultHeight"]
        if "allInline" in body:
            node_def["allInline"] = body["allInline"]
        if "resizable" in body:
            node_def["resizable"] = body["resizable"]

        results.append(node_def)
    return results


def load_node_defs(config_dir: Optional[Path] = None) -> List[Dict[str, Any]]:
    root = config_dir or _CONFIG_DIR
    if not root.is_dir():
        return []
    defs: List[Dict[str, Any]] = []
    for yaml_path in sorted(root.rglob("*.yaml")):
        try:
            raw = yaml_path.read_text(encoding="utf-8")
            data = yaml.safe_load(raw)
            if not isinstance(data, dict):
                continue
            defs.extend(_parse_one(yaml_path, data))
        except Exception:
            continue
    return defs


_CACHED_DEFS: Optional[List[Dict[str, Any]]] = None


def get_node_defs(config_dir: Optional[Path] = None) -> List[Dict[str, Any]]:
    global _CACHED_DEFS
    if _CACHED_DEFS is None:
        _CACHED_DEFS = load_node_defs(config_dir)
    return _CACHED_DEFS


def node_defs_socket_map() -> Dict[str, Dict[str, Dict[str, str]]]:
    result: Dict[str, Dict[str, Dict[str, str]]] = {}
    for d in get_node_defs():
        ins = {s["id"]: s["type"] for s in d.get("inputs", []) if isinstance(s, dict)}
        for p in d.get("props", []):
            if isinstance(p, dict) and "socketType" in p:
                ins[p["id"]] = p["socketType"]
        outs = {s["id"]: s["type"] for s in d.get("outputs", []) if isinstance(s, dict)}
        result[d["type"]] = {"inputs": ins, "outputs": outs}
    return result