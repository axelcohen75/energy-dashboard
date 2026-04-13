/**
 * Black-76 Pricing Engine for Energy Commodity Derivatives
 *
 * Pure JavaScript implementation — runs entirely in the browser.
 * Black-76 is the standard model for options on futures (oil, gas, power).
 */

// ─── Normal distribution helpers ────────────────────────────────────────────

function normCDF(x) {
    if (x === 0) return 0.5;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1.0 / (1.0 + 0.2316419 * x);
    const d = 0.3989422804014327;
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
        // θ = -dC/dT = -df*F*N'(d1)*σ/(2√T) + r*Price
        const diffusion = -df * F * normPDF(d1) * sigma / (2 * Math.sqrt(T));
        let riskFree;
        if (isCall) {
            riskFree = r * df * (F * normCDF(d1) - K * normCDF(d2));
        } else {
            riskFree = r * df * (K * normCDF(-d2) - F * normCDF(-d1));
        }
        return (diffusion + riskFree) / 365.0;
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
};

// ─── Bachelier (Normal) Model ───────────────────────────────────────────────
// Useful for spread options where the underlying spread can be negative.
// σ here is an *absolute* (dollar) volatility, not a relative one.

const Bachelier = {
    price(F, K, sigma, T, isCall) {
        if (T <= 1e-10 || sigma <= 0) {
            return Math.max((isCall ? 1 : -1) * (F - K), 0);
        }
        const stdv = sigma * Math.sqrt(T);
        const d = (F - K) / stdv;
        if (isCall) return stdv * (d * normCDF(d) + normPDF(d));
        return stdv * (-d * normCDF(-d) + normPDF(d));
    },
    delta(F, K, sigma, T, isCall) {
        if (T <= 1e-10 || sigma <= 0) {
            if (isCall) return F > K ? 1 : 0;
            return F < K ? -1 : 0;
        }
        const d = (F - K) / (sigma * Math.sqrt(T));
        return isCall ? normCDF(d) : -normCDF(-d);
    },
    gamma(F, K, sigma, T) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const stdv = sigma * Math.sqrt(T);
        return normPDF((F - K) / stdv) / stdv;
    },
    vega(F, K, sigma, T) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        return normPDF((F - K) / (sigma * Math.sqrt(T))) * Math.sqrt(T);
    },
    theta(F, K, sigma, T, isCall) {
        if (T <= 1e-10 || sigma <= 0) return 0;
        const stdv = sigma * Math.sqrt(T);
        return -sigma * normPDF((F - K) / stdv) / (2 * Math.sqrt(T)) / 365.0;
    },
};

// ─── Kirk's Approximation for Spread Options ────────────────────────────────
// Prices a European option on the spread (F1 - F2 - K).
//   σ_eq = √( σ1² + (σ2·F2/(F2+K))² − 2ρ·σ1·σ2·F2/(F2+K) )
// Equivalent to Black-76 on F_eq = F1/(F2+K) with strike 1, scaled by (F2+K).
// Works well when (F2+K) > 0; falls back to Bachelier otherwise.

const KirkSpread = {
    sigmaEq(F1, F2, sigma1, sigma2, rho, K) {
        const adj = F2 / (F2 + K);
        const v = sigma1 * sigma1
                + sigma2 * sigma2 * adj * adj
                - 2 * rho * sigma1 * sigma2 * adj;
        return Math.sqrt(Math.max(v, 1e-12));
    },

    price(F1, F2, K, sigma1, sigma2, rho, r, T, isCall) {
        if (T <= 1e-10) {
            const intrinsic = F1 - F2 - K;
            return Math.max((isCall ? 1 : -1) * intrinsic, 0);
        }
        const denom = F2 + K;
        const df = Math.exp(-r * T);

        if (denom <= 0) {
            // Kirk degenerates → fall back to Bachelier on the absolute spread
            const fwd = F1 - F2;
            const absVar = sigma1 * sigma1 * F1 * F1
                         + sigma2 * sigma2 * F2 * F2
                         - 2 * rho * sigma1 * sigma2 * F1 * F2;
            const absVol = Math.sqrt(Math.max(absVar, 1e-12));
            return df * Bachelier.price(fwd, K, absVol, T, isCall);
        }

        const sigmaE = this.sigmaEq(F1, F2, sigma1, sigma2, rho, K);
        const sqT = Math.sqrt(T);
        const F_eq = F1 / denom;
        const d1 = (Math.log(F_eq) + 0.5 * sigmaE * sigmaE * T) / (sigmaE * sqT);
        const d2 = d1 - sigmaE * sqT;

        if (isCall) {
            return df * denom * (F_eq * normCDF(d1) - normCDF(d2));
        }
        return df * denom * (normCDF(-d2) - F_eq * normCDF(-d1));
    },

    /**
     * Greeks via finite differences (Kirk has no closed-form ones in general).
     * Bumps:
     *   ΔF  = 0.01 (1¢)        for delta_1, delta_2
     *   Δσ  = 0.0001 (1bp vol) for vega_1, vega_2
     *   ΔT  = 1/365            for theta
     *   Δρ  = 0.001            for cega (correlation sensitivity)
     */
    greeks(F1, F2, K, sigma1, sigma2, rho, r, T, isCall) {
        const p = (a, b, c, d, e, f, g, h) => this.price(a, b, K, c, d, e, r, f, isCall);
        const base = p(F1, F2, sigma1, sigma2, rho, T);

        const dF = 0.01;
        const dSig = 0.0001;
        const dT = 1 / 365;
        const dRho = 0.001;

        const delta1 = (p(F1 + dF, F2, sigma1, sigma2, rho, T)
                      - p(F1 - dF, F2, sigma1, sigma2, rho, T)) / (2 * dF);
        const delta2 = (p(F1, F2 + dF, sigma1, sigma2, rho, T)
                      - p(F1, F2 - dF, sigma1, sigma2, rho, T)) / (2 * dF);
        const gamma1 = (p(F1 + dF, F2, sigma1, sigma2, rho, T)
                      - 2 * base
                      + p(F1 - dF, F2, sigma1, sigma2, rho, T)) / (dF * dF);
        const gamma2 = (p(F1, F2 + dF, sigma1, sigma2, rho, T)
                      - 2 * base
                      + p(F1, F2 - dF, sigma1, sigma2, rho, T)) / (dF * dF);
        const vega1  = (p(F1, F2, sigma1 + dSig, sigma2, rho, T)
                      - p(F1, F2, sigma1 - dSig, sigma2, rho, T)) / (2 * dSig) / 100;
        const vega2  = (p(F1, F2, sigma1, sigma2 + dSig, rho, T)
                      - p(F1, F2, sigma1, sigma2 - dSig, rho, T)) / (2 * dSig) / 100;
        const cega   = (p(F1, F2, sigma1, sigma2, rho + dRho, T)
                      - p(F1, F2, sigma1, sigma2, rho - dRho, T)) / (2 * dRho) / 100;
        const theta  = T > dT
            ? (p(F1, F2, sigma1, sigma2, rho, T - dT) - base)
            : 0;

        return { price: base, delta1, delta2, gamma1, gamma2, vega1, vega2, cega, theta };
    },
};

// ─── Crack Spread Presets ────────────────────────────────────────────────────
// Standard refinery margin proxies. Ratios are (crude : RBOB : HO)
// expressed as "a barrels of crude → b barrels of gasoline + c barrels of HO".
// Inputs are quoted in $/bbl (multiply $/gal by 42 to convert).

const CRACK_PRESETS = {
    'Gasoline Crack 1:1':  { ratios: { wti: 1, rbob: 1, ho: 0 }, label: '1×WTI → 1×RBOB' },
    'Heating Oil 1:1':     { ratios: { wti: 1, rbob: 0, ho: 1 }, label: '1×WTI → 1×HO'   },
    '3:2:1 Crack':         { ratios: { wti: 3, rbob: 2, ho: 1 }, label: '3×WTI → 2×RBOB + 1×HO' },
    '2:1:1 Crack':         { ratios: { wti: 2, rbob: 1, ho: 1 }, label: '2×WTI → 1×RBOB + 1×HO' },
    '5:3:2 Crack':         { ratios: { wti: 5, rbob: 3, ho: 2 }, label: '5×WTI → 3×RBOB + 2×HO' },
};

/**
 * Reduce a 3-asset crack to a synthetic 2-asset spread (refined basket vs crude),
 * computing the basket's relative volatility and its correlation to crude.
 *
 *   Per barrel of crude:
 *     F_basket = (b·F_RBOB + c·F_HO) / a
 *     spread   = F_basket − F_WTI
 *
 *   Variance of the basket (in $²) is computed from the absolute variances
 *   of each refined leg, then converted to a relative vol dividing by F_basket.
 */
function buildCrackBasket({
    F_wti, sigma_wti,
    F_rbob, sigma_rbob,
    F_ho, sigma_ho,
    rho_wr, rho_wh, rho_rh,
    ratios,
}) {
    const a = ratios.wti, b = ratios.rbob, c = ratios.ho;
    const w_r = b / a;
    const w_h = c / a;
    const F_basket = w_r * F_rbob + w_h * F_ho;

    // Absolute (dollar) std deviations of each refined leg, weighted per barrel of crude.
    const vR = w_r * F_rbob * sigma_rbob;
    const vH = w_h * F_ho   * sigma_ho;

    // Variance of the dollar value of the basket (per barrel of crude).
    const var_basket_abs = vR * vR + vH * vH + 2 * rho_rh * vR * vH;
    const sigma_basket = F_basket > 0 ? Math.sqrt(Math.max(var_basket_abs, 0)) / F_basket : 0;

    // Correlation between the basket and crude:
    //   cov(B, W) = w_r·F_rbob·σ_rbob · F_wti·σ_wti · ρ_wr  +  w_h·F_ho·σ_ho · F_wti·σ_wti · ρ_wh
    const cov = vR * F_wti * sigma_wti * rho_wr + vH * F_wti * sigma_wti * rho_wh;
    const denom = sigma_basket * F_basket * sigma_wti * F_wti;
    const rho_eff = denom > 0 ? cov / denom : 0;

    return {
        F_basket,
        sigma_basket,
        rho_eff: Math.max(-0.999, Math.min(0.999, rho_eff)),
    };
}

// ─── Forward Pricing ─────────────────────────────────────────────────────────

/**
 * Compute commodity forward price from cost-of-carry model.
 * F = S × e^((r + u - y) × T)
 *
 * @param {number} S     Spot price
 * @param {number} r     Funding/risk-free rate (decimal, e.g. 0.05)
 * @param {number} u     Storage cost (decimal, e.g. 0.02)
 * @param {number} y     Convenience yield (decimal, e.g. 0.03)
 * @param {number} T     Time to maturity (years)
 * @returns {number}     Forward price
 */
function computeForward(S, r, u, y, T) {
    return S * Math.exp((r + u - y) * T);
}

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
    };
}

function portfolioGreeks(legs, F, r, sigma, T) {
    const totals = { price: 0, delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0,
                     vanna: 0, volga: 0 };
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

// ─── Commodity Presets ───────────────────────────────────────────────────────
// These load realistic default parameters — the pricing model (Black-76) is the same for all.

const COMMODITIES = {
    'WTI Crude Oil (CL)':            { spot: 75,   vol: 35, rate: 5.0, convYield: 6.0, storageCost: 1.5 },
    'Brent Crude Oil (BZ)':          { spot: 78,   vol: 33, rate: 5.0, convYield: 5.5, storageCost: 1.0 },
    'Henry Hub Nat Gas (NG)':        { spot: 3.50, vol: 55, rate: 5.0, convYield: 8.0, storageCost: 4.0 },
    'TTF Natural Gas':               { spot: 35,   vol: 60, rate: 4.0, convYield: 6.0, storageCost: 2.0 },
    'German Power Baseload':         { spot: 85,   vol: 50, rate: 4.0, convYield: 0.0, storageCost: 0.0 },
    'RBOB Gasoline (RB)':            { spot: 2.50, vol: 38, rate: 5.0, convYield: 4.0, storageCost: 2.0 },
    'Custom':                        { spot: 100,  vol: 30, rate: 5.0, convYield: 0.0, storageCost: 0.0 },
};
