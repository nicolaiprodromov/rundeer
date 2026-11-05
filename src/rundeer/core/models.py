from __future__ import annotations

import json
import os
import re
import threading
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional


PROVIDER_KEY_MAP: Dict[str, str] = {
    "xai": "XAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
}

PROVIDER_MODELS: Dict[str, List[str]] = {
    "xai": ["xai/grok-4.7"],
    "anthropic": ["anthropic/claude-opus-5-5", "anthropic/claude-sonnet-5-5", "anthropic/claude-haiku-5-5"],
}

PROVIDER_BASE_URLS: Dict[str, str] = {
    "xai": "https://api.x.ai/v1",
    "anthropic": "https://api.anthropic.com/v1",
}

MODEL_FILTERS: Dict[str, re.Pattern] = {
    "xai": re.compile(r"^grok-\d+\.\d+(-fast)?$"),
}

_models_cache: Dict[str, List[str]] = {}
_cache_lock = threading.Lock()


def _key(prefix: str) -> Optional[str]:
    env_var = PROVIDER_KEY_MAP.get(prefix)
    return (os.environ.get(env_var) or None) if env_var else None


def _fetch_models_for_provider(prefix: str) -> Optional[List[str]]:
    api_key = _key(prefix)
    if not api_key:
        return None
    headers: Dict[str, str] = {"Content-Type": "application/json"}
    if prefix == "anthropic":
        headers["x-api-key"] = api_key
        headers["anthropic-version"] = "2023-06-01"
    else:
        headers["Authorization"] = f"Bearer {api_key}"
    try:
        req = urllib.request.Request(f"{PROVIDER_BASE_URLS[prefix]}/models", headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    flt = MODEL_FILTERS.get(prefix)
    models = sorted(f"{prefix}/{m['id']}" for m in data.get("data", []) if m.get("id") and (not flt or flt.match(m["id"])))
    return models or None


def _get_provider_models(prefix: str) -> List[str]:
    with _cache_lock:
        if prefix in _models_cache:
            return _models_cache[prefix]
    fetched = _fetch_models_for_provider(prefix)
    if fetched is None:
        return PROVIDER_MODELS[prefix]
    with _cache_lock:
        _models_cache[prefix] = fetched
    return fetched


def resolve_llm_api_key(model: str) -> Optional[str]:
    return _key(model.split("/", 1)[0]) if "/" in model else None


def provider_model(provider: str) -> str:
    prov = provider.strip()
    return prov.rsplit("/", 1)[0] if prov else ""


def llm_model(root: Path | str) -> str:
    import yaml
    from .paths import settings_yaml_path
    path = settings_yaml_path(root)
    data = (yaml.safe_load(path.read_text(encoding="utf-8")) if path.is_file() else None) or {}
    return provider_model(str(((data.get("settings") or {}).get("Agent") or {}).get("Provider") or ""))


def available_llm_providers(*, configured_model: str = "") -> List[Dict[str, Any]]:
    providers: List[Dict[str, Any]] = []
    for prefix in PROVIDER_KEY_MAP:
        key_set = bool(_key(prefix))
        models = list(_get_provider_models(prefix) if key_set else PROVIDER_MODELS[prefix])
        if configured_model.startswith(f"{prefix}/") and configured_model not in models:
            models.append(configured_model)
        providers.append({"id": prefix, "name": prefix, "key_set": key_set, "models": models})
    return providers


def make_vision_client(
    *,
    rate_limits: Optional[Dict[str, Any]] = None,
    rate_limit_state_path: Optional[Path | str] = None,
):
    from .api import GrokClient
    return GrokClient(rate_limits=rate_limits, rate_limit_state_path=rate_limit_state_path)
