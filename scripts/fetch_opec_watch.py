#!/usr/bin/env python3
"""
Scrape CME OPEC Watch probabilities and update physical-markets.js.

CME OPEC Watch derives meeting outcome probabilities from WTI crude oil
options prices. Since there's no public API, we scrape the rendered page.

Output: Updates the OPEC_WATCH_DATA object in docs/physical-markets.js

Usage:
    python scripts/fetch_opec_watch.py

Designed to run on a schedule (e.g., daily via GitHub Actions).
"""

import json
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime, timezone


CME_OPEC_WATCH_URL = 'https://www.cmegroup.com/markets/energy/opec-watch.html'
JS_FILE = Path(__file__).parent.parent / 'docs' / 'physical-markets.js'

# Fallback: try fetching the JSON data endpoint that CME's frontend uses
CME_API_URLS = [
    'https://www.cmegroup.com/services/opec-watch/opec-watch.json',
    'https://www.cmegroup.com/CmeWS/mvc/opec/OPECWatch',
    'https://www.cmegroup.com/content/cmegroup/en/markets/energy/opec-watch.ajax.json',
]


def fetch_with_retry(url, retries=3, delay=5):
    """Fetch URL with retries and browser-like headers."""
    import time
    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Connection': 'keep-alive',
    }

    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=headers)
            resp = urllib.request.urlopen(req, timeout=30)
            return resp.read().decode('utf-8')
        except (urllib.error.HTTPError, urllib.error.URLError, Exception) as e:
            print(f"  Attempt {attempt + 1}/{retries} failed: {e}")
            if attempt < retries - 1:
                wait = delay * (2 ** attempt)
                print(f"  Retrying in {wait}s...")
                time.sleep(wait)
    return None


def try_fetch_json_api():
    """Try CME's potential JSON API endpoints."""
    for url in CME_API_URLS:
        print(f"  Trying API: {url}")
        content = fetch_with_retry(url, retries=2, delay=3)
        if content:
            try:
                data = json.loads(content)
                if data:
                    print(f"  Got JSON data from {url}")
                    return data
            except json.JSONDecodeError:
                pass
    return None


def parse_opec_watch_html(html):
    """Parse OPEC Watch data from the HTML page."""
    meetings = []

    # Look for embedded JSON data in script tags
    # CME often embeds data as JSON in <script> tags or data attributes
    json_patterns = [
        r'opecWatchData\s*=\s*(\{[^;]+\});',
        r'var\s+data\s*=\s*(\{[^;]+\});',
        r'"opecWatch"\s*:\s*(\{[^}]+\})',
        r'chartData\s*=\s*(\[[^\]]+\])',
    ]

    for pattern in json_patterns:
        match = re.search(pattern, html, re.DOTALL)
        if match:
            try:
                data = json.loads(match.group(1))
                print(f"  Found embedded JSON data")
                return parse_json_data(data)
            except json.JSONDecodeError:
                continue

    # Try parsing from table structure
    # CME OPEC Watch uses a table with probability percentages
    table_pattern = r'<table[^>]*class="[^"]*opec[^"]*"[^>]*>(.*?)</table>'
    table_match = re.search(table_pattern, html, re.DOTALL | re.IGNORECASE)
    if table_match:
        return parse_table_data(table_match.group(1))

    # Try parsing probability bars/charts
    prob_pattern = r'(?:Large\s+Cut|Small\s+Cut|No\s+Change|Small\s+Increase|Large\s+Increase)[^0-9]*?(\d+\.?\d*)%'
    probs = re.findall(prob_pattern, html, re.IGNORECASE)
    if probs:
        print(f"  Found {len(probs)} probability values from text")

    return meetings


def parse_json_data(data):
    """Parse structured JSON data from CME."""
    meetings = []

    if isinstance(data, dict):
        for key in ['meetings', 'data', 'results', 'opecMeetings']:
            if key in data:
                items = data[key]
                if isinstance(items, list):
                    for item in items:
                        mtg = extract_meeting_from_json(item)
                        if mtg:
                            meetings.append(mtg)
                    break

    elif isinstance(data, list):
        for item in data:
            mtg = extract_meeting_from_json(item)
            if mtg:
                meetings.append(mtg)

    return meetings


def extract_meeting_from_json(item):
    """Extract a single meeting's data from a JSON object."""
    if not isinstance(item, dict):
        return None

    date = item.get('date', item.get('meetingDate', ''))
    label = item.get('label', item.get('title', item.get('meetingTitle', '')))
    probs = item.get('probabilities', item.get('outcomes', {}))

    if not date or not probs:
        return None

    # Normalize probabilities
    outcome_map = {
        'largeCut': 'Large Cut (>1M)',
        'smallCut': 'Small Cut',
        'noChange': 'No Change',
        'smallIncrease': 'Small Increase',
        'largeIncrease': 'Large Increase (>1M)',
        'large_cut': 'Large Cut (>1M)',
        'small_cut': 'Small Cut',
        'no_change': 'No Change',
        'small_increase': 'Small Increase',
        'large_increase': 'Large Increase (>1M)',
    }

    normalized = {}
    if isinstance(probs, dict):
        for k, v in probs.items():
            norm_key = outcome_map.get(k, k)
            try:
                normalized[norm_key] = round(float(v), 1)
            except (ValueError, TypeError):
                pass
    elif isinstance(probs, list):
        outcomes = ['Large Cut (>1M)', 'Small Cut', 'No Change', 'Small Increase', 'Large Increase (>1M)']
        for i, v in enumerate(probs[:5]):
            try:
                normalized[outcomes[i]] = round(float(v), 1)
            except (ValueError, TypeError):
                pass

    if not normalized:
        return None

    return {
        'date': date,
        'label': label,
        'probabilities': normalized,
    }


def parse_table_data(table_html):
    """Parse probabilities from an HTML table."""
    meetings = []

    rows = re.findall(r'<tr[^>]*>(.*?)</tr>', table_html, re.DOTALL)
    for row in rows:
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
        numbers = []
        for cell in cells:
            clean = re.sub(r'<[^>]+>', '', cell).strip()
            match = re.search(r'(\d+\.?\d*)%?', clean)
            if match:
                numbers.append(float(match.group(1)))

        if len(numbers) >= 5:
            meetings.append({
                'probabilities': {
                    'Large Cut (>1M)': numbers[0],
                    'Small Cut': numbers[1],
                    'No Change': numbers[2],
                    'Small Increase': numbers[3],
                    'Large Increase (>1M)': numbers[4],
                }
            })

    return meetings


def update_js_file(meetings):
    """Update the OPEC_WATCH_DATA meetings in physical-markets.js."""
    if not meetings:
        print("  No meetings data to update")
        return False

    js_content = JS_FILE.read_text()

    # Build the new meetings array JS
    meetings_js = "[\n"
    for mtg in meetings:
        probs_js = json.dumps(mtg['probabilities'], indent=8)
        # Convert Python dict to JS object formatting
        probs_js = probs_js.replace('"Large Cut (>1M)"', "'Large Cut (>1M)'")
        probs_js = probs_js.replace('"Small Cut"', "'Small Cut'")
        probs_js = probs_js.replace('"No Change"', "'No Change'")
        probs_js = probs_js.replace('"Small Increase"', "'Small Increase'")
        probs_js = probs_js.replace('"Large Increase (>1M)"', "'Large Increase (>1M)'")

        meetings_js += f"""        {{
            date: '{mtg['date']}',
            label: '{mtg['label']}',
            probabilities: {probs_js},
        }},
"""
    meetings_js += "    ]"

    # Replace the meetings array in the JS file
    pattern = r'(meetings:\s*)\[[\s\S]*?\n\s*\]'
    match = re.search(pattern, js_content)

    if match:
        new_content = js_content[:match.start()] + 'meetings: ' + meetings_js + js_content[match.end():]
        JS_FILE.write_text(new_content)
        print(f"  Updated {JS_FILE} with {len(meetings)} meetings")
        return True
    else:
        print("  Could not find meetings array in JS file")
        return False


def main():
    print("=" * 60)
    print("CME OPEC Watch Scraper")
    print("=" * 60)

    # Strategy 1: Try JSON API endpoints
    print("\n1. Trying CME JSON API endpoints...")
    json_data = try_fetch_json_api()
    if json_data:
        meetings = parse_json_data(json_data)
        if meetings:
            print(f"\n  Parsed {len(meetings)} meetings from API")
            for m in meetings:
                print(f"    {m.get('date', 'N/A')}: {m.get('label', 'N/A')}")
                for outcome, prob in m.get('probabilities', {}).items():
                    print(f"      {outcome}: {prob}%")
            update_js_file(meetings)
            return

    # Strategy 2: Try scraping the HTML page
    print("\n2. Trying HTML scrape of OPEC Watch page...")
    html = fetch_with_retry(CME_OPEC_WATCH_URL)
    if html:
        meetings = parse_opec_watch_html(html)
        if meetings:
            print(f"\n  Parsed {len(meetings)} meetings from HTML")
            update_js_file(meetings)
            return
        else:
            print("  Could not parse meetings from HTML")

    # Strategy 3: No data available — keep existing hardcoded data
    print("\n3. Could not fetch live data. Keeping existing hardcoded data.")
    print("   The hardcoded data in physical-markets.js will be used.")
    print("   To update manually, edit OPEC_WATCH_DATA in docs/physical-markets.js")
    print("\n   Note: CME may block automated access. Consider:")
    print("   - Using a headless browser (Playwright/Puppeteer)")
    print("   - Checking if CME offers a data API subscription")
    print("   - Manual periodic updates of the hardcoded data")


if __name__ == '__main__':
    main()
