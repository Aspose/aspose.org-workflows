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
        ["gh", "run", "list", f"--workflow={workflow_filename}", "--limit", "25",
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


def is_in_propagation_window(trigger_time, grace_minutes=3):
    """
    Return True if the run may not yet be visible in the GitHub API.
    GitHub can take 30-60 seconds to reflect a newly triggered run in gh run list.
    Treat not_found within the grace window as 'still propagating', not a timeout.
    """
    trigger_dt = datetime.fromisoformat(trigger_time.replace("Z", "+00:00"))
    elapsed = (datetime.now(timezone.utc) - trigger_dt).total_seconds()
    return elapsed < grace_minutes * 60


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
    Continues monitoring all in-flight workflows even when one fails —
    state is only set to 'failed' after all staged workflows reach a terminal state.
    Returns True if manifest was modified.
    """
    now = datetime.now(timezone.utc)
    changed = False

    staged = manifest.get("staged_workflows", [])
    prod_only = manifest.get("production_only_workflows", [])

    # Check staged workflows' staging runs
    all_staging_terminal = True
    any_staging_failed = False
    fail_error = None

    for entry in staged:
        if entry["staging_status"] == "success":
            continue

        if entry["staging_status"] in ("failed", "timeout"):
            # Already terminal from a previous check — track but keep iterating
            any_staging_failed = True
            fail_error = fail_error or f"Staging {entry['staging_status']}: {entry['workflow']}"
            continue

        if entry["staging_status"] not in ("triggered",):
            all_staging_terminal = False
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
                any_staging_failed = True
                fail_error = fail_error or f"Staging failed: {entry['workflow']} (conclusion: {conclusion})"
                print(f"  STAGING FAILED: {entry['workflow']} (run {run_id}, {conclusion})")
                # Continue — do not return early; check remaining staged workflows first
        elif status == "not_found" and is_in_propagation_window(entry["staging_trigger_time"]):
            print(f"  Run not yet visible for {entry['workflow']}, within 3-min grace window")
            all_staging_terminal = False
        elif check_timeout(entry["staging_trigger_time"], timeout_minutes):
            entry["staging_status"] = "timeout"
            any_staging_failed = True
            fail_error = fail_error or f"Staging timeout: {entry['workflow']} (status: {status})"
            print(f"  STAGING TIMEOUT: {entry['workflow']} (still {status})")
            changed = True
            # Continue — do not return early
        else:
            all_staging_terminal = False
            print(f"  Staging in progress: {entry['workflow']} ({status})")

    # Check production-only workflows (opportunistic — already running in production)
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
                print(f"  PRODUCTION (direct) FAILED: {entry['workflow']} (run {run_id}, {conclusion})")
                # Record outcome; final state decision is deferred to check_production
        elif status == "not_found" and is_in_propagation_window(entry["production_trigger_time"]):
            print(f"  Run not yet visible for {entry['workflow']} (production-only), within grace window")
        elif check_timeout(entry["production_trigger_time"], timeout_minutes):
            entry["production_status"] = "timeout"
            print(f"  PRODUCTION (direct) TIMEOUT: {entry['workflow']}")
            changed = True
        else:
            print(f"  Production (direct) in progress: {entry['workflow']} ({status})")

    # After iterating all staged workflows, determine state transition
    if any_staging_failed and all_staging_terminal:
        # All staging runs are terminal and at least one failed — do not promote to production
        manifest["state"] = "failed"
        manifest["failed_at"] = now.isoformat()
        manifest["error"] = fail_error
        print(f"\n  Staging failed. State -> 'failed'. Error: {fail_error}")
        changed = True
        return changed
    elif any_staging_failed and not all_staging_terminal:
        # Some failed, some still running — stay in staging, keep monitoring
        print("  Some staging workflows failed; others still in progress. Continuing to monitor.")
        return changed

    # If all staging passed, trigger production for staged batch
    if all_staging_terminal and staged and not any_staging_failed:
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
        all_prod_terminal = all(
            e["production_status"] in ("success", "failed", "timeout") for e in prod_only
        )
        if all_prod_terminal and prod_only:
            any_prod_failed = any(e["production_status"] in ("failed", "timeout") for e in prod_only)
            if any_prod_failed:
                fail_msg = next(
                    f"Production {e['production_status']}: {e['workflow']}"
                    for e in prod_only if e["production_status"] in ("failed", "timeout")
                )
                manifest["state"] = "failed"
                manifest["failed_at"] = now.isoformat()
                manifest["error"] = fail_msg
                print("  Production-only deploy failed. State -> 'failed'.")
                return True
            else:
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
    Continues monitoring all in-flight workflows even when one fails —
    state is only set to 'failed' after all workflows reach a terminal state.
    Returns True if manifest was modified.
    """
    now = datetime.now(timezone.utc)
    changed = False
    any_failed = False
    fail_error = None

    all_workflows = manifest.get("staged_workflows", []) + manifest.get("production_only_workflows", [])
    all_done = True

    for entry in all_workflows:
        if entry["production_status"] == "success":
            continue

        if entry["production_status"] in ("failed", "timeout"):
            # Already terminal from a previous check — track but keep iterating
            any_failed = True
            fail_error = fail_error or f"Production {entry['production_status']}: {entry['workflow']}"
            continue

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
                any_failed = True
                fail_error = fail_error or f"Production failed: {entry['workflow']} (conclusion: {conclusion})"
                print(f"  PRODUCTION FAILED: {entry['workflow']} (run {run_id}, {conclusion})")
                # Continue — do not return early; check remaining workflows first
        elif status == "not_found" and is_in_propagation_window(entry["production_trigger_time"]):
            print(f"  Run not yet visible for {entry['workflow']}, within 3-min grace window")
            all_done = False
        elif check_timeout(entry["production_trigger_time"], timeout_minutes):
            entry["production_status"] = "timeout"
            any_failed = True
            fail_error = fail_error or f"Production timeout: {entry['workflow']}"
            print(f"  PRODUCTION TIMEOUT: {entry['workflow']}")
            changed = True
            # Continue — do not return early
        else:
            all_done = False
            print(f"  Production in progress: {entry['workflow']} ({status})")

    # After iterating all workflows, determine final state
    if any_failed and all_done:
        # All workflows are terminal; at least one failed
        manifest["state"] = "failed"
        manifest["failed_at"] = now.isoformat()
        manifest["error"] = fail_error
        print(f"\n  Deploy failed. State -> 'failed'. Error: {fail_error}")
        changed = True
    elif any_failed and not all_done:
        # Some failed, some still running — stay in production, keep monitoring
        print("  Some production workflows failed; others still in progress. Continuing to monitor.")
    elif all_done and not any_failed:
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
    initial_state = state
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
        final_state = manifest["state"]
        print(f"\nManifest updated. New state: {final_state}")
        write_github_output("manifest_changed", "true")
        # Emit deploy_failed only when THIS run caused the transition to failed
        if initial_state != "failed" and final_state == "failed":
            write_github_output("deploy_failed", "true")
    else:
        print("\nNo status changes detected.")
        write_github_output("manifest_changed", "false")


if __name__ == "__main__":
    main()
