import requests
from requests.exceptions import RequestException
from xml.etree import ElementTree as ET
import json
import os
from google.oauth2 import service_account
from googleapiclient.discovery import build

# Helper function to authenticate Google services
def authenticate_google_service(scopes, key_info):
    try:
        credentials = service_account.Credentials.from_service_account_info(
            key_info, scopes=scopes
        )
        return credentials
    except Exception as e:
        print(f"[ERROR] Authentication failed: {e}")
        return None

# Check sitemap status before submitting
def check_sitemap_status(service, site_url, sitemap_url):
    try:
        request = service.sitemaps().list(siteUrl=site_url)
        response = request.execute()
        for sitemap in response.get('sitemap', []):
            if sitemap.get('path') == sitemap_url:
                print(f"[INFO] Sitemap already submitted: {sitemap_url}")
                return True
        return False
    except Exception as e:
        print(f"[ERROR] Failed to check sitemap status for {sitemap_url}: {e}")
        return False

# Submit sitemap to Google
def submit_sitemap_to_google(service, site_url, sitemap_url):
    try:
        request = service.sitemaps().submit(siteUrl=site_url, feedpath=sitemap_url)
        request.execute()
        print(f"[INFO] Submitted sitemap to Google: {sitemap_url}")
    except Exception as e:
        print(f"[ERROR] Failed to submit sitemap: {sitemap_url}: {e}")

# Check sitemap availability for given index sitemaps
def check_sitemap_availability(base_url, families):
    available_sitemaps = []
    try:
        # Check main index sitemap
        index_sitemap_url = f"{base_url}/sitemap.xml"
        response = requests.get(index_sitemap_url, timeout=5)
        if response.status_code == 200:
            print(f"[INFO] Sitemap index found: {index_sitemap_url}")
            if is_sitemap_index(response.text):
                individual_sitemaps = get_individual_sitemaps(response.text)
                available_sitemaps.extend([(base_url, sitemap) for sitemap in individual_sitemaps])
        # Check family-specific sitemaps
        for family in families:
            family_sitemap_url = f"{base_url}/{family}/sitemap.xml"
            response = requests.get(family_sitemap_url, timeout=5)
            if response.status_code == 200:
                print(f"[INFO] Family sitemap index found: {family_sitemap_url}")
                if is_sitemap_index(response.text):
                    individual_sitemaps = get_individual_sitemaps(response.text)
                    available_sitemaps.extend([(base_url, sitemap) for sitemap in individual_sitemaps])
    except RequestException as e:
        print(f"[ERROR] Failed to fetch sitemaps from {base_url}: {e}")
    return available_sitemaps

# Determine if sitemap is an index
def is_sitemap_index(xml_content):
    try:
        root = ET.fromstring(xml_content)
        return any(loc.text.endswith('.xml') for loc in root.findall('.//{http://www.sitemaps.org/schemas/sitemap/0.9}loc'))
    except ET.ParseError as e:
        print(f"[ERROR] Failed to parse sitemap index: {e}")
        return False

# Extract individual sitemaps from sitemap index
def get_individual_sitemaps(xml_content):
    sitemaps = []
    try:
        root = ET.fromstring(xml_content)
        sitemaps = [loc.text for loc in root.findall('.//{http://www.sitemaps.org/schemas/sitemap/0.9}loc') if loc.text.endswith('.xml')]
    except ET.ParseError as e:
        print(f"[ERROR] Failed to parse individual sitemaps: {e}")
    return sitemaps

# Main integration
def main():
    # Load credentials from GitHub Actions secret
    try:
        credentials_info = json.loads(os.getenv('GOOGLE_CREDENTIALS_JSON'))
    except KeyError:
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

    # Base URL and families list
    base_url = "https://products.aspose.org"
    families = ['words', 'pdf', 'cells', 'imaging', 'barcode', 'tasks', 'ocr', 'cad', 'html', 'zip', 'page', 'psd', 'tex']

    # Process sitemaps and submit to Google
    try:
        available_sitemaps = check_sitemap_availability(base_url, families)
        for site_url, sitemap in available_sitemaps:
            if not check_sitemap_status(webmaster_service, site_url, sitemap):
                submit_sitemap_to_google(webmaster_service, site_url, sitemap)
    except Exception as e:
        print(f"[ERROR] Unexpected error processing sitemaps: {e}")

if __name__ == "__main__":
    main()
