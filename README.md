# Energy Derivatives Pricing Terminal

> Plateforme de pricing d'options et d'analyse des marchés energy, développée avec Claude pour un usage personnel.

**[Accéder à l'application](https://axelcohen75.github.io/commodity-derivatives-pricer/)**

## Pages

### Options Pricer
Pricer d'options sur futures utilisant le modèle **Black-76**. Construction de stratégies multi-legs (straddle, strangle, butterfly, etc.), visualisation du payoff, des Greeks (Delta, Gamma, Vega, Theta, Rho, Vanna, Volga), surface 3D et parameter sweep. Presets disponibles pour les principales commodities energy (WTI, Brent, HH, TTF, Power, EUA, etc.).

### Energy Markets
Données de marché réelles via **Yahoo Finance** (spots, term structures, historiques). Analyse des timespreads (prompt spread, calendar spreads), monitoring des cross-commodity spreads (Brent-WTI, crack spreads, TTF-HH), et comparaison historique des courbes forward. Les données sont mises à jour automatiquement via GitHub Actions toutes les 30 minutes pendant les heures de marché.

## Données de marché

Les données sont récupérées par un script Python (`scripts/fetch_market_data.py`) qui utilise `yfinance` et sauvegarde les résultats dans un fichier JSON statique lu par le frontend. Zéro problème de CORS.

```bash
# Mettre à jour les données manuellement
pip install yfinance
python scripts/fetch_market_data.py
```

GitHub Actions met automatiquement à jour les données toutes les 30 min (lun-ven, heures NYMEX).

## Stack technique

- **HTML / CSS / JavaScript** vanilla, 100% côté client
- **Plotly.js** pour les graphiques 2D et surfaces 3D
- **Black-76** implémenté from scratch en JS
- **yfinance** (Python) pour les données Yahoo Finance
- **GitHub Actions** pour la mise à jour automatique des données

## Lancer en local

```bash
# Version web (statique)
# Ouvrir docs/index.html dans un navigateur

# Mettre à jour les données
pip install yfinance
python scripts/fetch_market_data.py

# Version Python (Dash)
pip install -r requirements.txt
python app.py
```

## Structure

```
├── docs/                     # Frontend (GitHub Pages)
│   ├── index.html
│   ├── style.css
│   ├── engine.js             # Moteur Black-76
│   ├── terminal.js           # UI pricer
│   ├── energy-data.js        # Lecture des données marché
│   ├── energy-markets.js     # UI energy markets
│   └── data/
│       └── market-data.json  # Données Yahoo Finance (auto-updated)
├── scripts/
│   └── fetch_market_data.py  # Fetcher Python yfinance
├── .github/workflows/
│   └── update-market-data.yml
├── engine/                   # Version Python
│   ├── models.py
│   └── market_data.py
├── app.py
└── requirements.txt
```
