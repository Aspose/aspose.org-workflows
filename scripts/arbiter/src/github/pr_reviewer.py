"""PR review posting and label management."""
from __future__ import annotations

import logging

from github.GithubException import GithubException
from github.PullRequest import PullRequest

_LOG = logging.getLogger(__name__)


def post_review(pr: PullRequest, body: str, event: str) -> bool:
    """Submit a GitHub review on the PR.

    event: APPROVE, REQUEST_CHANGES, or COMMENT
    Returns True if review was posted successfully.
    """
    try:
        pr.create_review(body=body, event=event)
        _LOG.info("Posted %s review on PR #%d", event, pr.number)
        return True
    except GithubException as exc:
        if exc.status == 422:
            # Bot is PR author — fall back to issue comment
            _LOG.warning("Cannot post review (422) — falling back to comment on PR #%d",
                         pr.number)
            try:
                pr.create_issue_comment(f"**SEO PR Arbiter Review** ({event})\n\n{body}")
                return True
            except Exception as inner:
                _LOG.error("Fallback comment also failed: %s", inner)
                return False
        _LOG.error("Failed to post review on PR #%d: %s", pr.number, exc)
        return False


def add_labels(pr: PullRequest, labels: list[str]) -> None:
    """Add labels to a PR. Creates labels if they don't exist."""
    if not labels:
        return
    try:
        pr.add_to_labels(*labels)
        _LOG.info("Added labels %s to PR #%d", labels, pr.number)
    except Exception as exc:
        _LOG.warning("Failed to add labels to PR #%d: %s", pr.number, exc)


def merge_pr(pr: PullRequest, merge_method: str = "squash") -> bool:
    """Squash-merge the PR. Returns True if successful."""
    try:
        pr.merge(merge_method=merge_method)
        _LOG.info("Merged PR #%d via %s", pr.number, merge_method)
        return True
    except Exception as exc:
        _LOG.error("Failed to merge PR #%d: %s", pr.number, exc)
        return False
