"""SEO PR Arbiter — Entry point and orchestrator."""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path
from typing import Any

from .ai.client import AIClient
from .config.loader import load_config, load_yaml
from .config.validator import validate_config, ConfigError
from .github.client import GitHubClient
from .github.pr_fetcher import fetch_open_prs, build_pr_context
from .github.pr_reviewer import post_review, add_labels, merge_pr
from .review.checklist import load_checklist, run_checks, compute_static_score
from .review.decision import make_decision, build_review_comment
from .review.evaluator import evaluate_content, scale_ai_score
from .state.repository import StateRepository
from .utils.logger import setup_logger
from .utils.metrics_logger import MetricsLogger

_LOG = logging.getLogger(__name__)


class PRArbitrAgent:
    """Orchestrates the PR review pipeline."""

    def __init__(self, config_path: str = "config/config.yaml"):
        self.cfg = load_config(config_path)
        validate_config(self.cfg)

        self.gh_client = GitHubClient(self.cfg["github"]["token"])
        self.state = StateRepository()
        self.metrics = MetricsLogger(self.cfg.get("metrics", {}))

        # Load checklist
        checklist_path = self.cfg["review"]["checklist_path"]
        self.checklist = load_checklist(checklist_path)
        self.ai_config = self.checklist.get("ai_evaluation", {})

        # Initialize AI client if configured
        self.ai_client = self._init_ai_client()

        # Prompt path
        self.prompt_path = self.cfg.get("prompts", {}).get("review_pr", "config/prompts/review.txt")

    def _init_ai_client(self) -> AIClient | None:
        """Initialize AI client if endpoint and key are configured."""
        if not self.ai_config.get("enabled", False):
            _LOG.info("AI evaluation disabled in checklist config")
            return None

        gpt = self.cfg.get("gpt_oss", {})
        endpoint = gpt.get("endpoint", "")
        api_key = gpt.get("api_key", "")

        if not endpoint or not api_key:
            _LOG.warning("GPT-OSS endpoint/key not configured — AI evaluation disabled")
            return None

        return AIClient(
            endpoint=endpoint,
            api_key=api_key,
            model=gpt.get("model", "gpt-4o-mini"),
            timeout=gpt.get("timeout", 120),
        )

    def run(self, product_key: str | None = None, max_prs: int | None = None) -> None:
        """Run the review pipeline."""
        products = self.cfg.get("products", {})

        if product_key:
            if product_key not in products:
                _LOG.error("Unknown product: %s", product_key)
                sys.exit(1)
            products = {product_key: products[product_key]}

        total_discovered = 0
        total_succeeded = 0
        total_failed = 0

        for name, product in products.items():
            _LOG.info("=== Processing product: %s ===", name)
            try:
                d, s, f = self._review_product(name, product, max_prs)
                total_discovered += d
                total_succeeded += s
                total_failed += f
            except Exception as exc:
                _LOG.error("Product %s failed: %s", name, exc, exc_info=True)
                total_failed += 1

        # Report metrics
        status = "success" if total_failed == 0 else (
            "partial_success" if total_succeeded > 0 else "failure"
        )
        self.metrics.report(
            product=product_key or "all",
            status=status,
            items_discovered=total_discovered,
            items_succeeded=total_succeeded,
            items_failed=total_failed,
        )

        self.state.close()
        self.gh_client.close()

        _LOG.info("Done. Discovered: %d, Succeeded: %d, Failed: %d",
                   total_discovered, total_succeeded, total_failed)

    def _review_product(self, name: str, product: dict[str, Any],
                        max_prs: int | None) -> tuple[int, int, int]:
        """Review PRs for a single product. Returns (discovered, succeeded, failed)."""
        repo_url = product["content_repo"]
        # Extract owner/repo from URL
        repo_full_name = repo_url.rstrip("/").split("github.com/")[-1]

        repo = self.gh_client.get_repo(repo_full_name)
        branch_prefix = self.cfg["review"].get("pr_branch_prefix", "seo/")
        prs = fetch_open_prs(repo, branch_prefix)

        discovered = len(prs)
        succeeded = 0
        failed = 0

        if not prs:
            _LOG.info("No open PRs found matching prefix '%s'", branch_prefix)
            return 0, 0, 0

        reviewed_count = 0
        for pr in prs:
            if max_prs and reviewed_count >= max_prs:
                _LOG.info("Reached max PRs limit (%d)", max_prs)
                break

            # Skip if already reviewed
            if self.state.is_reviewed(repo.html_url, pr.number):
                _LOG.info("PR #%d already reviewed — skipping", pr.number)
                continue

            try:
                self._review_single_pr(repo, pr, name)
                succeeded += 1
            except Exception as exc:
                _LOG.error("Failed to review PR #%d: %s", pr.number, exc, exc_info=True)
                failed += 1

            reviewed_count += 1

        return discovered, succeeded, failed

    def _review_single_pr(self, repo: Any, pr: Any, product_name: str) -> None:
        """Review a single PR end-to-end."""
        _LOG.info("Reviewing PR #%d: %s", pr.number, pr.title)

        path_contains = self.cfg["review"].get("file_filter", {}).get("path_contains")
        ctx = build_pr_context(repo, pr, path_contains)

        if not ctx.files:
            _LOG.warning("PR #%d has no reviewable markdown files", pr.number)
            return

        thresholds = self.cfg["review"]["score_thresholds"]
        ai_weight = self.ai_config.get("weight", 20)
        all_file_results = []
        all_ai_results = []
        total_static = 0
        total_ai = 0
        file_count = 0

        for pf in ctx.files:
            _LOG.info("Checking file: %s", pf.filename)

            # Static checks
            check_results = run_checks(
                pf.content, self.checklist,
                context={"patch": pf.patch}
            )
            static_score = compute_static_score(check_results)

            file_result = {
                "filename": pf.filename,
                "static_score": static_score,
                "checks": [
                    {
                        "id": cr.id,
                        "description": cr.description,
                        "weight": cr.weight,
                        "type": cr.check_type,
                        "passed": cr.passed,
                        "detail": cr.detail,
                    }
                    for cr in check_results
                ],
            }
            all_file_results.append(file_result)

            # AI evaluation
            if self.ai_client and self.ai_config.get("enabled", False):
                ai_result = evaluate_content(
                    self.ai_client, self.prompt_path, pf.content
                )
                ai_result["filename"] = pf.filename
                all_ai_results.append(ai_result)
                self.metrics.record_api_call()
                total_ai += scale_ai_score(ai_result.get("score", 0), ai_weight)
            file_count += 1
            total_static += static_score

        # Average scores across files
        if file_count > 0:
            avg_static = round(total_static / file_count)
            avg_ai = round(total_ai / file_count) if all_ai_results else 0
        else:
            avg_static = 0
            avg_ai = 0

        composite = min(100, avg_static + avg_ai)
        decision, event = make_decision(composite, thresholds)

        _LOG.info("PR #%d score: %d (static=%d, ai=%d) → %s",
                   pr.number, composite, avg_static, avg_ai, decision)

        # Build and post review
        comment = build_review_comment(
            pr_title=pr.title,
            file_results=all_file_results,
            composite_score=composite,
            decision=decision,
            ai_results=all_ai_results if all_ai_results else None,
        )

        if self.cfg["review"].get("post_review_comment", True):
            post_review(pr, comment, event)

        # Add labels based on decision
        labels = []
        if decision == "APPROVE":
            labels.append("arbiter:approved")
        elif decision == "REQUEST_CHANGES":
            labels.append("arbiter:changes-requested")
        else:
            labels.append("arbiter:rejected")

        pr_labels = self.cfg["review"].get("pr_labels", [])
        labels.extend(pr_labels)
        add_labels(pr, labels)

        # Auto-merge if enabled and approved
        if decision == "APPROVE" and self.cfg["review"].get("auto_merge", False):
            merge_pr(pr)

        # Record in state
        self.state.record_review(
            repo_url=repo.html_url,
            pr_number=pr.number,
            product=product_name,
            decision=decision,
            score=composite,
            pr_updated_at=ctx.updated_at,
        )


def main() -> None:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="SEO PR Arbiter")
    parser.add_argument("-c", "--config", default="config/config.yaml",
                        help="Path to config file")
    parser.add_argument("-p", "--product", default=None,
                        help="Single product key to review")
    parser.add_argument("-n", "--max-prs", type=int, default=None,
                        help="Max PRs to review per run")
    args = parser.parse_args()

    setup_logger()

    try:
        agent = PRArbitrAgent(config_path=args.config)
        agent.run(product_key=args.product, max_prs=args.max_prs)
    except ConfigError as exc:
        _LOG.error("Configuration error: %s", exc)
        sys.exit(1)
    except Exception as exc:
        _LOG.error("Fatal error: %s", exc, exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
