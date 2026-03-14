/**
 * Black-76 Pricing Engine for Energy Commodity Derivatives
 *
 * Pure JavaScript implementation — runs entirely in the browser.
 * Black-76 is the standard model for options on futures (oil, gas, power).
 */

// ─── Normal distribution helpers ────────────────────────────────────────────

function normCDF(x) {
    // Abramowitz & Stegun approximation (max error ~1.5e-7)
    if (x === 0) return 0.5;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1.0 / (1.0 + 0.2316419 * x);
    const d = 0.3989422804014327; // 1/sqrt(2*PI)
    const p = d * Math.exp(-0.5 * x * x);
    const k = ((((1.330274429 * t - 1.821255978) * t + 1.781477937) * t -
        0.356563782) * t + 0.319381530) * t;
    return sign === 1 ? 1.0 - p * k : p * k;
}

function normPDF(x) {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2.0 * Math.PI);
}

// ─── Black-76 Model ─────────────────────────────────────────────────────────

const Black76 = {
    d1(F, K, r, sigma, T) {
        if (T <= 0 || sigma <= 0) return 0;
        return (Math.log(F / K) + 0.5 * sigma * sigma * T) / (sigma * Math.sqrt(T));
    },

    d2(F, K, r, sigma, T) {
        if (T <= 0 || sigma <= 0) return 0;
        return this.d1(F, K, r, sigma, T) - sigma * Math.sqrt(T);
    },

    price(F, K, r, sigma, T, isCall) {
        if (T <= 1e-10) {
            return isCall ? Math.max(F - K, 0) : Math.max(K - F, 0);
        }
        const d1 = this.d1(F, K, r, sigma, T);
        const d2 = this.d2(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        return isCall
            ? df * (F * normCDF(d1) - K * normCDF(d2))
            : df * (K * normCDF(-d2) - F * normCDF(-d1));
    },

    delta(F, K, r, sigma, T, isCall) {
        if (T <= 1e-10) {
            if (isCall) return F > K ? 1 : (F === K ? 0.5 : 0);
            return F < K ? -1 : (F === K ? -0.5 : 0);
        }
        const d1 = this.d1(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        return isCall ? df * normCDF(d1) : df * (normCDF(d1) - 1);
    },

    gamma(F, K, r, sigma, T) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const d1 = this.d1(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        return df * normPDF(d1) / (F * sigma * Math.sqrt(T));
    },

    vega(F, K, r, sigma, T) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const d1 = this.d1(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        return df * F * normPDF(d1) * Math.sqrt(T) / 100.0;
    },

    theta(F, K, r, sigma, T, isCall) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const d1 = this.d1(F, K, r, sigma, T);
        const d2 = this.d2(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        const term1 = -df * F * normPDF(d1) * sigma / (2 * Math.sqrt(T));
        let term2;
        if (isCall) {
            term2 = r * df * (F * normCDF(d1) - K * normCDF(d2));
        } else {
            term2 = r * df * (K * normCDF(-d2) - F * normCDF(-d1));
        }
        return (term1 - term2) / 365.0;
    },

    rho(F, K, r, sigma, T, isCall) {
        if (T <= 1e-10) return 0;
        const p = this.price(F, K, r, sigma, T, isCall);
        return -T * p / 100.0;
    },

    vanna(F, K, r, sigma, T) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const d1 = this.d1(F, K, r, sigma, T);
        const d2 = this.d2(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        return -df * normPDF(d1) * d2 / sigma;
    },

    volga(F, K, r, sigma, T) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const d1 = this.d1(F, K, r, sigma, T);
        const d2 = this.d2(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        const vegaRaw = df * F * normPDF(d1) * Math.sqrt(T);
        return vegaRaw * d1 * d2 / sigma / 100.0;
    },

    speed(F, K, r, sigma, T) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const d1 = this.d1(F, K, r, sigma, T);
        const g = this.gamma(F, K, r, sigma, T);
        return -g / F * (d1 / (sigma * Math.sqrt(T)) + 1);
    },

    zomma(F, K, r, sigma, T) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const d1 = this.d1(F, K, r, sigma, T);
        const d2 = this.d2(F, K, r, sigma, T);
        const g = this.gamma(F, K, r, sigma, T);
        return g * (d1 * d2 - 1) / sigma;
    },

    color(F, K, r, sigma, T) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const d1 = this.d1(F, K, r, sigma, T);
        const d2 = this.d2(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        const sqrtT = Math.sqrt(T);
        return -df * normPDF(d1) / (2 * F * T * sigma * sqrtT) *
            (2 * r * T + 1 + d1 * (2 * r * T - d2 * sigma * sqrtT) / (sigma * sqrtT));
    },

    ultima(F, K, r, sigma, T) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const d1 = this.d1(F, K, r, sigma, T);
        const d2 = this.d2(F, K, r, sigma, T);
        const df = Math.exp(-r * T);
        const vegaRaw = df * F * normPDF(d1) * Math.sqrt(T);
        return -vegaRaw / (sigma * sigma) *
            (d1 * d2 * (1 - d1 * d2) + d1 * d1 + d2 * d2) / 100.0;
    }
};

// ─── Portfolio Helpers ───────────────────────────────────────────────────────

function computeGreeks(leg, F, r, sigma, T) {
    const K = leg.strike;
    const isCall = leg.type === 'call';
    const sign = leg.position === 'long' ? 1 : -1;
    const qty = leg.quantity || 1;
    const s = sign * qty;

    return {
        price:  s * Black76.price(F, K, r, sigma, T, isCall),
        delta:  s * Black76.delta(F, K, r, sigma, T, isCall),
        gamma:  s * Black76.gamma(F, K, r, sigma, T),
        vega:   s * Black76.vega(F, K, r, sigma, T),
        theta:  s * Black76.theta(F, K, r, sigma, T, isCall),
        rho:    s * Black76.rho(F, K, r, sigma, T, isCall),
        vanna:  s * Black76.vanna(F, K, r, sigma, T),
        volga:  s * Black76.volga(F, K, r, sigma, T),
        speed:  s * Black76.speed(F, K, r, sigma, T),
        zomma:  s * Black76.zomma(F, K, r, sigma, T),
        color:  s * Black76.color(F, K, r, sigma, T),
        ultima: s * Black76.ultima(F, K, r, sigma, T),
    };
}

function portfolioGreeks(legs, F, r, sigma, T) {
    const totals = { price: 0, delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0,
                     vanna: 0, volga: 0, speed: 0, zomma: 0, color: 0, ultima: 0 };
    for (const leg of legs) {
        const g = computeGreeks(leg, F, r, sigma, T);
        for (const k in totals) totals[k] += g[k];
    }
    return totals;
}

function portfolioPayoff(legs, spotRange) {
    return spotRange.map(S => {
        let pnl = 0;
        for (const leg of legs) {
            const sign = (leg.position === 'long' ? 1 : -1) * (leg.quantity || 1);
            if (leg.type === 'call') {
                pnl += sign * Math.max(S - leg.strike, 0);
            } else {
                pnl += sign * Math.max(leg.strike - S, 0);
            }
        }
        return pnl;
    });
}

function computeGreekSurface(legs, greek, spotRange, secondRange, secondParam, env) {
    const surface = [];
    for (let i = 0; i < secondRange.length; i++) {
        const row = [];
        for (let j = 0; j < spotRange.length; j++) {
            const r = secondParam === 'risk_free_rate' ? secondRange[i] : env.r;
            const sigma = secondParam === 'volatility' ? secondRange[i] : env.sigma;
            const T = secondParam === 'time_to_expiry' ? secondRange[i] : env.T;
            const g = portfolioGreeks(legs, spotRange[j], r, sigma, T);
            row.push(g[greek] || 0);
        }
        surface.push(row);
    }
    return surface;
}

function linspace(a, b, n) {
    const arr = [];
    const step = (b - a) / (n - 1);
    for (let i = 0; i < n; i++) arr.push(a + step * i);
    return arr;
}

// ─── Strategies ──────────────────────────────────────────────────────────────

const STRATEGIES = {
    'Straddle': K => [
        { type: 'call', strike: K, position: 'long', quantity: 1 },
        { type: 'put',  strike: K, position: 'long', quantity: 1 },
    ],
    'Strangle': K => [
        { type: 'call', strike: +(K * 1.05).toFixed(2), position: 'long', quantity: 1 },
        { type: 'put',  strike: +(K * 0.95).toFixed(2), position: 'long', quantity: 1 },
    ],
    'Bull Call Spread': K => [
        { type: 'call', strike: K, position: 'long', quantity: 1 },
        { type: 'call', strike: +(K * 1.10).toFixed(2), position: 'short', quantity: 1 },
    ],
    'Bear Put Spread': K => [
        { type: 'put', strike: +(K * 1.10).toFixed(2), position: 'long', quantity: 1 },
        { type: 'put', strike: K, position: 'short', quantity: 1 },
    ],
    'Butterfly': K => [
        { type: 'call', strike: +(K * 0.95).toFixed(2), position: 'long', quantity: 1 },
        { type: 'call', strike: K, position: 'short', quantity: 2 },
        { type: 'call', strike: +(K * 1.05).toFixed(2), position: 'long', quantity: 1 },
    ],
    'Iron Condor': K => [
        { type: 'put',  strike: +(K * 0.90).toFixed(2), position: 'long', quantity: 1 },
        { type: 'put',  strike: +(K * 0.95).toFixed(2), position: 'short', quantity: 1 },
        { type: 'call', strike: +(K * 1.05).toFixed(2), position: 'short', quantity: 1 },
        { type: 'call', strike: +(K * 1.10).toFixed(2), position: 'long', quantity: 1 },
    ],
    'Risk Reversal': K => [
        { type: 'call', strike: +(K * 1.05).toFixed(2), position: 'long', quantity: 1 },
        { type: 'put',  strike: +(K * 0.95).toFixed(2), position: 'short', quantity: 1 },
    ],
    'Collar': K => [
        { type: 'call', strike: +(K * 1.05).toFixed(2), position: 'short', quantity: 1 },
        { type: 'put',  strike: +(K * 0.95).toFixed(2), position: 'long', quantity: 1 },
    ],
};

// ─── Commodity Reference Data ────────────────────────────────────────────────

const COMMODITIES = {
    'WTI Crude Oil':          { ticker: 'CL',   unit: 'USD/bbl',   F: 75,   vol: 35, rate: 5.0, exchange: 'NYMEX' },
    'Brent Crude Oil':        { ticker: 'BZ',   unit: 'USD/bbl',   F: 78,   vol: 33, rate: 5.0, exchange: 'ICE' },
    'Henry Hub Natural Gas':  { ticker: 'NG',   unit: 'USD/MMBtu', F: 3.50, vol: 55, rate: 5.0, exchange: 'NYMEX' },
    'TTF Natural Gas':        { ticker: 'TTF',  unit: 'EUR/MWh',   F: 35,   vol: 60, rate: 4.0, exchange: 'ICE' },
    'German Power (Baseload)':{ ticker: 'DEPW', unit: 'EUR/MWh',   F: 85,   vol: 50, rate: 4.0, exchange: 'EEX' },
    'UK Power (Baseload)':    { ticker: 'UKPW', unit: 'GBP/MWh',   F: 95,   vol: 48, rate: 4.5, exchange: 'ICE' },
    'RBOB Gasoline':          { ticker: 'RB',   unit: 'USD/gal',   F: 2.50, vol: 38, rate: 5.0, exchange: 'NYMEX' },
    'Heating Oil':            { ticker: 'HO',   unit: 'USD/gal',   F: 2.60, vol: 36, rate: 5.0, exchange: 'NYMEX' },
    'EU Carbon (EUA)':        { ticker: 'EUA',  unit: 'EUR/tCO2',  F: 65,   vol: 45, rate: 4.0, exchange: 'ICE' },
    'Coal (API2)':            { ticker: 'API2', unit: 'USD/mt',    F: 120,  vol: 40, rate: 5.0, exchange: 'ICE' },
    'LNG (JKM)':              { ticker: 'JKM',  unit: 'USD/MMBtu', F: 12,   vol: 65, rate: 5.0, exchange: 'ICE' },
    'Ethanol':                { ticker: 'EH',   unit: 'USD/gal',   F: 1.80, vol: 35, rate: 5.0, exchange: 'CBOT' },
};
