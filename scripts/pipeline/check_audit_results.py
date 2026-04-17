"""
Check audit results JSON and exit with non-zero status if any failures are found.

Usage: python check_audit_results.py <audit-results.json>
"""
import json
import sys


def main():
    if len(sys.argv) < 2:
        print("Usage: check_audit_results.py <audit-results.json>", file=sys.stderr)
        sys.exit(1)

    path = sys.argv[1]
    try:
        with open(path) as f:
            results = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"ERROR: Could not read {path}: {e}", file=sys.stderr)
        sys.exit(1)

    total_fails = results.get("total_fails", 0)
    total_warns = results.get("total_warns", 0)
    findings = results.get("findings", [])

    print(f"Audit results: {total_fails} failures, {total_warns} warnings, {len(findings)} findings")

    if total_fails > 0:
        print("FAIL: Audit check failed — review findings above", file=sys.stderr)
        for f in findings:
            print(f"  - {f}", file=sys.stderr)
        sys.exit(1)

    print("PASS: Audit check passed")


if __name__ == "__main__":
    main()
