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


def _get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    resp = urllib.request.urlopen(req, timeout=15)
    return json.loads(resp.read())


# ─── EIA Data ────────────────────────────────────────────────────────────────

EIA_SERIES = {
    'us_crude_stocks': {
        'name': 'US Crude Oil Stocks (excl. SPR)',
        'unit': 'Million Barrels',
        'route': 'petroleum/stoc/wstk',
        'params': {
            'facets[product][]': 'EPC0',
            'facets[duoarea][]': 'NUS',
        },
        'divisor': 1000,  # convert from thousand barrels to million
    },
    'cushing_stocks': {
        'name': 'Cushing OK Crude Stocks',
        'unit': 'Million Barrels',
        'route': 'petroleum/stoc/wstk',
        'params': {
            'facets[product][]': 'EPC0',
            'facets[duoarea][]': 'R20',  # PADD 2 Midwest (Cushing is in PADD 2)
        },
        'divisor': 1000,
    },
    'spr': {
        'name': 'Strategic Petroleum Reserve',
        'unit': 'Million Barrels',
        'route': 'petroleum/stoc/wstk',
        'params': {
            'facets[product][]': 'EPC0',
            'facets[duoarea][]': 'R40',  # SPR is in PADD 3 (Gulf Coast)
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
        },
        'divisor': 1000,
    },
}

# NG storage is split by regions — needs special handling
NG_STORAGE_REGIONS = ['R31', 'R32', 'R33', 'R34', 'R35']


def fetch_eia_series(key, cfg, n_weeks=260):
    """Fetch weekly EIA data (5 years by default)."""
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


def fetch_ng_storage(n_weeks=260):
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
    print("Fetching EIA data...")
    results = {}
    for key, cfg in EIA_SERIES.items():
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
    'recession', 'inflation',
]


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
            outcomes = m.get('outcomes', [])
            prices = m.get('outcomePrices', [])
            volume = m.get('volume', 0)

            # Parse prices
            parsed_prices = []
            for p in (prices if isinstance(prices, list) else []):
                try:
                    parsed_prices.append(round(float(p) * 100, 1))
                except (ValueError, TypeError):
                    parsed_prices.append(0)

            try:
                vol = float(volume)
            except (ValueError, TypeError):
                vol = 0

            relevant.append({
                'question': m.get('question', ''),
                'outcomes': outcomes,
                'probabilities': parsed_prices,
                'volume': round(vol),
                'slug': m.get('slug', ''),
                'endDate': m.get('endDate', ''),
            })

    # Sort by volume descending
    relevant.sort(key=lambda x: x['volume'], reverse=True)

    # Keep top 30
    relevant = relevant[:30]

    print(f"  Found {len(relevant)} relevant markets")
    for m in relevant[:5]:
        print(f"    {m['question'][:70]} (vol=${m['volume']:,})")

    return relevant


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    output_path = Path(__file__).parent.parent / 'docs' / 'data' / 'physical-data.json'
    output_path.parent.mkdir(parents=True, exist_ok=True)

    eia = fetch_all_eia()
    polymarket = fetch_polymarket()

    result = {
        'updated': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'eia': eia,
        'polymarket': polymarket,
    }

    with open(output_path, 'w') as f:
        json.dump(result, f, separators=(',', ':'))

    size_kb = output_path.stat().st_size / 1024
    print(f"\nDone! Wrote {size_kb:.1f} KB to {output_path}")


if __name__ == '__main__':
    main()
