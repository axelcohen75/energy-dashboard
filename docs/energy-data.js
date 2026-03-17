/**
 * Energy Markets — Yahoo Finance Data Engine
 *
 * Fetches REAL market data from Yahoo Finance. No synthetic fallback.
 * If data is unavailable, the commodity is simply not displayed.
 */

// ─── Yahoo Finance Configuration ────────────────────────────────────────────

const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ─── CORS Proxy Layer ───────────────────────────────────────────────────────
// Multiple strategies to bypass CORS when calling Yahoo Finance from browser.

const CORS_STRATEGIES = [
    {
        name: 'allorigins-get',
        // The /get endpoint wraps response in {contents: "..."} with proper CORS
        buildUrl: url => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
        parse: async resp => {
            const wrapper = await resp.json();
            if (!wrapper.contents) return null;
            return JSON.parse(wrapper.contents);
        },
    },
    {
        name: 'corsproxy-io',
        buildUrl: url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
        parse: async resp => resp.json(),
    },
    {
        name: 'codetabs',
        buildUrl: url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
        parse: async resp => resp.json(),
    },
];

const YF_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';

// Cache: key → { data, timestamp }
const _cache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Commodity Definitions ──────────────────────────────────────────────────

const ENERGY_COMMODITIES = {
    'WTI Crude Oil (CL)': {
        unit: '$/bbl', months: 18,
        color: '#2563eb', colorDark: '#60a5fa',
        yahoo: { base: 'CL', continuous: 'CL=F', exchange: 'NYM' },
    },
    'Brent Crude Oil (BZ)': {
        unit: '$/bbl', months: 18,
        color: '#7c3aed', colorDark: '#a78bfa',
        yahoo: { base: 'BZ', continuous: 'BZ=F', exchange: 'NYM' },
    },
    'Henry Hub Nat Gas (NG)': {
        unit: '$/MMBtu', months: 18,
        color: '#059669', colorDark: '#34d399',
        yahoo: { base: 'NG', continuous: 'NG=F', exchange: 'NYM' },
    },
    'TTF Natural Gas': {
        unit: '€/MWh', months: 0, // spot only, no term structure on Yahoo
        color: '#d97706', colorDark: '#fbbf24',
        yahoo: { continuous: 'TTF=F' },
    },
    'RBOB Gasoline (RB)': {
        unit: '$/gal', months: 12,
        color: '#db2777', colorDark: '#f472b6',
        yahoo: { base: 'RB', continuous: 'RB=F', exchange: 'NYM' },
    },
    'Heating Oil (HO)': {
        unit: '$/gal', months: 12,
        color: '#0891b2', colorDark: '#22d3ee',
        yahoo: { base: 'HO', continuous: 'HO=F', exchange: 'NYM' },
    },
};

// ─── Low-level Fetch ────────────────────────────────────────────────────────

function _getCached(key) {
    const e = _cache[key];
    if (e && Date.now() - e.ts < CACHE_TTL) return e.data;
    return null;
}

function _setCache(key, data) {
    _cache[key] = { data, ts: Date.now() };
}

// Track which proxy works so we try it first next time
let _preferredProxy = null;

async function _fetchYahoo(url) {
    // Try preferred proxy first if we found one that works
    const strategies = _preferredProxy
        ? [_preferredProxy, ...CORS_STRATEGIES.filter(s => s !== _preferredProxy)]
        : CORS_STRATEGIES;

    for (const strategy of strategies) {
        try {
            const proxyUrl = strategy.buildUrl(url);
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 12000);
            const resp = await fetch(proxyUrl, { signal: ctrl.signal });
            clearTimeout(timer);

            if (!resp.ok) {
                console.warn(`[YF] ${strategy.name}: HTTP ${resp.status} for ${url}`);
                continue;
            }

            const json = await strategy.parse(resp);
            const result = json?.chart?.result?.[0];
            if (result) {
                _preferredProxy = strategy; // Remember what works
                return result;
            }
            console.warn(`[YF] ${strategy.name}: no chart data for ${url}`);
        } catch (e) {
            console.warn(`[YF] ${strategy.name} failed for ${url}:`, e.message);
        }
    }
    console.warn(`[YF] ALL strategies failed for ${url}`);
    return null;
}

async function fetchYahooChart(symbol, range, interval) {
    const cacheKey = `yf:${symbol}:${range}:${interval}`;
    const cached = _getCached(cacheKey);
    if (cached) return cached;

    const url = `${YF_CHART_URL}${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
    const result = await _fetchYahoo(url);
    if (result) _setCache(cacheKey, result);
    return result;
}

// ─── Forward Contract Tickers ───────────────────────────────────────────────

function getForwardTickers(base, exchange, nMonths) {
    const now = new Date();
    let month = now.getMonth() + 1;
    let year = now.getFullYear();
    const tickers = [];

    for (let i = 0; i < nMonths; i++) {
        if (month > 11) { month = 0; year++; }
        const code = MONTH_CODES[month];
        const yr = String(year).slice(-2);
        tickers.push({
            symbol: `${base}${code}${yr}.${exchange}`,
            label: `${MONTH_NAMES[month]} '${yr}`,
            month, year,
        });
        month++;
    }
    return tickers;
}

// ─── Fetch All Spot Prices ──────────────────────────────────────────────────

// Tracks which commodities have live data
const liveSpots = {}; // commodity name → price (only set when Yahoo returns data)

async function fetchAllSpotPrices() {
    const entries = Object.entries(ENERGY_COMMODITIES);

    await Promise.all(entries.map(async ([name, cfg]) => {
        if (!cfg.yahoo) return;
        try {
            const data = await fetchYahooChart(cfg.yahoo.continuous, '5d', '1d');
            const price = data?.meta?.regularMarketPrice;
            if (price != null && price > 0) {
                liveSpots[name] = price;
            }
        } catch (e) {
            console.warn(`[YF] spot fetch failed for ${name}:`, e.message);
        }
    }));

    return liveSpots;
}

// ─── Fetch Term Structure ───────────────────────────────────────────────────

async function fetchTermStructure(commodity) {
    const cfg = ENERGY_COMMODITIES[commodity];
    if (!cfg?.yahoo?.base || !cfg.months) return null; // No base ticker = no term structure

    const cacheKey = `ts:${commodity}`;
    const cached = _getCached(cacheKey);
    if (cached) return cached;

    const tickers = getForwardTickers(cfg.yahoo.base, cfg.yahoo.exchange, cfg.months);

    const results = await Promise.allSettled(
        tickers.map(async (t) => {
            const data = await fetchYahooChart(t.symbol, '5d', '1d');
            const price = data?.meta?.regularMarketPrice;
            return { ...t, price: (price != null && price > 0) ? price : null };
        })
    );

    const months = [];
    const prices = [];
    for (const r of results) {
        const val = r.status === 'fulfilled' ? r.value : null;
        if (val?.price != null) {
            months.push(val.label);
            prices.push(+val.price.toFixed(cfg.unit.includes('bbl') ? 2 : 3));
        }
    }

    if (months.length < 3) return null; // Not enough data

    const spot = liveSpots[commodity] || prices[0];
    const result = { months, prices, unit: cfg.unit, spot };
    _setCache(cacheKey, result);
    return result;
}

// ─── Fetch Term Structure at Historical Date ────────────────────────────────

async function fetchTermStructureAtDate(commodity, dateStr) {
    const cfg = ENERGY_COMMODITIES[commodity];
    if (!cfg?.yahoo?.base || !cfg.months) return null;

    const cacheKey = `ts-hist:${commodity}:${dateStr}`;
    const cached = _getCached(cacheKey);
    if (cached) return cached;

    const targetDate = new Date(dateStr);
    const now = new Date();
    const daysDiff = Math.ceil((now - targetDate) / (1000 * 60 * 60 * 24));
    if (daysDiff < 1 || daysDiff > 730) return null; // max 2 years back

    const range = daysDiff <= 30 ? '1mo' : daysDiff <= 90 ? '3mo' : daysDiff <= 180 ? '6mo' : daysDiff <= 365 ? '1y' : '2y';

    const tickers = getForwardTickers(cfg.yahoo.base, cfg.yahoo.exchange, cfg.months);

    const results = await Promise.allSettled(
        tickers.map(async (t) => {
            const data = await fetchYahooChart(t.symbol, range, '1d');
            if (!data?.timestamp || !data?.indicators?.quote?.[0]?.close) return { ...t, price: null };

            const timestamps = data.timestamp;
            const closes = data.indicators.quote[0].close;

            // Find closest trading day to target date
            const targetTs = targetDate.getTime() / 1000;
            let bestIdx = -1;
            let bestDist = Infinity;
            for (let i = 0; i < timestamps.length; i++) {
                if (closes[i] == null) continue;
                const dist = Math.abs(timestamps[i] - targetTs);
                if (dist < bestDist) { bestDist = dist; bestIdx = i; }
            }

            // Only accept if within 3 trading days
            if (bestIdx >= 0 && bestDist < 4 * 86400) {
                return { ...t, price: closes[bestIdx] };
            }
            return { ...t, price: null };
        })
    );

    const months = [];
    const prices = [];
    for (const r of results) {
        const val = r.status === 'fulfilled' ? r.value : null;
        if (val?.price != null) {
            months.push(val.label);
            prices.push(+val.price.toFixed(cfg.unit.includes('bbl') ? 2 : 3));
        }
    }

    if (months.length < 3) return null;

    const result = { months, prices, unit: cfg.unit, date: dateStr };
    _setCache(cacheKey, result);
    return result;
}

// ─── Fetch Historical Prices ────────────────────────────────────────────────

async function fetchHistoricalPrices(symbol, nDays) {
    const range = nDays <= 30 ? '1mo' : nDays <= 90 ? '3mo' : nDays <= 180 ? '6mo' : nDays <= 365 ? '1y' : '2y';
    const data = await fetchYahooChart(symbol, range, '1d');
    if (!data?.timestamp || !data?.indicators?.quote?.[0]?.close) return null;

    const timestamps = data.timestamp;
    const closes = data.indicators.quote[0].close;
    const dates = [];
    const values = [];

    for (let i = 0; i < timestamps.length; i++) {
        if (closes[i] == null) continue;
        dates.push(new Date(timestamps[i] * 1000).toISOString().slice(0, 10));
        values.push(closes[i]);
    }
    return dates.length > 0 ? { dates, values } : null;
}

// ─── Timespread History ─────────────────────────────────────────────────────

async function fetchTimespreadHistory(commodity, spreadDef, nDays) {
    const cfg = ENERGY_COMMODITIES[commodity];
    if (!cfg?.yahoo?.base) return null;

    const cacheKey = `tsh:${commodity}:${spreadDef.m1}:${spreadDef.m2}:${nDays}`;
    const cached = _getCached(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const m1Month = (now.getMonth() + spreadDef.m1 + 1) % 12;
    const m2Month = (now.getMonth() + spreadDef.m2 + 1) % 12;
    const m1Year = now.getFullYear() + Math.floor((now.getMonth() + spreadDef.m1 + 1) / 12);
    const m2Year = now.getFullYear() + Math.floor((now.getMonth() + spreadDef.m2 + 1) / 12);

    const sym1 = `${cfg.yahoo.base}${MONTH_CODES[m1Month]}${String(m1Year).slice(-2)}.${cfg.yahoo.exchange}`;
    const sym2 = `${cfg.yahoo.base}${MONTH_CODES[m2Month]}${String(m2Year).slice(-2)}.${cfg.yahoo.exchange}`;

    const [data1, data2] = await Promise.all([
        fetchHistoricalPrices(sym1, nDays),
        fetchHistoricalPrices(sym2, nDays),
    ]);

    if (!data1 || !data2 || data1.dates.length < 10 || data2.dates.length < 10) return null;

    const priceMap2 = {};
    data2.dates.forEach((d, i) => priceMap2[d] = data2.values[i]);

    const dates = [];
    const values = [];
    const decimals = cfg.unit.includes('bbl') ? 2 : 4;

    for (let i = 0; i < data1.dates.length; i++) {
        const d = data1.dates[i];
        if (priceMap2[d] != null) {
            dates.push(d);
            values.push(+(data1.values[i] - priceMap2[d]).toFixed(decimals));
        }
    }

    if (dates.length < 10) return null;

    const result = { dates, values, name: spreadDef.name, unit: cfg.unit };
    _setCache(cacheKey, result);
    return result;
}

// ─── Cross-Commodity Spread History ─────────────────────────────────────────

async function fetchSpreadHistory(spreadKey, nDays) {
    const def = SPREAD_DEFINITIONS[spreadKey];
    if (!def) return null;

    const cacheKey = `spread:${spreadKey}:${nDays}`;
    const cached = _getCached(cacheKey);
    if (cached) return cached;

    if (def.formula === 'custom' && spreadKey === '3-2-1 Crack Spread') {
        return _fetch321CrackHistory(nDays);
    }

    if (def.formula === 'fwd') return null; // Need term structure, not historical

    const longCfg = ENERGY_COMMODITIES[def.long];
    const shortCfg = ENERGY_COMMODITIES[def.short];
    if (!longCfg?.yahoo?.continuous || !shortCfg?.yahoo?.continuous) return null;

    const [longData, shortData] = await Promise.all([
        fetchHistoricalPrices(longCfg.yahoo.continuous, nDays),
        fetchHistoricalPrices(shortCfg.yahoo.continuous, nDays),
    ]);

    if (!longData || !shortData || longData.dates.length < 10) return null;

    const shortMap = {};
    shortData.dates.forEach((d, i) => shortMap[d] = shortData.values[i]);

    const dates = [];
    const values = [];
    for (let i = 0; i < longData.dates.length; i++) {
        const d = longData.dates[i];
        if (shortMap[d] != null) {
            dates.push(d);
            values.push(+(longData.values[i] * def.ratio.long - shortMap[d] * def.ratio.short).toFixed(2));
        }
    }

    if (dates.length < 10) return null;

    const current = values[values.length - 1];
    const result = { dates, values, name: spreadKey, unit: def.unit, current };
    _setCache(cacheKey, result);
    return result;
}

async function _fetch321CrackHistory(nDays) {
    const cacheKey = `spread:321crack:${nDays}`;
    const cached = _getCached(cacheKey);
    if (cached) return cached;

    const [rbData, hoData, clData] = await Promise.all([
        fetchHistoricalPrices('RB=F', nDays),
        fetchHistoricalPrices('HO=F', nDays),
        fetchHistoricalPrices('CL=F', nDays),
    ]);

    if (!rbData || !hoData || !clData) return null;

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
            values.push(+((2 * rbData.values[i] * 42 + hoMap[d] * 42 - 3 * clMap[d]) / 3).toFixed(2));
        }
    }

    if (dates.length < 10) return null;

    const current = values[values.length - 1];
    const result = { dates, values, name: '3-2-1 Crack Spread', unit: '$/bbl', current };
    _setCache(cacheKey, result);
    return result;
}

// ─── Compute Current Spread Value (from live spots) ─────────────────────────

function computeSpreadValue(spreadKey) {
    const def = SPREAD_DEFINITIONS[spreadKey];
    if (!def) return null;

    if (def.formula === 'custom' && spreadKey === '3-2-1 Crack Spread') {
        const rb = liveSpots['RBOB Gasoline (RB)'];
        const ho = liveSpots['Heating Oil (HO)'];
        const cl = liveSpots['WTI Crude Oil (CL)'];
        if (rb == null || ho == null || cl == null) return null;
        return +((2 * rb * 42 + ho * 42 - 3 * cl) / 3).toFixed(2);
    }

    if (def.formula === 'fwd') return null; // Can't compute without term structure

    const longPrice = liveSpots[def.long];
    const shortPrice = liveSpots[def.short];
    if (longPrice == null || shortPrice == null) return null;
    return +((longPrice * def.ratio.long - shortPrice * def.ratio.short)).toFixed(2);
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
    'RBOB Gasoline (RB)': [
        { name: 'RB Prompt Spread (M1-M2)', m1: 0, m2: 1 },
        { name: 'RB 1-6 Month', m1: 0, m2: 5 },
    ],
    'Heating Oil (HO)': [
        { name: 'HO Prompt Spread (M1-M2)', m1: 0, m2: 1 },
        { name: 'HO 1-6 Month', m1: 0, m2: 5 },
    ],
};

// ─── Spread Definitions ─────────────────────────────────────────────────────

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
    'EU Gas vs US Gas (TTF-HH)': {
        category: 'GAS',
        long: 'TTF Natural Gas', short: 'Henry Hub Nat Gas (NG)',
        ratio: { long: 1, short: 8.0 },
        unit: '€/MWh equiv.', description: 'TTF - HH×8 (MMBtu to MWh approx.)',
    },
};
