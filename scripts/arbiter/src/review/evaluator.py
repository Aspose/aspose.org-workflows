"""AI evaluation orchestrator."""
from __future__ import annotations

import logging
from typing import Any

from ..ai.client import AIClient
from ..config.loader import load_prompt

_LOG = logging.getLogger(__name__)

MAX_CONTENT_CHARS = 4000


def evaluate_content(ai_client: AIClient | None, prompt_path: str,
                     content: str) -> dict[str, Any]:
    """Run AI evaluation on file content.

    Returns the AI response dict with score and breakdown.
    If AI is unavailable, returns a zero-score fallback.
    """
    if ai_client is None:
        _LOG.info("AI evaluation skipped — no client configured")
        return _zero_response("AI evaluation disabled")

    truncated = content[:MAX_CONTENT_CHARS]
    try:
        prompt_template = load_prompt(prompt_path)
    except FileNotFoundError:
        _LOG.error("Prompt template not found: %s", prompt_path)
        return _zero_response("Prompt template missing")

    system_prompt = prompt_template.replace("{content}", truncated)

    result = ai_client.evaluate(
        system_prompt="You are an expert SEO metadata reviewer.",
        user_content=system_prompt,
    )
    return result


def scale_ai_score(raw_score: int, weight: int = 20) -> int:
    """Scale raw AI score (0-100) by weight."""
    return round((raw_score / 100) * weight)


def _zero_response(reason: str) -> dict[str, Any]:
    return {
        "score": 0,
        "summary": reason,
        "strengths": [],
        "issues": [],
        "recommendation": "REQUEST_CHANGES",
    }
