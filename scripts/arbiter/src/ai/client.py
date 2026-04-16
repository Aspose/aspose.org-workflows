"""OpenAI-compatible LLM client for AI evaluation."""
from __future__ import annotations

import json
import logging
from typing import Any

from openai import OpenAI

_LOG = logging.getLogger(__name__)


class AIClient:
    """Thin wrapper around the OpenAI client for GPT-OSS / LiteLLM."""

    def __init__(self, endpoint: str, api_key: str, model: str = "gpt-4o-mini",
                 timeout: int = 120):
        self.model = model
        self.timeout = timeout
        self._client = OpenAI(
            base_url=endpoint,
            api_key=api_key,
            timeout=timeout,
        )

    def evaluate(self, system_prompt: str, user_content: str) -> dict[str, Any]:
        """Send content for evaluation, return parsed JSON response."""
        try:
            response = self._client.chat.completions.create(
                model=self.model,
                temperature=0.2,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_content},
                ],
            )
            raw = response.choices[0].message.content.strip()
            # Strip markdown fences if present
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
                if raw.endswith("```"):
                    raw = raw[:-3].strip()
            result = json.loads(raw)
            _LOG.info("AI evaluation score: %s", result.get("score", "N/A"))
            return result
        except json.JSONDecodeError as exc:
            _LOG.error("AI returned invalid JSON: %s", exc)
            return self._fallback_response("Invalid JSON response from AI")
        except Exception as exc:
            _LOG.error("AI evaluation failed: %s", exc)
            return self._fallback_response(str(exc))

    @staticmethod
    def _fallback_response(reason: str) -> dict[str, Any]:
        """Return a zero-score fallback when AI evaluation fails."""
        return {
            "score": 0,
            "technical_accuracy": 0,
            "clarity": 0,
            "seo_quality": 0,
            "actionability": 0,
            "uniqueness": 0,
            "summary": f"AI evaluation failed: {reason}",
            "strengths": [],
            "issues": [f"AI evaluation unavailable: {reason}"],
            "recommendation": "REQUEST_CHANGES",
        }
