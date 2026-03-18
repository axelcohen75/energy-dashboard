#!/usr/bin/env python3
"""
Fetch energy market data from Yahoo Finance and save as static JSON.

This script is designed to run:
  - Locally: python scripts/fetch_market_data.py
  - Via GitHub Actions: on a schedule during market hours

Output: docs/data/market-data.json
"""

import json
import datetime
import sys
from pathlib import Path

try:
    import yfinance as yf
    import pandas as pd
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "yfinance", "-q"])
    import yfinance as yf
    import pandas as pd


# ─── Configuration ───────────────────────────────────────────────────────────

MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z']
MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

COMMODITIES = {
    'WTI Crude Oil (CL)': {
        'base': 'CL', 'continuous': 'CL=F', 'exchange': 'NYM',
        'months': 18, 'unit': '$/bbl',
    },
    'Brent Crude Oil (BZ)': {
        'base': 'BZ', 'continuous': 'BZ=F', 'exchange': 'NYM',
        'months': 18, 'unit': '$/bbl',
    },
    'Henry Hub Nat Gas (NG)': {
        'base': 'NG', 'continuous': 'NG=F', 'exchange': 'NYM',
        'months': 18, 'unit': '$/MMBtu',
    },
    'TTF Natural Gas': {
        'continuous': 'TTF=F',
        'months': 0, 'unit': '€/MWh',
    },
    'RBOB Gasoline (RB)': {
        'base': 'RB', 'continuous': 'RB=F', 'exchange': 'NYM',
        'months': 12, 'unit': '$/gal',
    },
    'Heating Oil (HO)': {
        'base': 'HO', 'continuous': 'HO=F', 'exchange': 'NYM',
        'months': 12, 'unit': '$/gal',
    },
}

TIMESPREADS = {
    'WTI Crude Oil (CL)': [
        {'name': 'CL Prompt Spread (M1-M2)', 'm1': 0, 'm2': 1},
        {'name': 'CL 1-3 Month', 'm1': 0, 'm2': 2},
        {'name': 'CL 1-6 Month', 'm1': 0, 'm2': 5},
        {'name': 'CL 1-12 Month', 'm1': 0, 'm2': 11},
        {'name': 'CL 6-12 Month', 'm1': 5, 'm2': 11},
    ],
    'Brent Crude Oil (BZ)': [
        {'name': 'BZ Prompt Spread (M1-M2)', 'm1': 0, 'm2': 1},
        {'name': 'BZ 1-3 Month', 'm1': 0, 'm2': 2},
        {'name': 'BZ 1-6 Month', 'm1': 0, 'm2': 5},
        {'name': 'BZ 1-12 Month', 'm1': 0, 'm2': 11},
    ],
    'Henry Hub Nat Gas (NG)': [
        {'name': 'NG Prompt Spread (M1-M2)', 'm1': 0, 'm2': 1},
        {'name': 'NG Summer-Winter', 'm1': 5, 'm2': 11},
        {'name': 'NG 1-6 Month', 'm1': 0, 'm2': 5},
        {'name': 'NG 1-12 Month', 'm1': 0, 'm2': 11},
    ],
    'RBOB Gasoline (RB)': [
        {'name': 'RB Prompt Spread (M1-M2)', 'm1': 0, 'm2': 1},
        {'name': 'RB 1-6 Month', 'm1': 0, 'm2': 5},
    ],
    'Heating Oil (HO)': [
        {'name': 'HO Prompt Spread (M1-M2)', 'm1': 0, 'm2': 1},
        {'name': 'HO 1-6 Month', 'm1': 0, 'm2': 5},
    ],
}


# ─── Helpers ─────────────────────────────────────────────────────────────────

def get_forward_tickers(base, exchange, n_months):
    """Generate Yahoo Finance tickers for forward contract months."""
    now = datetime.date.today()
    month = now.month
    year = now.year
    tickers = []

    for _ in range(n_months):
        month += 1
        if month > 12:
            month = 1
            year += 1
        code = MONTH_CODES[month - 1]
        yr = str(year)[-2:]
        tickers.append({
            'symbol': f"{base}{code}{yr}.{exchange}",
            'label': f"{MONTH_NAMES[month - 1]} '{yr}",
        })

    return tickers


def safe_download(symbols, **kwargs):
    """Download data from yfinance, handling single vs multi-symbol cases."""
    is_list = isinstance(symbols, list)
    if is_list and len(symbols) == 1:
        symbols = symbols[0]
        is_list = False

    data = yf.download(symbols, progress=False, **kwargs)

    # yfinance returns MultiIndex columns for multiple symbols
    # and flat columns for a single symbol
    return data, is_list


def get_close(data, symbol, is_multi):
    """Extract close prices for a symbol from download result."""
    try:
        if is_multi:
            series = data['Close'][symbol].dropna()
        else:
            series = data['Close'].dropna()
        return series if len(series) > 0 else None
    except (KeyError, TypeError):
        return None


# ─── Data Fetchers ───────────────────────────────────────────────────────────

def fetch_spots():
    """Fetch current spot prices for all commodities."""
    print("Fetching spot prices...")
    spots = {}
    symbols = [cfg['continuous'] for cfg in COMMODITIES.values()]

    data, is_multi = safe_download(symbols, period='5d', auto_adjust=True)

    for name, cfg in COMMODITIES.items():
        close = get_close(data, cfg['continuous'], is_multi)
        if close is not None:
            spots[name] = round(float(close.iloc[-1]), 4)
            print(f"  {name}: {spots[name]}")
        else:
            print(f"  {name}: NO DATA")

    return spots


def fetch_term_structures():
    """Fetch forward curve for each commodity with term structure."""
    print("\nFetching term structures...")
    structures = {}

    for name, cfg in COMMODITIES.items():
        if cfg['months'] == 0 or 'base' not in cfg:
            continue

        tickers = get_forward_tickers(cfg['base'], cfg['exchange'], cfg['months'])
        symbols = [t['symbol'] for t in tickers]

        try:
            data, is_multi = safe_download(symbols, period='5d', auto_adjust=True)

            months = []
            prices = []

            for ticker in tickers:
                close = get_close(data, ticker['symbol'], is_multi)
                if close is not None:
                    price = float(close.iloc[-1])
                    if price > 0:
                        months.append(ticker['label'])
                        prices.append(round(price, 4))

            if len(months) >= 3:
                structures[name] = {
                    'months': months,
                    'prices': prices,
                    'unit': cfg['unit'],
                }
                print(f"  {name}: {len(months)} contract months")
            else:
                print(f"  {name}: only {len(months)} months (skipped)")
        except Exception as e:
            print(f"  {name}: FAILED ({e})")

    return structures


def fetch_historical():
    """Fetch 2 years of daily close prices for continuous contracts."""
    print("\nFetching historical data...")
    history = {}
    symbols = [cfg['continuous'] for cfg in COMMODITIES.values()]

    data, is_multi = safe_download(symbols, period='2y', interval='1d', auto_adjust=True)

    for name, cfg in COMMODITIES.items():
        sym = cfg['continuous']
        close = get_close(data, sym, is_multi)
        if close is not None and len(close) > 10:
            history[sym] = {
                'dates': [d.strftime('%Y-%m-%d') for d in close.index],
                'close': [round(float(v), 4) for v in close.values],
            }
            print(f"  {sym}: {len(close)} days")
        else:
            print(f"  {sym}: NO DATA")

    return history


def fetch_timespreads():
    """Pre-compute timespread history for each commodity."""
    print("\nFetching timespreads...")
    spreads = {}

    for name, defs in TIMESPREADS.items():
        cfg = COMMODITIES[name]
        if 'base' not in cfg:
            continue

        # Collect all unique contract symbols needed for this commodity's spreads
        max_month = max(max(d['m1'], d['m2']) for d in defs) + 1
        tickers = get_forward_tickers(cfg['base'], cfg['exchange'], max_month)

        # Download all at once
        symbols = [t['symbol'] for t in tickers]
        try:
            data, is_multi = safe_download(symbols, period='2y', interval='1d', auto_adjust=True)
        except Exception as e:
            print(f"  {name}: download failed ({e})")
            continue

        for sdef in defs:
            try:
                sym1 = tickers[sdef['m1']]['symbol']
                sym2 = tickers[sdef['m2']]['symbol']

                close1 = get_close(data, sym1, is_multi)
                close2 = get_close(data, sym2, is_multi)

                if close1 is not None and close2 is not None:
                    aligned = pd.concat([close1, close2], axis=1, join='inner').dropna()
                    if len(aligned) > 10:
                        spread_vals = aligned.iloc[:, 0] - aligned.iloc[:, 1]
                        spreads[sdef['name']] = {
                            'dates': [d.strftime('%Y-%m-%d') for d in aligned.index],
                            'values': [round(float(v), 4) for v in spread_vals.values],
                            'unit': cfg['unit'],
                        }
                        print(f"  {sdef['name']}: {len(aligned)} days")
                    else:
                        print(f"  {sdef['name']}: not enough aligned data ({len(aligned)} days)")
                else:
                    print(f"  {sdef['name']}: missing contract data")
            except Exception as e:
                print(f"  {sdef['name']}: FAILED ({e})")

    return spreads

def fetch_contract_history():
    """Fetch 2 years of daily data for individual contract months (for term structure comparison)."""
    print("\nFetching contract month history (for term structure comparison)...")
    contract_history = {}

    for name, cfg in COMMODITIES.items():
        if cfg['months'] == 0 or 'base' not in cfg:
            continue

        tickers = get_forward_tickers(cfg['base'], cfg['exchange'], cfg['months'])
        symbols = [t['symbol'] for t in tickers]

        try:
            data, is_multi = safe_download(symbols, period='2y', interval='1d', auto_adjust=True)

            contracts = []
            for ticker in tickers:
                close = get_close(data, ticker['symbol'], is_multi)
                if close is not None and len(close) > 10:
                    contracts.append({
                        'symbol': ticker['symbol'],
                        'label': ticker['label'],
                        'dates': [d.strftime('%Y-%m-%d') for d in close.index],
                        'close': [round(float(v), 4) for v in close.values],
                    })

            if contracts:
                contract_history[name] = contracts
                print(f"  {name}: {len(contracts)} contracts with history")
        except Exception as e:
            print(f"  {name}: FAILED ({e})")

    return contract_history


# ─── Main ────────────────────────────────────────────────────────────────────

def main():
    output_path = Path(__file__).parent.parent / 'docs' / 'data' / 'market-data.json'
    output_path.parent.mkdir(parents=True, exist_ok=True)

    spots = fetch_spots()
    term_structures = fetch_term_structures()
    history = fetch_historical()
    timespreads = fetch_timespreads()
    contract_history = fetch_contract_history()

    result = {
        'updated': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'spots': spots,
        'termStructures': term_structures,
        'history': history,
        'timespreads': timespreads,
        'contractHistory': contract_history,
    }

    with open(output_path, 'w') as f:
        json.dump(result, f, separators=(',', ':'))

    size_kb = output_path.stat().st_size / 1024
    print(f"\nDone! Wrote {size_kb:.1f} KB to {output_path}")
    print(f"Updated: {result['updated']}")
    print(f"Spots: {len(spots)}, Term structures: {len(term_structures)}, "
          f"History: {len(history)}, Timespreads: {len(timespreads)}")


if __name__ == '__main__':
    main()
