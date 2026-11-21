"""
Fire-and-forget workflow trigger.

Reads the deploy manifest, triggers all workflows (staging for staged,
production for production-only), records timestamps, and sets state to 'staging'.

Usage:
    python trigger_workflows.py --manifest <path> [--dry-run]
"""

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone


_SHA_RE = re.compile(r"[0-9a-f]{40}")


def trigger_workflow(workflow_filename, environment, ref, dry_run=False):
    """
    Trigger a site workflow via gh CLI, pinned to the content commit `ref`
    (the manifest's content_sha, passed as the workflow's `ref` input, not gh --ref).
    Staging is pinned too so that what staging builds is exactly what production
    later builds. Returns trigger timestamp.
    """
    trigger_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if dry_run:
        print(f"  [DRY-RUN] Would trigger {workflow_filename} -> {environment} @ {ref} at {trigger_time}")
        return trigger_time
    result = subprocess.run(
        ["gh", "workflow", "run", workflow_filename,
         "--field", f"environment={environment}",
         "--field", f"ref={ref}"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"FATAL: Failed to trigger {workflow_filename}: {result.stderr}")
        sys.exit(1)
    print(f"  Triggered {workflow_filename} -> {environment} @ {ref} at {trigger_time}")
    time.sleep(5)  # Rate limiting between triggers
    return trigger_time


def main():
    if "--manifest" not in sys.argv:
        print("Usage: python trigger_workflows.py --manifest <path> [--dry-run]")
        sys.exit(1)

    manifest_path = sys.argv[sys.argv.index("--manifest") + 1]
    dry_run = "--dry-run" in sys.argv

    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)

    if manifest["state"] != "pending":
        print(f"Manifest state is '{manifest['state']}', expected 'pending'. Aborting.")
        sys.exit(1)

    staged = manifest.get("staged_workflows", [])
    prod_only = manifest.get("production_only_workflows", [])

    # Validate the pin before triggering anything (no partial fan-out on a bad manifest).
    content_sha = manifest.get("content_sha")
    if not (isinstance(content_sha, str) and _SHA_RE.fullmatch(content_sha)):
        print(f"FATAL: manifest content_sha is not a full commit SHA ({content_sha!r}). Aborting.")
        sys.exit(1)

    total = len(staged) + len(prod_only)
    print(f"Triggering {total} workflow(s): {len(staged)} staged, {len(prod_only)} production-only")

    # Trigger staged workflows to staging environment
    for entry in staged:
        entry["staging_trigger_time"] = trigger_workflow(entry["workflow"], "staging", content_sha, dry_run)
        entry["staging_status"] = "triggered"

    # Trigger production-only workflows directly to production
    for entry in prod_only:
        entry["production_trigger_time"] = trigger_workflow(entry["workflow"], "production", content_sha, dry_run)
        entry["production_status"] = "triggered"

    manifest["state"] = "staging"

    if not dry_run:
        with open(manifest_path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)

        # Signal to the workflow that manifest was updated
        output_file = os.environ.get("GITHUB_OUTPUT")
        if output_file:
            with open(output_file, "a") as f:
                f.write("manifest_changed=true\n")
    else:
        print(f"\n[DRY-RUN] Would update manifest state to 'staging'")

    print(f"\nAll {total} workflows triggered. State set to 'staging'.")


if __name__ == "__main__":
    main()
