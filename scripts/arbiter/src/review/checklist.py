"""Static checklist evaluation for SEO PRs."""
from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass
from typing import Any

import yaml

_LOG = logging.getLogger(__name__)


@dataclass
class CheckResult:
    """Result of a single check."""
    id: str
    description: str
    weight: int
    check_type: str  # required or recommended
    passed: bool
    detail: str = ""


def load_checklist(path: str) -> dict[str, Any]:
    """Load checklist YAML file."""
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def run_checks(content: str, checklist: dict[str, Any],
               context: dict[str, Any] | None = None) -> list[CheckResult]:
    """Run all static checks on file content."""
    context = context or {}
    results = []
    for check in checklist.get("checks", []):
        check_id = check["id"]
        fn = _CHECK_DISPATCH.get(check_id)
        if fn is None:
            _LOG.warning("No implementation for check '%s' — skipping", check_id)
            continue
        passed, detail = fn(content, context)
        results.append(CheckResult(
            id=check_id,
            description=check["description"],
            weight=check["weight"],
            check_type=check["type"],
            passed=passed,
            detail=detail,
        ))
    return results


def compute_static_score(results: list[CheckResult], max_static: int = 80) -> int:
    """Compute weighted static score with required-check cap.

    Static score is capped at max_static (default 80) because the remaining
    20 points come from AI evaluation.
    """
    any_required_failed = any(
        not r.passed for r in results if r.check_type == "required"
    )
    total = sum(r.weight for r in results if r.passed)
    if any_required_failed:
        total = min(total, 49)
    return min(total, max_static)


# ---------------------------------------------------------------------------
# Individual check implementations
# ---------------------------------------------------------------------------

_FM_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)


def _extract_frontmatter(content: str) -> str | None:
    """Extract raw YAML frontmatter string."""
    m = _FM_RE.match(content)
    return m.group(1) if m else None


def _parse_frontmatter(content: str) -> dict | None:
    """Parse frontmatter YAML. Returns None on failure."""
    raw = _extract_frontmatter(content)
    if raw is None:
        return None
    try:
        return yaml.safe_load(raw) or {}
    except yaml.YAMLError:
        return None


def _check_frontmatter_present(content: str, context: dict) -> tuple[bool, str]:
    raw = _extract_frontmatter(content)
    if raw is not None:
        return True, "Frontmatter block found"
    return False, "No YAML frontmatter block (---...---) detected"


def _check_frontmatter_yaml_valid(content: str, context: dict) -> tuple[bool, str]:
    raw = _extract_frontmatter(content)
    if raw is None:
        return False, "No frontmatter to validate"
    try:
        yaml.safe_load(raw)
        return True, "YAML parses successfully"
    except yaml.YAMLError as exc:
        return False, f"YAML parse error: {exc}"


def _check_seo_title_length(content: str, context: dict) -> tuple[bool, str]:
    fm = _parse_frontmatter(content)
    if fm is None:
        return False, "Cannot parse frontmatter"
    title = fm.get("seoTitle", "") or ""
    length = len(title)
    if 30 <= length <= 60:
        return True, f"seoTitle length: {length} chars"
    return False, f"seoTitle length: {length} chars (expected 30-60)"


def _check_description_length(content: str, context: dict) -> tuple[bool, str]:
    fm = _parse_frontmatter(content)
    if fm is None:
        return False, "Cannot parse frontmatter"
    desc = fm.get("description", "") or ""
    length = len(desc)
    if 50 <= length <= 160:
        return True, f"description length: {length} chars"
    return False, f"description length: {length} chars (expected 50-160)"


def _check_body_unchanged(content: str, context: dict) -> tuple[bool, str]:
    """Verify all diff changes are within frontmatter block."""
    patch = context.get("patch", "")
    if not patch:
        return True, "No patch data — assuming body unchanged"

    # Find frontmatter end line in the new file
    lines = content.split("\n")
    fm_end = None
    found_first = False
    for i, line in enumerate(lines, 1):
        if line.strip() == "---":
            if not found_first:
                found_first = True
            else:
                fm_end = i
                break

    if fm_end is None:
        return False, "Cannot determine frontmatter boundary"

    # Parse diff hunk headers to find changed line numbers
    hunk_re = re.compile(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")
    for hunk_match in hunk_re.finditer(patch):
        start = int(hunk_match.group(1))
        count = int(hunk_match.group(2) or "1")
        end = start + count - 1

        # Check if any changed lines are after frontmatter
        if end > fm_end:
            return False, f"Changes detected after frontmatter (line {end} > fm end {fm_end})"

    return True, f"All changes within frontmatter (ends at line {fm_end})"


def _check_frontmatter_values_safe(content: str, context: dict) -> tuple[bool, str]:
    """Check that values containing colons are properly quoted."""
    raw = _extract_frontmatter(content)
    if raw is None:
        return False, "No frontmatter"

    for line in raw.split("\n"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # Skip list items
        if line.startswith("-"):
            continue
        # Check key: value pairs where value contains a colon
        if ":" in line:
            parts = line.split(":", 1)
            if len(parts) == 2:
                value = parts[1].strip()
                if ":" in value and not (value.startswith('"') or value.startswith("'")):
                    return False, f"Unquoted colon in value: {line[:80]}"

    return True, "All colon-containing values properly quoted"


def _check_no_keyword_stuffing(content: str, context: dict) -> tuple[bool, str]:
    fm = _parse_frontmatter(content)
    if fm is None:
        return True, "No frontmatter — skipping"

    title = str(fm.get("seoTitle", ""))
    desc = str(fm.get("description", ""))
    text = f"{title} {desc}".lower()
    words = re.findall(r"\b[a-z]{4,}\b", text)
    counts = Counter(words)
    stuffed = [w for w, c in counts.items() if c > 2]
    if stuffed:
        return False, f"Keyword stuffing: {', '.join(stuffed)}"
    return True, "No keyword stuffing detected"


def _check_tags_format_valid(content: str, context: dict) -> tuple[bool, str]:
    fm = _parse_frontmatter(content)
    if fm is None:
        return False, "Cannot parse frontmatter"

    tags = fm.get("tags")
    if not isinstance(tags, list):
        return False, "tags is not a YAML list"
    if not (3 <= len(tags) <= 10):
        return False, f"Expected 3-10 tags, found {len(tags)}"

    for tag in tags:
        tag_str = str(tag)
        if not re.match(r"^[a-z0-9]+(-[a-z0-9]+)*$", tag_str):
            return False, f"Invalid tag format: '{tag_str}' (expected lowercase-hyphenated)"

    return True, f"{len(tags)} valid tags"


def _check_tags_relevance(content: str, context: dict) -> tuple[bool, str]:
    fm = _parse_frontmatter(content)
    if fm is None:
        return False, "Cannot parse frontmatter"

    tags = fm.get("tags", [])
    if not isinstance(tags, list):
        return False, "tags is not a list"

    tags_text = " ".join(str(t) for t in tags).lower()
    has_product = bool(re.search(r"aspose|groupdocs", tags_text))
    action_verbs = r"convert|create|edit|merge|split|compress|parse|extract|generate|render|export"
    has_action = bool(re.search(action_verbs, tags_text))

    if has_product and has_action:
        return True, "Tags include product name and action keyword"
    issues = []
    if not has_product:
        issues.append("no product name (aspose/groupdocs)")
    if not has_action:
        issues.append("no action keyword")
    return False, f"Tags missing: {', '.join(issues)}"


def _check_seo_title_has_brand(content: str, context: dict) -> tuple[bool, str]:
    fm = _parse_frontmatter(content)
    if fm is None:
        return False, "Cannot parse frontmatter"

    title = str(fm.get("seoTitle", "")).lower()
    if "aspose" in title or "groupdocs" in title:
        return True, "Brand name found in seoTitle"
    return False, "seoTitle does not mention Aspose or GroupDocs"


def _check_description_has_call_to_action(content: str, context: dict) -> tuple[bool, str]:
    fm = _parse_frontmatter(content)
    if fm is None:
        return False, "Cannot parse frontmatter"

    desc = str(fm.get("description", "")).lower()
    cta_verbs = [
        "learn", "discover", "explore", "convert", "create", "download",
        "try", "get", "start", "build", "generate", "process", "manage",
        "transform", "extract", "merge", "split", "edit", "compress",
    ]
    for verb in cta_verbs:
        if verb in desc:
            return True, f"Call to action found: '{verb}'"
    return False, "No action verb in description"


# Dispatcher mapping check IDs to functions
_CHECK_DISPATCH: dict[str, Any] = {
    "frontmatter_present": _check_frontmatter_present,
    "frontmatter_yaml_valid": _check_frontmatter_yaml_valid,
    "seo_title_length": _check_seo_title_length,
    "description_length": _check_description_length,
    "body_unchanged": _check_body_unchanged,
    "frontmatter_values_safe": _check_frontmatter_values_safe,
    "no_keyword_stuffing": _check_no_keyword_stuffing,
    "tags_format_valid": _check_tags_format_valid,
    "tags_relevance": _check_tags_relevance,
    "seo_title_has_brand": _check_seo_title_has_brand,
    "description_has_call_to_action": _check_description_has_call_to_action,
}
