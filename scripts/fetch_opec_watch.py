#!/usr/bin/env python3
"""
Scrape CME OPEC Watch probabilities using Playwright headless browser.

CME OPEC Watch derives meeting outcome probabilities from WTI crude oil
options prices. The page is Cloudflare-protected and uses QuikStrike iframes,
so we need a real browser to render it.

Output:
  - docs/data/opec-watch.json  (date-stamped history for day-over-day shifts)
  - docs/physical-markets.js   (updates OPEC_WATCH_DATA inline)

Usage:
    pip install playwright && playwright install chromium
    python scripts/fetch_opec_watch.py

Designed to run on a schedule (e.g., daily via GitHub Actions).
"""

import json
import re
import sys
import time
from pathlib import Path
from datetime import datetime, timezone, timedelta

CME_OPEC_WATCH_URL = 'https://www.cmegroup.com/markets/energy/opec-watch.html'
JS_FILE = Path(__file__).parent.parent / 'docs' / 'physical-markets.js'
DATA_FILE = Path(__file__).parent.parent / 'docs' / 'data' / 'opec-watch.json'

# Canonical outcome labels
OUTCOMES = ['Large Cut (>1M)', 'Small Cut', 'No Change', 'Small Increase', 'Large Increase (>1M)']


def load_history():
    """Load existing history from JSON file."""
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {'snapshots': [], 'meetings': []}


def save_history(data):
    """Save history to JSON file."""
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(data, indent=2))
    print(f"  Saved history to {DATA_FILE}")


def _find_chromium():
    """Find an available Chromium binary in the Playwright cache."""
    import glob
    import os
    cache_dir = os.path.expanduser('~/.cache/ms-playwright')
    # Look for any chromium build (version may differ from pip package)
    patterns = [
        os.path.join(cache_dir, 'chromium-*/chrome-linux/chrome'),
        os.path.join(cache_dir, 'chromium-*/chrome-linux64/chrome'),
        os.path.join(cache_dir, 'chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell'),
    ]
    for pattern in patterns:
        matches = sorted(glob.glob(pattern))
        if matches:
            return matches[-1]  # latest version
    return None


def scrape_with_playwright():
    """Use Playwright to load the CME OPEC Watch page and extract data."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("ERROR: playwright not installed.")
        print("  pip install playwright && playwright install chromium")
        return None

    print(f"  Loading {CME_OPEC_WATCH_URL} ...")
    meetings = []

    with sync_playwright() as p:
        # Try to find an available Chromium binary (version may differ from pip package)
        launch_args = {'headless': True}
        chromium_path = _find_chromium()
        if chromium_path:
            launch_args['executable_path'] = chromium_path
            print(f"  Using Chromium: {chromium_path}")
        browser = p.chromium.launch(**launch_args)
        context = browser.new_context(
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                        'AppleWebKit/537.36 (KHTML, like Gecko) '
                        'Chrome/122.0.0.0 Safari/537.36',
            viewport={'width': 1920, 'height': 1080},
        )
        page = context.new_page()

        try:
            page.goto(CME_OPEC_WATCH_URL, wait_until='networkidle', timeout=60000)
            print("  Page loaded, waiting for content...")
            time.sleep(5)

            # Try to find and switch into QuikStrike iframe
            iframes = page.frames
            print(f"  Found {len(iframes)} frames")

            target_frame = page
            for frame in iframes:
                url = frame.url
                if 'quikstrike' in url.lower() or 'opec' in url.lower():
                    print(f"  Switching to iframe: {url}")
                    target_frame = frame
                    break

            # Strategy 1: Look for probability data in tables
            meetings = extract_from_tables(target_frame)

            # Strategy 2: Look for probability data in any text content
            if not meetings:
                meetings = extract_from_text(target_frame)

            # Strategy 3: Try all frames
            if not meetings:
                for frame in iframes:
                    if frame == page.main_frame:
                        continue
                    print(f"  Trying frame: {frame.url[:80]}...")
                    meetings = extract_from_tables(frame)
                    if meetings:
                        break
                    meetings = extract_from_text(frame)
                    if meetings:
                        break

            # Strategy 4: Capture all network responses for JSON data
            if not meetings:
                print("  Trying page reload with network interception...")
                json_responses = []

                def handle_response(response):
                    ct = response.headers.get('content-type', '')
                    if 'json' in ct or 'javascript' in ct:
                        try:
                            body = response.text()
                            if any(kw in body.lower() for kw in ['opec', 'probability', 'outcome', 'large cut', 'no change']):
                                json_responses.append(body)
                        except Exception:
                            pass

                page.on('response', handle_response)
                page.reload(wait_until='networkidle', timeout=60000)
                time.sleep(5)

                for body in json_responses:
                    try:
                        data = json.loads(body)
                        meetings = parse_json_payload(data)
                        if meetings:
                            print(f"  Found data in network response!")
                            break
                    except json.JSONDecodeError:
                        pass

        except Exception as e:
            print(f"  Error during scraping: {e}")
        finally:
            browser.close()

    return meetings if meetings else None


def extract_from_tables(frame):
    """Extract probability data from HTML tables in a frame."""
    meetings = []
    try:
        tables = frame.query_selector_all('table')
        for table in tables:
            rows = table.query_selector_all('tr')
            probs = {}
            for row in rows:
                text = row.inner_text().strip()
                for outcome in OUTCOMES:
                    short = outcome.replace(' (>1M)', '')
                    if short.lower() in text.lower() or outcome.lower() in text.lower():
                        numbers = re.findall(r'(\d+\.?\d*)%?', text)
                        floats = [float(n) for n in numbers if 0 < float(n) < 100]
                        if floats:
                            probs[outcome] = floats[0]

            if len(probs) >= 3:
                meetings.append({'probabilities': probs})
                print(f"  Extracted from table: {probs}")

    except Exception as e:
        print(f"  Table extraction error: {e}")
    return meetings


def extract_from_text(frame):
    """Extract probability data from visible text content."""
    meetings = []
    try:
        content = frame.content()
        # Match patterns like "No Change 52.1%" or "Large Cut (>1M): 3.2%"
        probs = {}
        for outcome in OUTCOMES:
            short = outcome.replace(' (>1M)', '')
            patterns = [
                rf'{re.escape(outcome)}[^0-9]*?(\d+\.?\d*)\s*%',
                rf'{re.escape(short)}[^0-9]*?(\d+\.?\d*)\s*%',
            ]
            for pat in patterns:
                match = re.search(pat, content, re.IGNORECASE)
                if match:
                    val = float(match.group(1))
                    if 0 < val < 100:
                        probs[outcome] = val
                        break

        if len(probs) >= 3:
            meetings.append({'probabilities': probs})
            print(f"  Extracted from text: {probs}")

    except Exception as e:
        print(f"  Text extraction error: {e}")
    return meetings


def parse_json_payload(data):
    """Parse a JSON payload that might contain OPEC Watch data."""
    meetings = []

    if isinstance(data, dict):
        # Recursively search for probability-like structures
        for key, val in data.items():
            if isinstance(val, list):
                for item in val:
                    if isinstance(item, dict):
                        probs = {}
                        for k, v in item.items():
                            for outcome in OUTCOMES:
                                if outcome.lower() in k.lower() or k.lower() in outcome.lower():
                                    try:
                                        probs[outcome] = round(float(v), 2)
                                    except (ValueError, TypeError):
                                        pass
                        if len(probs) >= 3:
                            meetings.append({
                                'date': item.get('date', item.get('meetingDate', '')),
                                'label': item.get('label', item.get('title', '')),
                                'probabilities': probs,
                            })
            elif isinstance(val, dict):
                sub = parse_json_payload(val)
                if sub:
                    meetings.extend(sub)

    return meetings


def update_history(history, meetings):
    """Add today's snapshot to history, keeping last 30 days."""
    today = datetime.now(timezone.utc).strftime('%Y-%m-%d')

    # Build snapshot
    snapshot = {
        'date': today,
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'meetings': [],
    }

    for mtg in meetings:
        snapshot['meetings'].append({
            'date': mtg.get('date', ''),
            'label': mtg.get('label', ''),
            'probabilities': mtg.get('probabilities', {}),
        })

    # Remove any existing snapshot for today
    history['snapshots'] = [s for s in history['snapshots'] if s['date'] != today]
    history['snapshots'].append(snapshot)

    # Keep last 30 days
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).strftime('%Y-%m-%d')
    history['snapshots'] = [s for s in history['snapshots'] if s['date'] >= cutoff]
    history['snapshots'].sort(key=lambda s: s['date'])

    # Update current meetings
    history['meetings'] = snapshot['meetings']

    return history


def update_js_file(history):
    """Update OPEC_WATCH_DATA in physical-markets.js with current + previous day data."""
    meetings = history.get('meetings', [])
    if not meetings:
        print("  No meetings data to update")
        return False

    # Find previous day snapshot for shift calculation
    snapshots = history.get('snapshots', [])
    previous = None
    if len(snapshots) >= 2:
        previous = snapshots[-2]  # second-to-last is yesterday

    js_content = JS_FILE.read_text()

    # Build the new meetings array
    meetings_js = "[\n"
    for mtg in meetings:
        probs = mtg.get('probabilities', {})
        probs_js = json.dumps(probs)

        # Find previous day probabilities for this meeting
        prev_probs = {}
        if previous:
            for prev_mtg in previous.get('meetings', []):
                if prev_mtg.get('date') == mtg.get('date'):
                    prev_probs = prev_mtg.get('probabilities', {})
                    break
        prev_js = json.dumps(prev_probs) if prev_probs else '{}'

        prev_date = previous['date'] if previous else ''

        meetings_js += f"""        {{
            date: '{mtg.get('date', '')}',
            label: '{mtg.get('label', '')}',
            probabilities: {probs_js},
            previous: {prev_js},
            previousDate: '{prev_date}',
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
    print("CME OPEC Watch Scraper (Playwright)")
    print("=" * 60)
    print(f"  Time: {datetime.now(timezone.utc).isoformat()}")

    # Load existing history
    history = load_history()
    print(f"  Existing snapshots: {len(history.get('snapshots', []))}")

    # Scrape CME
    print("\n1. Scraping CME OPEC Watch with Playwright...")
    meetings = scrape_with_playwright()

    if meetings:
        print(f"\n  Successfully scraped {len(meetings)} meeting(s)")
        for m in meetings:
            print(f"    {m.get('date', 'N/A')}: {m.get('label', 'N/A')}")
            for outcome, prob in m.get('probabilities', {}).items():
                print(f"      {outcome}: {prob}%")

        # Update history
        history = update_history(history, meetings)
        save_history(history)

        # Update JS file
        update_js_file(history)

        print("\nDone! Data updated successfully.")
    else:
        print("\n  Could not scrape live data.")
        print("  Keeping existing data in physical-markets.js")
        print("\n  Troubleshooting:")
        print("  - Make sure Playwright + Chromium are installed:")
        print("    pip install playwright && playwright install chromium")
        print("  - CME may have changed their page structure")
        print("  - Try running with PWDEBUG=1 to debug visually:")
        print("    PWDEBUG=1 python scripts/fetch_opec_watch.py")
        print("\n  Manual update: edit OPEC_WATCH_DATA in docs/physical-markets.js")


if __name__ == '__main__':
    main()
