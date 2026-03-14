# Energy Derivatives Pricing Terminal ⚡

> Plateforme de pricing d'options et de risk management pour les matières premières énergétiques.

**[🔗 Accéder à l'application](https://axelcohen75.github.io/commodity-derivatives-pricer/)**

![Screenshot](docs/screenshot.png)

## Présentation

Ce projet est une plateforme web interactive de pricing d'options sur commodities énergétiques (pétrole, gaz, électricité, carbone...). Elle permet de pricer des options vanilles, construire des stratégies multi-legs et visualiser les Greeks en temps réel.

Le modèle utilisé est le **Black-76**, qui est le modèle standard pour les options sur futures — contrairement au Black-Scholes classique qui s'applique aux actions, Black-76 prend directement le prix du future comme input, ce qui évite de devoir modéliser le cost-of-carry (stockage, convenience yield) séparément. C'est le modèle de référence sur les desks commodities.

## Fonctionnalités

### Pricing
- Modèle **Black-76** pour options sur futures
- Support des Calls et Puts européens
- Positions Long / Short avec quantités ajustables

### Commodity Presets
Le modèle de pricing (Black-76) est le même pour toutes les commodities — les presets chargent simplement des paramètres de marché réalistes (prix, volatilité typique, taux) pour chaque sous-jacent :

WTI Crude Oil (CL), Brent Crude Oil (BZ), Henry Hub Natural Gas (NG), TTF Natural Gas, German Power Baseload, EU Carbon EUA, RBOB Gasoline (RB), Coal API2, LNG JKM

On peut aussi entrer des paramètres custom pour n'importe quel sous-jacent.

### Stratégies pré-configurées
Straddle, Strangle, Bull Call Spread, Bear Put Spread, Butterfly, Iron Condor, Risk Reversal, Collar

### Greeks
- **1er ordre** : Delta, Gamma, Vega, Theta, Rho
- **2ème ordre** : Vanna, Volga

### Visualisation
- Graphique interactif du payoff et des Greeks en fonction du sous-jacent
- Overlay multi-métriques (on peut activer/désactiver chaque Greek)
- **Surface 3D** des Greeks (Spot × Expiry ou Spot × Volatilité)
- **Parameter sweep** : visualiser comment un Greek évolue quand on fait varier un paramètre (temps, vol, taux)

## Stack technique

L'application tourne **100% côté client** (pas de serveur) :
- **HTML / CSS / JavaScript** vanilla
- **Plotly.js** pour les graphiques 2D et surfaces 3D
- **Black-76** implémenté from scratch en JS (+ version Python)

Il y a aussi une version **Python/Dash** pour ceux qui préfèrent :
- **Dash** + **Plotly**
- **NumPy / SciPy** pour le calcul numérique

## Lancer en local

### Version web (statique)
Ouvrir `docs/index.html` dans un navigateur, c'est tout.

### Version Python
```bash
pip install -r requirements.txt
python app.py
# → http://localhost:8050
```

## Structure du projet

```
├── docs/                  # Version statique (GitHub Pages)
│   ├── index.html
│   ├── style.css
│   ├── engine.js          # Moteur Black-76 en JS
│   └── terminal.js        # Logique UI
├── engine/                # Version Python
│   ├── models.py          # Black-76 + Greeks
│   └── market_data.py     # Données de référence commodities
├── app.py                 # App Dash (version Python)
└── requirements.txt
```

## Pourquoi Black-76 et pas Black-Scholes ?

Sur les marchés de commodities, on trade des options sur **futures** et non sur le spot directement. La raison est simple : le spot d'une commodity implique des coûts de stockage, de transport, et un convenience yield qui sont difficiles à modéliser.

Le modèle Black-76 résout ce problème en prenant le **prix du future** comme input. Le future intègre déjà toutes ces composantes (par arbitrage), donc on n'a pas besoin de les estimer séparément.

La formule est similaire à Black-Scholes mais sans le drift du spot :
- **Black-Scholes** : utilise S (spot) et doit modéliser le dividende/carry
- **Black-76** : utilise F (future) directement, le discount est juste e^(-rT)

## Limites et améliorations possibles

- Les données de marché sont statiques (pas de feed temps réel)
- Pas de smile/skew de volatilité — on utilise une vol flat
- Pas de support des options américaines ou exotiques (barrières, asiatiques)
- On pourrait ajouter un modèle de Bachelier pour les marchés power/gas (où les prix peuvent devenir négatifs)
- Intégration d'une vraie courbe de taux au lieu d'un taux flat

## Auteur

Axel Cohen — Projet réalisé dans le cadre de mes études en finance de marché.
