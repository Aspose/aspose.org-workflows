"""
Deploy status checker — state machine driver.

Reads the deploy manifest, checks workflow run statuses via GitHub CLI,
advances state transitions (staging -> production -> completed), and
triggers production workflows when staging passes.

Usage:
    python check_status.py --manifest <path> --config <path>

States:
    pending    -> nothing to do (deploy-pipeline hasn't triggered yet)
    staging    -> check staging runs + production-only runs
    production -> check all production runs
    completed  -> nothing to do (all done)
    failed     -> nothing to do (requires manual intervention)
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def write_github_output(key, value):
    output_file = os.environ.get("GITHUB_OUTPUT")
    if output_file:
        with open(output_file, "a") as f:
            f.write(f"{key}={value}\n")


def query_run_status(workflow_filename, trigger_time):
    """
    Query GitHub for the most recent run of a workflow created at or after trigger_time.
    Returns (status, run_id, conclusion) or ("not_found", None, None).
    """
    result = subprocess.run(
        ["gh", "run", "list", f"--workflow={workflow_filename}", "--limit", "5",
         "--json", "status,conclusion,databaseId,createdAt"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"    WARNING: gh run list failed for {workflow_filename}: {result.stderr}")
        return "not_found", None, None

    try:
        runs = json.loads(result.stdout)
    except json.JSONDecodeError:
        print(f"    WARNING: Invalid JSON from gh run list for {workflow_filename}")
        return "not_found", None, None

    # Filter to runs created at or after trigger_time
    for run in runs:
        if run.get("createdAt", "") >= trigger_time:
            return run["status"], run["databaseId"], run.get("conclusion")

    return "not_found", None, None


def check_timeout(trigger_time, timeout_minutes):
    """Check if a workflow has exceeded its timeout."""
    trigger_dt = datetime.fromisoformat(trigger_time.replace("Z", "+00:00"))
    elapsed = (datetime.now(timezone.utc) - trigger_dt).total_seconds()
    return elapsed > timeout_minutes * 60


def trigger_workflow(workflow_filename, environment):
    """Trigger a workflow via gh CLI. Returns trigger timestamp."""
    trigger_time = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    result = subprocess.run(
        ["gh", "workflow", "run", workflow_filename,
         "--field", f"environment={environment}"],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        print(f"    FATAL: Failed to trigger {workflow_filename}: {result.stderr}")
        return None
    print(f"    Triggered {workflow_filename} -> {environment} at {trigger_time}")
    time.sleep(5)
    return trigger_time


def check_staging(manifest, timeout_minutes):
    """
    Check staging phase: verify staging runs and production-only runs.
    If all staging passes, trigger production for staged workflows.
    Returns True if manifest was modified.
    """
    now = datetime.now(timezone.utc)
    changed = False

    staged = manifest.get("staged_workflows", [])
    prod_only = manifest.get("production_only_workflows", [])

    # Check staged workflows' staging runs
    all_staging_done = True
    for entry in staged:
        if entry["staging_status"] == "success":
            continue

        if entry["staging_status"] not in ("triggered",):
            all_staging_done = False
            continue

        status, run_id, conclusion = query_run_status(
            entry["workflow"], entry["staging_trigger_time"]
        )

        if status == "completed":
            entry["staging_run_id"] = run_id
            changed = True
            if conclusion == "success":
                entry["staging_status"] = "success"
                print(f"  STAGING PASSED: {entry['workflow']} (run {run_id})")
            else:
                entry["staging_status"] = "failed"
                manifest["state"] = "failed"
                manifest["failed_at"] = now.isoformat()
                manifest["error"] = f"Staging failed: {entry['workflow']} (conclusion: {conclusion})"
                print(f"  STAGING FAILED: {entry['workflow']} (run {run_id}, {conclusion})")
                return True
        elif status == "not_found" and check_timeout(entry["staging_trigger_time"], timeout_minutes):
            entry["staging_status"] = "timeout"
            manifest["state"] = "failed"
            manifest["failed_at"] = now.isoformat()
            manifest["error"] = f"Staging timeout: {entry['workflow']}"
            print(f"  STAGING TIMEOUT: {entry['workflow']}")
            changed = True
            return True
        elif check_timeout(entry["staging_trigger_time"], timeout_minutes):
            entry["staging_status"] = "timeout"
            manifest["state"] = "failed"
            manifest["failed_at"] = now.isoformat()
            manifest["error"] = f"Staging timeout: {entry['workflow']} (status: {status})"
            print(f"  STAGING TIMEOUT: {entry['workflow']} (still {status})")
            changed = True
            return True
        else:
            all_staging_done = False
            print(f"  Staging in progress: {entry['workflow']} ({status})")

    # Check production-only workflows (opportunistic — they're already running)
    for entry in prod_only:
        if entry["production_status"] in ("success", "failed", "timeout"):
            continue

        if entry["production_status"] != "triggered":
            continue

        status, run_id, conclusion = query_run_status(
            entry["workflow"], entry["production_trigger_time"]
        )

        if status == "completed":
            entry["production_run_id"] = run_id
            changed = True
            if conclusion == "success":
                entry["production_status"] = "success"
                print(f"  PRODUCTION (direct) PASSED: {entry['workflow']} (run {run_id})")
            else:
                entry["production_status"] = "failed"
                manifest["state"] = "failed"
                manifest["failed_at"] = now.isoformat()
                manifest["error"] = f"Production failed: {entry['workflow']} (conclusion: {conclusion})"
                print(f"  PRODUCTION (direct) FAILED: {entry['workflow']} (run {run_id}, {conclusion})")
                return True
        elif check_timeout(entry["production_trigger_time"], timeout_minutes):
            entry["production_status"] = "timeout"
            manifest["state"] = "failed"
            manifest["failed_at"] = now.isoformat()
            manifest["error"] = f"Production timeout: {entry['workflow']}"
            print(f"  PRODUCTION (direct) TIMEOUT: {entry['workflow']}")
            changed = True
            return True
        else:
            print(f"  Production (direct) in progress: {entry['workflow']} ({status})")

    # If all staging passed, trigger production for staged batch
    if all_staging_done and staged:
        print("\n  All staging runs passed. Triggering production for staged workflows...")
        trigger_failed = False
        for entry in staged:
            trigger_time = trigger_workflow(entry["workflow"], "production")
            if trigger_time is None:
                entry["production_status"] = "failed"
                manifest["state"] = "failed"
                manifest["failed_at"] = now.isoformat()
                manifest["error"] = f"Failed to trigger production: {entry['workflow']}"
                trigger_failed = True
                break
            entry["production_trigger_time"] = trigger_time
            entry["production_status"] = "triggered"

        changed = True
        if not trigger_failed:
            manifest["state"] = "production"
            print("  State advanced to 'production'.")
        return True

    # Edge case: no staged workflows at all (all are production-only)
    if not staged:
        # Check if all production-only are done
        all_prod_done = all(
            e["production_status"] == "success" for e in prod_only
        )
        if all_prod_done and prod_only:
            manifest["state"] = "completed"
            manifest["completed_at"] = now.isoformat()
            update_scan_state(manifest)
            print("  All production-only workflows completed. State -> 'completed'.")
            return True
        elif not prod_only:
            # Nothing to do
            manifest["state"] = "completed"
            manifest["completed_at"] = now.isoformat()
            return True

    return changed


def check_production(manifest, timeout_minutes):
    """
    Check production phase: verify all production runs (staged + production-only).
    Returns True if manifest was modified.
    """
    now = datetime.now(timezone.utc)
    changed = False

    all_workflows = manifest.get("staged_workflows", []) + manifest.get("production_only_workflows", [])
    all_done = True

    for entry in all_workflows:
        if entry["production_status"] == "success":
            continue

        if entry["production_status"] in ("failed", "timeout"):
            # Already failed — should have been caught, but ensure state is failed
            if manifest["state"] != "failed":
                manifest["state"] = "failed"
                manifest["failed_at"] = now.isoformat()
                manifest["error"] = f"Production {entry['production_status']}: {entry['workflow']}"
                return True
            return changed

        if entry["production_status"] != "triggered":
            all_done = False
            continue

        status, run_id, conclusion = query_run_status(
            entry["workflow"], entry["production_trigger_time"]
        )

        if status == "completed":
            entry["production_run_id"] = run_id
            changed = True
            if conclusion == "success":
                entry["production_status"] = "success"
                print(f"  PRODUCTION PASSED: {entry['workflow']} (run {run_id})")
            else:
                entry["production_status"] = "failed"
                manifest["state"] = "failed"
                manifest["failed_at"] = now.isoformat()
                manifest["error"] = f"Production failed: {entry['workflow']} (conclusion: {conclusion})"
                print(f"  PRODUCTION FAILED: {entry['workflow']} (run {run_id}, {conclusion})")
                return True
        elif check_timeout(entry["production_trigger_time"], timeout_minutes):
            entry["production_status"] = "timeout"
            manifest["state"] = "failed"
            manifest["failed_at"] = now.isoformat()
            manifest["error"] = f"Production timeout: {entry['workflow']}"
            print(f"  PRODUCTION TIMEOUT: {entry['workflow']}")
            changed = True
            return True
        else:
            all_done = False
            print(f"  Production in progress: {entry['workflow']} ({status})")

    if all_done:
        manifest["state"] = "completed"
        manifest["completed_at"] = now.isoformat()
        update_scan_state(manifest)
        print("\n  All production runs completed. State -> 'completed'.")
        changed = True

    return changed


def update_scan_state(manifest):
    """Update scan_state.json with the deployed content SHA."""
    state_path = os.path.join(
        os.path.dirname(sys.argv[sys.argv.index("--manifest") + 1]),
        "scan_state.json",
    )
    state = {
        "last_scanned_sha": manifest["content_sha"],
        "last_scan_time": datetime.now(timezone.utc).isoformat(),
    }
    save_json(state_path, state)
    print(f"  Updated scan_state.json: SHA={state['last_scanned_sha']}")


def main():
    if "--manifest" not in sys.argv or "--config" not in sys.argv:
        print("Usage: python check_status.py --manifest <path> --config <path>")
        sys.exit(1)

    manifest_path = sys.argv[sys.argv.index("--manifest") + 1]
    config_path = sys.argv[sys.argv.index("--config") + 1]

    manifest = load_json(manifest_path)
    config = load_json(config_path)

    state = manifest.get("state", "pending")
    timeout_minutes = config.get("workflow_timeout_minutes", 120)

    print(f"Deploy status check — current state: {state}")

    if state in ("pending", "completed", "failed"):
        print(f"State is '{state}', nothing to do.")
        write_github_output("manifest_changed", "false")
        return

    changed = False

    if state == "staging":
        print("\nChecking staging phase...")
        changed = check_staging(manifest, timeout_minutes)
    elif state == "production":
        print("\nChecking production phase...")
        changed = check_production(manifest, timeout_minutes)

    if changed:
        save_json(manifest_path, manifest)
        print(f"\nManifest updated. New state: {manifest['state']}")
        write_github_output("manifest_changed", "true")
    else:
        print("\nNo status changes detected.")
        write_github_output("manifest_changed", "false")


if __name__ == "__main__":
    main()
