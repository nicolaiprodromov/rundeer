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


_STREAM_TIMEOUT = 600

_SENTINEL = object()


class _NS:
    def __init__(self, **kw: Any):
        self.__dict__.update(kw)


def _iter_sse_lines(resp) -> Any:
    while True:
        raw = resp.readline()
        if not raw:
            break
        yield raw.decode(errors="replace").rstrip("\n\r")


def _parse_sse_line(raw_line: str) -> Optional[Dict[str, Any]]:
    line = raw_line.strip()
    if not line.startswith("data: ") or line == "data: [DONE]":
        return None
    try:
        return json.loads(line[6:])
    except json.JSONDecodeError:
        return None


class GrokRawLLM:

    def __init__(self, model: Optional[str] = None, max_tokens: Optional[int] = None):
        raw_model = model or os.environ.get("GROK_RAW_MODEL") or GROK_RAW_DEFAULT_MODEL
        self.model = raw_model.removeprefix("grok_raw/") if raw_model.startswith("grok_raw/") else raw_model
        self.max_tokens = max_tokens or int(os.environ.get("GROK_RAW_MAX_TOKENS") or 16384)

    async def acompletion(self, messages: List[Dict[str, Any]], **kwargs: Any) -> Dict[str, Any]:
        token = _load_grok_token()
        if not token:
            raise RuntimeError("grok_raw: no auth token found — run `grok login` first")

        tools = kwargs.get("tools")
        use_proxy = self.model in PROXY_MODELS or self.model.startswith("sxs-")

        loop = asyncio.get_running_loop()
        if use_proxy:
            input_items = self._to_responses_input(messages)
            proxy_tools = self._to_responses_tools(tools) if tools else None
            result = await loop.run_in_executor(
                None,
                lambda: self._chat_proxy_buffered(input_items, token, tools=proxy_tools),
            )
            return self._proxy_to_openai_format(result)
        else:
            result = await loop.run_in_executor(
                None,
                lambda: self._chat_xai_buffered(messages, token, tools=tools),
            )
            return result

    async def acompletion_stream(self, messages: List[Dict[str, Any]], **kwargs: Any) -> Any:
        token = _load_grok_token()
        if not token:
            raise RuntimeError("grok_raw: no auth token found — run `grok login` first")

        tools = kwargs.get("tools")
        use_proxy = self.model in PROXY_MODELS or self.model.startswith("sxs-")

        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()

        if use_proxy:
            input_items = self._to_responses_input(messages)
            proxy_tools = self._to_responses_tools(tools) if tools else None

            def _run_proxy():
                try:
                    for chunk in self._stream_proxy(input_items, token, tools=proxy_tools):
                        loop.call_soon_threadsafe(queue.put_nowait, chunk)
                except Exception as exc:
                    loop.call_soon_threadsafe(queue.put_nowait, exc)
                finally:
                    loop.call_soon_threadsafe(queue.put_nowait, _SENTINEL)

            loop.run_in_executor(None, _run_proxy)
        else:
            def _run_xai():
                try:
                    for chunk in self._stream_xai(messages, token, tools=tools):
                        loop.call_soon_threadsafe(queue.put_nowait, chunk)
                except Exception as exc:
                    loop.call_soon_threadsafe(queue.put_nowait, exc)
                finally:
                    loop.call_soon_threadsafe(queue.put_nowait, _SENTINEL)

            loop.run_in_executor(None, _run_xai)

        while True:
            item = await queue.get()
            if item is _SENTINEL:
                break
            if isinstance(item, Exception):
                raise item
            yield item

    @staticmethod
    def _to_responses_input(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        for m in messages:
            role = m.get("role")
            if role == "system":
                items.append({"role": "developer", "content": str(m.get("content") or "")})
            elif role == "user":
                content = m.get("content")
                if isinstance(content, list):
                    parts: List[Dict[str, Any]] = []
                    for block in content:
                        if not isinstance(block, dict):
                            continue
                        if block.get("type") == "text":
                            parts.append({"type": "input_text", "text": block.get("text", "")})
                        elif block.get("type") == "image_url":
                            url = (block.get("image_url") or {}).get("url", "")
                            if url:
                                parts.append({"type": "input_image", "image_url": url})
                    items.append({"role": "user", "content": parts if parts else ""})
                else:
                    items.append({"role": "user", "content": str(content or "")})
            elif role == "assistant":
                content = m.get("content")
                if content:
                    items.append({"role": "assistant", "content": str(content)})
                for tc in (m.get("tool_calls") or []):
                    fn = tc.get("function") or {}
                    items.append({
                        "type": "function_call",
                        "call_id": tc.get("id") or "",
                        "name": fn.get("name") or "",
                        "arguments": fn.get("arguments") or "{}",
                    })
            elif role == "tool":
                items.append({
                    "type": "function_call_output",
                    "call_id": m.get("tool_call_id") or "",
                    "output": str(m.get("content") or ""),
                })
        return items

    @staticmethod
    def _to_responses_tools(chat_tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for t in chat_tools:
            fn = t.get("function") or {}
            out.append({
                "type": "function",
                "name": fn.get("name") or "",
                "description": fn.get("description") or "",
                "parameters": fn.get("parameters") or {},
            })
        return out

    @staticmethod
    def _open_sse(url: str, body: Dict[str, Any], headers: Dict[str, str]) -> Any:
        payload = json.dumps(body).encode()
        req = urllib.request.Request(url, data=payload, headers=headers)
        return urllib.request.urlopen(req, timeout=_STREAM_TIMEOUT)

    def _stream_xai(self, messages: List[Dict[str, Any]], token: str, *, tools: Optional[List[Dict[str, Any]]] = None) -> Any:
        body: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": self.max_tokens,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

        resp = self._open_sse("https://api.x.ai/v1/chat/completions", body, headers)
        try:
            for raw_line in _iter_sse_lines(resp):
                if raw_line.strip() == "data: [DONE]":
                    break
                parsed = _parse_sse_line(raw_line)
                if parsed is None:
                    continue

                choices = parsed.get("choices") or []
                if not choices:
                    if parsed.get("usage"):
                        yield _NS(choices=[], usage=_NS(**parsed["usage"]))
                    continue

                ch = choices[0]
                delta_raw = ch.get("delta") or {}
                delta = _NS(
                    content=delta_raw.get("content"),
                    reasoning_content=delta_raw.get("reasoning_content"),
                    tool_calls=None,
                )
                if delta_raw.get("tool_calls"):
                    tcs = []
                    for tc in delta_raw["tool_calls"]:
                        fn_raw = tc.get("function") or {}
                        tcs.append(_NS(
                            index=tc.get("index", 0),
                            id=tc.get("id"),
                            function=_NS(
                                name=fn_raw.get("name"),
                                arguments=fn_raw.get("arguments"),
                            ),
                        ))
                    delta.tool_calls = tcs
                usage_raw = parsed.get("usage")
                yield _NS(
                    choices=[_NS(delta=delta, finish_reason=ch.get("finish_reason"))],
                    usage=_NS(**usage_raw) if usage_raw else None,
                )
        finally:
            resp.close()

    def _stream_proxy(self, input_items: List[Dict[str, Any]], token: str, *, tools: Optional[List[Dict[str, Any]]] = None) -> Any:
        body: Dict[str, Any] = {
            "model": self.model,
            "input": input_items,
            "max_output_tokens": self.max_tokens,
            "stream": True,
        }
        if tools:
            body["tools"] = tools
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-XAI-Token-Auth": "xai-grok-cli",
            "x-authenticateresponse": "authenticate-response",
            "x-grok-client-version": GROK_CLIENT_VERSION,
            "x-grok-model-override": self.model,
            "user-agent": f"xai-grok-workspace/{GROK_CLIENT_VERSION}",
        }

        resp = self._open_sse(PROXY_RESPONSES_URL, body, headers)
        pending_tool_calls: Dict[int, Dict[str, Any]] = {}
        try:
            for raw_line in _iter_sse_lines(resp):
                evt = _parse_sse_line(raw_line)
                if evt is None:
                    continue

                evt_type = evt.get("type", "")

                if evt_type == "response.output_text.delta":
                    delta_text = evt.get("delta", "")
                    if delta_text:
                        yield _NS(
                            choices=[_NS(
                                delta=_NS(content=delta_text, reasoning_content=None, tool_calls=None),
                                finish_reason=None,
                            )],
                            usage=None,
                        )

                elif evt_type == "response.reasoning_summary_text.delta":
                    delta_text = evt.get("delta", "")
                    if delta_text:
                        yield _NS(
                            choices=[_NS(
                                delta=_NS(content=None, reasoning_content=delta_text, tool_calls=None),
                                finish_reason=None,
                            )],
                            usage=None,
                        )

                elif evt_type == "response.output_item.added":
                    item = evt.get("item") or {}
                    if item.get("type") == "function_call":
                        idx = evt.get("output_index", len(pending_tool_calls))
                        call_id = item.get("call_id") or f"call_{idx}"
                        name = item.get("name") or ""
                        pending_tool_calls[idx] = {"call_id": call_id, "name": name}
                        yield _NS(
                            choices=[_NS(
                                delta=_NS(
                                    content=None,
                                    reasoning_content=None,
                                    tool_calls=[_NS(
                                        index=idx,
                                        id=call_id,
                                        function=_NS(name=name, arguments=None),
                                    )],
                                ),
                                finish_reason=None,
                            )],
                            usage=None,
                        )

                elif evt_type == "response.function_call_arguments.delta":
                    idx = evt.get("output_index", 0)
                    args_delta = evt.get("delta", "")
                    if args_delta:
                        yield _NS(
                            choices=[_NS(
                                delta=_NS(
                                    content=None,
                                    reasoning_content=None,
                                    tool_calls=[_NS(
                                        index=idx,
                                        id=None,
                                        function=_NS(name=None, arguments=args_delta),
                                    )],
                                ),
                                finish_reason=None,
                            )],
                            usage=None,
                        )

                elif evt_type == "response.completed":
                    r = evt.get("response", {})
                    u = r.get("usage", {})
                    finish = "tool_calls" if pending_tool_calls else "stop"
                    yield _NS(
                        choices=[_NS(
                            delta=_NS(content=None, reasoning_content=None, tool_calls=None),
                            finish_reason=finish,
                        )],
                        usage=_NS(
                            prompt_tokens=u.get("input_tokens") or 0,
                            completion_tokens=u.get("output_tokens") or 0,
                            total_tokens=u.get("total_tokens") or 0,
                        ),
                    )
        finally:
            resp.close()

    def _chat_xai_buffered(self, messages: List[Dict[str, Any]], token: str, *, tools: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": self.max_tokens,
        }
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"
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
        with urllib.request.urlopen(req, timeout=_STREAM_TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _chat_proxy_buffered(
        self,
        input_items: List[Dict[str, Any]],
        token: str,
        *,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {
            "model": self.model,
            "input": input_items,
            "max_output_tokens": self.max_tokens,
            "stream": True,
        }
        if tools:
            body["tools"] = tools
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
        resp = urllib.request.urlopen(req, timeout=_STREAM_TIMEOUT)
        text_parts: List[str] = []
        reasoning_parts: List[str] = []
        usage: Dict[str, Any] = {}
        model: Optional[str] = None
        function_calls: Dict[int, Dict[str, Any]] = {}
        try:
            for raw_line in _iter_sse_lines(resp):
                evt = _parse_sse_line(raw_line)
                if evt is None:
                    continue
                evt_type = evt.get("type", "")
                if evt_type == "response.output_text.delta":
                    text_parts.append(evt.get("delta", ""))
                elif evt_type == "response.reasoning_summary_text.delta":
                    reasoning_parts.append(evt.get("delta", ""))
                elif evt_type == "response.output_item.added":
                    item = evt.get("item") or {}
                    if item.get("type") == "function_call":
                        idx = evt.get("output_index", len(function_calls))
                        function_calls[idx] = {
                            "call_id": item.get("call_id") or "",
                            "name": item.get("name") or "",
                            "arguments": "",
                        }
                elif evt_type == "response.function_call_arguments.delta":
                    idx = evt.get("output_index", 0)
                    if idx in function_calls:
                        function_calls[idx]["arguments"] += evt.get("delta", "")
                elif evt_type == "response.function_call_arguments.done":
                    idx = evt.get("output_index", 0)
                    if idx in function_calls:
                        function_calls[idx]["arguments"] = evt.get("arguments") or function_calls[idx]["arguments"]
                        if evt.get("call_id"):
                            function_calls[idx]["call_id"] = evt["call_id"]
                        if evt.get("name"):
                            function_calls[idx]["name"] = evt["name"]
                elif evt_type == "response.completed":
                    r = evt.get("response", {})
                    usage = r.get("usage", {})
                    model = r.get("model")
        finally:
            resp.close()

        result: Dict[str, Any] = {
            "content": "".join(text_parts),
            "reasoning": "".join(reasoning_parts),
            "usage": usage,
            "model": model,
        }
        if function_calls:
            result["function_calls"] = [function_calls[idx] for idx in sorted(function_calls.keys())]
        return result

    @staticmethod
    def _proxy_to_openai_format(result: Dict[str, Any]) -> Dict[str, Any]:
        usage = result.get("usage") or {}
        message: Dict[str, Any] = {
            "role": "assistant",
            "content": result.get("content") or "",
            "reasoning_content": result.get("reasoning") or None,
        }
        fcs = result.get("function_calls")
        if fcs:
            tool_calls = []
            for i, fc in enumerate(fcs):
                tool_calls.append({
                    "id": fc.get("call_id") or f"call_{i}",
                    "type": "function",
                    "function": {
                        "name": fc.get("name") or "",
                        "arguments": fc.get("arguments") or "{}",
                    },
                })
            message["tool_calls"] = tool_calls
        return {
            "choices": [{
                "message": message,
                "finish_reason": "tool_calls" if fcs else "stop",
            }],
            "usage": {
                "prompt_tokens": usage.get("input_tokens") or 0,
                "completion_tokens": usage.get("output_tokens") or 0,
                "total_tokens": usage.get("total_tokens") or 0,
            },
            "model": result.get("model"),
        }


VISION_MODEL = "grok-3-mini"


def grok_raw_describe_image(data_url: str, question: str = "Describe this image in detail.") -> str:
    token = _load_grok_token()
    if not token:
        return "(vision fallback unavailable — no grok auth token)"
    body = {
        "model": VISION_MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": question},
                {"type": "image_url", "image_url": {"url": data_url}},
            ],
        }],
        "max_tokens": 4096,
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
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data["choices"][0]["message"].get("content") or ""
    except Exception as exc:
        return f"(vision fallback failed: {exc})"