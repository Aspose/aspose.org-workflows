"""
Unit tests for scripts/deploy/detect_changes.py's path -> workflow mapping.

Focus: releases.aspose.org (2026-09-25) -- it has no content/<site>/ tree of
its own, so it needs its own rule mapping specific data/*.json files to its
workflow, and needs to be part of SITES so a global theme/layout change (and
a configs/releases.aspose.org.* change) also redeploys it. Before this fix,
releases.aspose.org.yml was reachable only by manual workflow_dispatch and had
not rebuilt in 15 days despite data/package_registry.json changing repeatedly.

Run from repo root, same convention as test_run_deploy_target.py.
"""

import importlib.util
import os
import unittest

_script_path = os.path.join(
    os.path.dirname(__file__), "..", "scripts", "deploy", "detect_changes.py"
)
_spec = importlib.util.spec_from_file_location("detect_changes", _script_path)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)


class TestReleasesSiteIsDeployable(unittest.TestCase):
    def test_releases_workflow_is_in_the_full_deploy_set(self):
        self.assertIn("releases.aspose.org.yml", _mod.get_all_deploy_workflows())

    def test_releases_site_does_not_leak_into_shared_subdomains(self):
        # config.SUBDOMAINS also drives the weekly Google/Yandex sitemap
        # submitters -- releases.aspose.org must stay out of that list.
        from config import SUBDOMAINS
        self.assertNotIn("releases.aspose.org", SUBDOMAINS)
        self.assertIn("releases.aspose.org", _mod.SITES)


class TestDataFileMapping(unittest.TestCase):
    def test_package_registry_change_maps_to_releases_only(self):
        workflows, is_global = _mod.map_path_to_workflow("data/package_registry.json")
        self.assertEqual(workflows, {"releases.aspose.org.yml"})
        self.assertFalse(is_global)

    def test_each_releases_data_file_maps_correctly(self):
        for f in _mod.RELEASES_DATA_FILES:
            workflows, _ = _mod.map_path_to_workflow(f)
            self.assertEqual(workflows, {"releases.aspose.org.yml"}, f)

    def test_unrelated_data_file_maps_to_nothing(self):
        workflows, is_global = _mod.map_path_to_workflow("data/seo_autonomy_state.json")
        self.assertEqual(workflows, set())
        self.assertFalse(is_global)

    def test_other_sites_content_change_does_not_touch_releases(self):
        workflows, _ = _mod.map_path_to_workflow("content/docs.aspose.org/en/cells/python/_index.md")
        self.assertNotIn("releases.aspose.org.yml", workflows)
        self.assertIn("docs.aspose.org.yml", workflows)


class TestConfigAndGlobalPaths(unittest.TestCase):
    def test_releases_config_file_maps_to_releases_workflow(self):
        workflows, is_global = _mod.map_path_to_workflow("configs/releases.aspose.org.toml")
        self.assertEqual(workflows, {"releases.aspose.org.yml"})
        self.assertFalse(is_global)

    def test_global_theme_change_includes_releases(self):
        workflows, is_global = _mod.map_path_to_workflow("themes/releases/layouts/_default/homepage.html")
        self.assertTrue(is_global)
        self.assertIn("releases.aspose.org.yml", workflows)


class TestReleasesDependentProductsContent(unittest.TestCase):
    """products.aspose.org platform _index.md pages also feed releases.aspose.org."""

    PRODUCTS = "products.aspose.org.yml"
    RELEASES = "releases.aspose.org.yml"

    def test_platform_index_maps_to_products_and_releases(self):
        workflows, is_global = _mod.map_path_to_workflow(
            "content/products.aspose.org/en/gis/net/_index.md"
        )
        self.assertEqual(workflows, {self.PRODUCTS, self.RELEASES})
        self.assertFalse(is_global)

    def test_non_en_locale_maps_to_products_only(self):
        workflows, _ = _mod.map_path_to_workflow(
            "content/products.aspose.org/de/gis/net/_index.md"
        )
        self.assertEqual(workflows, {self.PRODUCTS})

    def test_depth_three_index_maps_to_products_only(self):
        workflows, _ = _mod.map_path_to_workflow(
            "content/products.aspose.org/en/gis/net/features/_index.md"
        )
        self.assertEqual(workflows, {self.PRODUCTS})

    def test_family_level_index_maps_to_products_only(self):
        workflows, _ = _mod.map_path_to_workflow(
            "content/products.aspose.org/en/gis/_index.md"
        )
        self.assertEqual(workflows, {self.PRODUCTS})

    def test_non_index_file_under_platform_maps_to_products_only(self):
        for name in ("overview.md", "index.md", "_index.de.md", "_index.md.bak"):
            workflows, _ = _mod.map_path_to_workflow(
                f"content/products.aspose.org/en/gis/net/{name}"
            )
            self.assertEqual(workflows, {self.PRODUCTS}, name)

    def test_other_sites_platform_index_does_not_touch_releases(self):
        workflows, _ = _mod.map_path_to_workflow(
            "content/docs.aspose.org/en/pdf/net/_index.md"
        )
        self.assertEqual(workflows, {"docs.aspose.org.yml"})

    def test_existing_data_files_still_map_to_releases_only(self):
        for f in _mod.RELEASES_DATA_FILES:
            workflows, is_global = _mod.map_path_to_workflow(f)
            self.assertEqual(workflows, {self.RELEASES}, f)
            self.assertFalse(is_global, f)

    def test_global_paths_still_return_all_workflows(self):
        workflows, is_global = _mod.map_path_to_workflow("themes/products/layouts/baseof.html")
        self.assertTrue(is_global)
        self.assertEqual(workflows, _mod.get_all_deploy_workflows())

    def test_windows_backslash_path_behaves_the_same(self):
        workflows, _ = _mod.map_path_to_workflow(
            "content\\products.aspose.org\\en\\gis\\net\\_index.md"
        )
        self.assertEqual(workflows, {self.PRODUCTS, self.RELEASES})
        workflows, _ = _mod.map_path_to_workflow(
            "content\\products.aspose.org\\de\\gis\\net\\_index.md"
        )
        self.assertEqual(workflows, {self.PRODUCTS})

    def test_near_miss_shapes_do_not_trigger_releases(self):
        # fullmatch: a trailing newline or a suffix must not slip through `$`.
        for path in (
            "content/products.aspose.org/en/gis/net/_index.md\n",
            "content/products.aspose.org/en/gis/net/_index.md.bak",
            "content/products.aspose.org/en/gis/net/_index.md ",
            "content/products.aspose.org/en/gis/net/_INDEX.md",
        ):
            workflows, _ = _mod.map_path_to_workflow(path)
            self.assertNotIn(self.RELEASES, workflows, path)


if __name__ == "__main__":
    unittest.main()
