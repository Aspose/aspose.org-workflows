"""
Tests for the staged-SHA pin (R-01): production (and staging) site workflows must be
dispatched with `--field ref=<manifest content_sha>`, so the commit that was staged is
the commit that is promoted -- not whatever the content repo's default branch is at
production trigger time.

A fake `gh` is injected by patching subprocess.run in the script modules; nothing real
is ever dispatched.

Run from repo root:
    pytest tests/test_deploy_pin_ref.py -v
"""

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

_here = os.path.dirname(__file__)
_deploy = os.path.join(_here, "..", "scripts", "deploy")


def _load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(_deploy, f"{name}.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# detect_changes imports sibling `config` from scripts/ (same as test_detect_changes.py)
sys.path.insert(0, os.path.join(_here, "..", "scripts"))
check_status = _load("check_status")
trigger_workflows = _load("trigger_workflows")
detect_changes = _load("detect_changes")

SHA_A = "a" * 40
SHA_B = "b" * 40


class FakeGh:
    """Records every `gh` invocation; run-list queries return a canned success."""

    def __init__(self, dispatch_rc=0):
        self.calls = []
        self.dispatch_rc = dispatch_rc

    def __call__(self, cmd, **kwargs):
        self.calls.append(list(cmd))
        r = MagicMock()
        r.stderr = ""
        if cmd[:3] == ["gh", "workflow", "run"]:
            r.returncode = self.dispatch_rc
            r.stdout = ""
        else:  # gh run list
            r.returncode = 0
            r.stdout = json.dumps([{
                "status": "completed", "conclusion": "success",
                "databaseId": 1, "createdAt": "2999-01-01T00:00:00Z",
            }])
        return r

    def dispatches(self):
        return [c for c in self.calls if c[:3] == ["gh", "workflow", "run"]]


def _fields(cmd):
    """{'environment': 'production', 'ref': '...'} from repeated --field k=v pairs."""
    out = {}
    for i, tok in enumerate(cmd):
        if tok == "--field":
            k, _, v = cmd[i + 1].partition("=")
            out[k] = v
    return out


class TestCheckStatusTriggerWorkflow(unittest.TestCase):
    def test_production_dispatch_carries_ref_field(self):
        gh = FakeGh()
        with patch.object(check_status.subprocess, "run", gh), patch.object(check_status.time, "sleep"):
            t = check_status.trigger_workflow("docs.aspose.org.yml", "production", SHA_A)
        self.assertIsNotNone(t)
        (cmd,) = gh.dispatches()
        self.assertEqual(_fields(cmd), {"environment": "production", "ref": SHA_A})
        # the pin is a workflow *input*; gh's own --ref flag (workflow-file revision) is untouched
        self.assertNotIn("--ref", cmd)

    def test_rejects_missing_or_non_sha_ref_without_dispatching(self):
        for bad in (None, "", "main", "refs/heads/main", SHA_A[:7], SHA_A.upper(), SHA_A + "0"):
            gh = FakeGh()
            with patch.object(check_status.subprocess, "run", gh), patch.object(check_status.time, "sleep"):
                t = check_status.trigger_workflow("docs.aspose.org.yml", "production", bad)
            self.assertIsNone(t, bad)
            self.assertEqual(gh.dispatches(), [], bad)

    def test_dispatch_failure_returns_none(self):
        gh = FakeGh(dispatch_rc=1)
        with patch.object(check_status.subprocess, "run", gh), patch.object(check_status.time, "sleep"):
            self.assertIsNone(check_status.trigger_workflow("kb.aspose.org.yml", "production", SHA_A))


def _staging_manifest(content_sha):
    return {
        "state": "staging",
        "content_sha": content_sha,
        "staged_workflows": [
            {"workflow": w, "staging_status": "success",
             "staging_trigger_time": "2026-01-01T00:00:00Z", "production_status": "pending"}
            for w in ("docs.aspose.org.yml", "kb.aspose.org.yml", "reference.aspose.org.yml")
        ],
        "production_only_workflows": [],
    }


class TestPromotionPinsStagedSha(unittest.TestCase):
    def test_promotion_dispatches_every_staged_workflow_at_manifest_sha(self):
        m = _staging_manifest(SHA_A)
        gh = FakeGh()
        with patch.object(check_status.subprocess, "run", gh), patch.object(check_status.time, "sleep"):
            changed = check_status.check_staging(m, 120)
        self.assertTrue(changed)
        self.assertEqual(m["state"], "production")
        d = gh.dispatches()
        self.assertEqual(len(d), 3)
        for cmd in d:
            self.assertEqual(_fields(cmd), {"environment": "production", "ref": SHA_A})

    def test_commit_landing_after_staging_is_not_built(self):
        """The default branch moves to SHA_B after staging; promotion must still ask for SHA_A."""
        m = _staging_manifest(SHA_A)
        default_branch_head = SHA_B  # a new commit lands between staging and production
        gh = FakeGh()
        with patch.object(check_status.subprocess, "run", gh), patch.object(check_status.time, "sleep"):
            check_status.check_staging(m, 120)
        self.assertTrue(gh.dispatches())
        for cmd in gh.dispatches():
            self.assertEqual(_fields(cmd)["ref"], SHA_A)
            self.assertNotEqual(_fields(cmd)["ref"], default_branch_head)

    def test_bad_manifest_sha_fails_closed_and_dispatches_nothing(self):
        m = _staging_manifest(None)
        gh = FakeGh()
        with patch.object(check_status.subprocess, "run", gh), patch.object(check_status.time, "sleep"):
            check_status.check_staging(m, 120)
        self.assertEqual(gh.dispatches(), [])
        self.assertEqual(m["state"], "failed")
        self.assertIn("Failed to trigger production", m["error"])

    def test_manifest_still_advances_to_completed_and_scan_state_records_pinned_sha(self):
        """After production succeeds, scan_state records content_sha (not HEAD), so the
        interim commit is picked up by the next scan."""
        with tempfile.TemporaryDirectory() as td:
            mpath = os.path.join(td, "deploy_manifest.json")
            m = _staging_manifest(SHA_A)
            m["state"] = "production"
            for e in m["staged_workflows"]:
                e.update(production_status="triggered", production_trigger_time="2026-01-01T00:00:00Z")
            gh = FakeGh()
            with patch.object(check_status.subprocess, "run", gh), \
                    patch.object(sys, "argv", ["check_status.py", "--manifest", mpath, "--config", "x"]):
                check_status.check_production(m, 120)
            self.assertEqual(m["state"], "completed")
            with open(os.path.join(td, "scan_state.json"), encoding="utf-8") as f:
                self.assertEqual(json.load(f)["last_scanned_sha"], SHA_A)


class TestInterimCommitIsDetectedNextScan(unittest.TestCase):
    """On a real git repo: A staged and promoted, B lands meanwhile. B is not built by
    the A deploy (the dispatch pins A), and the next scan (from last_scanned_sha=A)
    sees B."""

    def _git(self, cwd, *args):
        subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True,
                       env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                            "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"})

    def test_interim_commit_picked_up_after_pinned_deploy(self):
        with tempfile.TemporaryDirectory() as repo:
            self._git(repo, "init", "-q")
            os.makedirs(os.path.join(repo, "content", "docs.aspose.org", "en"))
            with open(os.path.join(repo, "content", "docs.aspose.org", "en", "a.md"), "w") as f:
                f.write("a")
            self._git(repo, "add", "-A")
            self._git(repo, "commit", "-qm", "A")
            sha_a = detect_changes.get_head_sha(repo)
            # B lands while A is between staging and production
            os.makedirs(os.path.join(repo, "content", "kb.aspose.org", "en"))
            with open(os.path.join(repo, "content", "kb.aspose.org", "en", "b.md"), "w") as f:
                f.write("b")
            self._git(repo, "add", "-A")
            self._git(repo, "commit", "-qm", "B")
            sha_b = detect_changes.get_head_sha(repo)
            self.assertNotEqual(sha_a, sha_b)

            # the promotion for the A manifest pins A, never HEAD (= B)
            gh = FakeGh()
            with patch.object(check_status.subprocess, "run", gh), patch.object(check_status.time, "sleep"):
                check_status.trigger_workflow("docs.aspose.org.yml", "production", sha_a)
            self.assertEqual(_fields(gh.dispatches()[0])["ref"], sha_a)

            # scan_state after completion = A, so the next scan diffs A..HEAD and finds B's file
            self.assertEqual(detect_changes.get_changed_files(repo, sha_a),
                             ["content/kb.aspose.org/en/b.md"])


class TestTriggerWorkflowsScript(unittest.TestCase):
    def _run_main(self, manifest, dry_run=False):
        with tempfile.TemporaryDirectory() as td:
            mpath = os.path.join(td, "deploy_manifest.json")
            with open(mpath, "w", encoding="utf-8") as f:
                json.dump(manifest, f)
            gh = FakeGh()
            argv = ["trigger_workflows.py", "--manifest", mpath] + (["--dry-run"] if dry_run else [])
            with patch.object(trigger_workflows.subprocess, "run", gh), \
                    patch.object(trigger_workflows.time, "sleep"), patch.object(sys, "argv", argv):
                try:
                    trigger_workflows.main()
                    code = 0
                except SystemExit as e:
                    code = e.code
            return code, gh

    def _pending(self, sha):
        return {"state": "pending", "content_sha": sha,
                "staged_workflows": [{"workflow": "docs.aspose.org.yml"}],
                "production_only_workflows": [{"workflow": "releases.aspose.org.yml"}]}

    def test_staging_and_production_only_dispatches_are_pinned(self):
        code, gh = self._run_main(self._pending(SHA_A))
        self.assertEqual(code, 0)
        got = {(_fields(c)["environment"], _fields(c)["ref"]) for c in gh.dispatches()}
        self.assertEqual(got, {("staging", SHA_A), ("production", SHA_A)})

    def test_bad_sha_aborts_before_any_dispatch(self):
        code, gh = self._run_main(self._pending("main"))
        self.assertEqual(code, 1)
        self.assertEqual(gh.dispatches(), [])


if __name__ == "__main__":
    unittest.main()