# SEO PR Arbiter — Setup & Execution Guide

This document provides everything needed to operate, configure, and troubleshoot the PR Arbiter deployed in this repository. It reviews pull requests created by the SEO analysis pipeline against `Aspose/aspose.org`.

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [SEO Pipeline Flow](#seo-pipeline-flow)
- [Scoring System](#scoring-system)
- [Static Checklist](#static-checklist)
- [AI Evaluation](#ai-evaluation)
- [Configuration Reference](#configuration-reference)
- [Secrets & Environment Variables](#secrets--environment-variables)
- [GitHub Workflows](#github-workflows)
- [Workflow Chaining](#workflow-chaining)
- [State Management](#state-management)
- [Metrics & Monitoring](#metrics--monitoring)
- [CLI Reference](#cli-reference)
- [Module Reference](#module-reference)
- [Troubleshooting](#troubleshooting)
- [Customization Guide](#customization-guide)

---

## Overview

The **SEO PR Arbiter** is an automated GitHub PR review system. When the SEO analysis pipeline generates frontmatter improvement patches and `seo-apply.yml` creates PRs on `Aspose/aspose.org`, those PRs previously had no quality gate. This arbiter fills that gap.

**What it does:**
1. Finds open PRs on `Aspose/aspose.org` matching branch prefix `seo/`
2. Evaluates every changed `.md` file against 11 static quality checks
3. Runs AI evaluation for nuanced SEO metadata quality assessment (enabled, weight 20)
4. Posts a scored GitHub review (APPROVE / REQUEST_CHANGES / REJECT) directly on the PR
5. Reports metrics to the shared Google Apps Script dashboard
6. Persists review state to avoid duplicate reviews

**Where results appear:**
- GitHub PR review comment on `Aspose/aspose.org`
- Google Apps Script dashboard (shared with tutorials and API docs arbiters)
- Runner logs (ephemeral)

---

## Architecture

```
aspose.org-workflows/
├── .github/workflows/
│   ├── seo-analysis.yml       ← Generates SEO patches (weekly)
│   ├── seo-apply.yml          ← Applies patches, creates PR, triggers review
│   └── seo-review.yml         ← PR Arbiter review workflow
├── scripts/arbiter/
│   ├── src/                   ← Arbiter engine (self-contained)
│   │   ├── main.py            ← Entry point & orchestrator
│   │   ├── ai/client.py       ← OpenAI-compatible LLM client
│   │   ├── config/            ← Config loader + validator
│   │   ├── github/            ← PR fetching, reviewing, merging
│   │   ├── review/            ← Checklist, decision, AI evaluator
│   │   ├── state/             ← TinyDB persistence
│   │   └── utils/             ← Logging + metrics
│   ├── config/
│   │   ├── config.yaml        ← Runtime configuration
│   │   ├── checklist.yaml     ← Quality check definitions
│   │   └── prompts/
│   │       └── review.txt     ← AI evaluation prompt template
│   ├── data/                  ← Runtime state (gitignored)
│   │   └── state.json         ← TinyDB review history
│   └── requirements.txt       ← Python dependencies
```

The engine is a complete copy of the tutorials-pr-arbiter reference implementation with SEO-specific configuration. It runs entirely within this repo — no cross-repo dependencies at runtime.

---

## SEO Pipeline Flow

The arbiter is the final stage in a 4-step SEO improvement pipeline:

```
Stage 1               Stage 2              Stage 3              Stage 4
GSC Query          SEO Analysis          SEO Apply            SEO Review
Collector          Pipeline              (Manual Gate)        (Arbiter)

Weekly Sun         Weekly Mon            Manual               Auto-triggered
00:00 UTC          06:00 UTC             dispatch             by seo-apply

┌──────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Collect   │     │ Analyze      │     │ Download     │     │ Fetch open   │
│ search    │────→│ pages with   │────→│ artifacts    │────→│ seo/* PRs    │
│ data from │     │ GSC data +   │     │ Apply patches│     │              │
│ Google    │     │ LLM          │     │ Create PR    │     │ Run 11       │
│ Search    │     │              │     │ on aspose.org│     │ static checks│
│ Console   │     │ Generate     │     │              │     │              │
│           │     │ patches      │     │ Trigger      │     │ Run AI eval  │
│           │     │ + artifacts  │     │ seo-review   │────→│ (enabled)    │
│           │     │              │     │              │     │              │
└──────────┘     └──────────────┘     └──────────────┘     │ Post review  │
                                                            │ on GitHub PR │
gsc-query-       seo-analysis.yml      seo-apply.yml       └──────────────┘
collector.yml                                               seo-review.yml
```

### What Each Stage Does

1. **GSC Query Collector** — Fetches search analytics (queries, clicks, impressions, CTR) from Google Search Console API. Stores data for analysis.

2. **SEO Analysis** — Uses GSC data + LLM to identify pages with poor SEO metadata. Generates `seoTitle`, `description`, and `tags` improvement patches. Uploads artifacts.

3. **SEO Apply** (Manual Gate) — Human provides an analysis run ID. Workflow downloads artifacts, applies patches to `Aspose/aspose.org` content, creates a PR on `seo/{run_id}` branch, then triggers the review.

4. **SEO Review** (Arbiter) — Automatically triggered after PR creation. Evaluates each changed file for SEO quality, posts scored GitHub review.

---

## Scoring System

### Score Composition

| Component | Max Points | Source |
|-----------|-----------|--------|
| Static checklist | 80 | 11 checks with configured weights |
| AI evaluation | 20 | LLM score (0–100) scaled by weight=20 |
| **Total** | **100** | `min(100, static + ai)` |

### Decision Thresholds

| Score Range | Decision | GitHub Review Event |
|-------------|----------|-------------------|
| ≥ 80 | APPROVE | `APPROVE` |
| 50–79 | REQUEST_CHANGES | `REQUEST_CHANGES` |
| < 50 | REJECT | `REQUEST_CHANGES` (GitHub doesn't allow REJECT) |

**Note:** SEO thresholds (80/50) are stricter than API docs (70/40) because SEO metadata directly impacts search rankings and user-facing SERP snippets.

### Required Check Cap

If **any** required check fails in **any** file in the PR, the static score is capped at **49 out of 80**. This ensures that a PR with structural problems (invalid YAML, body modifications, extreme title lengths) can never be approved.

---

## Static Checklist

Defined in `config/checklist.yaml`. Each check has an `id`, `description`, `weight`, and `type`.

### Required Checks (failure → score capped at 49)

| ID | Description | Weight | What It Validates |
|----|-------------|--------|-------------------|
| `frontmatter_present` | YAML frontmatter block exists | 10 | `---\n...\n---` regex match |
| `frontmatter_yaml_valid` | Frontmatter YAML parses without errors | 10 | `yaml.safe_load()` succeeds |
| `seo_title_length` | seoTitle is 30–60 characters | 15 | Extract `seoTitle:` field, check len |
| `description_length` | description is 50–160 characters | 15 | Extract `description:` field, check len |
| `body_unchanged` | Only frontmatter fields modified | 15 | Parse unified diff hunk headers, verify all changes within frontmatter lines |
| `frontmatter_values_safe` | Values with colons properly quoted | 10 | Detect unquoted colons in YAML values |

**Required total weight: 75 points**

### Recommended Checks (improve score, don't block)

| ID | Description | Weight | What It Validates |
|----|-------------|--------|-------------------|
| `no_keyword_stuffing` | No word repeated >2× in title/description | 5 | Tokenize, count word frequencies |
| `tags_format_valid` | Tags: YAML list, 3–10 lowercase hyphenated entries | 5 | Parse `tags:` field, validate format |
| `tags_relevance` | Tags include product name + action keyword | 5 | Regex for `aspose\|groupdocs` + action verbs |
| `seo_title_has_brand` | seoTitle mentions Aspose or GroupDocs | 5 | Case-insensitive search |
| `description_has_call_to_action` | Description contains action verb | 5 | Check for learn/convert/create/discover/etc. |

**Recommended total weight: 25 points**

### The body_unchanged Check (Diff-Aware)

This is the most critical SEO check. It uses the unified diff patch (passed via `context={'patch': ...}`) to verify that all changes are within the frontmatter block. It parses `@@ -X,Y +A,B @@` hunk headers and confirms modified lines are all before the closing `---` marker.

**Why this matters:** SEO patches should ONLY modify `seoTitle`, `description`, and `tags` in frontmatter. If body text was modified, something went wrong in the patching pipeline.

---

## AI Evaluation

**Enabled** with weight 20. This is the main differentiator from static checks — it assesses subjective SEO quality.

### How It Works

1. File content truncated to 4000 characters
2. Prompt template (`config/prompts/review.txt`) populated with content
3. Sent to GPT-OSS (`gpt-4o-mini`) at temperature 0.2
4. Response parsed as JSON with structured scores

### AI Scoring Criteria

| Criterion | Max | What It Assesses |
|-----------|-----|-----------------|
| `technical_accuracy` | 25 | Does metadata accurately reflect page content? |
| `clarity` | 20 | Is title click-worthy? Is description compelling in SERPs? |
| `seo_quality` | 20 | Are keywords natural? Does title match search intent? |
| `actionability` | 20 | Would users find what they expect from this SERP snippet? |
| `uniqueness` | 15 | Is metadata distinct from other pages? Avoids boilerplate? |

### AI Response Format

```json
{
  "score": 85,
  "technical_accuracy": 22,
  "clarity": 18,
  "seo_quality": 17,
  "actionability": 16,
  "uniqueness": 12,
  "summary": "Strong metadata update with accurate product mentions...",
  "strengths": ["Natural keyword integration", "Clear value proposition"],
  "issues": ["Description could be more specific about output formats"],
  "recommendation": "APPROVE"
}
```

### AI Score Scaling

Raw AI score (0–100) scaled by weight:
```
weighted_contribution = round((ai_score / 100) × 20) = 0–20 points
```

---

## Configuration Reference

### config/config.yaml

```yaml
github:
  token: "${GITHUB_TOKEN}"           # Resolved from env var at runtime

metrics:
  enabled: true
  endpoint: "https://script.google.com/macros/s/AKfycby.../exec"
  token: "lM6iU2mW0gV1eZ"           # Dashboard auth token (not a secret)
  agent_name: "SEO PR Arbiter"       # Distinguishes from other arbiters
  agent_owner: "Muhammad Muqarrab"
  job_type: "pr_review"
  item_name: "Pull Requests"
  website_section: "SEO"

gpt_oss:
  endpoint: "${GPT_OSS_ENDPOINT}"    # Resolved from env var
  api_key: "${GPT_OSS_API_KEY}"      # Resolved from env var
  model: "gpt-4o-mini"
  timeout: 120                       # Seconds

review:
  checklist_path: "config/checklist.yaml"
  pr_branch_prefix: "seo/"           # Only review PRs from seo/* branches
  auto_merge: false                  # Do not auto-merge approved PRs
  pr_labels: []                      # No label filter
  post_review_comment: true          # Post detailed review comment
  score_thresholds:
    approve: 80                      # Score >= 80 → APPROVE
    request_changes: 50              # Score 50–79 → REQUEST_CHANGES
  file_filter:
    path_contains: null              # Review ALL .md files (no path filter)

products:
  aspose-org:
    content_repo: "https://github.com/Aspose/aspose.org"
    branch: "main"

prompts:
  review_pr: "config/prompts/review.txt"

monitoring:
  check_interval_hours: 4
  stale_review_hours: 48

logging:
  level: "INFO"
  dir: "logs"
  rotation: "daily"
```

### Environment Variable Substitution

The config loader (`src/config/loader.py`) recursively replaces `${VAR_NAME}` patterns with `os.getenv('VAR_NAME')`. This happens at load time before any validation.

---

## Secrets & Environment Variables

### Required Secrets (GitHub Actions)

| Secret | Env Var in Workflow | Purpose |
|--------|-------------------|---------|
| `GH_TOKEN` or `REPO_TOKEN` | `GITHUB_TOKEN` | GitHub PAT with `repo` scope on `Aspose/aspose.org`. Used for: fetching PRs, reading file content, posting reviews, adding labels, triggering workflows |
| `GPT_OSS_ENDPOINT` | `GPT_OSS_ENDPOINT` | LLM API endpoint URL |
| `GPT_OSS_API_KEY` | `GPT_OSS_API_KEY` | LLM API authentication key |

### Token Permissions

The `GH_TOKEN` / `REPO_TOKEN` must have:
- `repo` scope (read + write access to `Aspose/aspose.org`)
- `workflow` scope (for triggering `seo-review.yml` from `seo-apply.yml`)
- Ability to: list PRs, read file content, create reviews, add labels

### Adding Secrets

1. Go to **aspose.org-workflows** repo → Settings → Secrets and variables → Actions
2. Add each secret with the exact name listed above
3. The workflow maps them to env vars:
   ```yaml
   env:
     GITHUB_TOKEN: ${{ secrets.GH_TOKEN || secrets.REPO_TOKEN }}
     GPT_OSS_ENDPOINT: ${{ secrets.GPT_OSS_ENDPOINT }}
     GPT_OSS_API_KEY: ${{ secrets.GPT_OSS_API_KEY }}
   ```

---

## GitHub Workflows

### seo-review.yml — PR Review Workflow

```yaml
name: SEO PR Review
on:
  workflow_dispatch:
    inputs:
      max_prs:
        description: "Max PRs to review"
        default: "1"
```

**Execution details:**
- **Runner:** `ubuntu-latest`
- **Timeout:** 30 minutes
- **Working directory:** `scripts/arbiter`
- **Python:** 3.11
- **State caching:** `data/state.json` cached with key `arbiter-seo-state-{branch}`

**Command:** `python -m src.main -p aspose-org -n {max_prs}`

### seo-apply.yml — Patch Application + Chain Trigger

The apply workflow creates the PR and then triggers the review:

```yaml
- name: Create pull request
  id: create_pr
  uses: peter-evans/create-pull-request@v6
  with:
    branch: seo/${{ inputs.artifact_run_id }}
    title: 'chore(seo): SEO frontmatter improvements [batch: ...]'

- name: Trigger PR Arbiter review
  if: inputs.dry_run == 'false' && steps.create_pr.outputs.pull-request-number
  run: gh workflow run seo-review.yml
  env:
    GH_TOKEN: ${{ secrets.GH_TOKEN || secrets.REPO_TOKEN }}
```

---

## Workflow Chaining

The `seo-apply.yml` → `seo-review.yml` chain works as follows:

1. `seo-apply.yml` runs (manually dispatched with an `artifact_run_id`)
2. Patches are applied to `Aspose/aspose.org` content
3. `peter-evans/create-pull-request@v6` creates a PR on branch `seo/{run_id}`
4. If PR was created (step output `pull-request-number` exists), `gh workflow run seo-review.yml` fires
5. `seo-review.yml` starts, finds the new `seo/*` PR, and reviews it

**Timing:** The review workflow triggers almost immediately after PR creation. The arbiter fetches all unreviewed `seo/*` PRs, so even if timing is off, the PR will be caught.

**Manual fallback:** If the chain fails (e.g., `gh workflow run` errors), manually trigger `seo-review.yml` from the Actions tab.

---

## State Management

### TinyDB (data/state.json)

Review history is persisted in a lightweight JSON database via TinyDB.

**Schema:**

| Field | Type | Description |
|-------|------|-------------|
| `repo_url` | string | Full GitHub repo URL |
| `pr_number` | int | PR number |
| `product` | string | Product key (`aspose-org`) |
| `decision` | string | `APPROVE` / `REQUEST_CHANGES` / `REJECT` |
| `score` | int | Final composite score (0–100) |
| `reviewed_at` | string | ISO timestamp of review |
| `pr_updated_at` | string | PR's `updated_at` at time of review |

**Behavior:**
- PRs are skipped permanently once reviewed (no re-review on update)
- Upsert logic: if PR already in DB, record is updated
- State file cached via GitHub Actions cache across workflow runs

### Cache Key

```yaml
key: arbiter-seo-state-${{ github.ref_name }}
restore-keys: arbiter-seo-state-
```

Isolated from any other arbiter instances (tutorials uses `arbiter-state-*`, API docs uses `arbiter-state-*` in a different repo).

### Resetting State

To force re-review of all PRs:
1. Delete the cache entry from Actions → Caches (look for `arbiter-seo-state-*`)
2. Or manually delete `data/state.json` before running

---

## Metrics & Monitoring

### Google Apps Script Dashboard

Metrics are POSTed to a shared endpoint after each run.

**Endpoint:** `https://script.google.com/macros/s/AKfycbyCHwElrM6RcYLi0JNQAkJmzGrBjAhf28mKXVyub_6SdaZ2ITvzCwfM5xCLE7rmuxio/exec`

**Payload fields:**

| Field | Value |
|-------|-------|
| `agent_name` | "SEO PR Arbiter" |
| `agent_owner` | "Muhammad Muqarrab" |
| `job_type` | "pr_review" |
| `product` | "Aspose.org SEO" |
| `platform` | Detected from file paths (or "All") |
| `status` | "success" / "partial_success" / "failure" |
| `items_discovered` | Files found |
| `items_succeeded` | Files reviewed successfully |
| `items_failed` | Errors |
| `run_duration_ms` | Execution time |
| `token_usage` | LLM tokens consumed |
| `api_calls_count` | LLM API calls made |

### Three Arbiters, One Dashboard

| Agent Name | Website Section | Source Repo |
|------------|----------------|-------------|
| Tutorials PR Arbiter | Tutorials | tutorials-pr-arbiter |
| API Docs PR Arbiter | API Reference | aspose.net-workflows |
| **SEO PR Arbiter** | **SEO** | **aspose.org-workflows** |

---

## CLI Reference

```bash
# Run from scripts/arbiter/ directory
python -m src.main [OPTIONS]
```

### Arguments

| Flag | Default | Description |
|------|---------|-------------|
| `--config`, `-c` | `config/config.yaml` | Path to config file |
| `--product`, `-p` | All products | Single product key to review |
| `--max-prs`, `-n` | Unlimited | Max PRs to review per run |

### Examples

```bash
# Review 1 PR (default workflow behavior)
python -m src.main -p aspose-org -n 1

# Review all open SEO PRs
python -m src.main -p aspose-org

# Use custom config
python -m src.main -c config/custom.yaml -p aspose-org

# Local dry run (set env vars first)
export GITHUB_TOKEN="ghp_..."
export GPT_OSS_ENDPOINT="https://..."
export GPT_OSS_API_KEY="sk-..."
python -m src.main -p aspose-org -n 1
```

---

## Module Reference

| Module | File | Responsibility |
|--------|------|---------------|
| **PRArbitrAgent** | `src/main.py` | Orchestrates entire review pipeline |
| **AIClient** | `src/ai/client.py` | OpenAI-compatible LLM client (GPT-OSS) |
| **load_config** | `src/config/loader.py` | YAML loading + `${VAR}` substitution |
| **validate_config** | `src/config/validator.py` | Config structure validation |
| **fetch_open_prs** | `src/github/pr_fetcher.py` | Query open PRs by branch prefix |
| **get_pr_files** | `src/github/pr_fetcher.py` | List changed files with patches |
| **get_english_markdown_files** | `src/github/pr_fetcher.py` | Filter to .md files |
| **get_file_content** | `src/github/pr_fetcher.py` | Fetch file at specific SHA |
| **post_review** | `src/github/pr_reviewer.py` | Submit GitHub review event |
| **add_labels** | `src/github/pr_reviewer.py` | Apply labels to PR |
| **merge_pr** | `src/github/pr_reviewer.py` | Squash merge (if enabled) |
| **GitHubClient** | `src/github/client.py` | PyGithub wrapper |
| **load_checklist** | `src/review/checklist.py` | Parse checklist YAML |
| **run_checks** | `src/review/checklist.py` | Execute all static checks |
| **make_decision** | `src/review/decision.py` | Score → decision mapping |
| **build_review_comment** | `src/review/decision.py` | Generate Markdown review body |
| **evaluate_content** | `src/review/evaluator.py` | AI evaluation orchestrator |
| **StateRepository** | `src/state/repository.py` | TinyDB review history |
| **MetricsLogger** | `src/utils/metrics_logger.py` | Google Apps Script reporter |
| **setup_logger** | `src/utils/logger.py` | File + console logging |

---

## Troubleshooting

### Common Issues

**"Config validation failed: GitHub token appears to be a placeholder"**
- `GITHUB_TOKEN` env var not set or `GH_TOKEN`/`REPO_TOKEN` secret missing
- Check: Actions → Settings → Secrets

**"No open PRs found matching prefix 'seo/'"**
- No PRs exist on `Aspose/aspose.org` with `seo/*` branches
- Or all matching PRs already reviewed (check state cache)
- Verify `seo-apply.yml` actually created a PR (check its run logs)

**"AI evaluation failed, using fallback"**
- GPT-OSS endpoint unreachable or API key invalid
- Check `GPT_OSS_ENDPOINT` and `GPT_OSS_API_KEY` secrets
- Fallback: AI contributes 0 points, only static checks count

**Review posted as comment instead of review**
- Happens when the bot user is the PR author (GitHub 422 error)
- Falls back to issue comment automatically

**Chain trigger failed (seo-apply → seo-review)**
- `gh workflow run` requires `workflow` scope on the token
- Check that `GH_TOKEN` has the `workflow` permission
- Manual workaround: trigger `seo-review.yml` from Actions tab

**body_unchanged check failing on valid SEO patches**
- The diff parser may be too strict if patches also modify lines near frontmatter boundaries
- Check the actual diff — if body lines were accidentally touched, the pipeline has a bug
- If false positive, review the `_check_body_unchanged` function in `checklist.py`

### Logs

Logs are written to `scripts/arbiter/logs/arbiter-{DATE}.log` on the runner. These are ephemeral. To debug, check the workflow run output in GitHub Actions.

---

## Customization Guide

### Adjusting Thresholds

In `config/config.yaml`:
```yaml
review:
  score_thresholds:
    approve: 80        # Lower = more lenient (e.g., 70 for initial rollout)
    request_changes: 50  # Lower = fewer rejections
```

### Adding a New Check

1. Add to `config/checklist.yaml`:
   ```yaml
   - id: my_new_check
     description: "Description of what it checks"
     weight: 5
     type: recommended  # or required
   ```

2. Add function to `src/review/checklist.py`:
   ```python
   def _check_my_new_check(content: str, context: Optional[Dict] = None) -> bool:
       # Return True if check passes
       return 'expected_pattern' in content
   ```

3. Register in the dispatcher dict inside `_evaluate_check()`.

### Disabling AI Evaluation

In `config/checklist.yaml`:
```yaml
ai_evaluation:
  enabled: false    # ← turn off
  weight: 20
```

Static checks will account for all 80 points. Max possible score becomes 80.

### Changing Branch Prefix

In `config/config.yaml`:
```yaml
review:
  pr_branch_prefix: "seo-v2/"  # or whatever new prefix
```

Also update `seo-apply.yml` to create PRs on the matching prefix.

### Enabling Auto-Merge

In `config/config.yaml`:
```yaml
review:
  auto_merge: true
```

**Warning:** Only enable this once you're confident in the scoring. SEO changes are user-facing.

### Adjusting AI Prompt

Edit `config/prompts/review.txt`. The `{content}` placeholder is replaced with the file content at evaluation time. The `{{ }}` double-brace escaping is for literal braces in the JSON format example.

---

## Dependencies

```
PyGithub>=2.1.1          # GitHub API client
openai>=1.0.0            # OpenAI-compatible client (GPT-OSS)
pyyaml>=6.0.1            # YAML config parsing
tinydb>=4.8.0            # Lightweight JSON state DB
python-frontmatter>=1.0.0 # Markdown frontmatter parsing
requests>=2.31.0         # HTTP requests (metrics posting)
```

---

## Pre-Flight Checklist

Before first run:

- [ ] `GH_TOKEN` or `REPO_TOKEN` secret exists with `repo` + `workflow` scope on `Aspose/aspose.org`
- [ ] `GPT_OSS_ENDPOINT` secret added
- [ ] `GPT_OSS_API_KEY` secret added
- [ ] `data/` directory has `.gitignore` with `*.json` (already done)
- [ ] At least one open PR exists on `Aspose/aspose.org` with `seo/*` branch prefix
- [ ] Test with manual dispatch: Actions → "SEO PR Review" → Run workflow
- [ ] End-to-end test: Run `seo-apply.yml` with `dry_run=false` and verify `seo-review.yml` auto-triggers

---

## End-to-End Verification

### Quick Test (Review Only)

1. Ensure an open PR exists on `Aspose/aspose.org` with branch `seo/*`
2. Go to Actions → "SEO PR Review" → Run workflow → `max_prs: 1`
3. Check the PR on `Aspose/aspose.org` for the review comment

### Full Pipeline Test

1. Run `seo-apply.yml` with a valid `artifact_run_id` and `dry_run: false`
2. Verify PR created on `Aspose/aspose.org` on branch `seo/{run_id}`
3. Verify `seo-review.yml` triggered automatically
4. Verify review comment posted on the PR
5. Check Google Apps Script dashboard for the metrics entry

### Local Test

```bash
cd scripts/arbiter
pip install -r requirements.txt
export GITHUB_TOKEN="ghp_..."
export GPT_OSS_ENDPOINT="https://..."
export GPT_OSS_API_KEY="sk-..."
python -m src.main -p aspose-org -n 1
```

---

## Reference

This arbiter is adapted from the [tutorials-pr-arbiter](https://github.com/user/tutorials-pr-arbiter) reference implementation. The engine code in `src/` is a portable copy with SEO-specific configuration layered on top via `config/`.
