import os
import sys
import requests
from pathlib import Path
from typing import Union


def load_prompt() -> str:

    path = Path(__file__).parent / "fractal_prompt.md"
    with open(path, encoding="utf-8") as f:
        return f.read().strip()


def fractal(prompt: str, iterations: Union[int, str] = 1) -> str:









    if not prompt or not isinstance(prompt, str):
        return ""


    if isinstance(iterations, str):
        try:
            iterations = int(iterations.strip())
        except (ValueError, TypeError):
            iterations = 1
    iterations = max(1, int(iterations or 1))

    api_key = os.environ.get("MODEL_API_KEY")
    if not api_key:
        print("[fractal] MODEL_API_KEY is not set", file=sys.stderr)
        return ""
    model = os.environ.get("MODEL_NAME", "default")
    base_url = os.environ.get("BASE_URL", "http://localhost:8000/v1").rstrip("/")

    system_prompt = load_prompt()

    base_prompt = prompt.rstrip(". ").rstrip(",")
    all_additions: list[str] = []
    for it in range(1, iterations + 1):
        try:
            already = ", ".join(all_additions) if all_additions else "(none)"
            user_content = (
                f"Base prompt: {base_prompt}\n"
                f"Already-added details — do NOT repeat, extend, or elaborate on any of these; pick a completely DIFFERENT aspect of the base prompt: {already}\n"
                f"Return your single new addition only (iteration {it}/{iterations})."
            )
            resp = requests.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 1500,
                },
                timeout=45,
            )
            resp.raise_for_status()
            data = resp.json()
            addition = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()

            if addition and len(addition) > 5:

                addition = addition.lstrip(", ")
                all_additions.append(addition)
            else:
                break
        except Exception as e:
            print(f"[fractal] Error calling model API (iter {it}): {type(e).__name__}: {e}", file=sys.stderr)
            break
    return (" , " + ", ".join(all_additions)) if all_additions else ""


if __name__ == "__main__":
    if len(sys.argv) > 1:

        args = sys.argv[1:]
        if len(args) > 1 and args[-1].isdigit():
            iters = int(args[-1])
            prompt_arg = " ".join(args[:-1])
        else:
            iters = 1
            prompt_arg = " ".join(args)
        additions = fractal(prompt_arg, iters)
        print(additions)
    else:

        demo = "a woman in red dress standing in forest at dusk"
        print("=== DEMO (additions only) ===")
        print("Base:", demo)
        print("Adds (1 iter):", fractal(demo, 1))
        print("Adds (3 iters):", fractal(demo, 3))
        print("\nUsage: python3 def/fractal.py \"your base prompt here\" [iterations]")
        print("(output is additive text only; use @fractal:prompt:5 in configs)")
