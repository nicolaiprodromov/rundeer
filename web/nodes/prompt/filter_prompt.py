from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import parse_qs, urlparse

from rundeer.core import paths as rpaths
from web.config.settings_manager import get_cached_settings
from web.nodes._shared.helpers import IMAGE_EXTS, safe_project_path


def _coerce_filter_image_values(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, list):
        values = value
    elif isinstance(value, str):
        values = value.split(",") if "," in value else [value]
    else:
        values = [value]
    return [str(item).strip() for item in values if str(item or "").strip()]


def filter_prompt_image_urls(root: Path, value: Any) -> List[str]:
    values = _coerce_filter_image_values(value)
    if not values:
        return []
    from rundeer.core.media import encode_image

    image_urls: List[str] = []
    cache_dir = rpaths.cache_dir(root, "filter-prompt")
    for raw in values:
        image_ref = raw
        if image_ref.startswith(("http://", "https://", "data:image/")):
            image_urls.append(image_ref)
            continue
        if image_ref.startswith("/api/file"):
            image_ref = (parse_qs(urlparse(image_ref).query).get("path") or [""])[0]
        path = safe_project_path(root, image_ref)
        if not path.is_file():
            raise FileNotFoundError(image_ref)
        if path.suffix.lower() not in IMAGE_EXTS:
            raise ValueError(f"unsupported image input: {image_ref}")
        image_urls.append(encode_image(path, pad=False, quality=85, cache_dir=cache_dir))
    return image_urls


def _reasoning_text(message: Any) -> str:
    def _get(key: str) -> Any:
        if isinstance(message, dict):
            return message.get(key)
        return getattr(message, key, None)

    rc = _get("reasoning_content")
    if isinstance(rc, str) and rc.strip():
        return rc
    blocks = _get("thinking_blocks")
    if isinstance(blocks, list):
        joined = "".join(str(b.get("thinking") or "") for b in blocks if isinstance(b, dict)).strip()
        if joined:
            return joined
    return ""


def filter_prompt_messages(prompt_text: str, instructions: str, image_urls: List[str]) -> List[Dict[str, Any]]:
    user_content: Any = prompt_text
    if image_urls:
        user_content = [{"type": "text", "text": prompt_text or "Use the attached images as visual context."}]
        user_content.extend({"type": "image_url", "image_url": {"url": url}} for url in image_urls)
    return [
        {"role": "system", "content": instructions},
        {"role": "user", "content": user_content},
    ]


def filter_prompt(root: Path, payload: Dict[str, Any]) -> Dict[str, Any]:
    from rundeer.core.config import load_project_env

    load_project_env(str(root))

    prompt_text = str(payload.get("prompt") or "")
    instructions = str(payload.get("instructions") or "Rewrite the following prompt to be more concise and vivid.")
    from rundeer.core.models import llm_model, resolve_llm_api_key
    model_name = str(payload.get("model") or "").strip() or llm_model(root)
    if not model_name:
        return {"error": "no model configured in settings", "filtered_prompt": prompt_text}

    api_key = resolve_llm_api_key(model_name)

    try:
        image_urls = filter_prompt_image_urls(root, payload.get("images") or payload.get("image_urls") or payload.get("input"))
    except Exception as exc:
        return {"error": f"image input: {exc}", "filtered_prompt": prompt_text}

    def _opt_num(key: str) -> Any:
        v = payload.get(key)
        if v is None or v == "":
            return None
        try:
            n = float(v)
        except (TypeError, ValueError):
            return None
        return n

    def _opt_int(key: str) -> Any:
        v = _opt_num(key)
        return None if v is None else int(v)

    msgs = filter_prompt_messages(prompt_text, instructions, image_urls)

    reasoning_effort = str(payload.get("reasoning_effort") or "").strip().lower()
    is_reasoning = reasoning_effort in {"none", "low", "medium", "high", "xhigh"}

    mt = _opt_int("max_tokens")
    if not (mt and mt > 0):
        data = get_cached_settings(root)
        st = float((data.get("settings") or {}).get("Agent", {}).get("Max_tokens") or 0)
        mt = int(st) if st and st > 0 else 1024
    if mt >= 99999999:
        mt = None

    import litellm
    call_kwargs: Dict[str, Any] = {
        "model": model_name,
        "messages": msgs,
        "drop_params": True,
    }
    if api_key:
        call_kwargs["api_key"] = api_key

    if is_reasoning:
        call_kwargs["reasoning_effort"] = reasoning_effort

    temperature = _opt_num("temperature")
    if temperature is not None:
        call_kwargs["temperature"] = temperature
    top_p = _opt_num("top_p")
    if top_p is not None:
        call_kwargs["top_p"] = top_p
    if mt is not None:
        call_kwargs["max_tokens"] = mt
    seed = _opt_int("seed")
    if seed is not None:
        call_kwargs["seed"] = seed

    if not is_reasoning:
        fp = _opt_num("frequency_penalty")
        if fp is not None:
            call_kwargs["frequency_penalty"] = fp
        pp = _opt_num("presence_penalty")
        if pp is not None:
            call_kwargs["presence_penalty"] = pp
        stop_raw = payload.get("stop")
        if isinstance(stop_raw, str) and stop_raw.strip():
            stop_list = [s.strip() for s in stop_raw.split(",") if s.strip()]
            if stop_list:
                call_kwargs["stop"] = stop_list if len(stop_list) > 1 else stop_list[0]
        elif isinstance(stop_raw, list):
            stop_list = [str(s).strip() for s in stop_raw if str(s).strip()]
            if stop_list:
                call_kwargs["stop"] = stop_list

    try:
        response = litellm.completion(**call_kwargs)
        message = response.choices[0].message
        return {"filtered_prompt": message.content, "thinking": _reasoning_text(message)}
    except Exception as exc:
        return {"error": str(exc), "filtered_prompt": prompt_text}
