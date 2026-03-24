# Google Search Console Tools

SEO pipeline tools for collecting search queries and resubmitting sitemaps via the Google Search Console API.

## Scripts

### query-collector.py

Collects last-28-days search queries from GSC for a given subdomain and compiles per-page keyword lists.

```bash
python query-collector.py --subdomain docs.aspose.net
python query-collector.py --subdomain blog.aspose.net --base-dir D:/data/keywords
```

- Fetches page × query analytics via the GSC Search Analytics API
- Groups queries by page URL, producing a sorted keyword list per page
- Detects language from the URL path (defaults to `en`)
- Filters out `/tag/`, `/categories/`, and `/archives/` paths
- Writes output to `<repo_root>/keywords/<subdomain>.json` (or custom `--base-dir`)

**Output format:**

```json
{
  "url": "https://docs.aspose.net/words/en/convert/docx-to-pdf/",
  "keywords": ["docx to pdf c#", "aspose words convert"],
  "lang": "en",
  "lastUpdated": "2025-09-19"
}
```

### sitemaps.py

Discovers all sitemaps across Aspose subdomains and resubmits them to Google Search Console.

```bash
python sitemaps.py
```

- Fetches `sitemap.xml` from each subdomain and parses sitemap indexes
- For family-based subdomains (`kb`, `docs`, `products`, `reference`), also probes per-family sitemaps
- Extracts nested and multilingual sitemaps from indexes
- Submits every discovered sitemap to GSC via `sitemaps().submit()`

**Subdomains covered:**
`products`, `blog`, `docs`, `kb`, `about`, `reference`, `websites` (all under `aspose.net`)

## Dependencies

- Python 3.x
- `requests`
- `google-auth`
- `google-api-python-client`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GOOGLE_CREDENTIALS_JSON` | Service account credentials JSON string (inline, not a file path) |
