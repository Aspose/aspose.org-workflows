"""
Unit tests for .github/actions/optional-s3-deploy/run_deploy_target.py

Run from repo root:
    python -m pytest tests/test_run_deploy_target.py -v
"""

import importlib.util
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# Dynamic import — file lives under .github/actions, not a package
_script_path = os.path.join(
    os.path.dirname(__file__),
    "..", ".github", "actions", "optional-s3-deploy", "run_deploy_target.py"
)
_spec = importlib.util.spec_from_file_location("run_deploy_target", _script_path)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_result(returncode=0, stdout="", stderr=""):
    r = MagicMock()
    r.returncode = returncode
    r.stdout = stdout
    r.stderr = stderr
    return r


def _run_main(args_list, hugo_returncode=0, hugo_stdout="", hugo_stderr=""):
    """
    Invoke run_deploy_target.main() with mocked sys.argv and subprocess.run.
    Returns (exit_code, printed_lines).
    """
    printed = []

    def fake_print(*args, **kwargs):
        printed.append(" ".join(str(a) for a in args))

    with patch("sys.argv", ["run_deploy_target.py"] + args_list), \
         patch("subprocess.run", return_value=_make_result(hugo_returncode, hugo_stdout, hugo_stderr)), \
         patch("sys.stdout.write"), \
         patch("sys.stderr.write"), \
         patch("sys.stdout.flush"), \
         patch("sys.stderr.flush"), \
         patch("builtins.print", side_effect=fake_print):
        try:
            _mod.main()
            return 0, printed
        except SystemExit as e:
            return e.code, printed


# ---------------------------------------------------------------------------
# Tests: classify_error
# ---------------------------------------------------------------------------

class TestClassifyError(unittest.TestCase):

    def test_nosuchbucket(self):
        out = _mod.classify_error("ERROR NoSuchBucket: the specified bucket does not exist")
        self.assertIn("NoSuchBucket", out)

    def test_access_denied(self):
        out = _mod.classify_error("AccessDenied when calling ListObjectsV2")
        self.assertIn("Access denied", out)

    def test_invalid_access_key(self):
        out = _mod.classify_error("The AWS Access Key Id you provided ... InvalidAccessKeyId")
        self.assertIn("Invalid AWS access key", out)

    def test_signature_mismatch(self):
        out = _mod.classify_error("SignatureDoesNotMatch: The request signature we calculated")
        self.assertIn("signature mismatch", out)

    def test_connection_refused(self):
        out = _mod.classify_error("dial tcp: connection refused")
        # could match either pattern
        self.assertTrue("Connection refused" in out or "Network" in out)

    def test_no_such_host(self):
        out = _mod.classify_error("no such host: s3-qa.example.com")
        self.assertIn("DNS", out)

    def test_unknown(self):
        out = _mod.classify_error("something totally unexpected 42")
        self.assertIn("Unknown", out)


# ---------------------------------------------------------------------------
# Tests: optional target behavior (exit 0 on failure)
# ---------------------------------------------------------------------------

class TestOptionalTarget(unittest.TestCase):

    _BASE_ARGS = [
        "--site", "websites.aspose.org",
        "--config", "./configs/websites.aspose.org.toml",
        "--target", "staging",
        "--required", "false",
        "--environment", "staging",
    ]

    def test_optional_success_exits_0(self):
        """Optional target succeeds → exit 0."""
        code, _ = _run_main(self._BASE_ARGS, hugo_returncode=0)
        self.assertEqual(code, 0)

    def test_optional_nosuchbucket_exits_0(self):
        """
        NoSuchBucket on optional target MUST exit 0.
        This is the primary regression guard for the May 2026 production outage.
        """
        code, lines = _run_main(
            self._BASE_ARGS,
            hugo_returncode=1,
            hugo_stderr="ERROR blob (code=NotFound): operation error S3: ListObjectsV2, "
                        "https response error StatusCode: 404, RequestID: ABC123, "
                        "NoSuchBucket:",
        )
        self.assertEqual(code, 0, "Optional target failure must not block the pipeline")
        warning_lines = [l for l in lines if "::warning" in l]
        self.assertTrue(warning_lines, "A ::warning:: annotation must be emitted")
        self.assertTrue(any("websites.aspose.org" in l for l in warning_lines))

    def test_optional_access_denied_exits_0(self):
        """AccessDenied on optional target → exit 0 with warning."""
        code, lines = _run_main(
            self._BASE_ARGS,
            hugo_returncode=1,
            hugo_stderr="AccessDenied: User is not authorized",
        )
        self.assertEqual(code, 0)

    def test_optional_production_s3_exits_0(self):
        """Optional production S3 failure must also exit 0."""
        args = [
            "--site", "docs.aspose.org",
            "--config", "./configs/docs.aspose.org.toml",
            "--target", "production",
            "--required", "false",
            "--environment", "production",
        ]
        code, _ = _run_main(args, hugo_returncode=1, hugo_stderr="NoSuchBucket:")
        self.assertEqual(code, 0)

    def test_optional_warning_contains_site(self):
        """Warning annotation must name the affected site."""
        code, lines = _run_main(
            self._BASE_ARGS,
            hugo_returncode=1,
            hugo_stderr="NoSuchBucket:",
        )
        self.assertEqual(code, 0)
        all_output = " ".join(lines)
        self.assertIn("websites.aspose.org", all_output)


# ---------------------------------------------------------------------------
# Tests: required target behavior (exit non-zero on failure)
# ---------------------------------------------------------------------------

class TestRequiredTarget(unittest.TestCase):

    _BASE_ARGS = [
        "--site", "websites.aspose.org",
        "--config", "./configs/websites.aspose.org.toml",
        "--target", "production_ceph",
        "--required", "true",
        "--environment", "production",
    ]

    def test_required_success_exits_0(self):
        """Required target succeeds → exit 0."""
        code, _ = _run_main(self._BASE_ARGS, hugo_returncode=0)
        self.assertEqual(code, 0)

    def test_required_failure_exits_nonzero(self):
        """Required target failure MUST propagate non-zero exit code."""
        code, lines = _run_main(
            self._BASE_ARGS,
            hugo_returncode=1,
            hugo_stderr="connection error: ceph endpoint unreachable",
        )
        self.assertNotEqual(code, 0, "Required target failure must fail the workflow")
        error_lines = [l for l in lines if "::error" in l]
        self.assertTrue(error_lines, "A ::error:: annotation must be emitted for required failures")

    def test_required_failure_exit_code_preserved(self):
        """Exit code from hugo deploy is propagated for required failures."""
        code, _ = _run_main(self._BASE_ARGS, hugo_returncode=2, hugo_stderr="timeout")
        self.assertEqual(code, 2)


# ---------------------------------------------------------------------------
# Tests: build_hugo_cmd
# ---------------------------------------------------------------------------

class TestBuildHugoCmd(unittest.TestCase):

    def _args(self, **kwargs):
        defaults = dict(
            config="./configs/test.toml",
            max_deletes=-1,
            target="staging",
            invalidate_cdn=False,
        )
        defaults.update(kwargs)
        ns = MagicMock()
        for k, v in defaults.items():
            setattr(ns, k, v)
        return ns

    def test_basic_cmd(self):
        cmd = _mod.build_hugo_cmd(self._args())
        self.assertIn("hugo", cmd)
        self.assertIn("deploy", cmd)
        self.assertIn("--maxDeletes=-1", cmd)

    def test_invalidate_cdn_flag(self):
        cmd = _mod.build_hugo_cmd(self._args(invalidate_cdn=True))
        self.assertIn("--invalidateCDN", cmd)

    def test_no_invalidate_cdn_by_default(self):
        cmd = _mod.build_hugo_cmd(self._args(invalidate_cdn=False))
        self.assertNotIn("--invalidateCDN", cmd)


if __name__ == "__main__":
    unittest.main()
