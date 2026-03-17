/**
 * Energy Markets — Synthetic Data Engine
 *
 * Generates realistic term structures, timespreads, and cross-commodity spreads
 * for energy markets. All data is synthetic but calibrated to real-world patterns
 * (contango/backwardation, seasonality, mean-reversion).
 */

// ─── Commodity Futures Definitions ──────────────────────────────────────────

const ENERGY_COMMODITIES = {
    'WTI Crude Oil (CL)': {
        spot: 72.50,
        unit: '$/bbl',
        months: 36,
        curve: 'backwardation',
        seasonality: 0.02,
        vol: 0.28,
        color: '#2563eb',
        colorDark: '#60a5fa',
    },
    'Brent Crude Oil (BZ)': {
        spot: 76.20,
        unit: '$/bbl',
        months: 36,
        curve: 'backwardation',
        seasonality: 0.02,
        vol: 0.26,
        color: '#7c3aed',
        colorDark: '#a78bfa',
    },
    'Henry Hub Nat Gas (NG)': {
        spot: 3.45,
        unit: '$/MMBtu',
        months: 36,
        curve: 'contango',
        seasonality: 0.25,
        vol: 0.45,
        color: '#059669',
        colorDark: '#34d399',
    },
    'TTF Natural Gas': {
        spot: 34.80,
        unit: '€/MWh',
        months: 36,
        curve: 'contango',
        seasonality: 0.20,
        vol: 0.50,
        color: '#d97706',
        colorDark: '#fbbf24',
    },
    'German Power Baseload': {
        spot: 82.50,
        unit: '€/MWh',
        months: 24,
        curve: 'contango',
        seasonality: 0.18,
        vol: 0.42,
        color: '#dc2626',
        colorDark: '#f87171',
    },
    'RBOB Gasoline (RB)': {
        spot: 2.48,
        unit: '$/gal',
        months: 24,
        curve: 'backwardation',
        seasonality: 0.12,
        vol: 0.32,
        color: '#db2777',
        colorDark: '#f472b6',
    },
    'Heating Oil (HO)': {
        spot: 2.62,
        unit: '$/gal',
        months: 24,
        curve: 'contango',
        seasonality: 0.10,
        vol: 0.30,
        color: '#0891b2',
        colorDark: '#22d3ee',
    },
};

// ─── Seeded random for reproducibility ──────────────────────────────────────

function seededRandom(seed) {
    let s = seed;
    return function () {
        s = (s * 16807 + 0) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

// ─── Term Structure Generator ───────────────────────────────────────────────

function generateTermStructure(commodity, seed) {
    const cfg = ENERGY_COMMODITIES[commodity];
    if (!cfg) return null;

    const rng = seededRandom(seed || 42);
    const months = [];
    const prices = [];
    const now = new Date();
    const baseMonth = now.getMonth();

    for (let i = 0; i < cfg.months; i++) {
        const date = new Date(now.getFullYear(), baseMonth + i + 1, 1);
        const monthLabel = date.toLocaleDateString('en', { year: '2-digit', month: 'short' });
        months.push(monthLabel);

        // Base drift: contango = slight upward, backwardation = slight downward
        const drift = cfg.curve === 'contango' ? 0.002 : -0.003;

        // Seasonality: winter premium for gas/power, summer for gasoline
        const monthOfYear = date.getMonth();
        let seasonal = 0;
        if (commodity.includes('Gas') || commodity.includes('Power') || commodity.includes('TTF')) {
            // Winter premium (Oct-Mar)
            seasonal = (monthOfYear >= 9 || monthOfYear <= 2) ? cfg.seasonality : -cfg.seasonality * 0.5;
        } else if (commodity.includes('Gasoline')) {
            // Summer driving season (Apr-Sep)
            seasonal = (monthOfYear >= 3 && monthOfYear <= 8) ? cfg.seasonality : -cfg.seasonality * 0.3;
        } else if (commodity.includes('Heating')) {
            seasonal = (monthOfYear >= 9 || monthOfYear <= 2) ? cfg.seasonality : -cfg.seasonality * 0.4;
        }

        // Noise
        const noise = (rng() - 0.5) * cfg.vol * 0.04;

        const factor = 1 + drift * i + seasonal * Math.sin((monthOfYear / 12) * 2 * Math.PI) + noise;
        prices.push(+(cfg.spot * factor).toFixed(cfg.spot < 10 ? 3 : 2));
    }

    return { months, prices, unit: cfg.unit, spot: cfg.spot };
}

// ─── Historical Timespread Generator ────────────────────────────────────────

const TIMESPREAD_DEFINITIONS = {
    'WTI Crude Oil (CL)': [
        { name: 'CL Prompt Spread (M1-M2)', m1: 0, m2: 1 },
        { name: 'CL 1-3 Month', m1: 0, m2: 2 },
        { name: 'CL 1-6 Month', m1: 0, m2: 5 },
        { name: 'CL 1-12 Month', m1: 0, m2: 11 },
        { name: 'CL 6-12 Month', m1: 5, m2: 11 },
    ],
    'Brent Crude Oil (BZ)': [
        { name: 'BZ Prompt Spread (M1-M2)', m1: 0, m2: 1 },
        { name: 'BZ 1-3 Month', m1: 0, m2: 2 },
        { name: 'BZ 1-6 Month', m1: 0, m2: 5 },
        { name: 'BZ 1-12 Month', m1: 0, m2: 11 },
    ],
    'Henry Hub Nat Gas (NG)': [
        { name: 'NG Prompt Spread (M1-M2)', m1: 0, m2: 1 },
        { name: 'NG Summer-Winter', m1: 5, m2: 11 },
        { name: 'NG 1-6 Month', m1: 0, m2: 5 },
        { name: 'NG 1-12 Month', m1: 0, m2: 11 },
    ],
    'TTF Natural Gas': [
        { name: 'TTF Prompt Spread (M1-M2)', m1: 0, m2: 1 },
        { name: 'TTF Summer-Winter', m1: 5, m2: 11 },
        { name: 'TTF Q1-Q3', m1: 2, m2: 8 },
        { name: 'TTF 1-12 Month', m1: 0, m2: 11 },
    ],
    'German Power Baseload': [
        { name: 'Power Prompt Spread (M1-M2)', m1: 0, m2: 1 },
        { name: 'Power Q1-Q3', m1: 2, m2: 8 },
        { name: 'Power 1-6 Month', m1: 0, m2: 5 },
    ],
    'RBOB Gasoline (RB)': [
        { name: 'RB Prompt Spread (M1-M2)', m1: 0, m2: 1 },
        { name: 'RB 1-6 Month', m1: 0, m2: 5 },
    ],
    'Heating Oil (HO)': [
        { name: 'HO Prompt Spread (M1-M2)', m1: 0, m2: 1 },
        { name: 'HO 1-6 Month', m1: 0, m2: 5 },
    ],
};

function generateTimespreadHistory(commodity, spreadDef, nDays) {
    const cfg = ENERGY_COMMODITIES[commodity];
    if (!cfg) return null;
    nDays = nDays || 252; // 1 year of trading days

    const rng = seededRandom(spreadDef.m1 * 1000 + spreadDef.m2 * 100 + nDays);
    const dates = [];
    const values = [];

    // Base spread depends on curve shape
    const monthGap = spreadDef.m2 - spreadDef.m1;
    let baseDrift = cfg.curve === 'contango' ? 0.002 : -0.003;
    let baseSpread = cfg.spot * baseDrift * monthGap;

    // Mean-reverting process (OU)
    const meanReversion = 0.03;
    const spreadVol = Math.abs(baseSpread) * 0.5 + cfg.spot * 0.005;
    let current = baseSpread + (rng() - 0.5) * spreadVol;

    const now = new Date();
    for (let i = nDays - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        // Skip weekends
        if (date.getDay() === 0 || date.getDay() === 6) continue;

        dates.push(date.toISOString().slice(0, 10));

        // Mean-reverting step
        const shock = (rng() - 0.5) * spreadVol * 0.15;
        current = current + meanReversion * (baseSpread - current) + shock;

        // Add seasonality influence
        const monthOfYear = date.getMonth();
        let seasonalShift = 0;
        if (commodity.includes('Gas') || commodity.includes('TTF') || commodity.includes('Power')) {
            seasonalShift = (monthOfYear >= 9 || monthOfYear <= 2) ? cfg.spot * 0.01 : -cfg.spot * 0.005;
        }

        values.push(+(current + seasonalShift).toFixed(cfg.spot < 10 ? 4 : 2));
    }

    return { dates, values, name: spreadDef.name, unit: cfg.unit };
}

// ─── Cross-Commodity Spread Definitions ─────────────────────────────────────

const SPREAD_DEFINITIONS = {
    // Oil spreads
    'Brent-WTI Spread': {
        category: 'OIL',
        long: 'Brent Crude Oil (BZ)',
        short: 'WTI Crude Oil (CL)',
        ratio: { long: 1, short: 1 },
        unit: '$/bbl',
        description: 'Brent premium over WTI',
    },
    // Crack spreads
    '3-2-1 Crack Spread': {
        category: 'CRACK',
        formula: 'custom',
        description: '(2×RB + 1×HO) × 42 - 3×CL) / 3',
        unit: '$/bbl',
    },
    'Gasoline Crack (RB-CL)': {
        category: 'CRACK',
        long: 'RBOB Gasoline (RB)',
        short: 'WTI Crude Oil (CL)',
        ratio: { long: 42, short: 1 },
        unit: '$/bbl',
        description: 'RBOB × 42 - CL (per barrel)',
    },
    'Heating Oil Crack (HO-CL)': {
        category: 'CRACK',
        long: 'Heating Oil (HO)',
        short: 'WTI Crude Oil (CL)',
        ratio: { long: 42, short: 1 },
        unit: '$/bbl',
        description: 'HO × 42 - CL (per barrel)',
    },
    // Gas/Power spreads
    'Spark Spread (Power-Gas)': {
        category: 'POWER & GAS',
        long: 'German Power Baseload',
        short: 'TTF Natural Gas',
        ratio: { long: 1, short: 1 },
        unit: '€/MWh',
        description: 'Power - Gas (clean spark proxy)',
    },
    'EU Gas vs US Gas (TTF-HH)': {
        category: 'POWER & GAS',
        long: 'TTF Natural Gas',
        short: 'Henry Hub Nat Gas (NG)',
        ratio: { long: 1, short: 8.0 },
        unit: '€/MWh equiv.',
        description: 'TTF - HH×8 (MMBtu to MWh approx.)',
    },
    // Fwd curve spreads
    'WTI Cal Spread (Y1-Y2)': {
        category: 'FWD SPREADS',
        formula: 'fwd',
        commodity: 'WTI Crude Oil (CL)',
        m1: 11,
        m2: 23,
        unit: '$/bbl',
        description: 'Year 1 - Year 2 calendar spread',
    },
    'NG Cal Spread (Y1-Y2)': {
        category: 'FWD SPREADS',
        formula: 'fwd',
        commodity: 'Henry Hub Nat Gas (NG)',
        m1: 11,
        m2: 23,
        unit: '$/MMBtu',
        description: 'Year 1 - Year 2 calendar spread',
    },
};

function computeSpreadValue(spreadKey, seed) {
    const def = SPREAD_DEFINITIONS[spreadKey];
    if (!def) return null;

    if (def.formula === 'custom' && spreadKey === '3-2-1 Crack Spread') {
        const rb = ENERGY_COMMODITIES['RBOB Gasoline (RB)'].spot;
        const ho = ENERGY_COMMODITIES['Heating Oil (HO)'].spot;
        const cl = ENERGY_COMMODITIES['WTI Crude Oil (CL)'].spot;
        return +((2 * rb * 42 + 1 * ho * 42 - 3 * cl) / 3).toFixed(2);
    }

    if (def.formula === 'fwd') {
        const ts = generateTermStructure(def.commodity, seed || 42);
        if (!ts) return null;
        return +(ts.prices[def.m1] - ts.prices[def.m2]).toFixed(ts.prices[0] < 10 ? 4 : 2);
    }

    const longPrice = ENERGY_COMMODITIES[def.long]?.spot || 0;
    const shortPrice = ENERGY_COMMODITIES[def.short]?.spot || 0;
    return +((longPrice * def.ratio.long - shortPrice * def.ratio.short)).toFixed(2);
}

function generateSpreadHistory(spreadKey, nDays) {
    const def = SPREAD_DEFINITIONS[spreadKey];
    if (!def) return null;
    nDays = nDays || 252;

    const rng = seededRandom(spreadKey.length * 137 + nDays);
    const currentVal = computeSpreadValue(spreadKey, 42);
    const dates = [];
    const values = [];

    const vol = Math.abs(currentVal) * 0.3 + 1.0;
    const meanRev = 0.02;
    let current = currentVal + (rng() - 0.5) * vol * 2;

    const now = new Date();
    for (let i = nDays - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        if (date.getDay() === 0 || date.getDay() === 6) continue;

        dates.push(date.toISOString().slice(0, 10));

        const shock = (rng() - 0.5) * vol * 0.12;
        current = current + meanRev * (currentVal - current) + shock;
        values.push(+current.toFixed(2));
    }

    return { dates, values, name: spreadKey, unit: def.unit, current: currentVal };
}
