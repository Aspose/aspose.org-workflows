"""Score-to-decision mapping and review comment builder."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from .checklist import CheckResult

_LOG = logging.getLogger(__name__)


@dataclass
class ReviewDecision:
    """Final review decision for a PR."""
    decision: str   # APPROVE, REQUEST_CHANGES, REJECT
    event: str      # GitHub review event: APPROVE or REQUEST_CHANGES
    score: int
    comment: str
    file_results: list[dict[str, Any]] = field(default_factory=list)


def make_decision(score: int, thresholds: dict[str, int]) -> tuple[str, str]:
    """Map composite score to decision and GitHub event."""
    approve = thresholds.get("approve", 80)
    request_changes = thresholds.get("request_changes", 50)

    if score >= approve:
        return "APPROVE", "APPROVE"
    elif score >= request_changes:
        return "REQUEST_CHANGES", "REQUEST_CHANGES"
    else:
        return "REJECT", "REQUEST_CHANGES"  # GitHub doesn't support REJECT event


def build_review_comment(
    pr_title: str,
    file_results: list[dict[str, Any]],
    composite_score: int,
    decision: str,
    ai_results: list[dict[str, Any]] | None = None,
) -> str:
    """Generate a Markdown review body."""
    lines = [
        f"## SEO PR Arbiter Review",
        "",
        f"**PR:** {pr_title}",
        f"**Score:** {composite_score}/100",
        f"**Decision:** {decision}",
        "",
    ]

    # Per-file results
    for fr in file_results:
        filename = fr["filename"]
        static_score = fr["static_score"]
        checks = fr["checks"]

        lines.append(f"### `{filename}`")
        lines.append(f"Static score: {static_score}/80")
        lines.append("")
        lines.append("| Check | Weight | Result | Detail |")
        lines.append("|-------|--------|--------|--------|")

        for c in checks:
            icon = "PASS" if c["passed"] else "FAIL"
            req = " (required)" if c["type"] == "required" else ""
            lines.append(
                f"| {c['description']}{req} | {c['weight']} | {icon} | {c['detail'][:60]} |"
            )
        lines.append("")

    # AI evaluation summary
    if ai_results:
        lines.append("### AI Evaluation")
        lines.append("")
        for ai in ai_results:
            filename = ai.get("filename", "")
            score = ai.get("score", 0)
            summary = ai.get("summary", "")
            lines.append(f"**{filename}:** {score}/100 — {summary}")

            strengths = ai.get("strengths", [])
            if strengths:
                lines.append(f"  Strengths: {', '.join(strengths)}")

            issues = ai.get("issues", [])
            if issues:
                lines.append(f"  Issues: {', '.join(issues)}")
            lines.append("")

    lines.append("---")
    lines.append("*Posted by SEO PR Arbiter*")

    return "\n".join(lines)
