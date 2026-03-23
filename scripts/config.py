"""
Shared configuration for aspose.org scripts.
All domain, subdomain, family, and language constants live here.
"""

DOMAIN = "aspose.org"

# All 7 aspose.org subdomains
SUBDOMAINS = [
    "www.aspose.org",
    "products.aspose.org",
    "docs.aspose.org",
    "kb.aspose.org",
    "blog.aspose.org",
    "reference.aspose.org",
    "websites.aspose.org",
]

# Content families per site (used by detect_changes.py).
# NOT used for sitemaps — aspose.org has whole-site sitemaps only, no per-family sitemaps.
SITE_FAMILIES = {
    "products.aspose.org": [
        "3d", "barcode", "cad", "cells", "diagram", "drawing", "email",
        "finance", "font", "gis", "html", "imaging", "medical", "note",
        "ocr", "omr", "page", "pdf", "psd", "pub", "slides", "svg",
        "tasks", "tex", "words", "zip",
    ],
    "docs.aspose.org":      ["3d", "cells", "note", "slides"],
    "kb.aspose.org":         ["3d", "cells", "note", "slides"],
    "reference.aspose.org":  ["3d", "cells", "note", "slides"],
    "blog.aspose.org":       ["3d", "cells", "email", "note", "slides"],
}

# Union of all families
ALL_FAMILIES = sorted(set(f for fams in SITE_FAMILIES.values() for f in fams))

# Languages used across multilingual sites (from products.aspose.org lang dirs)
LANGUAGES = sorted([
    "ar", "bg", "ca", "cs", "da", "de", "el", "es", "fa", "fi",
    "fr", "he", "hi", "hr", "hu", "id", "it", "ja", "ko", "lt",
    "lv", "ms", "nl", "no", "pl", "pt", "ro", "ru", "sk", "sr",
    "sv", "th", "tr", "uk", "vi", "zh",
])
