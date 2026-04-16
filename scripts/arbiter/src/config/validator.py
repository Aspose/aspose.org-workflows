"""Config validation."""
from __future__ import annotations

import logging
from typing import Any

_LOG = logging.getLogger(__name__)


class ConfigError(Exception):
    """Raised when config validation fails."""


def validate_config(cfg: dict[str, Any]) -> None:
    """Validate required config fields. Raises ConfigError on failure."""
    token = cfg.get("github", {}).get("token", "")
    if not token or token.startswith("${"):
        raise ConfigError(
            "Config validation failed: GitHub token appears to be a placeholder. "
            "Set the GITHUB_TOKEN environment variable."
        )

    gpt = cfg.get("gpt_oss", {})
    endpoint = gpt.get("endpoint", "")
    api_key = gpt.get("api_key", "")
    if not endpoint or endpoint.startswith("${"):
        _LOG.warning("GPT-OSS endpoint not configured — AI evaluation will be skipped")
    if not api_key or api_key.startswith("${"):
        _LOG.warning("GPT-OSS API key not configured — AI evaluation will be skipped")

    review = cfg.get("review", {})
    if "score_thresholds" not in review:
        raise ConfigError("Missing review.score_thresholds in config")

    thresholds = review["score_thresholds"]
    if "approve" not in thresholds or "request_changes" not in thresholds:
        raise ConfigError("Missing approve/request_changes in score_thresholds")

    products = cfg.get("products", {})
    if not products:
        raise ConfigError("No products defined in config")

    for name, product in products.items():
        if "content_repo" not in product:
            raise ConfigError(f"Product '{name}' missing content_repo")
