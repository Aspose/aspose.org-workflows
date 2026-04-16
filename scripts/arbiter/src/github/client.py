"""PyGithub wrapper."""
from __future__ import annotations

import logging

from github import Github
from github.Repository import Repository

_LOG = logging.getLogger(__name__)


class GitHubClient:
    """Authenticated GitHub API client."""

    def __init__(self, token: str):
        if not token:
            raise ValueError("GitHub token is required")
        self._gh = Github(token)

    def get_repo(self, full_name: str) -> Repository:
        """Get a repository by owner/name."""
        _LOG.debug("Fetching repo: %s", full_name)
        return self._gh.get_repo(full_name)

    def close(self) -> None:
        self._gh.close()
