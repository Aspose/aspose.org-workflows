import os
import json
import sys
import requests
import xml.etree.ElementTree as ET

# Import shared config
sys.path.append( os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from config import SUBDOMAINS


# Helper function to authenticate Google services
def authenticate_google_service(scopes, key_info):
    try:
        from google.oauth2 import service_account
        credentials = service_account.Credentials.from_service_account_info(
            key_info, scopes=scopes
        )
        return credentials
    except Exception as e:
        print(f"[ERROR] Authentication failed: {e}")
        return None


# Extract nested sitemaps from an index sitemap (including multilingual sitemaps)
def extract_sitemaps_from_index(sitemap_url):
    try:
        response = requests.get(sitemap_url, timeout=5)
        if response.status_code == 200:
            root = ET.fromstring(response.text)
            # Check if this is a sitemap index (root tag should be "sitemapindex")
            if not root.tag.endswith("sitemapindex"):
                # Not a sitemap index; return empty list so the sitemap is submitted directly.
                return []
            tree = ET.ElementTree(root)
            sitemaps = [url.text for url in tree.findall(".//{*}loc")]
            return sitemaps
    except requests.RequestException as e:
        print(f"[ERROR] Failed to fetch sitemap: {sitemap_url}: {e}")
    except ET.ParseError as e:
        print(f"[ERROR] Failed to parse XML from {sitemap_url}: {e}")
    return []


# Submit sitemap to Google (always resubmit)
def submit_sitemap_to_google(service, site_url, sitemap_url, dry_run=False):
    if dry_run:
        print(f"[DRY-RUN] Would submit sitemap to Google: {sitemap_url}")
        return
    try:
        request = service.sitemaps().submit(siteUrl=site_url, feedpath=sitemap_url)
        request.execute()
        print(f"[INFO] Resubmitted sitemap to Google: {sitemap_url}")
    except Exception as e:
        print(f"[ERROR] Failed to submit sitemap: {sitemap_url}: {e}")


# Check sitemap availability for a subdomain (whole-site sitemaps only)
def check_sitemap_availability(base_url):
    available_sitemaps = []
    index_sitemap_url = f"{base_url}/sitemap.xml"

    try:
        response = requests.get(index_sitemap_url, timeout=5)
        if response.status_code == 200:
            print(f"[INFO] Sitemap index found: {index_sitemap_url}")
            available_sitemaps.append((base_url, index_sitemap_url))

            # Extract all nested sitemaps (including multilingual versions)
            extracted_sitemaps = extract_sitemaps_from_index(index_sitemap_url)
            for extracted_sitemap in extracted_sitemaps:
                print(f"[INFO] Extracted sitemap: {extracted_sitemap}")
                available_sitemaps.append((base_url, extracted_sitemap))

    except requests.RequestException as e:
        print(f"[ERROR] Failed to fetch sitemaps from {base_url}: {e}")

    return available_sitemaps


# Helper function to check sitemaps for all subdomains
def check_all_subdomain_sitemaps(subdomains):
    all_available_sitemaps = []
    for subdomain in subdomains:
        print(f"[INFO] Checking sitemaps for subdomain: {subdomain}")
        available_sitemaps = check_sitemap_availability(f"https://{subdomain}")
        all_available_sitemaps.extend(available_sitemaps)
    return all_available_sitemaps


# Main execution
def main():
    dry_run = "--dry-run" in sys.argv

    if not dry_run:
        try:
            from google.oauth2 import service_account
            from googleapiclient.discovery import build
        except ImportError as e:
            print(f"[ERROR] Missing Google libraries: {e}")
            print("[ERROR] Install: google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client")
            sys.exit(1)

        # Load credentials from GitHub Actions secret
        try:
            credentials_info = json.loads(os.getenv('GOOGLE_CREDENTIALS_JSON'))
        except (TypeError, KeyError):
            print("[ERROR] GOOGLE_CREDENTIALS_JSON environment variable not set.")
            return
        except json.JSONDecodeError as e:
            print(f"[ERROR] Failed to decode GOOGLE_CREDENTIALS_JSON: {e}")
            return

        webmaster_scopes = ['https://www.googleapis.com/auth/webmasters']

        # Authenticate Google service
        webmaster_credentials = authenticate_google_service(webmaster_scopes, credentials_info)
        if not webmaster_credentials:
            print("[ERROR] Unable to authenticate Google service. Exiting.")
            return

        try:
            webmaster_service = build('searchconsole', 'v1', credentials=webmaster_credentials)
        except Exception as e:
            print(f"[ERROR] Failed to initialize Google Search Console service: {e}")
            return
    else:
        print("[DRY-RUN] Skipping authentication (no credentials needed)")
        webmaster_service = None

    # Process sitemaps for all subdomains and resubmit them to Google
    try:
        all_sitemaps = check_all_subdomain_sitemaps(SUBDOMAINS)
        for site_url, sitemap in all_sitemaps:
            submit_sitemap_to_google(webmaster_service, site_url, sitemap, dry_run)
    except Exception as e:
        print(f"[ERROR] Unexpected error processing sitemaps: {e}")


if __name__ == "__main__":
    main()
