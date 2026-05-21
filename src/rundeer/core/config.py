
from __future__ import annotations

import importlib.util
import json
import os
import re
import shlex
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional


BRAIN_DIRNAME = "brain"
RATE_LIMIT_KEYS = ("per_second", "per_minute", "per_hour", "per_day")
RATE_LIMIT_ALIASES = {
    "per_second": ("per_second", "perSecond", "second", "seconds"),
    "per_minute": ("per_minute", "perMinute", "minute", "minutes"),
    "per_hour": ("per_hour", "perHour", "hour", "hours"),
    "per_day": ("per_day", "perDay", "day", "days"),
}

DEFAULT_WEB_SETTINGS = {
    "artifact_view": "grid",
    "artifact_size": "md",
    "dock_expanded": False,
    "output_open_on_run": True,
    "output_panel_open": True,
    "files_panel_open": True,
    "artifacts_panel_open": True,
}




_DEF_REF_RE = re.compile(
    r'@([A-Za-z_]\w*)((?::(?:"[^"]*"|[^\s:"]+))*)'
)

_DEF_ARG_RE = re.compile(r':("[^"]*"|[^\s:"]+)')

_DEF_MODULE_CACHE: Dict[str, Any] = {}
_DEF_MODULE_LOCK = threading.Lock()
_ENV_LOAD_LOCK = threading.Lock()
_ENV_LOADED_ROOTS: set[str] = set()


def _parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#"):
        return None
    if stripped.startswith("export "):
        stripped = stripped[7:].lstrip()
    try:
        parts = shlex.split(stripped, comments=True, posix=True)
    except ValueError:
        return None
    if not parts or "=" not in parts[0]:
        return None
    key, value = parts[0].split("=", 1)
    key = key.strip()
    if not re.fullmatch(r"[A-Za-z_]\w*", key):
        return None
    return key, value


def _env_file_candidates(project_root: Path) -> List[Path]:
    return [project_root / ".env"]


def load_project_env(project_root: Optional[Path | str] = None) -> None:
    root = Path(project_root).expanduser() if project_root else Path.cwd()
    root = root.resolve()
    cache_key = str(root)

    with _ENV_LOAD_LOCK:
        if cache_key in _ENV_LOADED_ROOTS:
            return
        for env_file in _env_file_candidates(root):
            if not env_file.is_file():
                continue
            try:
                lines = env_file.read_text(encoding="utf-8").splitlines()
            except OSError:
                continue
            for line in lines:
                parsed = _parse_env_line(line)
                if parsed is None:
                    continue
                key, value = parsed
                os.environ[key] = value
        _ENV_LOADED_ROOTS.add(cache_key)


def _load_def_module(path: Path):

    key = str(path.resolve())
    with _DEF_MODULE_LOCK:
        cached = _DEF_MODULE_CACHE.get(key)
        if cached is not None:
            return cached
        spec = importlib.util.spec_from_file_location(
            f"_rundeer_def_{path.stem}_{abs(hash(key))}", str(path)
        )
        if spec is None or spec.loader is None:
            raise ImportError(f"cannot load definition module: {path}")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _DEF_MODULE_CACHE[key] = mod
        return mod


def _parse_def_args(arg_chain: str, full_prompt: str) -> List[str]:






    if not arg_chain:
        return []
    args: List[str] = []
    for m in _DEF_ARG_RE.finditer(arg_chain):
        raw = m.group(1)
        if raw.startswith('"') and raw.endswith('"'):
            args.append(raw[1:-1])
        elif raw == "prompt":
            args.append(full_prompt)
        else:
            args.append(raw)
    return args


def resolve_definitions(
    text: Optional[str],
    definitions: Optional[Dict[str, str]],
    project_root: Optional[Path | str] = None,
) -> Optional[str]:




















    if not text or not definitions:
        return text
    if "@" not in text:
        return text
    root = Path(project_root) if project_root else Path.cwd()
    load_project_env(root)
    full_prompt = text



    norm_defs: Dict[str, str] = {}
    for k, v in definitions.items():
        key = str(k).lstrip("@")
        if key:
            norm_defs[key] = str(v)

    def repl(match: "re.Match[str]") -> str:
        name = match.group(1)
        arg_chain = match.group(2) or ""
        spec = norm_defs.get(name)
        if spec is None:
            return match.group(0)
        spec_path = Path(spec).expanduser()
        if not spec_path.is_absolute():
            spec_path = root / spec_path
        if not spec_path.exists():
            return match.group(0)
        mod = _load_def_module(spec_path)
        fn = getattr(mod, name, None)
        if not callable(fn):
            raise AttributeError(
                f"definition '{name}': {spec_path} has no callable named '{name}'"
            )
        args = _parse_def_args(arg_chain, full_prompt)
        return str(fn(*args))

    return _DEF_REF_RE.sub(repl, text)


def package_root() -> Path:

    return Path(__file__).resolve().parent.parent


def brain_dir() -> Path:
    return package_root() / BRAIN_DIRNAME


def load_config(config_path: Optional[str | Path]) -> Dict[str, Any]:
    if not config_path:
        return {}
    p = Path(config_path)
    if p.exists():
        return normalize_config(json.loads(p.read_text(encoding="utf-8")))
    return {}


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"", "0", "false", "no", "off", "none", "null"}:
            return False
        if text in {"1", "true", "yes", "on"}:
            return True
    return bool(value)


def _positive_int_or_none(value: Any) -> Optional[int]:
    if value in (None, ""):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def normalize_rate_limits(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:





    section = raw if isinstance(raw, dict) else {}
    def _get_limit(key: str) -> Optional[int]:
        for alias in RATE_LIMIT_ALIASES[key]:
            value = _positive_int_or_none(section.get(alias))
            if value is not None:
                return value
        return None

    has_any_limit = any(_get_limit(key) for key in RATE_LIMIT_KEYS)
    out: Dict[str, Any] = {"enabled": _coerce_bool(section.get("enabled"), has_any_limit)}
    for key in RATE_LIMIT_KEYS:
        out[key] = _get_limit(key)
    return out


def normalize_web_settings(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    section = raw if isinstance(raw, dict) else {}
    out = dict(DEFAULT_WEB_SETTINGS)
    if section.get("artifact_view") in {"grid", "tree"}:
        out["artifact_view"] = section["artifact_view"]
    if section.get("artifact_size") in {"sm", "md", "lg"}:
        out["artifact_size"] = section["artifact_size"]
    for key in (
        "dock_expanded", "output_open_on_run", "output_panel_open",
        "files_panel_open", "artifacts_panel_open",
    ):
        if key in section:
            out[key] = _coerce_bool(section.get(key), bool(out[key]))
    return out


def normalize_config(raw: Dict[str, Any]) -> Dict[str, Any]:







    if not isinstance(raw, dict):
        return {}
    cfg = dict(raw)

    def _section(name: str) -> Dict[str, Any]:
        val = cfg.get(name)
        return val if isinstance(val, dict) else {}


    raw_output = cfg.get("output")
    if isinstance(raw_output, str):
        _p = Path(raw_output)
        output: Dict[str, Any] = {"dir": str(_p.parent), "name": _p.name}
    else:
        output = _section("output")
    batch = _section("batch")
    refs = _section("references") if isinstance(cfg.get("references"), dict) else {}
    image = _section("image")
    video_in = _section("video")
    rate_limits = _section("rate_limits") or _section("rateLimiter")
    web = _section("web")

    def _set(flat_key: str, *candidates: Any) -> None:
        if flat_key in cfg and not isinstance(cfg[flat_key], dict):
            return
        for c in candidates:
            if c is not None:
                cfg[flat_key] = c
                return

    _set("output_dir", output.get("dir"))
    _set("output_name", output.get("name"))

    _set("iterations", batch.get("iterations"))
    _set("concurrency", batch.get("concurrency"))
    _set("grid", batch.get("grid"))
    _set("grid_options", batch.get("grid_options"))
    _set("grid_only", batch.get("grid_only"))
    _set("chain", batch.get("chain"))
    _set("chain_compose", batch.get("chain_compose"))
    _set("chain_threshold", batch.get("chain_threshold"))
    _set("chain_override", batch.get("chain_override"))
    _set("chain_dilate", batch.get("chain_dilate"))
    _set("chain_feather", batch.get("chain_feather"))
    _set("chain_min_region", batch.get("chain_min_region"))

    if refs:
        cfg["references"] = refs.get("ids", [])
        _set("pad_reference", refs.get("pad"))
        _set("ref_quality", refs.get("quality"))

    _set("model", image.get("model"))
    _set("aspect_ratio", image.get("aspect_ratio"))
    _set("image_resolution", image.get("resolution"))



    video_out: Dict[str, Any] = {}
    for k in ("model", "duration", "resolution", "aspect_ratio",
              "output_dir", "concurrency"):
        if k in video_in:
            video_out[k] = video_in[k]
    if video_out or "video" in raw:
        cfg["video"] = video_out

    cfg["rate_limits"] = normalize_rate_limits(rate_limits)
    cfg["web"] = normalize_web_settings(web)

    return cfg


def resolve_config_path(cli_path: Optional[str]) -> Optional[Path]:


    if cli_path:
        p = Path(cli_path)
        return p if p.is_absolute() else Path.cwd() / p
    candidate = Path.cwd() / ".rundeer" / "config.json"
    if candidate.exists():
        return candidate
    return None


def resolve_style_dir(style_name: str) -> Path:
    style_dir = brain_dir() / style_name
    if not style_dir.is_dir():
        raise FileNotFoundError(f"Style folder not found: {style_dir}")
    return style_dir


def load_prompt(style_dir: Path, style_name: str) -> str:
    prompt_file = style_dir / f"{style_name.lower()}.md"
    if not prompt_file.exists():
        raise FileNotFoundError(f"Prompt file not found: {prompt_file}")
    return prompt_file.read_text(encoding="utf-8")


def fill_prompt(template: str, subject: str, motion: Optional[str] = None) -> str:
    subject = subject or ""
    motion = motion or ""
    has_subject_token = "[subject]" in (template or "")
    has_motion_token = "[motion]" in (template or "")
    out = (template or "").replace("[subject]", subject)
    out = out.replace("[motion]", motion)




    if subject and not has_subject_token:
        out = f"{subject}\n\n{out}".strip() if out.strip() else subject
    if motion and not has_motion_token:
        out = f"{out}\n\n{motion}".strip()
    return out


def resolve_subject(raw: Optional[str], project_root: Optional[Path] = None) -> str:








    if not raw:
        return raw or ""
    s = raw.strip()
    if not s.lower().endswith(".md"):
        return s
    candidates: List[Path] = []
    p = Path(s).expanduser()
    if p.is_absolute():
        candidates = [p]
    else:
        if project_root:
            candidates.append(project_root / p)
        candidates.append(Path.cwd() / p)
    for c in candidates:
        if c.exists():
            return c.read_text(encoding="utf-8").strip()
    return s


def parse_references(ref_arg: Any, config: Dict[str, Any]) -> List[int]:

    if ref_arg is not None and ref_arg != "":
        if isinstance(ref_arg, str):
            parts = [p.strip() for p in ref_arg.replace(",", " ").split() if p.strip()]
            ids = [int(p) for p in parts]
        elif isinstance(ref_arg, (list, tuple)):
            ids = [int(x) for x in ref_arg]
        else:
            ids = [int(ref_arg)]
        return ids[:5]
    ref_config = config.get("references", config.get("reference"))
    if ref_config is None:
        return []
    if isinstance(ref_config, (list, tuple)):
        return [int(x) for x in ref_config][:5]
    return [int(ref_config)]


def resolve_references(style_dir: Path, ref_ids: List[int]) -> List[Path]:

    ref_dir = style_dir / "Reference"
    if not ref_dir.is_dir():
        return []
    refs = sorted(ref_dir.glob("*.jpg")) + sorted(ref_dir.glob("*.png"))
    resolved: List[Path] = []
    for ref_id in ref_ids:
        prefix = f"{int(ref_id):04d}_"
        match = next((img for img in refs if img.name.startswith(prefix)), None)
        if match:
            resolved.append(match)
    return resolved


def parse_inputs(
    input_arg: Optional[str | List[str]],
    config: Optional[Dict[str, Any]] = None,
) -> List[Path]:






    raw: Any = input_arg
    if raw in (None, "", []) and config is not None:
        raw = config.get("input")

    if raw in (None, "", []):
        return []

    if isinstance(raw, (list, tuple)):
        parts = [str(x) for x in raw if str(x).strip()]
    else:
        parts = [p.strip() for p in str(raw).replace(",", " ").split() if p.strip()]

    root: Optional[Path] = None
    if config is not None and config.get("__project_root__"):
        root = Path(config["__project_root__"])

    paths: List[Path] = []
    for p in parts:
        pp = Path(p).expanduser()
        if not pp.is_absolute() and root is not None:
            pp = root / pp
        paths.append(pp)

    for pp in paths:
        if not pp.exists():
            raise FileNotFoundError(f"Input image not found: {pp}")
    return paths


def parse_aspect_ratio(ratio_str: str) -> float:
    w, h = ratio_str.split(":")
    return int(w) / int(h)
