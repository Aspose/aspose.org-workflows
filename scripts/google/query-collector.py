#!/usr/bin/env python3
import argparse
import json
import os
import re
from datetime import datetime, timedelta

from googleapiclient.discovery import build
from google.oauth2 import service_account

# Configuration for Google Search Console API
SCOPES = ['https://www.googleapis.com/auth/webmasters.readonly']

def get_repo_root():
    """
    Returns the absolute path to the repository root.
    Assumes this script is in a subdirectory of the repo.
    """
    return os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

def get_keywords_file(subdomain, base_dir=None):
    """
    Returns the file path for storing keywords data for a given subdomain.
    If no base_dir is provided, it defaults to the /keywords folder at the repo root.
    """
    if base_dir is None:
        repo_root = get_repo_root()
        base_dir = os.path.join(repo_root, 'keywords')
    return os.path.join(base_dir, f"{subdomain}.json")

def save_keywords(file_path, data):
    """
    Saves the data (list of page records) to a JSON file.
    """
    os.makedirs(os.path.dirname(file_path), exist_ok=True)
    with open(file_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

def detect_language_from_url(url, default='en'):
    """
    A simple heuristic to detect a 2-letter language code in the URL.
    It can appear immediately after the domain (e.g., blog.aspose.net/fr/...)
    or after one extra segment (e.g., kb.aspose.net/barcode/fr/...).
    Defaults to 'en' if no 2-letter segment is found.
    """
    pattern = r'https?://[^/]+(?:/[^/]+)?/([a-zA-Z]{2})/'
    match = re.search(pattern, url)
    if match:
        lang_candidate = match.group(1)
        if len(lang_candidate) == 2:
            return lang_candidate.lower()
    return default

def fetch_gsc_data(site_url, start_date, end_date):
    """
    Fetches search analytics data for a given site_url and date range.
    Returns a list of rows where each row includes the page URL and query.
    """
    # Load credentials directly from the environment variable
    credentials_info = json.loads(os.environ['GOOGLE_CREDENTIALS_JSON'])
    credentials = service_account.Credentials.from_service_account_info(
        credentials_info, scopes=SCOPES)
    service = build('webmasters', 'v3', credentials=credentials)
    
    request = {
        'startDate': start_date,
        'endDate': end_date,
        'dimensions': ['page', 'query'],
        'rowLimit': 25000  # Adjust as needed
    }
    
    response = service.searchanalytics().query(siteUrl=site_url, body=request).execute()
    return response.get('rows', [])

def group_keywords_by_page(rows):
    """
    Groups rows returned from the GSC API by page URL,
    filtering out pages with paths containing /tag/, /categories/, or /archives/.
    Returns a dictionary mapping page URL to a set of keywords.
    """
    page_keywords = {}
    unwanted_patterns = ['/tag/', '/categories/', '/archives/']
    for row in rows:
        keys = row.get('keys', [])
        if len(keys) < 2:
            continue
        page, query = keys[0], keys[1]
        if any(pattern in page for pattern in unwanted_patterns):
            continue
        if page not in page_keywords:
            page_keywords[page] = set()
        page_keywords[page].add(query)
    return page_keywords

def main():
    parser = argparse.ArgumentParser(
        description='Extract and assemble keywords from GSC for a subdomain (last 28 days)')
    parser.add_argument('--subdomain', type=str, required=True,
                        help='Subdomain identifier (e.g., docs.aspose.org)')
    parser.add_argument('--base-dir', type=str,
                        help='Base directory to store keywords JSON (overrides default repo-root/keywords)')
    args = parser.parse_args()

    subdomain = args.subdomain
    base_dir = args.base_dir  # May be None; get_keywords_file will handle it.

    site_url = f"https://{subdomain}"
    print(f"Fetching data for site: {site_url}")

    end_date = datetime.now().date()
    start_date = end_date - timedelta(days=28)
    start_date_str = start_date.strftime('%Y-%m-%d')
    end_date_str = end_date.strftime('%Y-%m-%d')
    print(f"Date range: {start_date_str} to {end_date_str}")

    rows = fetch_gsc_data(site_url, start_date_str, end_date_str)
    if not rows:
        print("No data returned from GSC.")
        return

    page_keywords = group_keywords_by_page(rows)

    output_data = []
    for page_url, keywords_set in page_keywords.items():
        record = {
            'url': page_url,
            'keywords': sorted(list(keywords_set)),
            'lang': detect_language_from_url(page_url),
            'lastUpdated': end_date_str
        }
        output_data.append(record)

    keywords_file = get_keywords_file(subdomain, base_dir)
    save_keywords(keywords_file, output_data)
    print(f"Saved keywords for {len(output_data)} pages to {keywords_file}")

if __name__ == '__main__':
    main()
