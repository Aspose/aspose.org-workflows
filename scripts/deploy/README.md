# Deploy Pipeline Scripts

Automated deployment pipeline that detects content changes, triggers GitHub Actions workflows, and tracks their progress through staging and production environments.

## Scripts

### detect_changes.py

Scans a content repository for changes since the last deploy and maps them to the appropriate workflow files.

```bash
python detect_changes.py <content_repo_path> <last_scanned_sha> [--manifest <path>]
```

- Compares `HEAD` against the last scanned SHA using `git diff`
- Maps changed file paths to workflow filenames based on section/family structure
- Global paths (`themes/`, `layouts/`, `static/`, etc.) trigger all workflows
- If `--manifest` is provided, writes a `deploy_manifest.json` with per-workflow tracking
- On first run (no SHA), triggers all workflows
- Outputs: `workflows`, `has_changes`, `new_sha`, `global_change` (via `GITHUB_OUTPUT`)

### trigger_workflows.py

Triggers GitHub Actions workflows listed in the deploy manifest.

```bash
python trigger_workflows.py --manifest <path>
```

- Reads the manifest (must be in `pending` state)
- Triggers staged workflows to `staging` environment
- Triggers production-only workflows directly to `production`
- Records trigger timestamps and sets manifest state to `staging`
- Requires `gh` CLI to be authenticated

### check_status.py

State machine driver that monitors workflow runs and advances the deploy through stages.

```bash
python check_status.py --manifest <path> --config <path>
```

**State transitions:**
1. `pending` — waiting for trigger
2. `staging` — checks staging runs; if all pass, triggers production
3. `production` — checks all production runs
4. `completed` — all workflows succeeded
5. `failed` — requires manual intervention

- Queries run status via `gh run list`
- Enforces configurable timeout per workflow
- Updates `scan_state.json` on successful completion

## Configuration Files

### deploy_config.json

```json
{
  "skip_staging_workflows": ["blog.aspose.net.yml"],
  "workflow_timeout_minutes": 120
}
```

- `skip_staging_workflows` — workflows that deploy directly to production, skipping staging
- `workflow_timeout_minutes` — max time (minutes) before a run is marked as timed out

### deploy_manifest.json

Tracks the current deploy cycle: which workflows were triggered, their statuses, timestamps, and run IDs. Written by `detect_changes.py`, updated by `trigger_workflows.py` and `check_status.py`.

### scan_state.json

Persists the last successfully deployed content SHA and timestamp. Used by `detect_changes.py` to determine the diff range for the next scan.

## Dependencies

- Python 3.x (standard library only)
- `gh` CLI (authenticated with repo access)
- Runs inside GitHub Actions (reads/writes `GITHUB_OUTPUT`)
