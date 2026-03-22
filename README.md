# Energy Derivatives Pricing Terminal

> Options pricing and energy market analysis platform, built with Claude for personal use.

**[Access the app](https://axelcohen75.github.io/commodity-derivatives-pricer/)**

## Pages

### Options Pricer
Futures options pricer using the **Black-76** model. Build multi-leg strategies (straddle, strangle, butterfly, etc.), visualize payoff, Greeks (Delta, Gamma, Vega, Theta, Rho, Vanna, Volga), 3D surface and parameter sweep. Presets available for major energy commodities (WTI, Brent, HH, TTF, Power, EUA, etc.).

### Energy Markets
Real market data via **Yahoo Finance** (spots, term structures, historical). Timespread analysis (prompt spread, calendar spreads), cross-commodity spread monitoring (Brent-WTI, crack spreads, TTF-HH), and historical forward curve comparison. Data is automatically updated via GitHub Actions every 30 minutes during market hours.

### Physical
EIA weekly inventory data (crude, Cushing, SPR, gasoline, distillates, natural gas) with up to 43 years of history and 5-year range bands. OPEC Watch with meeting outcome probabilities (implied from options), OPEC+ decisions history (2024–2026), calendar, key dates, supply snapshot, and seasonal indicators.

### Geopolitics
Polymarket prediction markets filtered for energy-relevant geopolitical events (conflicts, sanctions, diplomacy) and OPEC/physical impact (oil prices, production, trade). US x Iran ceasefire term structure with probability by deadline.

## Market Data

Data is fetched by Python scripts and saved as static JSON files read by the frontend. Zero CORS issues.

```bash
# Update data manually
pip install yfinance
python scripts/fetch_market_data.py    # Yahoo Finance (spots, term structures)
python scripts/fetch_physical_data.py  # EIA inventories + Polymarket
python scripts/fetch_opec_watch.py     # CME OPEC Watch probabilities
```

GitHub Actions automatically updates data every 30 min (Mon-Fri, NYMEX hours).

## Tech Stack

- **HTML / CSS / JavaScript** vanilla, 100% client-side
- **Plotly.js** for 2D charts and 3D surfaces
- **Black-76** implemented from scratch in JS
- **yfinance** (Python) for Yahoo Finance data
- **EIA API v2** for US inventory data
- **Polymarket Gamma API** for prediction markets
- **GitHub Actions** for automated data updates

## Run Locally

```bash
# Web version (static)
# Open docs/index.html in a browser

# Update data
pip install yfinance
python scripts/fetch_market_data.py
python scripts/fetch_physical_data.py

# Python version (Dash)
pip install -r requirements.txt
python app.py
```

## Structure

```
├── docs/                      # Frontend (GitHub Pages)
│   ├── index.html
│   ├── style.css
│   ├── engine.js              # Black-76 engine
│   ├── terminal.js            # Pricer UI
│   ├── energy-data.js         # Market data reader
│   ├── energy-markets.js      # Energy markets UI
│   ├── physical-markets.js    # Physical tab + OPEC Watch
│   ├── geopolitics.js         # Geopolitics tab
│   └── data/
│       ├── market-data.json   # Yahoo Finance data (auto-updated)
│       └── physical-data.json # EIA + Polymarket data (auto-updated)
├── scripts/
│   ├── fetch_market_data.py   # Yahoo Finance fetcher
│   ├── fetch_physical_data.py # EIA + Polymarket fetcher
│   └── fetch_opec_watch.py    # CME OPEC Watch scraper
├── .github/workflows/
│   └── update-market-data.yml
├── engine/                    # Python version
│   ├── models.py
│   └── market_data.py
├── app.py
└── requirements.txt
```
