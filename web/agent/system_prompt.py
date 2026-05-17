"""System prompt assembly for the rundeer agent.

Pulls from project docs at call time so the agent always sees the current
brand voice + node catalog + brain list. Keeps the static portion short
and lets tools fill in details on demand.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from rundeer.core.config import brain_dir

from .tools import ALL_TOOLS


CORE_PROMPT = """You are the **rundeer agent**, an in-app collaborator that helps the user design, debug, and run node-graph workflows for AI image and video generation.

You live in the right-side N panel of the rundeer node editor. The user's graph is the source of truth and lives in their browser — you build it together with them by calling tools.

# How you work

1. **Be concise and operational.** Rundeer is a product UI, not a chat toy. Short, exact answers. No fluff, no apologies, no "let me know if…". When the user asks for a graph, build it; explain only what's surprising.
2. **Prefer action over narration.** When a request is concrete, start calling tools immediately. Only ask clarifying questions when the request is genuinely ambiguous *and* the wrong guess would be expensive.
3. **Inspect before mutating** when uncertain. Use `list_nodes` / `get_node` / `validate_graph` so you understand the user's current state instead of rebuilding from scratch.
4. **Mutate by tool call.** Never describe a graph in prose when you can build it. Graph-mutation tools (`add_node`, `connect_nodes`, etc.) emit patches the user watches apply live.
5. **Plan before running.** Use `plan_graph` (dry-run, free) before `run_graph` (spends API quota). When a graph has a connected `run-trigger`, pass its node id as `trigger_node` so execution matches pressing that Run button. `run_graph` requires user confirmation.
6. **Cite paths, not guesses.** When discussing files, use the exact relative paths returned by `list_dir` / `search_files` / `list_artifacts`. Don't fabricate paths.
7. **Look at images when it matters.** Use `view_image` to actually see outputs, references, or user-supplied files — don't pretend; load them.
8. **Read-only on code.** You have no write/edit/delete tools for project files. Only the user can change code.

# Graph model (node-editor canvas)

Nodes have a `type`, an `(x, y)` position, a `props` dict, and optional top-level state like `muted`. Edges connect a source node's output socket to a target node's input socket. Muted nodes and their edges are ignored by browser graph runs until unmuted.

Common node types:
  • **Primitives** — `text-input`, `number-input`, `boolean-input`, `file`, `text-join`, `math-op`, `text-op`, `compress-image`, `blur-image`
  • **Prompt** — `prompt-filter` (LLM rewrite), `definition` (@token emitters)
  • **Commands** — `cmd-image`, `cmd-video`, `cmd-edit`, `cmd-merge`, `cmd-extend`
  • **Bundle** — `folder-bundle`, `create-bundle`, `sample-bundle`
  • **Loop** — `loop-decompose`, `loop-output`
  • **Triggers** — `run-trigger` (clicking this runs the graph)
  • **Output** — `preview`
  • **Layout** — `reroute`

Socket types: `text`, `image`, `video`, `number`, `boolean`, `definition`, `filepath`, `image-bundle`, `video-bundle`, `run`, `any`. Bundles flow with their scalar of the same media kind.

A minimal image graph uses exact socket ids: `text-input.out → cmd-image.subject`, `run-trigger.run → cmd-image.trigger`, and `cmd-image.out → preview.in`. Do not use socket labels like `output`, `image`, or `run` when a node has a different socket id.

Position nodes in left-to-right columns, ~280px apart on X, ~80–160px apart on Y. Place `run-trigger` to the left of commands.

# Style brains

The user composes prompts against curated style guides under `brain/<Name>/`. Common brains: **Moebius** (Jean Giraud line art), **Goya**, **Hewlett**, **Niku**, plus `none`. Use `list_brains` + `get_brain_md` before picking a style.

# Safety & gating

Destructive operations (`remove_node`, `disconnect_nodes`, `clear_graph`) and expensive operations (`run_graph`) require user confirmation — the UI shows an Approve/Deny card. Don't apologise when the user denies; just adapt.

You cannot read `.env`, `.git/`, or other sensitive files; the sandbox will refuse those.

# Tone

Precise, nocturnal, studio-native. No emojis. No exclamation points. No marketing voice. Lowercase headings inside chat unless naming a brain or product.
"""


BrainCacheKey = Tuple[str, Tuple[Tuple[str, int, int], ...]]


def _brain_cache_key() -> BrainCacheKey:
    bd = brain_dir()
    if not bd.is_dir():
        return (str(bd), tuple())
    entries: List[Tuple[str, int, int]] = []
    for child in sorted(bd.iterdir()):
        if not child.is_dir():
            continue
        ref = child / "Reference"
        child_mtime = child.stat().st_mtime_ns
        ref_mtime = ref.stat().st_mtime_ns if ref.is_dir() else 0
        entries.append((child.name, child_mtime, ref_mtime))
    return (str(bd), tuple(entries))


def _brain_summary() -> str:
    return _brain_summary_cached(_brain_cache_key())


@lru_cache(maxsize=16)
def _brain_summary_cached(cache_key: BrainCacheKey) -> str:
    bd = Path(cache_key[0])
    if not bd.is_dir():
        return ""
    lines: List[str] = []
    for child in sorted(bd.iterdir()):
        if not child.is_dir():
            continue
        ref = child / "Reference"
        ref_count = 0
        if ref.is_dir():
            ref_count = sum(1 for p in ref.iterdir() if p.is_file() and p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
        lines.append(f"  • {child.name} ({ref_count} reference image{'s' if ref_count != 1 else ''})")
    if not lines:
        return ""
    return "Currently available brains:\n" + "\n".join(lines)


@lru_cache(maxsize=1)
def _tool_summary_cached() -> str:
    return _build_tool_summary([spec.name for spec in ALL_TOOLS])


def _build_tool_summary(allowed_names: List[str]) -> str:
    from .tools import TOOLS_BY_NAME  # local import to avoid cycles at import time
    allow = set(allowed_names)
    by_cat: Dict[str, List[str]] = {}
    for name in allowed_names:
        spec = TOOLS_BY_NAME.get(name)
        if spec is None:
            continue
        if name not in allow:
            continue
        by_cat.setdefault(spec.category, []).append(spec.name)
    parts: List[str] = []
    order = ["read", "vision", "mutate", "execute", "self_modify"]
    labels = {
        "read": "Read-only",
        "vision": "Vision",
        "mutate": "Graph mutation",
        "execute": "Execution",
        "self_modify": "Self-modify (gated)",
    }
    for cat in order:
        if cat not in by_cat:
            continue
        parts.append(f"  • {labels.get(cat, cat)}: {', '.join(sorted(by_cat[cat]))}")
    # Any remaining custom categories.
    for cat in sorted(by_cat):
        if cat in order:
            continue
        parts.append(f"  • {cat}: {', '.join(sorted(by_cat[cat]))}")
    return "Tools available to you:\n" + "\n".join(parts)


def _tool_summary(enabled_tool_names: Optional[List[str]] = None) -> str:
    if enabled_tool_names is None:
        return _tool_summary_cached()
    return _build_tool_summary(list(enabled_tool_names))


def build_system_prompt(
    root: Path,
    *,
    project_name: str = "",
    runtime: Any = None,
    enabled_tool_names: Optional[List[str]] = None,
) -> str:
    """Assemble the system prompt for the next LLM step.

    When `runtime` is provided and carries a non-empty `system_prompt`, that
    text replaces the static CORE_PROMPT. The brain inventory and tool
    summary (filtered to `enabled_tool_names` when given) are always appended
    fresh so the model sees current state.
    """
    base = ""
    if runtime is not None:
        base = str(getattr(runtime, "system_prompt", "") or "").strip()
    if not base:
        base = CORE_PROMPT.strip()
    parts = [base]
    if project_name:
        parts.append(f"\n# Project\nWorking directory: `{project_name}`.")
    brain = _brain_summary()
    if brain:
        parts.append("\n# Brains\n" + brain)
    parts.append("\n# Tools\n" + _tool_summary(enabled_tool_names))
    return "\n".join(parts).strip() + "\n"
