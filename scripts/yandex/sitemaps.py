import os
import json
import sys
import requests
import xml.etree.ElementTree as ET

# Import shared config
sys.path.append( os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from config import SUBDOMAINS


# Helper function to get the Yandex Webmaster API access token
def get_yandex_access_token():
    try:
        token = os.getenv('YANDEX_OAUTH_TOKEN')
        if not token:
            raise ValueError("YANDEX_OAUTH_TOKEN environment variable not set.")
        return token
    except Exception as e:
        print(f"[ERROR] Token retrieval failed: {e}")
        return None

# Helper function to get the Yandex hosts and their IDs for the user
def get_yandex_hosts_and_ids(access_token):
    """
    Retrieves a dictionary of hosts and their IDs from Yandex.Webmaster.

    Args:
        access_token (str): The OAuth token for Yandex.

    Returns:
        tuple: A tuple containing the user ID (str) and a dictionary
               mapping host URLs to their host IDs.
    """
    headers = {
        'Authorization': f'OAuth {access_token}',
        'Content-Type': 'application/json'
    }

    # Step 1: Get the user ID
    user_id_url = "https://api.webmaster.yandex.net/v4/user"
    try:
        user_id_response = requests.get(user_id_url, headers=headers)
        user_id_response.raise_for_status()
        user_id = user_id_response.json()['user_id']
        print(f"[INFO] Successfully retrieved Yandex User ID: {user_id}")
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] Failed to retrieve user ID from Yandex: {e}")
        return None, {}
    except KeyError:
        print("[ERROR] Failed to parse user ID from Yandex response.")
        return None, {}

    # Step 2: Get the list of hosts using the user ID
    hosts_url = f"https://api.webmaster.yandex.net/v4/user/{user_id}/hosts"
    try:
        hosts_response = requests.get(hosts_url, headers=headers)
        hosts_response.raise_for_status()
        hosts_data = hosts_response.json()

        host_map = {}
        for host in hosts_data.get('hosts', []):
            host_map[host['ascii_host_url'].rstrip('/')] = host['host_id']
        print("[INFO] Successfully retrieved hosts from Yandex.")
        return user_id, host_map
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] Failed to retrieve hosts from Yandex: {e}")
        return user_id, {}
    except KeyError:
        print("[ERROR] Failed to parse Yandex hosts response.")
        return user_id, {}

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

# Submit sitemap to Yandex (always resubmit)
def submit_sitemap_to_yandex(access_token, user_id, host_id, sitemap_url, dry_run=False):
    if dry_run:
        print(f"[DRY-RUN] Would submit sitemap to Yandex: {sitemap_url}")
        return
    try:
        headers = {'Authorization': f'OAuth {access_token}'}
        payload = {'url': sitemap_url}
        # Correct API endpoint
        url = f'https://api.webmaster.yandex.net/v4/user/{user_id}/hosts/{host_id}/user-added-sitemaps'
        response = requests.post(url, headers=headers, json=payload)
        response.raise_for_status()
        print(f"[INFO] Resubmitted sitemap to Yandex: {sitemap_url}")
    except requests.RequestException as e:
        print(f"[ERROR] Failed to submit sitemap to Yandex: {sitemap_url}: {e}")

# Check sitemap availability for a subdomain (whole-site sitemaps only)
def check_sitemap_availability(base_url):
    available_sitemaps = []
    index_sitemap_url = f"{base_url}/sitemap.xml"

    try:
        # Fetch and validate main sitemap index
        response = requests.head(index_sitemap_url, timeout=5)  # Lightweight check
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
        # Load Yandex OAuth token from environment variable
        access_token = get_yandex_access_token()
        if not access_token:
            print("[ERROR] Yandex OAuth token is missing. Exiting.")
            return

        # Get all Yandex hosts and their IDs at once
        user_id, yandex_hosts = get_yandex_hosts_and_ids(access_token)

        print(f"Yandex hosts retrieved: {yandex_hosts}")

        if not yandex_hosts:
            print("[ERROR] No Yandex hosts found or retrieval failed. Exiting.")
            return
    else:
        print("[DRY-RUN] Skipping authentication (no credentials needed)")
        access_token = None
        user_id = None
        yandex_hosts = {}

    # Process sitemaps for all subdomains and resubmit them to Yandex
    try:
        all_sitemaps = check_all_subdomain_sitemaps(SUBDOMAINS)
        for base_url, sitemap in all_sitemaps:

            # The Yandex API returns the host URL without the port number in the key
            normalized_url = base_url.rstrip('/')
            host_id = yandex_hosts.get(normalized_url)

            if host_id or dry_run:
                submit_sitemap_to_yandex(access_token, user_id, host_id, sitemap, dry_run)
            else:
                print(f"[WARNING] Could not find host ID for {normalized_url}. Skipping sitemap submission.")
    except Exception as e:
        print(f"[ERROR] Unexpected error processing sitemaps: {e}")


if __name__ == "__main__":
    main()
