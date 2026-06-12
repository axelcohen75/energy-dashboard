#!/usr/bin/env python3
"""
Generate an AI daily market briefing from REAL fetched data.

Inputs (must exist, produced by the other fetch scripts):
  - docs/data/news-data.json     (real headlines from RSS feeds)
  - docs/data/market-data.json   (real prices from Yahoo Finance / ENTSO-E)
  - docs/data/opec-watch.json    (optional, CME OPEC Watch probabilities)

Output:
  - docs/data/daily-briefing.json

The summary is written by Claude (Anthropic API) and is constrained to use
ONLY the provided headlines and price data — nothing is invented.

Requires the ANTHROPIC_API_KEY environment variable. Without it the script
exits gracefully and the frontend shows a setup notice instead.
"""

import json
import os
import sys
import datetime
import urllib.request
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "docs" / "data"
OUTPUT = DATA_DIR / "daily-briefing.json"

ANTHROPIC_MODEL = "claude-sonnet-4-6"
MAX_AGE_HOURS = 5  # don't regenerate more often than this (cron runs every 30 min)

# Sector → keywords used to pick relevant headlines
SECTOR_KEYWORDS = {
    "oil": ["oil", "crude", "wti", "brent", "opec", "gasoline", "diesel", "distillate",
            "refin", "barrel", "rig", "shale", "spr", "tanker", "saudi", "iran", "russia"],
    "gas": ["gas", "lng", "ttf", "henry hub", "storage", "pipeline", "freeport",
            "methane", "gazprom", "nord stream", "injection", "withdrawal"],
    "power": ["power", "electricity", "carbon", "eua", "ets", "emission", "renewable",
              "solar", "wind", "nuclear", "grid", "utility", "baseload", "mwh"],
}

# Sector → (commodity name in market-data.json, history symbol)
SECTOR_PRICES = {
    "oil": [
        ("WTI Crude Oil (CL)", "CL=F", "$/bbl"),
        ("Brent Crude Oil (BZ)", "BZ=F", "$/bbl"),
        ("RBOB Gasoline (RB)", "RB=F", "$/gal"),
        ("Heating Oil (HO)", "HO=F", "$/gal"),
    ],
    "gas": [
        ("Henry Hub Nat Gas (NG)", "NG=F", "$/MMBtu"),
        ("TTF Natural Gas", "TTF=F", "€/MWh"),
    ],
    "power": [
        ("EU Carbon EUA (CO2)", "CO2.L", "$/EUA"),
        ("German Power (DE)", "DE-PWR", "€/MWh"),
        ("TTF Natural Gas", "TTF=F", "€/MWh"),
    ],
}


def load_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def pct_change(closes, n):
    if not closes or len(closes) < n + 1:
        return None
    prev = closes[-1 - n]
    if not prev:
        return None
    return (closes[-1] - prev) / prev * 100


def build_price_block(market, sector):
    """Real price moves for the sector, formatted for the prompt."""
    lines = []
    history = market.get("history", {})
    spots = market.get("spots", {})
    for name, sym, unit in SECTOR_PRICES[sector]:
        hist = history.get(sym)
        spot = spots.get(name)
        if not hist or spot is None:
            continue
        closes = hist.get("close", [])
        d1 = pct_change(closes, 1)
        w1 = pct_change(closes, 5)
        m1 = pct_change(closes, 21)
        parts = [f"{name}: {spot} {unit}"]
        if d1 is not None:
            parts.append(f"1d {d1:+.2f}%")
        if w1 is not None:
            parts.append(f"1w {w1:+.2f}%")
        if m1 is not None:
            parts.append(f"1m {m1:+.2f}%")
        lines.append(" | ".join(parts))
    return lines


def pick_headlines(news, sector, limit=12):
    """Pick the sector's most relevant recent headlines (real, from RSS)."""
    articles = (news.get("physical") or []) + (news.get("geopolitics") or [])
    kws = SECTOR_KEYWORDS[sector]
    scored = []
    for a in articles:
        text = (a.get("title", "") + " " + a.get("summary", "")).lower()
        score = sum(1 for kw in kws if kw in text)
        if sector == "oil":
            score = max(score, 1)  # oil is the default bucket
        if score > 0:
            scored.append((score, a))
    scored.sort(key=lambda x: (-x[0], x[1].get("published", "")), reverse=False)
    out = []
    for _, a in scored[:limit]:
        h = {"title": a.get("title", ""), "source": a.get("source", ""),
             "published": a.get("published", "")}
        if a.get("summary"):
            h["summary"] = a["summary"][:160]
        out.append(h)
    return out


def call_claude(api_key, prompt):
    body = json.dumps({
        "model": ANTHROPIC_MODEL,
        "max_tokens": 2000,
        "system": (
            "You are an energy markets analyst writing an end-of-day desk briefing. "
            "STRICT RULES: base every statement ONLY on the headlines and price data "
            "provided by the user. Never invent numbers, events, or names. If the "
            "provided information is thin for a sector, say so briefly rather than "
            "padding. Write tight, professional prose in English, like a trading-desk "
            "morning note. Respond ONLY with valid JSON, no markdown fences."
        ),
        "messages": [{"role": "user", "content": prompt}],
    }).encode()

    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=body,
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read())
    return data["content"][0]["text"]


def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("ANTHROPIC_API_KEY not set — skipping AI briefing generation.")
        print("Add it as a GitHub Actions secret to enable the daily briefing.")
        return 0

    # Throttle: skip if the existing briefing is fresh
    existing = load_json(OUTPUT)
    if existing and existing.get("generated"):
        try:
            gen = datetime.datetime.fromisoformat(existing["generated"])
            age = datetime.datetime.now(datetime.timezone.utc) - gen
            if age.total_seconds() < MAX_AGE_HOURS * 3600 and "--force" not in sys.argv:
                print(f"Briefing is {age.total_seconds()/3600:.1f}h old (<{MAX_AGE_HOURS}h) — skipping.")
                return 0
        except Exception:
            pass

    news = load_json(DATA_DIR / "news-data.json")
    market = load_json(DATA_DIR / "market-data.json")
    if not news or not market:
        print("Missing news-data.json or market-data.json — run the fetch scripts first.")
        return 1

    opec = load_json(DATA_DIR / "opec-watch.json")

    # Build per-sector context
    sectors_ctx = {}
    for sector in ["oil", "gas", "power"]:
        sectors_ctx[sector] = {
            "prices": build_price_block(market, sector),
            "headlines": pick_headlines(news, sector),
        }

    opec_block = ""
    if opec:
        try:
            mtgs = opec.get("meetings") or []
            if mtgs:
                m = mtgs[0]
                opec_block = (f"\nCME OPEC WATCH (options-implied, next meeting {m.get('date','?')}): "
                              + ", ".join(f"{k} {v}%" for k, v in (m.get("probabilities") or {}).items()))
        except Exception:
            pass

    prompt = f"""Today is {datetime.date.today().isoformat()}. Write a daily briefing for three energy sectors.

For each sector you get REAL price moves and REAL headlines (from RSS feeds today). Use only this material.

=== OIL ===
PRICES:
{chr(10).join(sectors_ctx['oil']['prices']) or 'no price data'}
{opec_block}
HEADLINES:
{json.dumps(sectors_ctx['oil']['headlines'], indent=1)}

=== GAS ===
PRICES:
{chr(10).join(sectors_ctx['gas']['prices']) or 'no price data'}
HEADLINES:
{json.dumps(sectors_ctx['gas']['headlines'], indent=1)}

=== POWER & CARBON ===
PRICES:
{chr(10).join(sectors_ctx['power']['prices']) or 'no price data'}
HEADLINES:
{json.dumps(sectors_ctx['power']['headlines'], indent=1)}

Return JSON exactly in this shape:
{{
 "oil":   {{"summary": "100-150 word prose recap connecting today's price action to the news flow", "drivers": ["3 short bullet points of key drivers"]}},
 "gas":   {{"summary": "...", "drivers": ["..."]}},
 "power": {{"summary": "...", "drivers": ["..."]}}
}}"""

    print(f"Calling Claude ({ANTHROPIC_MODEL})...")
    raw = call_claude(api_key, prompt)

    # Parse model output (strip accidental fences)
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    briefing = json.loads(raw)

    out = {
        "generated": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "model": ANTHROPIC_MODEL,
        "sectors": {},
    }
    for sector in ["oil", "gas", "power"]:
        sec = briefing.get(sector, {})
        out["sectors"][sector] = {
            "summary": sec.get("summary", ""),
            "drivers": sec.get("drivers", []),
            "headlineCount": len(sectors_ctx[sector]["headlines"]),
            "sources": sorted({h["source"] for h in sectors_ctx[sector]["headlines"] if h.get("source")})[:6],
        }

    with open(OUTPUT, "w") as f:
        json.dump(out, f, indent=1)
    print(f"Wrote {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
