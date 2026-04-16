"""Config loader with environment variable substitution."""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

import yaml


_ENV_PATTERN = re.compile(r"\$\{(\w+)\}")


def _substitute_env(value: Any) -> Any:
    """Recursively replace ${VAR} patterns with os.getenv(VAR)."""
    if isinstance(value, str):
        def _replacer(match: re.Match) -> str:
            var = match.group(1)
            return os.getenv(var, "")
        return _ENV_PATTERN.sub(_replacer, value)
    if isinstance(value, dict):
        return {k: _substitute_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_substitute_env(v) for v in value]
    return value


def load_config(config_path: str | Path = "config/config.yaml") -> dict:
    """Load YAML config and resolve environment variables."""
    path = Path(config_path)
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    return _substitute_env(raw)


def load_yaml(path: str | Path) -> dict:
    """Load any YAML file without env substitution."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"YAML file not found: {p}")
    with open(p, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def load_prompt(path: str | Path) -> str:
    """Load a prompt template file as text."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Prompt file not found: {p}")
    return p.read_text(encoding="utf-8")
