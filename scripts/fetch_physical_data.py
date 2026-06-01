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

# Keywords for OPEC/physical impact category (vs geopolitics)
OPEC_PHYSICAL_KEYWORDS = [
    'opec', 'crude oil', 'barrel', 'oil price', 'gas price',
    'gasoline', 'petroleum', 'drilling', 'fracking', 'refinery',
    'pipeline', 'lng', 'production cut', 'output', 'supply',
    'recession', 'inflation', 'tariff', 'embargo',
    'sanction', 'saudi', 'normalize', 'ship', 'transit',
    'strait', 'hormuz', 'houthi', 'settle over', 'settle under',
]

POLYMARKET_EXCLUDED_KEYWORDS = [
    'fifa', 'world cup', ' vs ', 'vs.', 'spread:', 'both teams to score',
    'o/u', 'album', 'gta vi', 'parliamentary election', 'core cpi',
    'ethereum', 'gwei', 'bitcoin', 'pete hegseth', 'house member',
]

DIRECT_ENERGY_KEYWORDS = [
    'oil', 'crude', 'opec', 'petroleum', 'gasoline', 'gas price',
    'natural gas', 'energy', 'pipeline', 'drilling', 'fracking', 'lng',
    'refinery', 'barrel', 'houthi', 'strait', 'hormuz', 'brent', 'wti',
    'henry hub', 'ttf', 'cushing',
]

ENERGY_GEOPOLITICS_ACTORS = [
    'iran', 'oman', 'saudi', 'venezuela', 'russia', 'qatar', 'kuwait',
    'uae', 'united arab emirates', 'bahrain',
]

ENERGY_GEOPOLITICS_CONTEXT = [
    'sanction', 'tariff', 'embargo', 'ceasefire', 'diplomatic', 'nuclear',
    'war powers', 'military', 'strike', 'attack', 'airspace', 'regime',
    'agreement', 'deal', 'transit', 'shipping', 'vessel',
]

PRIORITY_POLYMARKET_MARKET_IDS = [
    2333553,  # Iran x Oman Strait of Hormuz agreement by June 15?
]

HORMUZ_REOPENING_EVENT_ID = 514376


def categorize_market(question, description=''):
    """Categorize market as 'opec_physical' or 'geopolitics'."""
    text = (question + ' ' + (description or '')).lower()
    if any(kw in text for kw in OPEC_PHYSICAL_KEYWORDS):
        return 'opec_physical'
    return 'geopolitics'


def is_relevant_energy_market(question, description=''):
    """Keep energy-linked geopolitical markets while dropping broad false positives."""
    text = f" {question} ".lower()
    if any(kw in text for kw in POLYMARKET_EXCLUDED_KEYWORDS):
        return False
    if any(kw in text for kw in DIRECT_ENERGY_KEYWORDS):
        return True
    return (
        any(actor in text for actor in ENERGY_GEOPOLITICS_ACTORS)
        and any(ctx in text for ctx in ENERGY_GEOPOLITICS_CONTEXT)
    )


def _parse_json_list(raw):
    """Gamma returns outcomes/prices as either lists or JSON-encoded strings."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return []
    return raw if isinstance(raw, list) else []


def _parse_volume(raw):
    try:
        return round(float(raw or 0))
    except (ValueError, TypeError):
        return 0


def _is_market_active(m):
    end_date = m.get('endDate')
    if not end_date:
        return True
    try:
        expiry = datetime.datetime.fromisoformat(end_date.replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return True
    return expiry >= datetime.datetime.now(datetime.timezone.utc)


def _parse_market(m):
    outcomes = _parse_json_list(m.get('outcomes', []))
    prices = []
    for p in _parse_json_list(m.get('outcomePrices', [])):
        try:
            prices.append(round(float(p) * 100, 1))
        except (ValueError, TypeError):
            prices.append(0)

    return {
        'question': m.get('question', ''),
        'outcomes': outcomes,
        'probabilities': prices,
        'volume': _parse_volume(m.get('volume', 0)),
        'slug': m.get('slug', ''),
        'endDate': m.get('endDate', ''),
        'category': categorize_market(m.get('question', ''), m.get('description', '')),
        'groupSlug': m.get('negRiskMarketID', '') or m.get('groupItemTitle', ''),
        'groupTitle': m.get('groupItemTitle', ''),
    }


def _fetch_market_by_id(market_id):
    url = f'{POLYMARKET_BASE}/markets/{market_id}'
    return _get_json(url)


def fetch_polymarket():
    print("\nFetching Polymarket data...")
    # Fetch high-volume open markets and filter for energy/geopolitics relevance
    all_markets = []

    for offset in range(0, 2000, 100):
        url = f'{POLYMARKET_BASE}/markets?closed=false&limit=100&offset={offset}&order=volume&ascending=false'
        try:
            data = _get_json(url)
            all_markets.extend(data)
        except Exception as e:
            print(f"  Fetch offset={offset} failed: {e}")
            break

    # Force in curated lower-volume markets that are useful for energy traders.
    for market_id in PRIORITY_POLYMARKET_MARKET_IDS:
        try:
            priority = _fetch_market_by_id(market_id)
            all_markets.append(priority)
        except Exception as e:
            print(f"  Priority market {market_id} failed: {e}")

    # Filter for energy/geopolitics relevance
    relevant_by_slug = {}
    for m in all_markets:
        if not _is_market_active(m):
            continue
        if is_relevant_energy_market(m.get('question', ''), m.get('description', '')):
            parsed = _parse_market(m)
            dedupe_key = parsed['slug'] or parsed['question']
            relevant_by_slug[dedupe_key] = parsed

    relevant = list(relevant_by_slug.values())

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


# ─── Hormuz Reopening Monitor ────────────────────────────────────────────────


def fetch_hormuz_reopening_monitor():
    """Fetch the Polymarket signal closest to Strait of Hormuz reopening."""
    print(f"\nFetching Hormuz reopening monitor (event {HORMUZ_REOPENING_EVENT_ID})...")
    try:
        url = f'{POLYMARKET_BASE}/events/{HORMUZ_REOPENING_EVENT_ID}'
        data = _get_json(url)
    except Exception as e:
        print(f"  Failed to fetch Hormuz event: {e}")
        return []

    # data is the event object; markets are nested
    markets = data.get('markets', [])
    if not markets:
        print("  No markets found in Hormuz event")
        return []

    signals = []
    for m in markets:
        if not _is_market_active(m):
            continue
        question = m.get('question', '')
        group_title = m.get('groupItemTitle', '')
        prices = _parse_json_list(m.get('outcomePrices', []))
        prob = None
        if prices:
            try:
                prob = round(float(prices[0]) * 100, 1)
            except (ValueError, TypeError, IndexError):
                prob = None

        if prob is not None:
            signals.append({
                'label': group_title or 'Iran-Oman agreement',
                'question': question,
                'prob': prob,
                'endDate': m.get('endDate', ''),
                'volume': _parse_volume(m.get('volume', 0)),
                'slug': m.get('slug', ''),
                'eventTitle': data.get('title', 'Strait of Hormuz reopening'),
            })

    signals.sort(key=lambda x: x['prob'], reverse=True)

    print(f"  Found {len(signals)} Hormuz reopening signals:")
    for p in signals:
        print(f"    {p['label']:>15} → {p['prob']:5.1f}%")

    return signals


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    output_path = Path(__file__).parent.parent / 'docs' / 'data' / 'physical-data.json'
    output_path.parent.mkdir(parents=True, exist_ok=True)

    eia = fetch_all_eia()
    pm = fetch_polymarket()
    hormuz = fetch_hormuz_reopening_monitor()

    result = {
        'updated': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'eia': eia,
        'polymarket': pm,
        'hormuzReopeningSignals': hormuz,
    }

    with open(output_path, 'w') as f:
        json.dump(result, f, separators=(',', ':'))

    size_kb = output_path.stat().st_size / 1024
    print(f"\nDone! Wrote {size_kb:.1f} KB to {output_path}")


if __name__ == '__main__':
    main()
