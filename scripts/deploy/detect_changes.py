"""
Detect content changes in the Aspose/aspose.org repo and map them to workflow filenames.

Usage:
    python detect_changes.py <content_repo_path> <last_scanned_sha> [--manifest <path>] [--dry-run]

If last_scanned_sha is empty, all deploy workflows are returned (initial run).

Outputs (written to GITHUB_OUTPUT if available):
    workflows     - JSON array of workflow filenames to trigger
    has_changes   - "true" or "false"
    new_sha       - HEAD SHA of the content repo
    global_change - "true" or "false"

If --manifest is provided, writes a deploy_manifest.json at the given path.
If --dry-run is provided, prints what would be written without writing files.
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timezone

# Import shared config
sys.path.append( os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from config import DOMAIN, SUBDOMAINS

# --- Mapping Configuration ---

# All aspose.org sites use whole-site workflows (no per-family workflows).
SITES = [f"{sub}" for sub in SUBDOMAINS]

# Paths outside content/ that affect all sites (theme, layout, static assets)
GLOBAL_PATHS = ["themes/", "layouts/", "archetypes/", "static/", "i18n/"]


def get_all_deploy_workflows():
    """Return the full list of every deploy workflow filename."""
    return {f"{site}.yml" for site in SITES}


def map_path_to_workflow(path):
    """
    Map a single changed file path to zero or more workflow filenames.
    Returns (set_of_workflows, is_global_change).
    """
    workflows = set()
    parts = path.replace("\\", "/").split("/")

    # Check for global paths (themes, layouts, etc.)
    for gp in GLOBAL_PATHS:
        if path.startswith(gp):
            return get_all_deploy_workflows(), True

    # content/<site>/... -> <site>.yml
    if len(parts) >= 2 and parts[0] == "content":
        site = parts[1]
        if site in SITES:
            workflows.add(f"{site}.yml")

    # configs/<site>.toml or configs/<site>.yml -> <site>.yml
    if len(parts) == 2 and parts[0] == "configs":
        config_file = parts[1]
        site = config_file.rsplit(".", 1)[0]  # strip extension
        if site in SITES:
            workflows.add(f"{site}.yml")

    return workflows, False


def get_changed_files(repo_path, last_sha):
    """Get list of changed files between last_sha and HEAD."""
    if not last_sha:
        # First run: return empty to trigger all workflows
        return None

    result = subprocess.run(
        ["git", "diff", "--name-only", f"{last_sha}..HEAD"],
        cwd=repo_path,
        capture_output=True,
        text=True,
    )

    if result.returncode != 0:
        print(f"ERROR: git diff failed: {result.stderr}", file=sys.stderr)
        # On error, treat as initial run (deploy all)
        return None

    files = [f.strip() for f in result.stdout.strip().split("\n") if f.strip()]
    return files


def get_head_sha(repo_path):
    """Get the current HEAD SHA of the content repo."""
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=repo_path,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"ERROR: git rev-parse failed: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    return result.stdout.strip()


def write_github_output(key, value, dry_run=False):
    """Write a key=value pair to GITHUB_OUTPUT if available."""
    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file and not dry_run:
        with open(output_file, "a") as f:
            f.write(f"{key}={value}\n")
    # Also print for local debugging
    print(f"  {key}={value}")


def load_deploy_config(manifest_path):
    """Load deploy_config.json from the same directory as the manifest."""
    config_path = os.path.join(os.path.dirname(manifest_path), "deploy_config.json")
    if os.path.exists(config_path):
        with open(config_path, encoding="utf-8") as f:
            return json.load(f)
    return {}


def is_deploy_active(manifest_path):
    """Check if a deploy is currently in progress (staging or production)."""
    if not os.path.exists(manifest_path):
        return False
    try:
        with open(manifest_path, encoding="utf-8") as f:
            existing = json.load(f)
        return existing.get("state") in ("staging", "production")
    except (json.JSONDecodeError, KeyError):
        return False


def write_manifest(path, workflow_list, new_sha, last_sha, global_change, config, dry_run=False):
    """Write the deploy manifest JSON file with per-workflow tracking."""
    skip_staging = set(config.get("skip_staging_workflows", []))

    staged = []
    prod_only = []
    for wf in workflow_list:
        if wf in skip_staging:
            prod_only.append({
                "workflow": wf,
                "production_trigger_time": None,
                "production_run_id": None,
                "production_status": "pending",
            })
        else:
            staged.append({
                "workflow": wf,
                "staging_trigger_time": None,
                "staging_run_id": None,
                "staging_status": "pending",
                "production_trigger_time": None,
                "production_run_id": None,
                "production_status": "pending",
            })

    manifest = {
        "scan_id": datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S"),
        "content_sha": new_sha,
        "previous_sha": last_sha,
        "detected_at": datetime.now(timezone.utc).isoformat(),
        "global_change": global_change,
        "state": "pending",
        "staged_workflows": staged,
        "production_only_workflows": prod_only,
        "completed_at": None,
        "failed_at": None,
        "error": None,
    }

    if dry_run:
        print(f"\n[DRY-RUN] Would write manifest to: {path}")
        print(json.dumps(manifest, indent=2))
    else:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=2)
        print(f"\nManifest written to: {path}")


def main():
    if len(sys.argv) < 3:
        print("Usage: python detect_changes.py <content_repo_path> <last_sha> [--manifest <path>] [--dry-run]")
        sys.exit(1)

    repo_path = sys.argv[1]
    last_sha = sys.argv[2].strip()

    manifest_path = None
    if "--manifest" in sys.argv:
        idx = sys.argv.index("--manifest")
        if idx + 1 < len(sys.argv):
            manifest_path = sys.argv[idx + 1]

    dry_run = "--dry-run" in sys.argv

    new_sha = get_head_sha(repo_path)
    print(f"Content repo HEAD: {new_sha}")
    print(f"Last scanned SHA:  {last_sha or '(none — initial run)'}")

    changed_files = get_changed_files(repo_path, last_sha)

    if changed_files is None:
        # Initial run or error — deploy everything
        print("Initial run or git diff error: triggering all deploy workflows")
        workflows = get_all_deploy_workflows()
        global_change = True
    elif not changed_files:
        # No changes
        print("No changes detected since last scan.")
        write_github_output("has_changes", "false", dry_run)
        write_github_output("workflows", "[]", dry_run)
        write_github_output("new_sha", new_sha, dry_run)
        write_github_output("global_change", "false", dry_run)
        return
    else:
        print(f"Changed files ({len(changed_files)}):")
        for f in changed_files[:50]:  # Print first 50
            print(f"  - {f}")
        if len(changed_files) > 50:
            print(f"  ... and {len(changed_files) - 50} more")

        workflows = set()
        global_change = False

        for filepath in changed_files:
            mapped, is_global = map_path_to_workflow(filepath)
            workflows.update(mapped)
            if is_global:
                global_change = True

        if global_change:
            workflows = get_all_deploy_workflows()

    workflow_list = sorted(workflows)

    print(f"\nWorkflows to trigger ({len(workflow_list)}):")
    for wf in workflow_list:
        print(f"  -> {wf}")

    has_changes = "true" if workflow_list else "false"

    write_github_output("has_changes", has_changes, dry_run)
    write_github_output("workflows", json.dumps(workflow_list), dry_run)
    write_github_output("new_sha", new_sha, dry_run)
    write_github_output("global_change", str(global_change).lower(), dry_run)

    if manifest_path and workflow_list:
        if is_deploy_active(manifest_path):
            print(f"\nWARNING: Deploy is in progress. Skipping manifest write.")
            write_github_output("has_changes", "false", dry_run)
            return

        config = load_deploy_config(manifest_path)
        write_manifest(manifest_path, workflow_list, new_sha, last_sha, global_change, config, dry_run)


if __name__ == "__main__":
    main()
