"""Logging setup."""
from __future__ import annotations

import logging
import sys
from datetime import datetime
from pathlib import Path


def setup_logger(level: str = "INFO", log_dir: str = "logs") -> logging.Logger:
    """Configure root logger with console and optional file handler."""
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    # Console handler
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)-8s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    ))
    root.addHandler(console)

    # File handler (best-effort)
    try:
        log_path = Path(log_dir)
        log_path.mkdir(parents=True, exist_ok=True)
        today = datetime.now().strftime("%Y-%m-%d")
        fh = logging.FileHandler(log_path / f"arbiter-{today}.log", encoding="utf-8")
        fh.setFormatter(logging.Formatter(
            "%(asctime)s %(levelname)-8s %(name)s: %(message)s",
        ))
        root.addHandler(fh)
    except OSError:
        root.warning("Could not create log file — logging to console only")

    return root
