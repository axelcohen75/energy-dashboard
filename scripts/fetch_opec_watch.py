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
        launch_args = {
            'headless': True,
            'args': [
                '--no-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
            ],
        }
        chromium_path = _find_chromium()
        if chromium_path:
            launch_args['executable_path'] = chromium_path
            print(f"  Using Chromium: {chromium_path}")
        browser = p.chromium.launch(**launch_args)
        context = browser.new_context(
            user_agent='Mozilla/5.0 (X11; Linux x86_64) '
                        'AppleWebKit/537.36 (KHTML, like Gecko) '
                        'Chrome/131.0.0.0 Safari/537.36',
            viewport={'width': 1920, 'height': 1080},
            java_script_enabled=True,
            locale='en-US',
            timezone_id='America/New_York',
        )
        # Hide webdriver flag from Cloudflare detection
        context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        """)

        page = context.new_page()

        # Intercept network responses to catch JSON/API data
        json_responses = []
        all_qs_responses = []
        def handle_response(response):
            url = response.url
            ct = response.headers.get('content-type', '')

            # Capture ALL QuikStrike responses for analysis
            if 'quikstrike' in url.lower():
                try:
                    body = response.text()
                    all_qs_responses.append({'url': url, 'body': body, 'ct': ct})
                    print(f"  QS response [{ct[:30]}]: {url[:120]}")
                except Exception:
                    pass
                return

            # Also capture OPEC-related responses from any domain
            if 'json' in ct or 'opec' in url.lower():
                try:
                    body = response.text()
                    if any(kw in body.lower() for kw in ['opec', 'probability', 'outcome',
                            'large cut', 'no change', 'increase', 'cut']):
                        json_responses.append({'url': url, 'body': body})
                        print(f"  Captured response: {url[:100]}")
                except Exception:
                    pass

        page.on('response', handle_response)

        try:
            # Use 'load' instead of 'networkidle' — Cloudflare challenge pages
            # keep connections open which causes networkidle to timeout
            page.goto(CME_OPEC_WATCH_URL, wait_until='load', timeout=90000)
            print("  Page loaded (initial), waiting for JS rendering...")

            # Wait for Cloudflare challenge to complete (if any)
            time.sleep(10)

            # Check if we're stuck on a Cloudflare challenge page
            title = page.title()
            print(f"  Page title: {title}")
            if 'just a moment' in title.lower() or 'cloudflare' in title.lower():
                print("  Cloudflare challenge detected, waiting longer...")
                time.sleep(15)
                title = page.title()
                print(f"  Page title after wait: {title}")

            # Wait for actual content to appear
            try:
                page.wait_for_selector('iframe, table, [class*="opec"], [class*="chart"]',
                                       timeout=30000)
                print("  Content elements found")
            except Exception:
                print("  No specific content selectors found, continuing...")

            # Try to find and switch into QuikStrike iframe
            iframes = page.frames
            print(f"  Found {len(iframes)} frames")
            for frame in iframes:
                url = frame.url
                if url and url != 'about:blank':
                    print(f"    Frame: {url[:120]}")

            # Find the QuikStrike OPEC Watch iframe and wait for it
            qs_frames = []
            for frame in iframes:
                url = frame.url
                if 'quikstrike' in url.lower() and 'opecwatch' in url.lower():
                    qs_frames.insert(0, frame)  # prioritize OPEC-specific
                elif 'quikstrike' in url.lower():
                    qs_frames.append(frame)

            if qs_frames:
                target_frame = qs_frames[0]
                print(f"  Using QuikStrike frame: {target_frame.url[:120]}")

                # Wait for the iframe's JS to finish loading data
                print("  Waiting for QuikStrike iframe networkidle...")
                try:
                    # Wait for network to settle in main page (captures iframe traffic too)
                    page.wait_for_load_state('networkidle', timeout=30000)
                    print("  Network idle reached")
                except Exception:
                    print("  Network idle timeout, continuing...")

                # Additional wait for client-side rendering
                print("  Waiting 10s for client-side rendering...")
                time.sleep(10)

                # Dump iframe content for debugging
                try:
                    qs_content = target_frame.content()
                    print(f"  QuikStrike iframe content length: {len(qs_content)}")
                    # Log visible text (stripped of HTML)
                    qs_text = re.sub(r'<[^>]+>', ' ', qs_content)
                    qs_text = re.sub(r'\s+', ' ', qs_text).strip()
                    # Print more - first 2000 AND last 2000 chars to find data
                    print(f"  QS text START: {qs_text[:2000]}")
                    if len(qs_text) > 2000:
                        print(f"  QS text END: {qs_text[-2000:]}")
                    # Also look for percentage values anywhere
                    pcts = re.findall(r'(\d{1,2}\.\d+)%', qs_text)
                    if pcts:
                        print(f"  Found percentages in iframe: {pcts[:20]}")
                except Exception as e:
                    print(f"  Could not read iframe content: {e}")

                # Log all QuikStrike network responses captured
                print(f"  Total QuikStrike responses captured: {len(all_qs_responses)}")
                for resp in all_qs_responses:
                    body_preview = resp['body'][:300] if resp['body'] else '(empty)'
                    print(f"    QS [{resp['ct'][:20]}] {resp['url'][:80]}")
                    print(f"      Body: {body_preview}")
            else:
                target_frame = page
                print("  No QuikStrike iframe found, using main page")

            # Strategy 1: Extract from QuikStrike iframe
            meetings = extract_from_frame(target_frame)

            # Strategy 2: Try all QuikStrike frames
            if not meetings:
                for frame in qs_frames[1:]:
                    print(f"  Trying alt QuikStrike frame: {frame.url[:80]}...")
                    time.sleep(5)
                    meetings = extract_from_frame(frame)
                    if meetings:
                        break

            # Strategy 3: Try all other frames
            if not meetings:
                for frame in iframes:
                    if frame == page.main_frame or frame in qs_frames:
                        continue
                    if not frame.url or frame.url == 'about:blank':
                        continue
                    meetings = extract_from_frame(frame)
                    if meetings:
                        break

            # Strategy 4: Check captured network responses (both general + QuikStrike)
            all_responses = json_responses + all_qs_responses
            if not meetings and all_responses:
                print(f"  Checking {len(all_responses)} captured responses for data...")
                for resp in all_responses:
                    body = resp.get('body', '')
                    if not body:
                        continue
                    # Try JSON parsing
                    try:
                        data = json.loads(body)
                        meetings = parse_json_payload(data)
                        if meetings:
                            print(f"  Found data in response: {resp['url'][:100]}")
                            break
                    except (json.JSONDecodeError, ValueError):
                        pass
                    # Try regex on response body text
                    if not meetings:
                        probs = {}
                        for outcome in OUTCOMES:
                            short = outcome.replace(' (>1M)', '').lower()
                            match = re.search(
                                rf'{re.escape(short)}[^0-9]*?(\d{{1,2}}\.?\d*)\s*%',
                                body, re.IGNORECASE)
                            if match:
                                probs[outcome] = float(match.group(1))
                        if len(probs) >= 3:
                            meetings = [{'probabilities': probs}]
                            print(f"  Found data in response text: {resp['url'][:100]}")
                            break

            # Strategy 5: Dump page content for debugging
            if not meetings:
                content = page.content()
                print(f"  Page content length: {len(content)}")
                print(f"  Page snippet: {content[:500]}")

        except Exception as e:
            print(f"  Error during scraping: {e}")
        finally:
            browser.close()

    return meetings if meetings else None


def extract_from_frame(frame):
    """Extract probability data from a frame using multiple strategies."""
    meetings = []

    try:
        content = frame.content()
    except Exception as e:
        print(f"  Could not get frame content: {e}")
        return meetings

    # Strip HTML tags for text matching
    text = re.sub(r'<[^>]+>', ' ', content)
    text = re.sub(r'\s+', ' ', text)

    # ── Strategy A: CME's actual 3-category format (Increase/Pause/Decrease) ──
    # CME OPEC Watch shows: "Increase X.XX%  Pause Y.YY%  Decrease Z.ZZ%"
    cme_patterns = {
        'Increase': r'(?<!\w)Increase\s+(\d{1,2}\.\d+)\s*%',
        'Pause':    r'(?<!\w)Pause\s+(\d{1,2}\.\d+)\s*%',
        'Decrease': r'(?<!\w)Decrease\s+(\d{1,2}\.\d+)\s*%',
    }
    cme_probs = {}
    for label, pat in cme_patterns.items():
        match = re.search(pat, text)
        if match:
            cme_probs[label] = float(match.group(1))
            print(f"    Found CME: {label} = {match.group(1)}%")

    if len(cme_probs) == 3:
        probs = {
            'Decrease': cme_probs.get('Decrease', 0),
            'No Change': cme_probs.get('Pause', 0),
            'Increase': cme_probs.get('Increase', 0),
        }
        mtg = {'probabilities': probs, 'format': '3-category'}

        # Try to extract meeting date/label (e.g. "April 5 OPEC Meeting")
        date_match = re.search(
            r'((?:January|February|March|April|May|June|July|August|September|'
            r'October|November|December)\s+\d{1,2})\s*(OPEC\s*\+?\s*Meeting)',
            text, re.IGNORECASE)
        if date_match:
            mtg['label'] = f"{date_match.group(1)} {date_match.group(2)}"
            # Parse to a proper date
            try:
                year = datetime.now().year
                dt = datetime.strptime(f"{date_match.group(1)} {year}", "%B %d %Y")
                mtg['date'] = dt.strftime('%Y-%m-%d')
            except ValueError:
                mtg['date'] = date_match.group(1)
            print(f"    Meeting: {mtg['label']} ({mtg['date']})")

        meetings.append(mtg)
        print(f"  Extracted CME 3-category: {cme_probs}")
        return meetings

    # ── Strategy B: Try 5-category patterns ──
    probs = {}
    outcome_patterns = {
        'Large Cut (>1M)':     [r'large\s*cut', r'significant\s*cut'],
        'Small Cut':           [r'small\s*cut', r'modest\s*cut', r'(?<!\w)decrease'],
        'No Change':           [r'no\s*change', r'unchanged', r'(?<!\w)pause'],
        'Small Increase':      [r'small\s*increase', r'modest\s*increase', r'(?<!\w)increase'],
        'Large Increase (>1M)':[r'large\s*increase', r'significant\s*increase'],
    }

    for outcome, patterns in outcome_patterns.items():
        for pat in patterns:
            match = re.search(rf'({pat})[^0-9%]*?(\d{{1,2}}\.?\d*)\s*%', text, re.IGNORECASE)
            if match:
                val = float(match.group(2))
                if 0 < val < 100:
                    probs[outcome] = val
                    print(f"    Found: {outcome} = {val}%")
                    break

    if len(probs) >= 3:
        meetings.append({'probabilities': probs})
        print(f"  Extracted {len(probs)} outcomes from frame text")
        return meetings

    # ── Strategy C: Deduplicated percentage clusters ──
    pct_matches = re.findall(r'(\d{1,2}\.\d+)%', text)
    pct_values = [float(v) for v in pct_matches if 0.1 < float(v) < 99.9]

    # Deduplicate consecutive identical values (chart label + data table)
    deduped = []
    for v in pct_values:
        if not deduped or abs(v - deduped[-1]) > 0.001:
            deduped.append(v)

    for n in [5, 3]:
        if len(deduped) >= n:
            for i in range(len(deduped) - n + 1):
                group = deduped[i:i+n]
                total = sum(group)
                if 98 < total < 102:
                    print(f"  Found {n} percentages summing to {total:.1f}%: {group}")
                    if n == 5:
                        probs = dict(zip(OUTCOMES, group))
                    elif n == 3:
                        # CME order: Increase / Pause / Decrease
                        probs = {
                            'Increase': group[0],
                            'No Change': group[1],
                            'Decrease': group[2],
                        }
                    meetings.append({'probabilities': probs})
                    return meetings

    if probs:
        print(f"  Partial extraction ({len(probs)} outcomes): {probs}")

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
