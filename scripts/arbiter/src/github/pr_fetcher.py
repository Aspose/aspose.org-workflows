"""PR fetching and file extraction."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from github.PullRequest import PullRequest
from github.Repository import Repository

_LOG = logging.getLogger(__name__)


@dataclass
class PRFile:
    """A changed file in a PR."""
    filename: str
    status: str
    patch: str = ""
    content: str = ""


@dataclass
class PRContext:
    """All information needed to review a PR."""
    repo_url: str
    pr_number: int
    title: str
    updated_at: str
    head_sha: str
    files: list[PRFile] = field(default_factory=list)


def fetch_open_prs(repo: Repository, branch_prefix: str) -> list[PullRequest]:
    """Get open PRs matching a branch prefix."""
    prs = []
    for pr in repo.get_pulls(state="open", sort="updated", direction="desc"):
        if pr.head.ref.startswith(branch_prefix):
            prs.append(pr)
            _LOG.info("Found PR #%d: %s (branch: %s)", pr.number, pr.title, pr.head.ref)
    return prs


def get_pr_files(pr: PullRequest) -> list[dict[str, Any]]:
    """Get list of changed files with patches."""
    files = []
    for f in pr.get_files():
        files.append({
            "filename": f.filename,
            "status": f.status,
            "patch": f.patch or "",
            "sha": f.sha,
        })
    return files


def get_english_markdown_files(files: list[dict[str, Any]],
                                path_contains: str | None = None) -> list[dict[str, Any]]:
    """Filter to .md files, optionally matching a path substring."""
    result = []
    for f in files:
        name = f["filename"]
        if not name.endswith(".md"):
            continue
        # Skip non-English content (e.g., /zh/, /ja/, /de/ directories)
        parts = name.split("/")
        has_lang_dir = any(len(p) == 2 and p.isalpha() and p != "en" for p in parts)
        if has_lang_dir:
            continue
        if path_contains and path_contains not in name:
            continue
        result.append(f)
    return result


def get_file_content(repo: Repository, path: str, ref: str) -> str:
    """Fetch file content at a specific commit SHA."""
    try:
        content = repo.get_contents(path, ref=ref)
        if isinstance(content, list):
            _LOG.warning("Path %s returned a directory, not a file", path)
            return ""
        return content.decoded_content.decode("utf-8")
    except Exception as exc:
        _LOG.error("Failed to fetch %s at %s: %s", path, ref, exc)
        return ""


def build_pr_context(repo: Repository, pr: PullRequest,
                     path_contains: str | None = None) -> PRContext:
    """Build a complete PRContext for review."""
    all_files = get_pr_files(pr)
    md_files = get_english_markdown_files(all_files, path_contains)

    pr_files = []
    for f in md_files:
        content = get_file_content(repo, f["filename"], pr.head.sha)
        pr_files.append(PRFile(
            filename=f["filename"],
            status=f["status"],
            patch=f["patch"],
            content=content,
        ))

    _LOG.info("PR #%d: %d total files, %d markdown files to review",
              pr.number, len(all_files), len(pr_files))

    return PRContext(
        repo_url=repo.html_url,
        pr_number=pr.number,
        title=pr.title,
        updated_at=pr.updated_at.isoformat() if pr.updated_at else "",
        head_sha=pr.head.sha,
        files=pr_files,
    )
