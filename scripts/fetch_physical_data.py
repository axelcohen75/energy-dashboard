#!/usr/bin/env python3
"""
Fetch physical market data: EIA inventories + Polymarket predictions.
Output: docs/data/physical-data.json
"""

import json
import datetime
import urllib.request
import urllib.parse
import os
from pathlib import Path

EIA_KEY = os.environ.get('EIA_API_KEY', 'DEMO_KEY')
EIA_BASE = 'https://api.eia.gov/v2'
POLYMARKET_BASE = 'https://gamma-api.polymarket.com'


def _get_json(url, retries=4, delay=5):
    import time
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            resp = urllib.request.urlopen(req, timeout=20)
            return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                wait = delay * (2 ** attempt)
                print(f"    Rate limited, waiting {wait}s...")
                time.sleep(wait)
            else:
                raise


# ─── EIA Data ────────────────────────────────────────────────────────────────

EIA_SERIES = {
    'us_crude_stocks': {
        'name': 'US Crude Oil Stocks (excl. SPR)',
        'unit': 'Million Barrels',
        'route': 'petroleum/stoc/wstk',
        'params': {
            'facets[product][]': 'EPC0',
            'facets[duoarea][]': 'NUS',
            'facets[process][]': 'SAX',  # Ending Stocks Excluding SPR
        },
        'divisor': 1000,
    },
    'cushing_stocks': {
        'name': 'Cushing OK Crude Stocks',
        'unit': 'Million Barrels',
        'route': 'petroleum/stoc/wstk',
        'params': {
            'facets[product][]': 'EPC0',
            'facets[duoarea][]': 'R20',
            'facets[process][]': 'SAX',  # Ending Stocks Excluding SPR
        },
        'divisor': 1000,
    },
    'spr': {
        'name': 'Strategic Petroleum Reserve',
        'unit': 'Million Barrels',
        'route': 'petroleum/stoc/wstk',
        'params': {
            'facets[product][]': 'EPC0',
            'facets[duoarea][]': 'NUS',
            'facets[process][]': 'SAS',  # Ending Stocks SPR
        },
        'divisor': 1000,
    },
    'gasoline_stocks': {
        'name': 'US Motor Gasoline Stocks',
        'unit': 'Million Barrels',
        'route': 'petroleum/stoc/wstk',
        'params': {
            'facets[product][]': 'EPM0',
            'facets[duoarea][]': 'NUS',
            'facets[process][]': 'SAE',  # Ending Stocks
        },
        'divisor': 1000,
    },
    'distillate_stocks': {
        'name': 'US Distillate Fuel Oil Stocks',
        'unit': 'Million Barrels',
        'route': 'petroleum/stoc/wstk',
        'params': {
            'facets[product][]': 'EPD0',
            'facets[duoarea][]': 'NUS',
            'facets[process][]': 'SAE',  # Ending Stocks
        },
        'divisor': 1000,
    },
}

# NG storage is split by regions — needs special handling
NG_STORAGE_REGIONS = ['R31', 'R32', 'R33', 'R34', 'R35']


def fetch_eia_series(key, cfg, n_weeks=5000):
    """Fetch weekly EIA data (max history)."""
    params = {
        'api_key': EIA_KEY,
        'frequency': 'weekly',
        'data[0]': 'value',
        'sort[0][column]': 'period',
        'sort[0][direction]': 'desc',
        'length': str(n_weeks),
    }
    params.update(cfg['params'])
    query = urllib.parse.urlencode(params, doseq=True)
    url = f"{EIA_BASE}/{cfg['route']}/data/?{query}"

    try:
        data = _get_json(url)
        rows = data.get('response', {}).get('data', [])
        if not rows:
            return None

        dates = []
        values = []
        for r in rows:
            v = r.get('value')
            if v is not None:
                dates.append(r['period'])
                values.append(round(float(v) / cfg['divisor'], 2))

        # Reverse to chronological order
        dates.reverse()
        values.reverse()

        return {
            'name': cfg['name'],
            'unit': cfg['unit'],
            'dates': dates,
            'values': values,
        }
    except Exception as e:
        print(f"  {key}: FAILED ({e})")
        return None


def fetch_ng_storage(n_weeks=5000):
    """Fetch US NG working gas storage — sum of all regions."""
    print("  Fetching NG storage (summing regions)...")
    params = {
        'api_key': EIA_KEY,
        'frequency': 'weekly',
        'data[0]': 'value',
        'facets[process][]': 'SWO',
        'sort[0][column]': 'period',
        'sort[0][direction]': 'desc',
        'length': str(n_weeks * 5),  # 5 regions
    }
    query = urllib.parse.urlencode(params, doseq=True)
    url = f"{EIA_BASE}/natural-gas/stor/wkly/data/?{query}"

    try:
        data = _get_json(url)
        rows = data.get('response', {}).get('data', [])

        # Group by period, sum across regions
        by_period = {}
        for r in rows:
            period = r['period']
            v = r.get('value')
            if v is not None:
                by_period[period] = by_period.get(period, 0) + float(v)

        periods = sorted(by_period.keys())
        dates = periods
        values = [round(by_period[p], 0) for p in periods]

        if dates:
            return {
                'name': 'US Natural Gas Working Storage',
                'unit': 'Bcf',
                'dates': dates,
                'values': values,
            }
    except Exception as e:
        print(f"    NG storage FAILED: {e}")
    return None


def fetch_all_eia():
    import time
    print("Fetching EIA data...")
    results = {}
    for key, cfg in EIA_SERIES.items():
        time.sleep(2)  # Rate limit friendly
        data = fetch_eia_series(key, cfg)
        if data:
            results[key] = data
            latest = data['values'][-1] if data['values'] else 'N/A'
            print(f"  {cfg['name']}: {len(data['dates'])} weeks, latest={latest} {cfg['unit']}")
        else:
            print(f"  {cfg['name']}: NO DATA")

    # Natural gas storage (special handling)
    ng = fetch_ng_storage()
    if ng:
        results['ng_storage'] = ng
        latest = ng['values'][-1] if ng['values'] else 'N/A'
        print(f"  {ng['name']}: {len(ng['dates'])} weeks, latest={latest} {ng['unit']}")

    return results


# ─── Polymarket ──────────────────────────────────────────────────────────────

ENERGY_KEYWORDS = [
    'oil', 'crude', 'opec', 'petroleum', 'gasoline', 'gas price',
    'energy', 'iran', 'sanction', 'tariff', 'embargo', 'pipeline',
    'drilling', 'fracking', 'lng', 'refinery', 'barrel',
    'russia', 'saudi', 'venezuela', 'ceasefire',
    'recession', 'inflation', 'houthi', 'strait', 'hormuz',
]

# Keywords for OPEC/physical impact category (vs geopolitics)
OPEC_PHYSICAL_KEYWORDS = [
    'opec', 'crude oil', 'barrel', 'oil price', 'gas price',
    'gasoline', 'petroleum', 'drilling', 'fracking', 'refinery',
    'pipeline', 'lng', 'production cut', 'output', 'supply',
    'recession', 'inflation', 'tariff', 'embargo',
    'sanction', 'saudi', 'normalize', 'ship', 'transit',
    'strait', 'hormuz', 'houthi', 'settle over', 'settle under',
]


def categorize_market(question, description=''):
    """Categorize market as 'opec_physical' or 'geopolitics'."""
    text = (question + ' ' + (description or '')).lower()
    if any(kw in text for kw in OPEC_PHYSICAL_KEYWORDS):
        return 'opec_physical'
    return 'geopolitics'


def fetch_polymarket():
    print("\nFetching Polymarket data...")
    # Fetch high-volume open markets and filter for energy/geopolitics relevance
    all_markets = []

    for offset in [0, 100, 200]:
        url = f'{POLYMARKET_BASE}/markets?closed=false&limit=100&offset={offset}&order=volume&ascending=false'
        try:
            data = _get_json(url)
            all_markets.extend(data)
        except Exception as e:
            print(f"  Fetch offset={offset} failed: {e}")
            break

    # Filter for energy/geopolitics relevance
    relevant = []
    for m in all_markets:
        q = (m.get('question', '') + ' ' + m.get('description', '')).lower()
        if any(kw in q for kw in ENERGY_KEYWORDS):
            # Parse outcomes and prices (may be JSON strings)
            outcomes_raw = m.get('outcomes', [])
            prices_raw = m.get('outcomePrices', [])
            if isinstance(outcomes_raw, str):
                try:
                    outcomes_raw = json.loads(outcomes_raw)
                except (json.JSONDecodeError, TypeError):
                    outcomes_raw = []
            if isinstance(prices_raw, str):
                try:
                    prices_raw = json.loads(prices_raw)
                except (json.JSONDecodeError, TypeError):
                    prices_raw = []

            volume = m.get('volume', 0)

            # Parse prices to percentages
            parsed_prices = []
            for p in (prices_raw if isinstance(prices_raw, list) else []):
                try:
                    parsed_prices.append(round(float(p) * 100, 1))
                except (ValueError, TypeError):
                    parsed_prices.append(0)

            try:
                vol = float(volume)
            except (ValueError, TypeError):
                vol = 0

            # Categorize: geopolitics vs OPEC/physical impact
            category = categorize_market(m.get('question', ''), m.get('description', ''))

            relevant.append({
                'question': m.get('question', ''),
                'outcomes': outcomes_raw,
                'probabilities': parsed_prices,
                'volume': round(vol),
                'slug': m.get('slug', ''),
                'endDate': m.get('endDate', ''),
                'category': category,
                'groupSlug': m.get('negRiskMarketID', '') or m.get('groupItemTitle', ''),
                'groupTitle': m.get('groupItemTitle', ''),
            })

    # Sort by volume descending
    relevant.sort(key=lambda x: x['volume'], reverse=True)

    # Keep top 40
    relevant = relevant[:40]

    print(f"  Found {len(relevant)} relevant markets")
    geo = sum(1 for m in relevant if m['category'] == 'geopolitics')
    opec = sum(1 for m in relevant if m['category'] == 'opec_physical')
    print(f"    Geopolitics: {geo}, OPEC/Physical: {opec}")
    for m in relevant[:5]:
        prob_str = f"{m['probabilities'][0]:.0f}%" if m['probabilities'] else 'N/A'
        print(f"    {m['question'][:60]} ({prob_str}, vol=${m['volume']:,})")

    return relevant


# ─── Ceasefire Term Structure ────────────────────────────────────────────────

CEASEFIRE_EVENT_ID = 236840  # US x Iran ceasefire event on Polymarket


def fetch_ceasefire_term_structure():
    """Fetch ceasefire event from Polymarket and extract term structure."""
    print("\nFetching ceasefire term structure (event 236840)...")
    try:
        url = f'{POLYMARKET_BASE}/events/{CEASEFIRE_EVENT_ID}'
        data = _get_json(url)
    except Exception as e:
        print(f"  Failed to fetch ceasefire event: {e}")
        return []

    # data is the event object; markets are nested
    markets = data.get('markets', [])
    if not markets:
        print("  No markets found in ceasefire event")
        return []

    points = []
    for m in markets:
        question = m.get('question', '')
        group_title = m.get('groupItemTitle', '')
        prices_raw = m.get('outcomePrices', [])

        # Parse prices
        if isinstance(prices_raw, str):
            try:
                prices_raw = json.loads(prices_raw)
            except (json.JSONDecodeError, TypeError):
                prices_raw = []

        prob = None
        if prices_raw:
            try:
                prob = round(float(prices_raw[0]) * 100, 1)
            except (ValueError, TypeError, IndexError):
                pass

        end_date = m.get('endDate', '')

        try:
            vol = round(float(m.get('volume', 0)))
        except (ValueError, TypeError):
            vol = 0

        if prob is not None:
            points.append({
                'label': group_title or question,
                'question': question,
                'prob': prob,
                'endDate': end_date,
                'volume': vol,
            })

    # Sort by probability (ascending = by maturity timeline)
    points.sort(key=lambda x: x['prob'])

    print(f"  Found {len(points)} ceasefire maturities:")
    for p in points:
        print(f"    {p['label']:>15} → {p['prob']:5.1f}%")

    return points


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    output_path = Path(__file__).parent.parent / 'docs' / 'data' / 'physical-data.json'
    output_path.parent.mkdir(parents=True, exist_ok=True)

    eia = fetch_all_eia()
    pm = fetch_polymarket()
    ceasefire = fetch_ceasefire_term_structure()

    result = {
        'updated': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'eia': eia,
        'polymarket': pm,
        'ceasefireTermStructure': ceasefire,
    }

    with open(output_path, 'w') as f:
        json.dump(result, f, separators=(',', ':'))

    size_kb = output_path.stat().st_size / 1024
    print(f"\nDone! Wrote {size_kb:.1f} KB to {output_path}")


if __name__ == '__main__':
    main()
