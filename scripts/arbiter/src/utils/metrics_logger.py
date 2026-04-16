"""Metrics reporter for Google Apps Script dashboard."""
from __future__ import annotations

import json
import logging
import time
from typing import Any

import requests

_LOG = logging.getLogger(__name__)


class MetricsLogger:
    """Posts run metrics to the shared dashboard endpoint."""

    def __init__(self, config: dict[str, Any]):
        self.enabled = config.get("enabled", False)
        self.endpoint = config.get("endpoint", "")
        self.token = config.get("token", "")
        self.agent_name = config.get("agent_name", "SEO PR Arbiter")
        self.agent_owner = config.get("agent_owner", "")
        self.job_type = config.get("job_type", "pr_review")
        self.item_name = config.get("item_name", "Pull Requests")
        self.website_section = config.get("website_section", "SEO")
        self._start_time = time.time()
        self._token_usage = 0
        self._api_calls = 0

    def record_api_call(self, tokens: int = 0) -> None:
        self._api_calls += 1
        self._token_usage += tokens

    def report(self, product: str, status: str,
               items_discovered: int, items_succeeded: int,
               items_failed: int) -> None:
        """Post metrics to the dashboard. Fails silently."""
        if not self.enabled or not self.endpoint:
            _LOG.debug("Metrics reporting disabled or no endpoint configured")
            return

        elapsed_ms = int((time.time() - self._start_time) * 1000)
        payload = {
            "token": self.token,
            "agent_name": self.agent_name,
            "agent_owner": self.agent_owner,
            "job_type": self.job_type,
            "product": product,
            "platform": "All",
            "status": status,
            "items_discovered": items_discovered,
            "items_succeeded": items_succeeded,
            "items_failed": items_failed,
            "run_duration_ms": elapsed_ms,
            "token_usage": self._token_usage,
            "api_calls_count": self._api_calls,
            "item_name": self.item_name,
            "website_section": self.website_section,
        }

        try:
            resp = requests.post(
                self.endpoint,
                json=payload,
                timeout=15,
                headers={"Content-Type": "application/json"},
            )
            _LOG.info("Metrics posted: %s (HTTP %d)", status, resp.status_code)
        except Exception as exc:
            _LOG.warning("Failed to post metrics: %s", exc)
