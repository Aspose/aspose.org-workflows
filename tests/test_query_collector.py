"""
Unit tests for group_queries_by_page() in scripts/google/query-collector.py

Run from repo root:
    python -m pytest tests/test_query_collector.py -v
"""

import importlib.util
import os
import sys

# ---------------------------------------------------------------------------
# Dynamic import — filename contains a hyphen so normal import won't work
# ---------------------------------------------------------------------------
_script_path = os.path.join(
    os.path.dirname(__file__), "..", "scripts", "google", "query-collector.py"
)
_spec = importlib.util.spec_from_file_location("query_collector", _script_path)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
group_queries_by_page = _mod.group_queries_by_page


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _row(page, query, clicks=10, impressions=20, ctr=0.05, position=3.5):
    """Build a minimal GSC API row dict."""
    return {
        "keys": [page, query],
        "clicks": clicks,
        "impressions": impressions,
        "ctr": ctr,
        "position": position,
    }


# ---------------------------------------------------------------------------
# Test 1 – Happy path: 3 rows across 2 pages → 2 keys in output
# ---------------------------------------------------------------------------

def test_happy_path_grouping():
    """3 rows belonging to 2 different pages produce exactly 2 keys in the result."""
    rows = [
        _row("https://example.com/page-a", "query alpha"),
        _row("https://example.com/page-b", "query beta"),
        _row("https://example.com/page-a", "query gamma"),
    ]
    result = group_queries_by_page(rows, min_impressions=1)

    assert set(result.keys()) == {
        "https://example.com/page-a",
        "https://example.com/page-b",
    }
    assert len(result["https://example.com/page-a"]) == 2
    assert len(result["https://example.com/page-b"]) == 1


# ---------------------------------------------------------------------------
# Test 2 – Metric extraction: values present and correctly rounded
# ---------------------------------------------------------------------------

def test_metric_extraction():
    """
    A single row produces a query dict with clicks, impressions,
    ctr rounded to 6 decimal places, and position rounded to 2 dp.
    """
    rows = [_row("https://example.com/page-x", "my query",
                 clicks=7, impressions=42,
                 ctr=0.1666666666, position=4.567)]
    result = group_queries_by_page(rows, min_impressions=1)

    assert "https://example.com/page-x" in result
    q = result["https://example.com/page-x"][0]

    assert q["query"] == "my query"
    assert q["clicks"] == 7
    assert q["impressions"] == 42
    assert q["ctr"] == round(0.1666666666, 6)
    assert q["position"] == round(4.567, 2)


# ---------------------------------------------------------------------------
# Test 3 – Filter: row below min_impressions threshold is excluded
# ---------------------------------------------------------------------------

def test_filter_below_threshold():
    """A row with impressions=2 is excluded when min_impressions=5."""
    rows = [_row("https://example.com/page-a", "query", impressions=2)]
    result = group_queries_by_page(rows, min_impressions=5)

    assert result == {}


# ---------------------------------------------------------------------------
# Test 4 – Filter: row AT the threshold is included (inclusive boundary)
# ---------------------------------------------------------------------------

def test_filter_at_threshold_inclusive():
    """A row with impressions exactly equal to min_impressions is included."""
    rows = [_row("https://example.com/page-a", "query", impressions=5)]
    result = group_queries_by_page(rows, min_impressions=5)

    assert "https://example.com/page-a" in result
    assert len(result["https://example.com/page-a"]) == 1


# ---------------------------------------------------------------------------
# Test 5 – Unwanted path filter: /tag/ and /categories/ are excluded
# ---------------------------------------------------------------------------

def test_unwanted_path_filter():
    """URLs containing /tag/ or /categories/ are excluded; a clean URL is kept."""
    rows = [
        _row("https://example.com/tag/python", "tag query", impressions=100),
        _row("https://example.com/categories/news", "cat query", impressions=100),
        _row("https://example.com/archives/2023/post", "arc query", impressions=100),
        _row("https://example.com/good-page", "good query", impressions=100),
    ]
    result = group_queries_by_page(rows, min_impressions=1)

    assert "https://example.com/tag/python" not in result
    assert "https://example.com/categories/news" not in result
    assert "https://example.com/archives/2023/post" not in result
    assert "https://example.com/good-page" in result


# ---------------------------------------------------------------------------
# Test 6 – Missing API fields default gracefully
# ---------------------------------------------------------------------------

def test_missing_api_fields_default():
    """
    A row missing 'clicks' defaults to 0;
    a row missing 'ctr' defaults to 0.0.
    """
    row_no_clicks = {
        "keys": ["https://example.com/page-a", "query one"],
        "impressions": 10,
        "ctr": 0.05,
        "position": 2.0,
        # 'clicks' deliberately omitted
    }
    row_no_ctr = {
        "keys": ["https://example.com/page-b", "query two"],
        "clicks": 3,
        "impressions": 10,
        "position": 5.0,
        # 'ctr' deliberately omitted
    }
    result = group_queries_by_page([row_no_clicks, row_no_ctr], min_impressions=1)

    assert result["https://example.com/page-a"][0]["clicks"] == 0
    assert result["https://example.com/page-b"][0]["ctr"] == 0.0


# ---------------------------------------------------------------------------
# Test 7 – Sort: queries for a page are ordered by impressions descending
# ---------------------------------------------------------------------------

def test_sort_by_impressions_descending():
    """
    Three queries for the same page with impressions [50, 200, 100]
    are returned ordered [200, 100, 50].
    """
    page = "https://example.com/page-sort"
    rows = [
        _row(page, "q-low",  impressions=50),
        _row(page, "q-high", impressions=200),
        _row(page, "q-mid",  impressions=100),
    ]
    result = group_queries_by_page(rows, min_impressions=1)

    ordered = [q["impressions"] for q in result[page]]
    assert ordered == [200, 100, 50]


# ---------------------------------------------------------------------------
# Test 8 – Empty input returns an empty dict
# ---------------------------------------------------------------------------

def test_empty_input():
    """Passing an empty list returns an empty dict."""
    result = group_queries_by_page([], min_impressions=5)
    assert result == {}


# ---------------------------------------------------------------------------
# Test 9 – Custom min_impressions=0 includes rows with impressions=1
# ---------------------------------------------------------------------------

def test_custom_min_impressions_zero():
    """
    With min_impressions=0 every row passes the impressions filter,
    including one with impressions=1.
    """
    rows = [
        _row("https://example.com/page-a", "rare query", impressions=1),
        _row("https://example.com/page-b", "common query", impressions=50),
    ]
    result = group_queries_by_page(rows, min_impressions=0)

    assert "https://example.com/page-a" in result
    assert "https://example.com/page-b" in result
    assert result["https://example.com/page-a"][0]["impressions"] == 1
