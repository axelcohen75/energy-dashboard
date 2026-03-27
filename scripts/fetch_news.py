#!/usr/bin/env python3
"""
Fetch energy news from RSS feeds and classify into Physical vs Geopolitics.

Sources: Google News (aggregates Bloomberg, FT, Reuters, etc.), OilPrice, Rigzone, CNBC.
Output: docs/data/news-data.json
"""

import json
import re
import datetime
import sys
from pathlib import Path

try:
    import feedparser
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "feedparser", "-q"])
    import feedparser


# ─── RSS Feed Configuration ─────────────────────────────────────────────────

FEEDS = {
    # Google News aggregates Bloomberg, FT, Reuters, NYT, etc.
    "physical": [
        {
            "url": "https://oilprice.com/rss/main",
            "name": "OilPrice",
        },
    ],
    "geopolitics": [
        {
            "url": "https://news.google.com/rss/search?q=middle+east+iran+oil+sanctions+conflict+strait+hormuz+when:3d&hl=en&gl=US&ceid=US:en",
            "name": "Google News (Middle East)",
        },
        {
            "url": "https://news.google.com/rss/search?q=Russia+Ukraine+oil+gas+sanctions+energy+when:3d&hl=en&gl=US&ceid=US:en",
            "name": "Google News (Russia/Ukraine)",
        },
        {
            "url": "https://news.google.com/rss/search?q=OPEC+geopolitics+oil+embargo+war+conflict+energy+when:3d&hl=en&gl=US&ceid=US:en",
            "name": "Google News (Geopolitics)",
        },
    ],
}

# Keywords for relevance scoring
PHYSICAL_KEYWORDS = [
    "inventory", "inventories", "eia", "crude oil", "crude stock", "refinery",
    "pipeline", "opec", "production", "output", "supply", "demand", "barrel",
    "storage", "cushing", "spr", "strategic petroleum", "gasoline", "distillate",
    "lng", "natural gas", "export", "import", "tanker", "freight", "crack spread",
    "refining", "capacity", "drill", "rig count", "shale", "permian", "bakken",
    "north sea", "brent", "wti", "henry hub", "ttf", "opec+", "quota",
    "compliance", "cut", "pump", "output hike", "unwind",
]

GEOPOLITICS_KEYWORDS = [
    "iran", "iraq", "saudi", "russia", "ukraine", "sanctions", "conflict",
    "war", "strike", "missile", "military", "geopolit", "middle east",
    "strait of hormuz", "hormuz", "red sea", "houthi", "yemen", "libya",
    "venezuela", "embargo", "ceasefire", "diplomacy", "nuclear", "deal",
    "tension", "escalat", "attack", "drone", "navy", "blockade",
    "tariff", "trade war", "china", "energy security", "weaponiz",
]

# Preferred sources (ranked)
PREFERRED_SOURCES = [
    "bloomberg", "financial times", "ft.com", "reuters", "wall street journal",
    "wsj", "s&p global", "platts", "argus", "cnbc", "new york times",
    "oilprice", "rigzone", "energy intelligence",
]


def parse_source(entry):
    """Extract the original source from a Google News entry."""
    # Google News includes source in the <source> tag
    source = entry.get("source", {})
    if isinstance(source, dict):
        return source.get("title", "")
    # Fallback: extract from title (often "Title - Source")
    title = entry.get("title", "")
    if " - " in title:
        return title.rsplit(" - ", 1)[-1].strip()
    return ""


def get_source_priority(source_name):
    """Lower = better. Preferred sources get higher priority."""
    source_lower = source_name.lower()
    for i, pref in enumerate(PREFERRED_SOURCES):
        if pref in source_lower:
            return i
    return 100


def clean_summary(summary):
    """Remove HTML tags and truncate."""
    if not summary:
        return ""
    clean = re.sub(r"<[^>]+>", "", summary)
    clean = re.sub(r"&\w+;", " ", clean)
    clean = re.sub(r"\s+", " ", clean).strip()
    # Remove "Source Name -" prefix that Google News sometimes adds
    if " - " in clean and len(clean.split(" - ")[0]) < 40:
        parts = clean.split(" - ", 1)
        if len(parts) > 1:
            clean = parts[1].strip()
    if len(clean) > 200:
        clean = clean[:197] + "..."
    return clean


def compute_relevance(title, summary, category):
    """Score relevance of an article to its category."""
    text = (title + " " + summary).lower()
    keywords = PHYSICAL_KEYWORDS if category == "physical" else GEOPOLITICS_KEYWORDS
    score = sum(1 for kw in keywords if kw in text)
    return score


def resolve_google_news_url(url):
    """Return the Google News URL as-is (redirect happens client-side)."""
    # Google News RSS links redirect to the original article
    return url


def fetch_category(category, feed_configs):
    """Fetch and deduplicate news for a category."""
    articles = []
    seen_titles = set()

    for feed_cfg in feed_configs:
        try:
            feed = feedparser.parse(feed_cfg["url"])
            for entry in feed.entries:
                title = entry.get("title", "").strip()
                if not title:
                    continue

                # Deduplicate by normalized title
                title_norm = re.sub(r"[^a-z0-9]", "", title.lower())[:60]
                if title_norm in seen_titles:
                    continue
                seen_titles.add(title_norm)

                # Remove source suffix from Google News titles
                display_title = title
                source = parse_source(entry)
                if source and title.endswith(f" - {source}"):
                    display_title = title[: -(len(source) + 3)].strip()

                summary = clean_summary(entry.get("summary", ""))
                link = entry.get("link", "")
                published = entry.get("published", "")

                # Parse date
                pub_date = ""
                if entry.get("published_parsed"):
                    try:
                        dt = datetime.datetime(*entry.published_parsed[:6])
                        pub_date = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                    except Exception:
                        pass

                relevance = compute_relevance(title, summary, category)
                source_priority = get_source_priority(source)

                articles.append({
                    "title": display_title,
                    "summary": summary,
                    "source": source,
                    "url": link,
                    "published": pub_date,
                    "relevance": relevance,
                    "sourcePriority": source_priority,
                })

        except Exception as e:
            print(f"  Warning: Failed to fetch {feed_cfg['name']}: {e}")

    # Sort: relevance (desc), source priority (asc), then date (desc)
    articles.sort(key=lambda a: (-a["relevance"], a["sourcePriority"], a.get("published", "") or ""), reverse=False)
    # For equal relevance+source, sort by date desc
    articles.sort(key=lambda a: (-a["relevance"], a["sourcePriority"], -(hash(a.get("published", "")) if a.get("published") else 0)))

    # Remove scoring fields from output
    for a in articles:
        a.pop("relevance", None)
        a.pop("sourcePriority", None)

    # Limit to top 25 per category
    return articles[:25]


def main():
    output_dir = Path(__file__).resolve().parent.parent / "docs" / "data"
    output_dir.mkdir(parents=True, exist_ok=True)
    output_file = output_dir / "news-data.json"

    print("Fetching energy news...")

    data = {
        "updated": datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "physical": [],
        "geopolitics": [],
    }

    for category, feeds in FEEDS.items():
        print(f"  [{category}] Fetching from {len(feeds)} feeds...")
        articles = fetch_category(category, feeds)
        data[category] = articles
        print(f"  [{category}] {len(articles)} articles")

    with open(output_file, "w") as f:
        json.dump(data, f, indent=2)

    print(f"Saved to {output_file}")
    print(f"  Physical: {len(data['physical'])} articles")
    print(f"  Geopolitics: {len(data['geopolitics'])} articles")


if __name__ == "__main__":
    main()
