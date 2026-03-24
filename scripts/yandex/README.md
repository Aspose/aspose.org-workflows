# Yandex Webmaster Tools

Sitemap discovery and resubmission via the Yandex Webmaster API.

## Scripts

### sitemaps.py

Discovers all sitemaps across Aspose subdomains and resubmits them to Yandex Webmaster.

```bash
python sitemaps.py
```

- Authenticates via Yandex OAuth token and retrieves user ID and host mappings
- Fetches `sitemap.xml` from each subdomain and parses sitemap indexes
- For family-based subdomains (`products`, `kb`, `docs`, `reference`), also probes per-family sitemaps
- Extracts nested and multilingual sitemaps from indexes
- Submits every discovered sitemap via the Yandex `user-added-sitemaps` API endpoint

**Subdomains covered:**
`products`, `blog`, `docs`, `about`, `reference`, `kb` (all under `aspose.net`)

## Dependencies

- Python 3.x
- `requests`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `YANDEX_OAUTH_TOKEN` | Yandex Webmaster OAuth access token |
