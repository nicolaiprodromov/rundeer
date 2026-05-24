from __future__ import annotations

import asyncio
import json
import os
import threading
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

PROVIDER_KEY_MAP: Dict[str, str] = {
    "xai": "WXWAI_API_KEY",
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
}

PROVIDER_MODELS: Dict[str, List[str]] = {
    "xai": ["xai/grok-3", "xai/grok-3-mini"],
    "openai": ["openai/gpt-4o", "openai/o3", "openai/o3-mini"],
    "anthropic": ["anthropic/claude-sonnet-4", "anthropic/claude-opus-4"],
}

PROVIDER_BASE_URLS: Dict[str, str] = {
    "xai": "https://api.x.ai/v1",
    "openai": "https://api.openai.com/v1",
    "anthropic": "https://api.anthropic.com/v1",
}

_models_cache: Dict[str, List[str]] = {}
_cache_lock = threading.Lock()


def _fetch_models_for_provider(prefix: str) -> Optional[List[str]]:
    env_var = PROVIDER_KEY_MAP.get(prefix)
    if not env_var:
        return None
    api_key = os.environ.get(env_var)
    if not api_key:
        return None
    base_url = PROVIDER_BASE_URLS.get(prefix)
    if not base_url:
        return None
    try:
        url = f"{base_url}/models"
        headers: Dict[str, str] = {"Content-Type": "application/json"}
        if prefix == "anthropic":
            headers["x-api-key"] = api_key
            headers["anthropic-version"] = "2023-06-01"
        else:
            headers["Authorization"] = f"Bearer {api_key}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        models = []
        for m in data.get("data", []):
            model_id = m.get("id", "")
            if model_id:
                models.append(f"{prefix}/{model_id}")
        return sorted(models) if models else None
    except Exception:
        return None


def _get_provider_models(prefix: str) -> List[str]:
    with _cache_lock:
        if prefix in _models_cache:
            return _models_cache[prefix]
    fetched = _fetch_models_for_provider(prefix)
    if fetched is not None:
        with _cache_lock:
            _models_cache[prefix] = fetched
        return fetched
    return PROVIDER_MODELS.get(prefix, [])


def refresh_models_cache() -> None:
    for prefix in PROVIDER_KEY_MAP:
        fetched = _fetch_models_for_provider(prefix)
        if fetched is not None:
            with _cache_lock:
                _models_cache[prefix] = fetched


PROXY_RESPONSES_URL = "https://cli-chat-proxy.grok.com/v1/responses"
GROK_CLIENT_VERSION = "0.1.218"
PROXY_MODELS = {
    "sxs-claude-opus-4-6", "sxs-gpt-5-3-codex", "sxs-gpt-5-4",
    "sxs-glm-5", "sxs-kimi-k2-5", "sxs-glm-5p1",
}
GROK_RAW_DEFAULT_MODEL = "sxs-claude-opus-4-6"


def resolve_llm_api_key(model: str) -> Optional[str]:
    prefix = model.split("/", 1)[0] if "/" in model else ""
    env_var = PROVIDER_KEY_MAP.get(prefix)
    if env_var:
        return os.environ.get(env_var) or None
    return None


def available_llm_providers() -> List[Dict[str, Any]]:
    providers: List[Dict[str, Any]] = []
    for prefix, env_var in PROVIDER_KEY_MAP.items():
        key_set = bool(os.environ.get(env_var))
        providers.append({
            "id": prefix,
            "name": prefix,
            "key_set": key_set,
            "models": _get_provider_models(prefix) if key_set else PROVIDER_MODELS.get(prefix, []),
        })

    grok_raw_available = _grok_auth_path().is_file()
    grok_raw_model = os.environ.get("GROK_RAW_MODEL") or GROK_RAW_DEFAULT_MODEL
    providers.append({
        "id": "grok_raw",
        "name": "grok_raw",
        "key_set": grok_raw_available,
        "models": [f"grok_raw/{grok_raw_model}"] if grok_raw_available else [],
    })

    return providers


def _grok_auth_path() -> Path:
    grok_home = os.environ.get("GROK_HOME", os.path.expanduser("~/.grok"))
    return Path(grok_home) / "auth.json"


@dataclass
class VisionConfig:
    provider: str
    api_key: Optional[str]
    base_url: Optional[str]


def load_vision_config() -> VisionConfig:
    provider = os.environ.get("RUNDEER_VISION_PROVIDER") or "grok_imagine"
    api_key = os.environ.get("GROK_IMAGINE_API_KEY") or os.environ.get("VISION_API_KEY") or None
    base_url = os.environ.get("GROK_IMAGINE_BASE_URL") or os.environ.get("BASE_URL") or None
    return VisionConfig(provider=provider, api_key=api_key, base_url=base_url)


def _api_host_from_base_url(base_url: Optional[str]) -> Optional[str]:
    if not base_url:
        return None
    parsed = urlparse(base_url if "://" in base_url else f"https://{base_url}")
    return parsed.netloc or parsed.path.split("/", 1)[0] or None


def make_vision_client(
    config: Optional[VisionConfig] = None,
    *,
    rate_limits: Optional[Dict[str, Any]] = None,
    rate_limit_state_path: Optional[Path | str] = None,
):
    from .api import GrokClient
    cfg = config or load_vision_config()
    from xai_sdk import Client
    kwargs: Dict[str, Any] = {}
    if cfg.api_key:
        kwargs["api_key"] = cfg.api_key
    host = _api_host_from_base_url(cfg.base_url)
    if host:
        kwargs["api_host"] = host
    sdk_client = Client(**kwargs)
    return GrokClient(
        client=sdk_client,
        rate_limits=rate_limits,
        rate_limit_state_path=rate_limit_state_path,
    )


def _load_grok_token() -> Optional[str]:
    auth_path = _grok_auth_path()
    if not auth_path.is_file():
        return None
    try:
        data = json.loads(auth_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    for entry in data.values():
        if isinstance(entry, dict) and "key" in entry:
            return entry["key"]
    return None


class GrokRawLLM:

    def __init__(self, model: Optional[str] = None, max_tokens: Optional[int] = None):
        raw_model = model or os.environ.get("GROK_RAW_MODEL") or GROK_RAW_DEFAULT_MODEL
        self.model = raw_model.removeprefix("grok_raw/") if raw_model.startswith("grok_raw/") else raw_model
        self.max_tokens = max_tokens or int(os.environ.get("GROK_RAW_MAX_TOKENS") or 4096)

    async def acompletion(self, messages: List[Dict[str, Any]], **kwargs: Any) -> Dict[str, Any]:
        token = _load_grok_token()
        if not token:
            raise RuntimeError("grok_raw: no auth token found — run `grok login` first")

        system_parts = []
        user_messages = []
        for m in messages:
            if m.get("role") == "system":
                system_parts.append(str(m.get("content") or ""))
            else:
                user_messages.append({"role": m["role"], "content": str(m.get("content") or "")})

        system = "\n\n".join(system_parts) if system_parts else None
        use_proxy = self.model in PROXY_MODELS or self.model.startswith("sxs-")

        loop = asyncio.get_running_loop()
        if use_proxy:
            result = await loop.run_in_executor(
                None,
                lambda: self._chat_proxy(user_messages, token, system=system),
            )
            return self._proxy_to_openai_format(result)
        else:
            all_messages = []
            if system:
                all_messages.append({"role": "system", "content": system})
            all_messages.extend(user_messages)
            result = await loop.run_in_executor(
                None,
                lambda: self._chat_xai(all_messages, token),
            )
            return result

    def _chat_xai(self, messages: List[Dict[str, Any]], token: str) -> Dict[str, Any]:
        import urllib.request
        import urllib.error
        body = {
            "model": self.model,
            "messages": messages,
            "max_tokens": self.max_tokens,
        }
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }
        payload = json.dumps(body).encode()
        req = urllib.request.Request(
            "https://api.x.ai/v1/chat/completions",
            data=payload,
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _chat_proxy(
        self,
        messages: List[Dict[str, Any]],
        token: str,
        system: Optional[str] = None,
    ) -> Dict[str, Any]:
        import urllib.request
        import urllib.error
        input_items: List[Dict[str, Any]] = []
        if system:
            input_items.append({"role": "developer", "content": system})
        for m in messages:
            input_items.append({"role": m["role"], "content": m["content"]})

        body = {
            "model": self.model,
            "input": input_items,
            "max_output_tokens": self.max_tokens,
            "stream": True,
        }
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-XAI-Token-Auth": "xai-grok-cli",
            "x-authenticateresponse": "authenticate-response",
            "x-grok-client-version": GROK_CLIENT_VERSION,
            "x-grok-model-override": self.model,
            "user-agent": f"xai-grok-workspace/{GROK_CLIENT_VERSION}",
        }
        payload = json.dumps(body).encode()
        req = urllib.request.Request(
            PROXY_RESPONSES_URL,
            data=payload,
            headers=headers,
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            raw = resp.read()
        return self._parse_sse_responses(raw)

    @staticmethod
    def _parse_sse_responses(raw_bytes: bytes) -> Dict[str, Any]:
        text_parts: List[str] = []
        reasoning_parts: List[str] = []
        usage: Dict[str, Any] = {}
        model: Optional[str] = None

        for line in raw_bytes.decode(errors="replace").splitlines():
            if not line.startswith("data: ") or line.strip() == "data: [DONE]":
                continue
            try:
                evt = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            evt_type = evt.get("type", "")
            if evt_type == "response.output_text.delta":
                text_parts.append(evt.get("delta", ""))
            elif evt_type == "response.reasoning_summary_text.delta":
                reasoning_parts.append(evt.get("delta", ""))
            elif evt_type == "response.completed":
                r = evt.get("response", {})
                usage = r.get("usage", {})
                model = r.get("model")

        return {
            "content": "".join(text_parts),
            "reasoning": "".join(reasoning_parts),
            "usage": usage,
            "model": model,
        }

    @staticmethod
    def _proxy_to_openai_format(result: Dict[str, Any]) -> Dict[str, Any]:
        usage = result.get("usage") or {}
        return {
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": result.get("content") or "",
                    "reasoning_content": result.get("reasoning") or None,
                },
                "finish_reason": "stop",
            }],
            "usage": {
                "prompt_tokens": usage.get("input_tokens") or 0,
                "completion_tokens": usage.get("output_tokens") or 0,
                "total_tokens": usage.get("total_tokens") or 0,
            },
            "model": result.get("model"),
        }