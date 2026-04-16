"""TinyDB-based review state persistence."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from tinydb import TinyDB, Query

_LOG = logging.getLogger(__name__)


class StateRepository:
    """Persists review history to avoid duplicate reviews."""

    def __init__(self, db_path: str = "data/state.json"):
        path = Path(db_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = TinyDB(str(path))
        self._reviews = self._db.table("reviews")

    def is_reviewed(self, repo_url: str, pr_number: int) -> bool:
        """Check if a PR has already been reviewed."""
        Review = Query()
        result = self._reviews.search(
            (Review.repo_url == repo_url) & (Review.pr_number == pr_number)
        )
        return len(result) > 0

    def record_review(self, repo_url: str, pr_number: int, product: str,
                      decision: str, score: int, pr_updated_at: str) -> None:
        """Upsert a review record."""
        Review = Query()
        record = {
            "repo_url": repo_url,
            "pr_number": pr_number,
            "product": product,
            "decision": decision,
            "score": score,
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
            "pr_updated_at": pr_updated_at,
        }
        existing = self._reviews.search(
            (Review.repo_url == repo_url) & (Review.pr_number == pr_number)
        )
        if existing:
            self._reviews.update(record,
                                 (Review.repo_url == repo_url) & (Review.pr_number == pr_number))
            _LOG.info("Updated review record for PR #%d", pr_number)
        else:
            self._reviews.insert(record)
            _LOG.info("Inserted review record for PR #%d", pr_number)

    def close(self) -> None:
        self._db.close()
