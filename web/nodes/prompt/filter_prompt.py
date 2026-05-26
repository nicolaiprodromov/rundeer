from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import parse_qs, urlparse

from rundeer.core import paths as rpaths
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
    model_override = str(payload.get("model") or "").strip()
    model_name = model_override or (os.environ.get("RUNDEER_LLM_MODEL") or os.environ.get("MODEL_NAME") or "").strip()

    if not model_name:
        return {"error": "RUNDEER_LLM_MODEL not set (provide via .env or model prop)", "filtered_prompt": prompt_text}

    from rundeer.core.models import resolve_llm_api_key
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

    import litellm
    call_kwargs: Dict[str, Any] = {
        "model": model_name,
        "messages": filter_prompt_messages(prompt_text, instructions, image_urls),
    }
    if api_key:
        call_kwargs["api_key"] = api_key

    reasoning_effort = str(payload.get("reasoning_effort") or "").strip().lower()
    is_reasoning = reasoning_effort in {"none", "low", "medium", "high", "xhigh"}
    if is_reasoning:
        call_kwargs["reasoning_effort"] = reasoning_effort

    temperature = _opt_num("temperature")
    if temperature is not None:
        call_kwargs["temperature"] = temperature
    top_p = _opt_num("top_p")
    if top_p is not None:
        call_kwargs["top_p"] = top_p
    max_tokens = _opt_int("max_tokens")
    if max_tokens is not None and max_tokens > 0:
        call_kwargs["max_tokens"] = max_tokens
    else:
        call_kwargs["max_tokens"] = 1024
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
        filtered = response.choices[0].message.content
        return {"filtered_prompt": filtered}
    except Exception as exc:
        return {"error": str(exc), "filtered_prompt": prompt_text}
