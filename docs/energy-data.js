/**
 * Energy Markets — Data Engine
 *
 * Fetches real market data from Yahoo Finance for US-traded energy futures.
 * Falls back to synthetic data for European commodities (TTF, German Power)
 * and when API calls fail.
 */

// ─── Yahoo Finance Configuration ────────────────────────────────────────────

const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const CORS_PROXIES = [
    url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
];

const YF_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';

// Cache: key → { data, timestamp }
const dataCache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Commodity Futures Definitions ──────────────────────────────────────────

const ENERGY_COMMODITIES = {
    'WTI Crude Oil (CL)': {
        spot: 72.50, unit: '$/bbl', months: 24,
        curve: 'backwardation', seasonality: 0.02, vol: 0.28,
        color: '#2563eb', colorDark: '#60a5fa',
        yahoo: { base: 'CL', continuous: 'CL=F', exchange: 'NYM' },
    },
    'Brent Crude Oil (BZ)': {
        spot: 76.20, unit: '$/bbl', months: 24,
        curve: 'backwardation', seasonality: 0.02, vol: 0.26,
        color: '#7c3aed', colorDark: '#a78bfa',
        yahoo: { base: 'BZ', continuous: 'BZ=F', exchange: 'NYM' },
    },
    'Henry Hub Nat Gas (NG)': {
        spot: 3.45, unit: '$/MMBtu', months: 24,
        curve: 'contango', seasonality: 0.25, vol: 0.45,
        color: '#059669', colorDark: '#34d399',
        yahoo: { base: 'NG', continuous: 'NG=F', exchange: 'NYM' },
    },
    'TTF Natural Gas': {
        spot: 34.80, unit: '€/MWh', months: 24,
        curve: 'contango', seasonality: 0.20, vol: 0.50,
        color: '#d97706', colorDark: '#fbbf24',
        yahoo: null, // Not on Yahoo Finance
    },
    'German Power Baseload': {
        spot: 82.50, unit: '€/MWh', months: 18,
        curve: 'contango', seasonality: 0.18, vol: 0.42,
        color: '#dc2626', colorDark: '#f87171',
        yahoo: null, // Not on Yahoo Finance
    },
    'RBOB Gasoline (RB)': {
        spot: 2.48, unit: '$/gal', months: 18,
        curve: 'backwardation', seasonality: 0.12, vol: 0.32,
        color: '#db2777', colorDark: '#f472b6',
        yahoo: { base: 'RB', continuous: 'RB=F', exchange: 'NYM' },
    },
    'Heating Oil (HO)': {
        spot: 2.62, unit: '$/gal', months: 18,
        curve: 'contango', seasonality: 0.10, vol: 0.30,
        color: '#0891b2', colorDark: '#22d3ee',
        yahoo: { base: 'HO', continuous: 'HO=F', exchange: 'NYM' },
    },
};

// ─── Yahoo Finance Fetcher ──────────────────────────────────────────────────

async function fetchWithProxy(url) {
    // Try direct first (works in some environments)
    for (const makeProxy of [u => u, ...CORS_PROXIES]) {
        try {
            const proxyUrl = makeProxy(url);
            const resp = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
            if (!resp.ok) continue;
            const data = await resp.json();
            if (data.chart?.result?.[0]) return data.chart.result[0];
        } catch { /* try next proxy */ }
    }
    return null;
}

function getCached(key) {
    const entry = dataCache[key];
    if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.data;
    return null;
}

function setCache(key, data) {
    dataCache[key] = { data, timestamp: Date.now() };
}

/**
 * Fetch chart data from Yahoo Finance
 * @param {string} symbol - Yahoo Finance symbol (e.g., 'CL=F')
 * @param {string} range - Time range ('1d', '5d', '1mo', '3mo', '6mo', '1y', '2y')
 * @param {string} interval - Data interval ('1d', '1wk', '1mo')
 */
async function fetchYahooChart(symbol, range, interval) {
    const cacheKey = `yf:${symbol}:${range}:${interval}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const url = `${YF_CHART_URL}${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
    const result = await fetchWithProxy(url);
    if (result) setCache(cacheKey, result);
    return result;
}

// ─── Get Forward Contract Tickers ───────────────────────────────────────────

function getForwardTickers(base, exchange, nMonths) {
    const now = new Date();
    let month = now.getMonth() + 1; // Start next month
    let year = now.getFullYear();
    const tickers = [];

    for (let i = 0; i < nMonths; i++) {
        if (month > 11) { month = 0; year++; }
        const code = MONTH_CODES[month];
        const yr = String(year).slice(-2);
        const symbol = `${base}${code}${yr}.${exchange}`;
        const label = `${MONTH_NAMES[month]} '${yr}`;
        tickers.push({ symbol, label, month, year });
        month++;
    }
    return tickers;
}

// ─── Fetch Spot Price ───────────────────────────────────────────────────────

async function fetchSpotPrice(commodity) {
    const cfg = ENERGY_COMMODITIES[commodity];
    if (!cfg?.yahoo) return cfg?.spot || null;

    const result = await fetchYahooChart(cfg.yahoo.continuous, '1d', '1d');
    if (result?.meta?.regularMarketPrice) {
        return result.meta.regularMarketPrice;
    }
    return cfg.spot; // fallback
}

// ─── Fetch All Spot Prices ──────────────────────────────────────────────────

async function fetchAllSpotPrices() {
    const cacheKey = 'spots:all';
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const entries = Object.entries(ENERGY_COMMODITIES);
    const results = {};

    // Fetch Yahoo-available commodities in parallel
    const promises = entries.map(async ([name, cfg]) => {
        if (!cfg.yahoo) {
            results[name] = cfg.spot;
            return;
        }
        try {
            const data = await fetchYahooChart(cfg.yahoo.continuous, '5d', '1d');
            if (data?.meta?.regularMarketPrice) {
                results[name] = data.meta.regularMarketPrice;
                // Update the stored spot for spread calculations
                cfg.spot = data.meta.regularMarketPrice;
            } else {
                results[name] = cfg.spot;
            }
        } catch {
            results[name] = cfg.spot;
        }
    });

    await Promise.all(promises);
    setCache(cacheKey, results);
    return results;
}

// ─── Fetch Term Structure (Real Data) ───────────────────────────────────────

async function fetchTermStructure(commodity) {
    const cfg = ENERGY_COMMODITIES[commodity];
    if (!cfg) return null;

    // No Yahoo ticker → use synthetic
    if (!cfg.yahoo) return generateTermStructureSynthetic(commodity);

    const cacheKey = `ts:${commodity}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const nMonths = Math.min(cfg.months, 18); // Keep it reasonable
    const tickers = getForwardTickers(cfg.yahoo.base, cfg.yahoo.exchange, nMonths);

    // Fetch all contract prices in parallel
    const promises = tickers.map(async (t) => {
        try {
            const data = await fetchYahooChart(t.symbol, '5d', '1d');
            const price = data?.meta?.regularMarketPrice;
            return { ...t, price: price || null };
        } catch {
            return { ...t, price: null };
        }
    });

    const results = await Promise.allSettled(promises);
    const months = [];
    const prices = [];
    let hasData = false;

    for (const r of results) {
        const val = r.status === 'fulfilled' ? r.value : null;
        if (val && val.price != null) {
            months.push(val.label);
            prices.push(+val.price.toFixed(cfg.spot < 10 ? 3 : 2));
            hasData = true;
        }
    }

    if (!hasData) return generateTermStructureSynthetic(commodity);

    const result = { months, prices, unit: cfg.unit, spot: cfg.spot, source: 'yahoo' };
    setCache(cacheKey, result);
    return result;
}

// ─── Fetch Historical Data for Spreads ──────────────────────────────────────

function yahooRangeFromDays(nDays) {
    if (nDays <= 30) return '1mo';
    if (nDays <= 90) return '3mo';
    if (nDays <= 180) return '6mo';
    if (nDays <= 365) return '1y';
    return '2y';
}

async function fetchHistoricalPrices(symbol, nDays) {
    const range = yahooRangeFromDays(nDays);
    const data = await fetchYahooChart(symbol, range, '1d');
    if (!data?.timestamp || !data?.indicators?.quote?.[0]?.close) return null;

    const timestamps = data.timestamp;
    const closes = data.indicators.quote[0].close;
    const dates = [];
    const values = [];

    for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] == null) continue;
        const d = new Date(timestamps[i] * 1000);
        dates.push(d.toISOString().slice(0, 10));
        values.push(closes[i]);
    }
    return { dates, values };
}

// ─── Fetch Timespread History (Real Data) ───────────────────────────────────

async function fetchTimespreadHistory(commodity, spreadDef, nDays) {
    const cfg = ENERGY_COMMODITIES[commodity];
    if (!cfg?.yahoo) return generateTimespreadHistorySynthetic(commodity, spreadDef, nDays);

    const cacheKey = `tsh:${commodity}:${spreadDef.m1}:${spreadDef.m2}:${nDays}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    // For timespreads, we use continuous contracts shifted by month gap
    // Yahoo has continuous contracts: CL=F (front month)
    // For approximation, we'll compute spread from the term structure shift
    // More precisely: fetch two specific contract months if possible
    const now = new Date();
    const m1Month = (now.getMonth() + spreadDef.m1 + 1) % 12;
    const m2Month = (now.getMonth() + spreadDef.m2 + 1) % 12;
    const m1Year = now.getFullYear() + Math.floor((now.getMonth() + spreadDef.m1 + 1) / 12);
    const m2Year = now.getFullYear() + Math.floor((now.getMonth() + spreadDef.m2 + 1) / 12);

    const m1Code = MONTH_CODES[m1Month];
    const m2Code = MONTH_CODES[m2Month];
    const sym1 = `${cfg.yahoo.base}${m1Code}${String(m1Year).slice(-2)}.${cfg.yahoo.exchange}`;
    const sym2 = `${cfg.yahoo.base}${m2Code}${String(m2Year).slice(-2)}.${cfg.yahoo.exchange}`;

    try {
        const [data1, data2] = await Promise.all([
            fetchHistoricalPrices(sym1, nDays),
            fetchHistoricalPrices(sym2, nDays),
        ]);

        if (data1 && data2 && data1.dates.length > 10 && data2.dates.length > 10) {
            // Align dates
            const dateSet2 = new Set(data2.dates);
            const priceMap2 = {};
            data2.dates.forEach((d, i) => priceMap2[d] = data2.values[i]);

            const dates = [];
            const values = [];
            for (let i = 0; i < data1.dates.length; i++) {
                const d = data1.dates[i];
                if (priceMap2[d] != null) {
                    dates.push(d);
                    values.push(+(data1.values[i] - priceMap2[d]).toFixed(cfg.spot < 10 ? 4 : 2));
                }
            }

            if (dates.length > 10) {
                const result = { dates, values, name: spreadDef.name, unit: cfg.unit, source: 'yahoo' };
                setCache(cacheKey, result);
                return result;
            }
        }
    } catch { /* fallback below */ }

    // Fallback: use continuous front month vs second month approximation
    // or synthetic data
    return generateTimespreadHistorySynthetic(commodity, spreadDef, nDays);
}

// ─── Fetch Cross-Commodity Spread History (Real Data) ───────────────────────

async function fetchSpreadHistory(spreadKey, nDays) {
    const def = SPREAD_DEFINITIONS[spreadKey];
    if (!def) return null;

    const cacheKey = `spread:${spreadKey}:${nDays}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    // Forward spreads and custom formulas use synthetic
    if (def.formula === 'fwd') return generateSpreadHistorySynthetic(spreadKey, nDays);

    // For 3-2-1 crack spread, we need 3 commodities
    if (def.formula === 'custom' && spreadKey === '3-2-1 Crack Spread') {
        return fetch321CrackHistory(nDays);
    }

    // Standard 2-leg spread
    const longCfg = ENERGY_COMMODITIES[def.long];
    const shortCfg = ENERGY_COMMODITIES[def.short];

    // If either leg has no Yahoo data, use synthetic
    if (!longCfg?.yahoo || !shortCfg?.yahoo) {
        return generateSpreadHistorySynthetic(spreadKey, nDays);
    }

    try {
        const [longData, shortData] = await Promise.all([
            fetchHistoricalPrices(longCfg.yahoo.continuous, nDays),
            fetchHistoricalPrices(shortCfg.yahoo.continuous, nDays),
        ]);

        if (longData && shortData && longData.dates.length > 10) {
            const shortMap = {};
            shortData.dates.forEach((d, i) => shortMap[d] = shortData.values[i]);

            const dates = [];
            const values = [];
            for (let i = 0; i < longData.dates.length; i++) {
                const d = longData.dates[i];
                if (shortMap[d] != null) {
                    dates.push(d);
                    const val = longData.values[i] * def.ratio.long - shortMap[d] * def.ratio.short;
                    values.push(+val.toFixed(2));
                }
            }

            if (dates.length > 10) {
                const current = values[values.length - 1];
                const result = { dates, values, name: spreadKey, unit: def.unit, current, source: 'yahoo' };
                setCache(cacheKey, result);
                return result;
            }
        }
    } catch { /* fallback */ }

    return generateSpreadHistorySynthetic(spreadKey, nDays);
}

async function fetch321CrackHistory(nDays) {
    const cacheKey = `spread:321crack:${nDays}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
        const [rbData, hoData, clData] = await Promise.all([
            fetchHistoricalPrices('RB=F', nDays),
            fetchHistoricalPrices('HO=F', nDays),
            fetchHistoricalPrices('CL=F', nDays),
        ]);

        if (rbData && hoData && clData) {
            const hoMap = {};
            hoData.dates.forEach((d, i) => hoMap[d] = hoData.values[i]);
            const clMap = {};
            clData.dates.forEach((d, i) => clMap[d] = clData.values[i]);

            const dates = [];
            const values = [];
            for (let i = 0; i < rbData.dates.length; i++) {
                const d = rbData.dates[i];
                if (hoMap[d] != null && clMap[d] != null) {
                    dates.push(d);
                    const val = (2 * rbData.values[i] * 42 + 1 * hoMap[d] * 42 - 3 * clMap[d]) / 3;
                    values.push(+val.toFixed(2));
                }
            }

            if (dates.length > 10) {
                const current = values[values.length - 1];
                const result = { dates, values, name: '3-2-1 Crack Spread', unit: '$/bbl', current, source: 'yahoo' };
                setCache(cacheKey, result);
                return result;
            }
        }
    } catch { /* fallback */ }

    return generateSpreadHistorySynthetic('3-2-1 Crack Spread', nDays);
}

// ─── Compute Current Spread Value ───────────────────────────────────────────

function computeSpreadValue(spreadKey) {
    const def = SPREAD_DEFINITIONS[spreadKey];
    if (!def) return null;

    if (def.formula === 'custom' && spreadKey === '3-2-1 Crack Spread') {
        const rb = ENERGY_COMMODITIES['RBOB Gasoline (RB)'].spot;
        const ho = ENERGY_COMMODITIES['Heating Oil (HO)'].spot;
        const cl = ENERGY_COMMODITIES['WTI Crude Oil (CL)'].spot;
        return +((2 * rb * 42 + 1 * ho * 42 - 3 * cl) / 3).toFixed(2);
    }

    if (def.formula === 'fwd') {
        // Use synthetic term structure for fwd spreads
        const ts = generateTermStructureSynthetic(def.commodity);
        if (!ts) return null;
        return +(ts.prices[def.m1] - ts.prices[def.m2]).toFixed(ts.prices[0] < 10 ? 4 : 2);
    }

    const longPrice = ENERGY_COMMODITIES[def.long]?.spot || 0;
    const shortPrice = ENERGY_COMMODITIES[def.short]?.spot || 0;
    return +((longPrice * def.ratio.long - shortPrice * def.ratio.short)).toFixed(2);
}

// ═══════════════════════════════════════════════════════════════════════════
// SYNTHETIC FALLBACK DATA
// Used for European commodities (TTF, German Power) and when Yahoo is down.
// ═══════════════════════════════════════════════════════════════════════════

function seededRandom(seed) {
    let s = seed;
    return function () {
        s = (s * 16807 + 0) % 2147483647;
        return (s - 1) / 2147483646;
    };
}

function generateTermStructureSynthetic(commodity, seed) {
    const cfg = ENERGY_COMMODITIES[commodity];
    if (!cfg) return null;

    const rng = seededRandom(seed || 42);
    const months = [];
    const prices = [];
    const now = new Date();
    const baseMonth = now.getMonth();

    for (let i = 0; i < cfg.months; i++) {
        const date = new Date(now.getFullYear(), baseMonth + i + 1, 1);
        months.push(`${MONTH_NAMES[date.getMonth()]} '${String(date.getFullYear()).slice(-2)}`);

        const drift = cfg.curve === 'contango' ? 0.002 : -0.003;
        const monthOfYear = date.getMonth();
        let seasonal = 0;
        if (commodity.includes('Gas') || commodity.includes('Power') || commodity.includes('TTF')) {
            seasonal = (monthOfYear >= 9 || monthOfYear <= 2) ? cfg.seasonality : -cfg.seasonality * 0.5;
        } else if (commodity.includes('Gasoline')) {
            seasonal = (monthOfYear >= 3 && monthOfYear <= 8) ? cfg.seasonality : -cfg.seasonality * 0.3;
        } else if (commodity.includes('Heating')) {
            seasonal = (monthOfYear >= 9 || monthOfYear <= 2) ? cfg.seasonality : -cfg.seasonality * 0.4;
        }

        const noise = (rng() - 0.5) * cfg.vol * 0.04;
        const factor = 1 + drift * i + seasonal * Math.sin((monthOfYear / 12) * 2 * Math.PI) + noise;
        prices.push(+(cfg.spot * factor).toFixed(cfg.spot < 10 ? 3 : 2));
    }

    return { months, prices, unit: cfg.unit, spot: cfg.spot, source: 'synthetic' };
}

function generateTimespreadHistorySynthetic(commodity, spreadDef, nDays) {
    const cfg = ENERGY_COMMODITIES[commodity];
    if (!cfg) return null;
    nDays = nDays || 252;

    const rng = seededRandom(spreadDef.m1 * 1000 + spreadDef.m2 * 100 + nDays);
    const dates = [];
    const values = [];

    const monthGap = spreadDef.m2 - spreadDef.m1;
    const baseDrift = cfg.curve === 'contango' ? 0.002 : -0.003;
    const baseSpread = cfg.spot * baseDrift * monthGap;

    const meanReversion = 0.03;
    const spreadVol = Math.abs(baseSpread) * 0.5 + cfg.spot * 0.005;
    let current = baseSpread + (rng() - 0.5) * spreadVol;

    const now = new Date();
    for (let i = nDays - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        if (date.getDay() === 0 || date.getDay() === 6) continue;

        dates.push(date.toISOString().slice(0, 10));

        const shock = (rng() - 0.5) * spreadVol * 0.15;
        current = current + meanReversion * (baseSpread - current) + shock;

        const monthOfYear = date.getMonth();
        let seasonalShift = 0;
        if (commodity.includes('Gas') || commodity.includes('TTF') || commodity.includes('Power')) {
            seasonalShift = (monthOfYear >= 9 || monthOfYear <= 2) ? cfg.spot * 0.01 : -cfg.spot * 0.005;
        }

        values.push(+(current + seasonalShift).toFixed(cfg.spot < 10 ? 4 : 2));
    }

    return { dates, values, name: spreadDef.name, unit: cfg.unit, source: 'synthetic' };
}

function generateSpreadHistorySynthetic(spreadKey, nDays) {
    const def = SPREAD_DEFINITIONS[spreadKey];
    if (!def) return null;
    nDays = nDays || 252;

    const rng = seededRandom(spreadKey.length * 137 + nDays);
    const currentVal = computeSpreadValue(spreadKey);
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

    return { dates, values, name: spreadKey, unit: def.unit, current: currentVal, source: 'synthetic' };
}

// ─── Timespread Definitions ─────────────────────────────────────────────────

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

// ─── Cross-Commodity Spread Definitions ─────────────────────────────────────

const SPREAD_DEFINITIONS = {
    'Brent-WTI Spread': {
        category: 'OIL',
        long: 'Brent Crude Oil (BZ)', short: 'WTI Crude Oil (CL)',
        ratio: { long: 1, short: 1 },
        unit: '$/bbl', description: 'Brent premium over WTI',
    },
    '3-2-1 Crack Spread': {
        category: 'CRACK', formula: 'custom',
        description: '(2×RB + 1×HO) × 42 - 3×CL) / 3',
        unit: '$/bbl',
    },
    'Gasoline Crack (RB-CL)': {
        category: 'CRACK',
        long: 'RBOB Gasoline (RB)', short: 'WTI Crude Oil (CL)',
        ratio: { long: 42, short: 1 },
        unit: '$/bbl', description: 'RBOB × 42 - CL (per barrel)',
    },
    'Heating Oil Crack (HO-CL)': {
        category: 'CRACK',
        long: 'Heating Oil (HO)', short: 'WTI Crude Oil (CL)',
        ratio: { long: 42, short: 1 },
        unit: '$/bbl', description: 'HO × 42 - CL (per barrel)',
    },
    'Spark Spread (Power-Gas)': {
        category: 'POWER & GAS',
        long: 'German Power Baseload', short: 'TTF Natural Gas',
        ratio: { long: 1, short: 1 },
        unit: '€/MWh', description: 'Power - Gas (clean spark proxy)',
    },
    'EU Gas vs US Gas (TTF-HH)': {
        category: 'POWER & GAS',
        long: 'TTF Natural Gas', short: 'Henry Hub Nat Gas (NG)',
        ratio: { long: 1, short: 8.0 },
        unit: '€/MWh equiv.', description: 'TTF - HH×8 (MMBtu to MWh approx.)',
    },
    'WTI Cal Spread (Y1-Y2)': {
        category: 'FWD SPREADS', formula: 'fwd',
        commodity: 'WTI Crude Oil (CL)', m1: 11, m2: 23,
        unit: '$/bbl', description: 'Year 1 - Year 2 calendar spread',
    },
    'NG Cal Spread (Y1-Y2)': {
        category: 'FWD SPREADS', formula: 'fwd',
        commodity: 'Henry Hub Nat Gas (NG)', m1: 11, m2: 23,
        unit: '$/MMBtu', description: 'Year 1 - Year 2 calendar spread',
    },
};
