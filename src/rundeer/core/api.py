
from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from .rate_limit import RateLimiter


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

            client = Client(api_key=os.environ.get("XAI_API_KEY"))
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
        quality: Optional[str] = None,
    ) -> List[Any]:
        self._acquire_request_slot()
        params: Dict[str, Any] = {"aspect_ratio": aspect_ratio}
        if image_urls:
            params["image_urls"] = image_urls
        if resolution:
            params["resolution"] = resolution
        if quality:
            params["quality"] = quality
        t0 = time.monotonic()
        responses = self._client.image.sample_batch(prompt, model, n, **params)
        result = list(responses)
        dt = time.monotonic() - t0
        sys.stderr.write(f"[api-timing] generate_image model={model} n={n} elapsed={dt:.2f}s\n")
        sys.stderr.flush()
        return result

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
        t0 = time.monotonic()
        result = self._client.video.generate(prompt, model=model, **params)
        dt = time.monotonic() - t0
        sys.stderr.write(f"[api-timing] generate_video model={model} elapsed={dt:.2f}s\n")
        sys.stderr.flush()
        return result

    def extend_video(
        self,
        prompt: str,
        source: str,
        model: str = "grok-imagine-video",
        duration: int = 6,
    ) -> Any:
        self._acquire_request_slot()
        t0 = time.monotonic()
        result = self._client.video.extend(
            prompt,
            model,
            source,
            duration=duration,
        )
        dt = time.monotonic() - t0
        sys.stderr.write(f"[api-timing] extend_video model={model} elapsed={dt:.2f}s\n")
        sys.stderr.flush()
        return result
