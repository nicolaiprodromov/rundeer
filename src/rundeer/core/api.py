
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from .rate_limit import RateLimiter


def _api_host_from_base_url(base_url: Optional[str]) -> Optional[str]:
    if not base_url:
        return None
    parsed = urlparse(base_url if "://" in base_url else f"https://{base_url}")
    return parsed.netloc or parsed.path.split("/", 1)[0] or None


class GrokClient:


    def __init__(
        self,
        client: Any = None,
        *,
        rate_limits: Optional[Dict[str, Any]] = None,
        rate_limit_state_path: Optional[Path | str] = None,
    ):
        if client is None:
            from xai_sdk import Client

            kwargs: Dict[str, Any] = {}
            api_key = os.environ.get("VISION_API_KEY")
            api_host = _api_host_from_base_url(os.environ.get("BASE_URL"))
            if api_key:
                kwargs["api_key"] = api_key
            if api_host:
                kwargs["api_host"] = api_host
            client = Client(**kwargs)
        self._client = client
        self._rate_limiter = RateLimiter(rate_limits, state_path=rate_limit_state_path)

    def _acquire_request_slot(self) -> None:
        self._rate_limiter.acquire()

    def generate_image(
        self,
        prompt: str,
        model: str = "grok-imagine-image",
        n: int = 1,
        aspect_ratio: str = "1:1",
        image_urls: Optional[List[str]] = None,
        resolution: Optional[str] = None,
    ) -> List[Any]:
        self._acquire_request_slot()
        params: Dict[str, Any] = {"aspect_ratio": aspect_ratio}
        if image_urls:
            params["image_urls"] = image_urls
        if resolution:
            params["resolution"] = resolution
        responses = self._client.image.sample_batch(prompt, model, n, **params)
        return list(responses)

    def generate_video(
        self,
        prompt: str,
        model: str = "grok-imagine-video",
        duration: int = 6,
        aspect_ratio: str = "16:9",
        resolution: str = "720p",
        image: Optional[str] = None,
        reference_images: Optional[List[str]] = None,
        video_url: Optional[str] = None,
    ) -> Any:
        self._acquire_request_slot()

        raw = prompt.encode("utf-8")
        if len(raw) > 4096:
            prompt = raw[:4096].decode("utf-8", errors="ignore")
        params: Dict[str, Any] = {}
        if video_url:



            params["video_url"] = video_url
        else:
            params["duration"] = duration
            params["aspect_ratio"] = aspect_ratio
            params["resolution"] = resolution
            if image:
                params["image_url"] = image
            if reference_images:
                params["reference_image_urls"] = list(reference_images)
        return self._client.video.generate(prompt, model=model, **params)

    def extend_video(
        self,
        prompt: str,
        source: str,
        model: str = "grok-imagine-video",
        duration: int = 6,
    ) -> Any:
        self._acquire_request_slot()
        return self._client.video.extend(
            prompt,
            model,
            source,
            duration=duration,
        )
