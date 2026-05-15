#!/usr/bin/env python3
"""
Optional-target Hugo deploy wrapper.

Runs `hugo deploy` for a specific target and classifies the result.
For optional targets (--required false): exits 0 even on failure,
  emits a GitHub Actions warning annotation so the failure is visible.
For required targets (--required true): exits non-zero on failure,
  emits a GitHub Actions error annotation.

Usage:
    python run_deploy_target.py \\
        --site websites.aspose.org \\
        --config ./configs/websites.aspose.org.toml \\
        --target staging \\
        --required false \\
        --environment staging \\
        [--invalidate-cdn] \\
        [--max-deletes -1]
"""

import argparse
import subprocess
import sys
from datetime import datetime, timezone

# Error patterns to classify S3/network failures.
# Keys are substrings found in hugo deploy stderr/stdout.
ERROR_PATTERNS = {
    "NoSuchBucket": "S3 bucket not found (NoSuchBucket) — bucket may have been deleted or never created",
    "NoSuchKey": "S3 object not found (NoSuchKey)",
    "AccessDenied": "Access denied to storage target — check IAM/ACL permissions",
    "InvalidAccessKeyId": "Invalid AWS access key ID — check ACCESS_KEY secret",
    "SignatureDoesNotMatch": "AWS signature mismatch — check SECRET_ACCESS secret",
    "RequestTimeout": "Request timed out connecting to storage",
    "connection refused": "Connection refused — endpoint may be unreachable",
    "no such host": "DNS resolution failed — endpoint hostname not found",
    "dial tcp": "Network connectivity failure",
    "TooManyRequests": "Rate limited by storage provider",
    "ServiceUnavailable": "Storage service temporarily unavailable",
    "InternalError": "Storage provider internal error",
}


def classify_error(output: str) -> str:
    """Return a human-readable error classification for the combined output."""
    for pattern, description in ERROR_PATTERNS.items():
        if pattern in output:
            return description
    return "Unknown error — review hugo deploy output above"


def emit_annotation(level: str, title: str, message: str) -> None:
    """Emit a GitHub Actions workflow annotation (::warning:: or ::error::)."""
    # GitHub requires these characters to be percent-encoded in annotation values
    safe_msg = (
        message
        .replace("%", "%25")
        .replace("\r", "%0D")
        .replace("\n", "%0A")
        .replace(":", "%3A")
        .replace(",", "%2C")
    )
    print(f"::{level} title={title}::{safe_msg}", flush=True)


def build_hugo_cmd(args: argparse.Namespace) -> list:
    """Construct the hugo deploy command from parsed arguments."""
    cmd = [
        "hugo", "deploy",
        "--config", args.config,
        f"--maxDeletes={args.max_deletes}",
        "--target", args.target,
        "--force",
    ]
    if args.invalidate_cdn:
        cmd.append("--invalidateCDN")
    return cmd


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Optional-target Hugo deploy wrapper with governed failure classification."
    )
    parser.add_argument("--site", required=True,
                        help="Site name, e.g. websites.aspose.org")
    parser.add_argument("--config", required=True,
                        help="Hugo config file path, e.g. ./configs/websites.aspose.org.toml")
    parser.add_argument("--target", required=True,
                        help="Hugo deploy target name, e.g. staging or production")
    parser.add_argument("--required", required=True, choices=["true", "false"],
                        help="Whether this target is required (true) or optional (false)")
    parser.add_argument("--environment", required=True,
                        help="Deploy environment label, e.g. staging or production")
    parser.add_argument("--invalidate-cdn", action="store_true",
                        help="Pass --invalidateCDN to hugo deploy")
    parser.add_argument("--max-deletes", type=int, default=-1,
                        help="Value for hugo deploy --maxDeletes (default: -1)")
    args = parser.parse_args()

    required = args.required.lower() == "true"
    target_kind_label = "required" if required else "optional"
    started_at = datetime.now(timezone.utc).isoformat()

    cmd = build_hugo_cmd(args)
    print(
        f"[deploy-wrapper] {args.site} -> target={args.target} "
        f"env={args.environment} kind={target_kind_label}",
        flush=True,
    )
    print(f"[deploy-wrapper] Running: {' '.join(cmd)}", flush=True)
    print("[deploy-wrapper] --- hugo output below ---", flush=True)

    # Run the command, capturing output while also streaming to console.
    result = subprocess.run(cmd, capture_output=True, text=True)
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    sys.stdout.flush()
    sys.stderr.flush()

    completed_at = datetime.now(timezone.utc).isoformat()
    exit_code = result.returncode
    combined_output = result.stdout + result.stderr

    print("[deploy-wrapper] --- hugo output above ---", flush=True)

    if exit_code == 0:
        print(
            f"[deploy-wrapper] SUCCESS: {args.site} {args.target} deployed "
            f"({started_at} -> {completed_at})",
            flush=True,
        )
        emit_annotation(
            "notice",
            f"Deploy {args.target} succeeded",
            f"{args.site} {args.environment} {args.target} deploy succeeded.",
        )
        sys.exit(0)

    # Failure path
    error_class = classify_error(combined_output)
    print(
        f"[deploy-wrapper] FAILED (exit {exit_code}): {args.site} {args.target} — {error_class}",
        flush=True,
    )

    if required:
        emit_annotation(
            "error",
            f"Required deploy target failed: {args.site} {args.target}",
            f"REQUIRED target {args.target} for {args.site} ({args.environment}) failed "
            f"with exit code {exit_code}. Error class: {error_class}. "
            f"This is a hard failure — Ceph production deploy cannot proceed.",
        )
        sys.exit(exit_code if exit_code != 0 else 1)
    else:
        emit_annotation(
            "warning",
            f"Optional S3 target unavailable: {args.site} {args.target}",
            f"OPTIONAL target {args.target} for {args.site} ({args.environment}) failed "
            f"with exit code {exit_code}. Error class: {error_class}. "
            f"S3 is optional — Ceph production is the required deployment target. "
            f"Continuing deployment pipeline.",
        )
        print(
            "[deploy-wrapper] Optional target failed — exiting 0 to allow pipeline to continue.",
            flush=True,
        )
        sys.exit(0)


if __name__ == "__main__":
    main()
