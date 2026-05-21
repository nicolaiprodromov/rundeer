
from __future__ import annotations

import html
import re
import urllib.parse
import urllib.request
from typing import Any, Dict, List


DDG_HTML = "https://html.duckduckgo.com/html/"
USER_AGENT = "rundeer-agent/1.0 (+https://github.com/nicolaiprodromov/rundeer)"

_RESULT_RE = re.compile(
    r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>(.*?)</a>'
    r'.*?<a[^>]+class="result__snippet"[^>]*>(.*?)</a>',
    re.DOTALL | re.IGNORECASE,
)
_TAG_RE = re.compile(r"<[^>]+>")


def _clean(text: str) -> str:
    return html.unescape(_TAG_RE.sub("", text)).strip()


def _decode_redirect(url: str) -> str:

    parsed = urllib.parse.urlparse(url if url.startswith("http") else f"https:{url}")
    if "duckduckgo.com" in parsed.netloc and parsed.path.startswith("/l"):
        qs = urllib.parse.parse_qs(parsed.query)
        target = qs.get("uddg")
        if target:
            return urllib.parse.unquote(target[0])
    return url if url.startswith("http") else f"https:{url}"


def web_search_tool(*, query: str, max_results: int = 6) -> Dict[str, Any]:
    q = (query or "").strip()
    if not q:
        return {"error": "empty query"}
    cap = max(1, min(int(max_results), 12))
    data = urllib.parse.urlencode({"q": q}).encode("utf-8")
    req = urllib.request.Request(
        DDG_HTML,
        data=data,
        headers={"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"},
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            body = resp.read().decode("utf-8", errors="replace")
    except Exception as exc:
        return {"error": f"web search failed: {exc}"}
    results: List[Dict[str, Any]] = []
    for match in _RESULT_RE.finditer(body):
        url = _decode_redirect(match.group(1))
        title = _clean(match.group(2))
        snippet = _clean(match.group(3))
        if not title or not url:
            continue
        results.append({"title": title[:200], "url": url, "snippet": snippet[:400]})
        if len(results) >= cap:
            break
    return {"query": q, "count": len(results), "results": results}
