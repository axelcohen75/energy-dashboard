#!/usr/bin/env python3
"""
Fetch CFTC Commitments of Traders (COT) data for energy commodities.

Uses the cot_reports library to download disaggregated futures+options reports.
Output: docs/data/cftc-data.json
"""

import json
import datetime
import sys
from pathlib import Path

try:
    from cot_reports import cot_year
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "cot_reports", "-q"])
    from cot_reports import cot_year

import os

# ─── Configuration ───────────────────────────────────────────────────────────

# Map platform commodity names → CFTC contract names (disaggregated report)
CFTC_CONTRACTS = {
    "WTI Crude Oil (CL)": {
        "disagg": "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE",
        "legacy": "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE",
    },
    "Brent Crude Oil (BZ)": {
        "disagg": "BRENT LAST DAY - NEW YORK MERCANTILE EXCHANGE",
        "legacy": "BRENT LAST DAY - NEW YORK MERCANTILE EXCHANGE",
    },
    "Henry Hub Nat Gas (NG)": {
        "disagg": "HENRY HUB PENULTIMATE NAT GAS - NEW YORK MERCANTILE EXCHANGE",
        "legacy": "HENRY HUB PENULTIMATE NAT GAS - NEW YORK MERCANTILE EXCHANGE",
    },
    "RBOB Gasoline (RB)": {
        "disagg": "GASOLINE RBOB - NEW YORK MERCANTILE EXCHANGE",
        "legacy": "GASOLINE RBOB - NEW YORK MERCANTILE EXCHANGE",
    },
    "Heating Oil (HO)": {
        "disagg": "NY HARBOR ULSD - NEW YORK MERCANTILE EXCHANGE",
        "legacy": "NY HARBOR ULSD - NEW YORK MERCANTILE EXCHANGE",
    },
}

# How many weeks of history to include
WEEKS_HISTORY = 52


def fetch_disaggregated(year):
    """Fetch disaggregated futures+options report for a given year."""
    try:
        df = cot_year(year=year, cot_report_type="disaggregated_futopt")
        return df
    except Exception as e:
        print(f"  Warning: Failed to fetch disaggregated {year}: {e}")
        return None


def extract_commodity_data(df, cftc_name):
    """Extract positioning data for a single commodity from the DataFrame."""
    # Column names differ between report types
    name_col = "Market_and_Exchange_Names"
    date_col = "Report_Date_as_YYYY-MM-DD"

    if name_col not in df.columns:
        # Try alternative column names
        for c in df.columns:
            if "market" in c.lower() and "name" in c.lower():
                name_col = c
                break
    if date_col not in df.columns:
        for c in df.columns:
            if "yyyy" in c.lower() and "mm" in c.lower():
                date_col = c
                break

    # Filter for this commodity (partial match)
    mask = df[name_col].str.contains(cftc_name[:40], case=False, na=False)
    commodity_df = df[mask].copy()

    if commodity_df.empty:
        return []

    commodity_df = commodity_df.sort_values(date_col, ascending=False)

    records = []
    for _, row in commodity_df.head(WEEKS_HISTORY).iterrows():
        try:
            oi = int(row.get("Open_Interest_All", 0) or 0)
            mm_long = int(row.get("M_Money_Positions_Long_All", 0) or 0)
            mm_short = int(row.get("M_Money_Positions_Short_All", 0) or 0)
            prod_long = int(row.get("Prod_Merc_Positions_Long_All", 0) or 0)
            prod_short = int(row.get("Prod_Merc_Positions_Short_All", 0) or 0)
            swap_long = int(row.get("Swap_Positions_Long_All", 0) or 0)
            swap_short = int(row.get("Swap__Positions_Short_All", 0) or 0)
            other_long = int(row.get("Other_Rept_Positions_Long_All", 0) or 0)
            other_short = int(row.get("Other_Rept_Positions_Short_All", 0) or 0)

            records.append({
                "date": str(row[date_col]),
                "oi": oi,
                "mm_long": mm_long,
                "mm_short": mm_short,
                "mm_net": mm_long - mm_short,
                "prod_long": prod_long,
                "prod_short": prod_short,
                "prod_net": prod_long - prod_short,
                "swap_long": swap_long,
                "swap_short": swap_short,
                "swap_net": swap_long - swap_short,
                "other_long": other_long,
                "other_short": other_short,
                "other_net": other_long - other_short,
            })
        except Exception:
            continue

    return records


def main():
    output_dir = Path(__file__).resolve().parent.parent / "docs" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_file = output_dir / "cftc-data.json"

    print("Fetching CFTC COT data...")

    # Fetch current year + previous year for history
    current_year = datetime.datetime.now().year
    frames = []
    for year in [current_year, current_year - 1]:
        print(f"  Fetching {year}...")
        df = fetch_disaggregated(year)
        if df is not None:
            frames.append(df)

    if not frames:
        print("  ERROR: No data fetched")
        return

    import pandas as pd
    combined = pd.concat(frames, ignore_index=True)
    print(f"  Combined: {len(combined)} rows")

    data = {
        "updated": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "commodities": {},
    }

    for platform_name, cftc_cfg in CFTC_CONTRACTS.items():
        cftc_name = cftc_cfg["disagg"]
        print(f"  Processing {platform_name} ({cftc_name[:50]}...)...")
        records = extract_commodity_data(combined, cftc_name)
        if records:
            data["commodities"][platform_name] = records
            print(f"    {len(records)} weeks of data")
        else:
            print(f"    No data found")

    # Clean up temp files created by cot_reports
    for tmp in ["c_year.txt", "annualof.txt"]:
        try:
            os.remove(tmp)
        except FileNotFoundError:
            pass

    with open(output_file, "w") as f:
        json.dump(data, f)

    print(f"Saved to {output_file}")
    total = sum(len(v) for v in data["commodities"].values())
    print(f"  {len(data['commodities'])} commodities, {total} total records")


if __name__ == "__main__":
    main()
