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

MIN_POLYMARKET_LIQUIDITY = 50_000

HORMUZ_TERM_SEARCH = 'Strait of Hormuz traffic returns to normal'

POLYMARKET_SEARCH_QUERIES = [
    HORMUZ_TERM_SEARCH,
    'Trump announces US blockade of Hormuz lifted',
    'Hormuz ships transit',
    'Iranian demands Trump agree June 30',
    'Iran oil sanction relief',
    'Crude Oil CL hit by end of June',
    'Crude Oil CL settle at in June',
    'WTI crude oil hit June',
]

CURATED_POLYMARKET_EVENT_IDS = [
    125877,  # Will Crude Oil (CL) hit__ by end of June?
    125876,  # What will Crude Oil (CL) settle at in June?
    372242,  # Trump announces US blockade of Hormuz lifted by...?
    432180,  # Will __ ships transit the Strait of Hormuz on any day by May 31?
    432225,  # Avg. # of ships transiting Strait of Hormuz end of May?
    509893,  # What Iranian demands will Trump agree to by June 30?
]

POLYMARKET_EXCLUDED_KEYWORDS = [
    'fifa', 'world cup', ' vs ', 'vs.', 'spread:', 'both teams to score',
    'o/u', 'album', 'gta vi', 'parliamentary election', 'core cpi',
    'ethereum', 'gwei', 'bitcoin', 'pete hegseth', 'house member',
]

POLYMARKET_RELEVANT_KEYWORDS = [
    'hormuz', 'crude oil', 'wti', 'oil sanction', 'transit fee',
    'blockade', 'ships transit', 'iranian', 'iran ', 'u.s. military strikes',
]


def is_relevant_quote(question):
    """Keep quote-board markets focused on energy/Hormuz/Iran risk."""
    text = f" {question or ''} ".lower()
    if any(kw in text for kw in POLYMARKET_EXCLUDED_KEYWORDS):
        return False
    return any(kw in text for kw in POLYMARKET_RELEVANT_KEYWORDS)


def _parse_json_list(raw):
    """Gamma returns outcomes/prices as either lists or JSON-encoded strings."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            return []
    return raw if isinstance(raw, list) else []


def _parse_number(raw):
    try:
        return round(float(raw or 0))
    except (ValueError, TypeError):
        return 0


def _market_number(m, key):
    return _parse_number(m.get(f'{key}Num', m.get(key, 0)))


def _is_market_open(m):
    # Polymarket often keeps just-ended markets visible until resolution; keep
    # them if they are not marked closed so the quoted curve matches the UI.
    return not bool(m.get('closed'))


def _quote_group(question, event_title=''):
    text = f" {question or ''} {event_title or ''} ".lower()
    if 'traffic returns to normal' in text:
        return 'hormuz_traffic'
    if 'crude oil' in text or 'wti' in text:
        return 'oil_price'
    if 'hormuz' in text:
        return 'hormuz_policy'
    if 'iran' in text:
        return 'iran_macro'
    return 'macro'


def _quote_label(question, group_title=''):
    if group_title:
        return group_title
    q = question or ''
    for prefix in [
        'Strait of Hormuz traffic returns to normal by ',
        'Will Donald Trump announce that the United States blockade of the Strait of Hormuz has been lifted by ',
        'Will Crude Oil (CL) hit ',
        'Will WTI Crude Oil (WTI) hit ',
    ]:
        if q.startswith(prefix):
            return q.replace(prefix, '').replace('?', '')
    return q[:48] + ('...' if len(q) > 48 else '')


def _term_label(question):
    label = _quote_label(question)
    label = label.replace('end of ', 'End ')
    label = label.replace('June', 'Jun').replace('July', 'Jul').replace('December', 'Dec')
    label = label.replace('May', 'May')
    return label


def _end_sort_key(end_date):
    if not end_date:
        return datetime.datetime.max.replace(tzinfo=datetime.timezone.utc)
    try:
        return datetime.datetime.fromisoformat(end_date.replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return datetime.datetime.max.replace(tzinfo=datetime.timezone.utc)


def _parse_market(m):
    outcomes = _parse_json_list(m.get('outcomes', []))
    prices = []
    for p in _parse_json_list(m.get('outcomePrices', [])):
        try:
            prices.append(round(float(p) * 100, 1))
        except (ValueError, TypeError):
            prices.append(0)

    event_title = m.get('_eventTitle', '')
    question = m.get('question', '')
    liquidity = _market_number(m, 'liquidity')
    volume = _market_number(m, 'volume')
    group_title = m.get('groupItemTitle', '')

    return {
        'id': m.get('id'),
        'question': m.get('question', ''),
        'outcomes': outcomes,
        'probabilities': prices,
        'volume': volume,
        'liquidity': liquidity,
        'slug': m.get('slug', ''),
        'endDate': m.get('endDate', ''),
        'category': _quote_group(question, event_title),
        'quoteGroup': _quote_group(question, event_title),
        'groupSlug': m.get('negRiskMarketID', '') or m.get('groupItemTitle', ''),
        'groupTitle': group_title,
        'label': _quote_label(question, group_title),
        'eventTitle': event_title,
    }


def _fetch_event_by_id(event_id):
    url = f'{POLYMARKET_BASE}/events/{event_id}'
    return _get_json(url)


def _public_search_events(query, limit=12):
    params = urllib.parse.urlencode({
        'q': query,
        'limit_per_type': limit,
        'events_status': 'active',
        'keep_closed_markets': 0,
    })
    url = f'{POLYMARKET_BASE}/public-search?{params}'
    try:
        data = _get_json(url)
    except Exception as e:
        print(f"  Search failed for {query!r}: {e}")
        return []
    return data.get('events', [])


def _liquid_markets_from_event(event):
    event_title = event.get('title', '')
    parsed = []
    for market in event.get('markets', []):
        if not _is_market_open(market):
            continue
        if _market_number(market, 'liquidity') < MIN_POLYMARKET_LIQUIDITY:
            continue
        if not is_relevant_quote(market.get('question', '')):
            continue
        market['_eventTitle'] = event_title
        parsed.append(_parse_market(market))
    return parsed


def fetch_hormuz_term_structure():
    """Build a real maturity curve from liquid Hormuz normal-traffic markets."""
    print("\nFetching Hormuz normal-traffic term structure...")
    points_by_slug = {}

    for event_stub in _public_search_events(HORMUZ_TERM_SEARCH, limit=10):
        title = event_stub.get('title', '')
        if 'traffic returns to normal' not in title.lower():
            continue
        try:
            event = _fetch_event_by_id(event_stub['id'])
        except Exception as e:
            print(f"  Event {event_stub.get('id')} failed: {e}")
            continue

        for quote in _liquid_markets_from_event(event):
            quote['label'] = _term_label(quote['question'])
            points_by_slug[quote['slug'] or quote['question']] = quote

    points = list(points_by_slug.values())
    points.sort(key=lambda q: _end_sort_key(q.get('endDate')))

    print(f"  Found {len(points)} liquid Hormuz maturities:")
    for p in points:
        prob = (p.get('probabilities') or [0])[0]
        print(f"    {p['label']:>8} → {prob:5.1f}% liq=${p['liquidity']:,}")

    return points


def fetch_polymarket_quotes(hormuz_term):
    print("\nFetching Polymarket quote board...")
    events_by_id = {}

    for query in POLYMARKET_SEARCH_QUERIES:
        for event in _public_search_events(query):
            event_id = event.get('id')
            if event_id:
                events_by_id[int(event_id)] = event

    for event_id in CURATED_POLYMARKET_EVENT_IDS:
        events_by_id[event_id] = {'id': event_id}

    quotes_by_key = {}
    for event_id in sorted(events_by_id):
        try:
            event = _fetch_event_by_id(event_id)
        except Exception as e:
            print(f"  Event {event_id} failed: {e}")
            continue
        for quote in _liquid_markets_from_event(event):
            key = quote.get('slug') or quote.get('id') or quote.get('question')
            quotes_by_key[key] = quote

    for quote in hormuz_term:
        key = quote.get('slug') or quote.get('question')
        quotes_by_key[key] = quote

    quotes = list(quotes_by_key.values())
    quotes.sort(key=lambda q: (q.get('liquidity', 0), q.get('volume', 0)), reverse=True)

    print(f"  Found {len(quotes)} liquid quotes (liq >= ${MIN_POLYMARKET_LIQUIDITY:,})")
    for q in quotes[:8]:
        prob = (q.get('probabilities') or [0])[0]
        print(f"    {q['quoteGroup']:<14} {prob:5.1f}% liq=${q['liquidity']:,} {q['question'][:58]}")

    return quotes[:80]


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    output_path = Path(__file__).parent.parent / 'docs' / 'data' / 'physical-data.json'
    output_path.parent.mkdir(parents=True, exist_ok=True)

    eia = fetch_all_eia()
    hormuz_term = fetch_hormuz_term_structure()
    pm = fetch_polymarket_quotes(hormuz_term)

    result = {
        'updated': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'eia': eia,
        'polymarket': pm,
        'polymarketQuotes': pm,
        'hormuzTermStructure': hormuz_term,
    }

    with open(output_path, 'w') as f:
        json.dump(result, f, separators=(',', ':'))

    size_kb = output_path.stat().st_size / 1024
    print(f"\nDone! Wrote {size_kb:.1f} KB to {output_path}")


if __name__ == '__main__':
    main()
