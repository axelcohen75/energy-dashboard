/**
 * Energy Markets — UI Controller
 *
 * Reads pre-fetched data from data/market-data.json (no CORS issues).
 */

// ─── Tab Switching ──────────────────────────────────────────────────────────

let marketsInitialized = false;

function switchTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.toggle('active', el.id === `tab-${tab}`);
    });

    if (tab === 'markets' && !marketsInitialized) {
        initEnergyMarkets();
        marketsInitialized = true;
    }

    if (tab === 'physical' && !physicalInitialized) {
        initPhysicalMarkets();
    }

    if (tab === 'geopolitics' && !geopoliticsInitialized) {
        initGeopolitics();
    }

    if (tab === 'cftc' && !cftcInitialized) {
        initCftc();
    }

    setTimeout(() => {
        if (tab === 'markets') {
            try { Plotly.Plots.resize('spot-evo-chart'); } catch(e) {}
            try { Plotly.Plots.resize('term-structure-chart'); } catch(e) {}
            try { Plotly.Plots.resize('spread-monitor-chart'); } catch(e) {}
        } else if (tab === 'physical') {
            Plotly.Plots.resize('inventory-chart');
            try { Plotly.Plots.resize('opec-watch-chart'); } catch(e) {}
        } else if (tab === 'geopolitics') {
            try { Plotly.Plots.resize('pm-term-chart'); } catch(e) {}
        } else if (tab === 'cftc') {
            try { Plotly.Plots.resize('cftc-net-chart'); Plotly.Plots.resize('cftc-ls-chart'); } catch(e) {}
        } else {
            Plotly.Plots.resize('payoff-chart');
            Plotly.Plots.resize('greeks-chart');
            Plotly.Plots.resize('surface-chart');
            Plotly.Plots.resize('theta-chart');
        }
    }, 50);
}

// ─── Chart Helpers ──────────────────────────────────────────────────────────

function showChartLoading(chartId) {
    const cc = getChartColors();
    Plotly.react(chartId, [], {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        xaxis: { visible: false }, yaxis: { visible: false },
        annotations: [{
            text: 'Loading...',
            xref: 'paper', yref: 'paper', x: 0.5, y: 0.5,
            showarrow: false, font: { size: 13, color: cc.muted },
        }],
        margin: { l: 55, r: 30, t: 25, b: 40 },
    }, CHART_CONFIG);
}

function showChartEmpty(chartId, msg) {
    const cc = getChartColors();
    Plotly.react(chartId, [], {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        xaxis: { visible: false }, yaxis: { visible: false },
        annotations: [{
            text: msg || 'No data available',
            xref: 'paper', yref: 'paper', x: 0.5, y: 0.5,
            showarrow: false, font: { size: 12, color: cc.dim },
        }],
        margin: { l: 55, r: 30, t: 25, b: 40 },
    }, CHART_CONFIG);
}

// ─── Energy Markets Init ────────────────────────────────────────────────────

async function initEnergyMarkets() {
    const cc = getChartColors();
    const emptyLayout = {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        xaxis: { gridcolor: cc.grid, zerolinecolor: cc.zero, tickfont: { size: 10, color: cc.muted } },
        yaxis: { gridcolor: cc.grid, zerolinecolor: cc.zero, tickfont: { size: 10, color: cc.muted } },
        margin: { l: 55, r: 30, t: 25, b: 40 },
    };

    Plotly.newPlot('spot-evo-chart', [], { ...emptyLayout }, CHART_CONFIG);
    Plotly.newPlot('term-structure-chart', [], { ...emptyLayout }, CHART_CONFIG);
    Plotly.newPlot('spread-monitor-chart', [], { ...emptyLayout }, CHART_CONFIG);

    // Show loading
    showChartLoading('term-structure-chart');
    showChartEmpty('spot-evo-chart', 'Select a commodity or spread on the left');
    renderSpotPrices(false);

    // Load market data
    await loadMarketData();

    // Populate compare-commodity dropdown
    const tsCompareCommodity = document.getElementById('ts-compare-commodity');
    for (const [name] of Object.entries(ENERGY_COMMODITIES)) {
        if (liveSpots[name] != null && marketData?.termStructures?.[name]) {
            tsCompareCommodity.appendChild(new Option(name, name));
        }
    }

    populateSpreads();

    // Draw initial spread chart
    if (document.getElementById('spread-select').options.length > 0) {
        updateSpreadChart();
    }

    // Set date input default
    const dateInput = document.getElementById('ts-compare-date');
    if (dateInput) {
        const today = new Date().toISOString().slice(0, 10);
        const twoYearsAgo = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
        dateInput.max = today;
        dateInput.min = twoYearsAgo;
        dateInput.value = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    }

    // Default: select WTI
    const defaultCommodity = 'WTI Crude Oil (CL)';
    if (liveSpots[defaultCommodity] != null) {
        selectedCommodity = defaultCommodity;
        spotEvoSelected.add(defaultCommodity);
    }

    // Render everything
    renderSpotPrices(true);
    renderSpreadDashboard();
    updateTermStructure();
    updateSpotEvolution();

    // Load news feed into Overview tab
    loadAndRenderNews('physical', 'overview-news-feed');

    // OPEC Watch in left sidebar
    renderOpecWatchOverview();

    // Show data timestamp
    const ts = getDataTimestamp();
    if (ts) {
        const ago = _timeAgo(ts);
        console.log(`[Market Data] Last updated ${ago}`);
    }
}

function _timeAgo(date) {
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Spot Prices ────────────────────────────────────────────────────────────

let selectedCommodity = null;  // most-recently clicked commodity (drives term structure)

function selectCommodity(name) {
    // Toggle selection for price evolution
    if (spotEvoSelected.has(name)) {
        spotEvoSelected.delete(name);
        // If we deselected the term-structure commodity, pick the last remaining one
        if (selectedCommodity === name) {
            selectedCommodity = spotEvoSelected.size > 0
                ? [...spotEvoSelected][spotEvoSelected.size - 1]
                : null;
        }
    } else {
        spotEvoSelected.add(name);
        selectedCommodity = name;
    }
    // Clicking a commodity clears any active spread view
    priceEvoMode = 'commodity';
    priceEvoSpreadKey = null;

    renderSpotPrices(true);
    renderSpreadDashboard();
    updateTermStructure();
    updateSpotEvolution();
}

function _getChange(sym, nDays) {
    if (!marketData?.history?.[sym]) return null;
    const hist = marketData.history[sym];
    if (!hist.close || hist.close.length < 2) return null;
    const latest = hist.close[hist.close.length - 1];
    const idx = Math.max(0, hist.close.length - nDays - 1);
    const prev = hist.close[idx];
    if (!prev) return null;
    return ((latest - prev) / prev) * 100;
}

function _getYtdChange(sym) {
    if (!marketData?.history?.[sym]) return null;
    const hist = marketData.history[sym];
    if (!hist.dates || !hist.close || hist.close.length < 2) return null;
    const year = new Date().getFullYear();
    const yearStr = `${year}-01`;
    const idx = hist.dates.findIndex(d => d >= yearStr);
    if (idx < 0) return null;
    const start = hist.close[idx];
    const latest = hist.close[hist.close.length - 1];
    return ((latest - start) / start) * 100;
}

function _fmtChange(pct) {
    if (pct == null) return '<span style="font-size:9px;color:var(--text-dim)">—</span>';
    const sign = pct >= 0 ? '+' : '';
    const c = pct >= 0
        ? (isDarkMode ? '#34d399' : '#059669')
        : (isDarkMode ? '#f87171' : '#dc2626');
    return `<span style="font-family:var(--mono);font-size:9px;color:${c}">${sign}${pct.toFixed(1)}%</span>`;
}

function renderSpotPrices(loaded) {
    const container = document.getElementById('spot-prices-table');
    let html = '';

    // Header
    html += `<div style="display:flex;justify-content:flex-end;gap:12px;padding:0 6px 4px;border-bottom:1px solid var(--input-border);margin-bottom:4px">
        <span style="font-family:var(--mono);font-size:7px;color:var(--text-dim);letter-spacing:0.5px;min-width:36px;text-align:right">1D</span>
        <span style="font-family:var(--mono);font-size:7px;color:var(--text-dim);letter-spacing:0.5px;min-width:36px;text-align:right">YTD</span>
    </div>`;

    for (const [name, cfg] of Object.entries(ENERGY_COMMODITIES)) {
        const price = liveSpots[name];
        if (loaded && price == null) continue;

        const shortName = name
            .replace('WTI Crude Oil (CL)', 'WTI Crude')
            .replace('Brent Crude Oil (BZ)', 'Brent Crude')
            .replace('Henry Hub Nat Gas (NG)', 'HH Nat Gas')
            .replace('TTF Natural Gas', 'TTF Gas')
            .replace('RBOB Gasoline (RB)', 'RBOB Gasoline')
            .replace('Heating Oil (HO)', 'Heating Oil');
        const color = isDarkMode ? cfg.colorDark : cfg.color;
        const decimals = price != null && price < 10 ? 3 : 2;
        const isEvoSelected = spotEvoSelected.has(name);
        const chg1d = loaded ? _getChange(cfg.continuous, 1) : null;
        const chgYtd = loaded ? _getYtdChange(cfg.continuous) : null;

        // Selection indicator dot
        const dotColor = isEvoSelected ? color : 'var(--input-border)';
        const dot = `<span style="width:6px;height:6px;border-radius:50%;background:${dotColor};flex-shrink:0;transition:background 0.2s"></span>`;

        html += `
            <div class="spot-row${isEvoSelected ? ' spot-row-active' : ''}" onclick="selectCommodity('${name}')" style="cursor:pointer" title="Click to select/deselect for price evolution">
                <div style="display:flex;align-items:center;gap:6px;min-width:0">
                    ${dot}
                    <div class="spot-name" style="border-left: 3px solid ${color}; padding-left: 8px">
                        ${shortName}
                    </div>
                </div>
                <div class="spot-val" style="display:flex;align-items:center;gap:8px">
                    <span class="spot-price">${loaded ? price.toFixed(decimals) : '...'}</span>
                    <span class="spot-unit">${cfg.unit}</span>
                    ${_fmtChange(chg1d)}
                    ${_fmtChange(chgYtd)}
                </div>
            </div>`;
    }

    // Market indices separator
    if (loaded && marketData?.indices) {
        html += `<div style="border-top:1px solid var(--input-border);margin-top:6px;padding-top:6px">
            <div style="font-family:var(--mono);font-size:7px;color:var(--text-dim);letter-spacing:1px;padding:0 6px 4px">MARKET INDICES</div>`;

        for (const [sym, info] of Object.entries(MARKET_INDICES)) {
            const data = marketData.indices[sym];
            if (!data) continue;
            const price = data.price;
            const decimals = price < 10 ? 3 : (price > 1000 ? 0 : 2);
            const chg1d = data.chg1d;
            const chgYtd = data.chgYtd;

            html += `
                <div class="spot-row" style="opacity:0.85">
                    <div class="spot-name" style="border-left: 3px solid ${isDarkMode ? info.colorDark : info.color}; padding-left: 8px">
                        ${info.label}
                    </div>
                    <div class="spot-val" style="display:flex;align-items:center;gap:8px">
                        <span class="spot-price">${price.toFixed(decimals)}</span>
                        <span class="spot-unit">${info.unit}</span>
                        ${_fmtChange(chg1d)}
                        ${_fmtChange(chgYtd)}
                    </div>
                </div>`;
        }
        html += '</div>';
    }

    if (loaded && !html) {
        html = '<div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">No data. Run: python scripts/fetch_market_data.py</div>';
    }

    container.innerHTML = html;
}

// ─── Spot Price Evolution ───────────────────────────────────────────────────

let spotEvoPeriod = '1M';
const spotEvoSelected = new Set(); // selected commodity names for the chart

// Mode: 'commodity' shows selected commodity histories; 'spread' shows a spread history
let priceEvoMode = 'commodity';
let priceEvoSpreadKey = null;

function setSpotEvoPeriod(period) {
    spotEvoPeriod = period;
    document.querySelectorAll('#spot-evo-periods .btn-xs').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.trim() === period);
    });
    updateSpotEvolution();
}

function _getPeriodDays(period) {
    const now = new Date();
    switch (period) {
        case '1D': return 2;
        case '1W': return 7;
        case '1M': return 30;
        case 'MTD': {
            const d = new Date(now.getFullYear(), now.getMonth(), 1);
            return Math.ceil((now - d) / 86400000) + 1;
        }
        case 'YTD': {
            const d = new Date(now.getFullYear(), 0, 1);
            return Math.ceil((now - d) / 86400000) + 1;
        }
        case '1Y': return 365;
        case '5Y': return 1825;
        case '10Y': return 3650;
        default: return 30;
    }
}

function updateSpotEvolution() {
    // Spread mode: show spread price history
    if (priceEvoMode === 'spread' && priceEvoSpreadKey) {
        _updateSpotEvoSpread();
        renderPriceEvoInfo();
        return;
    }

    if (spotEvoSelected.size === 0) {
        showChartEmpty('spot-evo-chart', 'Select a commodity or spread on the left');
        renderPriceEvoInfo();
        return;
    }
    if (!marketData?.history) {
        showChartEmpty('spot-evo-chart', 'No data');
        renderPriceEvoInfo();
        return;
    }

    const cc = getChartColors();
    const nDays = _getPeriodDays(spotEvoPeriod);
    const traces = [];
    const multiCommodity = spotEvoSelected.size > 1;

    for (const name of spotEvoSelected) {
        const cfg = ENERGY_COMMODITIES[name];
        if (!cfg) continue;
        const hist = marketData.history[cfg.continuous];
        if (!hist?.dates?.length) continue;

        const startIdx = Math.max(0, hist.dates.length - nDays);
        const dates = hist.dates.slice(startIdx);
        const prices = hist.close.slice(startIdx);
        const color = isDarkMode ? cfg.colorDark : cfg.color;
        const shortName = name.replace(/ \(.*/, '');

        if (multiCommodity) {
            // Normalize to % change for performance comparison
            const base = prices[0];
            traces.push({
                x: dates,
                y: prices.map(p => ((p / base) - 1) * 100),
                type: 'scatter',
                mode: 'lines',
                name: shortName,
                line: { color, width: 2 },
            });
        } else {
            traces.push({
                x: dates,
                y: prices,
                type: 'scatter',
                mode: 'lines',
                name: shortName,
                line: { color, width: 2 },
                fill: 'tozeroy',
                fillcolor: color + '15',
            });
        }
    }

    if (traces.length === 0) {
        showChartEmpty('spot-evo-chart', 'No price history available');
        renderPriceEvoInfo();
        return;
    }

    // Subtitle
    const subtitle = document.getElementById('spot-evo-subtitle');
    const names = [...spotEvoSelected].map(n => n.replace(/ \(.*/, '').toUpperCase());
    if (subtitle) {
        if (multiCommodity) {
            subtitle.textContent = 'PERFORMANCE: ' + names.join(' · ') + ' // ' + spotEvoPeriod;
        } else {
            subtitle.textContent = names[0] + ' // ' + spotEvoPeriod;
        }
    }

    // Pick unit from first selected (only shown in single mode)
    const firstCfg = ENERGY_COMMODITIES[[...spotEvoSelected][0]];

    const layout = {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        margin: { l: 55, r: 30, t: 10, b: 40 },
        xaxis: {
            gridcolor: cc.grid, zerolinecolor: cc.zero,
            tickfont: { size: 9, color: cc.muted },
        },
        yaxis: {
            gridcolor: cc.grid, zerolinecolor: cc.zero,
            tickfont: { size: 9, color: cc.muted },
            title: multiCommodity
                ? { text: '% Change', font: { size: 10, color: cc.muted } }
                : { text: firstCfg?.unit || '', font: { size: 10, color: cc.muted } },
            zeroline: multiCommodity,
            zerolinecolor: multiCommodity ? cc.muted : cc.zero,
        },
        showlegend: traces.length > 1,
        legend: { x: 0, y: 1, font: { size: 9, color: cc.muted }, bgcolor: 'transparent' },
        hovermode: 'x unified',
    };

    Plotly.react('spot-evo-chart', traces, layout, CHART_CONFIG);
    renderPriceEvoInfo();
}

// Show spread history in the price evolution chart
function _updateSpotEvoSpread() {
    const cc = getChartColors();
    const nDays = _getPeriodDays(spotEvoPeriod);
    const def = SPREAD_DEFINITIONS[priceEvoSpreadKey];
    const data = getSpreadHistory(priceEvoSpreadKey, nDays);

    if (!data) {
        showChartEmpty('spot-evo-chart', `No data for ${priceEvoSpreadKey}`);
        return;
    }

    const vals = data.values;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const valColor = isDarkMode ? '#a78bfa' : '#7c3aed';

    const traces = [
        {
            x: data.dates, y: vals,
            type: 'scatter', mode: 'lines', name: priceEvoSpreadKey,
            line: { color: valColor, width: 2 },
            fill: 'tozeroy',
            fillcolor: valColor + '20',
        },
        {
            x: [data.dates[0], data.dates[data.dates.length - 1]], y: [mean, mean],
            type: 'scatter', mode: 'lines', name: `Mean (${mean.toFixed(2)})`,
            line: { color: isDarkMode ? '#fbbf24' : '#d97706', width: 1.5, dash: 'dash' },
        },
        {
            x: [data.dates[0], data.dates[data.dates.length - 1]], y: [0, 0],
            type: 'scatter', mode: 'lines',
            line: { color: cc.muted, width: 1, dash: 'dot' },
            showlegend: false,
        },
    ];

    const subtitle = document.getElementById('spot-evo-subtitle');
    if (subtitle) subtitle.textContent = `${priceEvoSpreadKey} // ${def?.unit || ''} // ${spotEvoPeriod}`;

    const layout = {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        margin: { l: 55, r: 30, t: 10, b: 40 },
        xaxis: { gridcolor: cc.grid, zerolinecolor: cc.zero, tickfont: { size: 9, color: cc.muted } },
        yaxis: {
            gridcolor: cc.grid, zerolinecolor: cc.zero, tickfont: { size: 9, color: cc.muted },
            title: { text: def?.unit || '', font: { size: 10, color: cc.muted } },
            zeroline: true, zerolinecolor: cc.muted,
        },
        showlegend: true,
        legend: { x: 0, y: 1, font: { size: 9, color: cc.muted }, bgcolor: 'transparent' },
        hovermode: 'x unified',
    };

    Plotly.react('spot-evo-chart', traces, layout, CHART_CONFIG);
}

// ─── Price Evolution Info Panel ──────────────────────────────────────────────

function renderPriceEvoInfo() {
    const container = document.getElementById('price-evo-info');
    if (!container) return;

    if (priceEvoMode === 'spread' && priceEvoSpreadKey) {
        _renderSpreadInfo(container);
        return;
    }

    const count = spotEvoSelected.size;
    if (count === 0) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:10px;padding:8px;text-align:center;line-height:1.6">Select a commodity<br>or click a spread</div>';
        return;
    }

    if (count === 1) {
        _renderSingleCommodityInfo(container, [...spotEvoSelected][0]);
    } else {
        _renderCorrelationMatrix(container);
    }
}

function _renderSingleCommodityInfo(container, name) {
    const cfg = ENERGY_COMMODITIES[name];
    if (!cfg || !marketData) { container.innerHTML = ''; return; }

    const price = liveSpots[name];
    const hist = marketData.history?.[cfg.continuous];
    const color = isDarkMode ? cfg.colorDark : cfg.color;
    const shortName = name.replace(/ \(.*/, '');
    const decimals = price != null && price < 10 ? 3 : 2;

    const chg1d  = _getChange(cfg.continuous, 1);
    const chg1w  = _getChange(cfg.continuous, 5);
    const chg1m  = _getChange(cfg.continuous, 21);
    const chgYtd = _getYtdChange(cfg.continuous);
    const chg1y  = _getChange(cfg.continuous, 252);

    let hi52 = null, lo52 = null;
    if (hist?.close?.length) {
        const recent = hist.close.slice(-252);
        hi52 = Math.max(...recent);
        lo52 = Math.min(...recent);
    }

    const vol30  = _computeVol(cfg.continuous, 30);
    const vol252 = _computeVol(cfg.continuous, 252);

    const rangePos = (hi52 != null && lo52 != null && hi52 > lo52 && price != null)
        ? Math.min(100, Math.max(0, ((price - lo52) / (hi52 - lo52)) * 100))
        : null;

    let html = `
        <div style="border-left:3px solid ${color};padding-left:8px;margin-bottom:12px">
            <div style="font-family:var(--mono);font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:0.5px">${shortName.toUpperCase()}</div>
            <div style="font-family:var(--mono);font-size:20px;font-weight:700;color:${color};line-height:1.1;margin-top:2px">${price != null ? price.toFixed(decimals) : '—'}</div>
            <div style="font-size:9px;color:var(--text-dim)">${cfg.unit}</div>
        </div>

        <div style="margin-bottom:12px">
            <div class="info-section-lbl">PERFORMANCE</div>
            ${_pctRow('1D', chg1d)}
            ${_pctRow('1W', chg1w)}
            ${_pctRow('1M', chg1m)}
            ${_pctRow('YTD', chgYtd)}
            ${_pctRow('1Y', chg1y)}
        </div>`;

    if (hi52 != null && lo52 != null) {
        html += `
        <div style="margin-bottom:12px">
            <div class="info-section-lbl">52-WEEK RANGE</div>
            <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9px;color:var(--text-muted);margin-bottom:4px">
                <span>${lo52.toFixed(decimals)}</span>
                <span>${hi52.toFixed(decimals)}</span>
            </div>
            <div style="height:4px;background:var(--input-bg);border-radius:2px;overflow:hidden">
                <div style="height:100%;width:${rangePos ?? 50}%;background:${color};border-radius:2px"></div>
            </div>
            ${price != null ? `<div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);text-align:center;margin-top:3px">${price.toFixed(decimals)} (${rangePos != null ? rangePos.toFixed(0) : '—'}th pct)</div>` : ''}
        </div>`;
    }

    if (vol30 != null) {
        html += `
        <div>
            <div class="info-section-lbl">VOLATILITY (ANN.)</div>
            ${_statRow('30D', vol30.toFixed(1) + '%')}
            ${vol252 != null ? _statRow('1Y',  vol252.toFixed(1) + '%') : ''}
        </div>`;
    }

    container.innerHTML = html;
}

function _renderCorrelationMatrix(container) {
    const names = [...spotEvoSelected];
    const shortNames = names.map(n => n.replace(/ \(.*/, '').replace('Henry Hub ', 'HH ').slice(0, 9));
    const nDays = _getPeriodDays(spotEvoPeriod);

    // Pairwise Pearson correlations on daily log-returns
    const corrs = names.map((n1, i) =>
        names.map((n2, j) => {
            if (i === j) return 1.0;
            const cfg1 = ENERGY_COMMODITIES[n1], cfg2 = ENERGY_COMMODITIES[n2];
            if (!cfg1 || !cfg2) return null;
            const aligned = _getAlignedReturns(cfg1.continuous, cfg2.continuous, nDays);
            return aligned ? _pearson(aligned.x, aligned.y) : null;
        })
    );

    let html = `<div class="info-section-lbl" style="margin-bottom:6px">CORRELATIONS (${spotEvoPeriod})</div>`;
    html += '<div style="overflow-x:auto"><table class="corr-table"><thead><tr><th></th>';
    shortNames.forEach(n => { html += `<th>${n}</th>`; });
    html += '</tr></thead><tbody>';

    for (let i = 0; i < names.length; i++) {
        html += `<tr><td class="corr-label">${shortNames[i]}</td>`;
        for (let j = 0; j < names.length; j++) {
            const c = corrs[i][j];
            let bg = 'transparent', fg = 'var(--text)';
            if (i === j) {
                bg = 'var(--input-bg)'; fg = 'var(--text-dim)';
            } else if (c !== null) {
                const abs = Math.abs(c);
                bg = c > 0 ? `rgba(52,211,153,${(abs * 0.35).toFixed(2)})` : `rgba(248,113,113,${(abs * 0.35).toFixed(2)})`;
                fg = c > 0 ? (isDarkMode ? '#34d399' : '#059669') : (isDarkMode ? '#f87171' : '#dc2626');
            }
            html += `<td style="background:${bg};color:${fg};font-weight:${i===j?400:600}">${c !== null ? c.toFixed(2) : '—'}</td>`;
        }
        html += '</tr>';
    }
    html += '</tbody></table></div>';

    // Individual period performance
    html += `<div class="info-section-lbl" style="margin-top:12px;margin-bottom:4px">PERFORMANCE (${spotEvoPeriod})</div>`;
    for (const name of names) {
        const cfg = ENERGY_COMMODITIES[name];
        if (!cfg) continue;
        const color = isDarkMode ? cfg.colorDark : cfg.color;
        const sn = name.replace(/ \(.*/, '');
        const chg = _getChange(cfg.continuous, nDays);
        const up = chg != null && chg >= 0;
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px solid var(--panel-border)">
            <div style="display:flex;align-items:center;gap:5px">
                <div style="width:8px;height:8px;border-radius:50%;flex-shrink:0;background:${color}"></div>
                <span style="font-size:9px;color:var(--text-muted)">${sn}</span>
            </div>
            <span style="font-family:var(--mono);font-size:10px;font-weight:600;color:${chg != null ? (up ? (isDarkMode?'#34d399':'#059669') : (isDarkMode?'#f87171':'#dc2626')) : 'var(--text-dim)'}">${chg != null ? (up?'+':'') + chg.toFixed(2) + '%' : '—'}</span>
        </div>`;
    }

    container.innerHTML = html;
}

function _renderSpreadInfo(container) {
    const name = priceEvoSpreadKey;
    const def = SPREAD_DEFINITIONS[name];
    if (!def) { container.innerHTML = ''; return; }

    const nDays = _getPeriodDays(spotEvoPeriod);
    const data = getSpreadHistory(name, nDays);
    const current = computeSpreadValue(name);

    if (!data || current == null) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:10px;padding:8px">No spread data</div>';
        return;
    }

    const vals = data.values;
    const sorted = [...vals].sort((a, b) => a - b);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const p5   = sorted[Math.floor(sorted.length * 0.05)];
    const p25  = sorted[Math.floor(sorted.length * 0.25)];
    const p75  = sorted[Math.floor(sorted.length * 0.75)];
    const p95  = sorted[Math.floor(sorted.length * 0.95)];
    const min  = sorted[0];
    const max  = sorted[sorted.length - 1];
    const rangePos = max > min ? Math.min(100, Math.max(0, ((current - min) / (max - min)) * 100)) : 50;

    const valColor = current >= 0 ? (isDarkMode ? '#34d399' : '#059669') : (isDarkMode ? '#f87171' : '#dc2626');
    const shortName = name.replace(' Spread', '');

    let html = `
        <div style="margin-bottom:12px">
            <div style="font-family:var(--mono);font-size:10px;font-weight:700;color:var(--text-muted);letter-spacing:0.5px;margin-bottom:4px">${shortName.toUpperCase()}</div>
            <div style="font-family:var(--mono);font-size:20px;font-weight:700;color:${valColor};line-height:1.1">${current >= 0 ? '+' : ''}${current.toFixed(2)}</div>
            <div style="font-size:9px;color:var(--text-dim)">${def.unit}</div>
        </div>

        <div style="margin-bottom:12px">
            <div class="info-section-lbl">STATISTICS (${spotEvoPeriod})</div>
            ${_statRow('Mean', mean.toFixed(2) + ' ' + def.unit)}
            ${_statRow('P5',   p5.toFixed(2)   + ' ' + def.unit)}
            ${_statRow('P25',  p25.toFixed(2)  + ' ' + def.unit)}
            ${_statRow('P75',  p75.toFixed(2)  + ' ' + def.unit)}
            ${_statRow('P95',  p95.toFixed(2)  + ' ' + def.unit)}
            ${_statRow('Min',  min.toFixed(2)  + ' ' + def.unit)}
            ${_statRow('Max',  max.toFixed(2)  + ' ' + def.unit)}
        </div>

        <div>
            <div class="info-section-lbl">RANGE (${spotEvoPeriod})</div>
            <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9px;color:var(--text-muted);margin-bottom:4px">
                <span>${min.toFixed(2)}</span>
                <span>${max.toFixed(2)}</span>
            </div>
            <div style="height:4px;background:var(--input-bg);border-radius:2px;overflow:hidden">
                <div style="height:100%;width:${rangePos.toFixed(1)}%;background:${valColor};border-radius:2px"></div>
            </div>
            <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);text-align:center;margin-top:3px">${rangePos.toFixed(0)}th pct</div>
        </div>`;

    container.innerHTML = html;
}

// Row helpers
function _pctRow(label, pct) {
    if (pct == null) return '';
    const up = pct >= 0;
    const color = up ? (isDarkMode ? '#34d399' : '#059669') : (isDarkMode ? '#f87171' : '#dc2626');
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid var(--panel-border)">
        <span style="font-size:9px;color:var(--text-dim)">${label}</span>
        <span style="font-family:var(--mono);font-size:10px;font-weight:600;color:${color}">${up?'+':''}${pct.toFixed(2)}%</span>
    </div>`;
}

function _statRow(label, val) {
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid var(--panel-border)">
        <span style="font-size:9px;color:var(--text-dim)">${label}</span>
        <span style="font-family:var(--mono);font-size:10px;color:var(--text)">${val}</span>
    </div>`;
}

// ─── Volatility & Correlation Helpers ───────────────────────────────────────

function _computeVol(sym, nDays) {
    const hist = marketData?.history?.[sym];
    if (!hist?.close || hist.close.length < 3) return null;
    const recent = hist.close.slice(-(nDays + 1));
    const returns = [];
    for (let i = 1; i < recent.length; i++) {
        if (recent[i - 1] > 0) returns.push(Math.log(recent[i] / recent[i - 1]));
    }
    if (returns.length < 5) return null;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance * 252) * 100;
}

function _getAlignedReturns(sym1, sym2, nDays) {
    const h1 = marketData?.history?.[sym1];
    const h2 = marketData?.history?.[sym2];
    if (!h1?.dates || !h2?.dates) return null;

    const r1 = {};
    for (let i = 1; i < h1.dates.length; i++) {
        if (h1.close[i - 1] > 0) r1[h1.dates[i]] = Math.log(h1.close[i] / h1.close[i - 1]);
    }
    const r2 = {};
    for (let i = 1; i < h2.dates.length; i++) {
        if (h2.close[i - 1] > 0) r2[h2.dates[i]] = Math.log(h2.close[i] / h2.close[i - 1]);
    }

    const dates = Object.keys(r1).filter(d => r2[d] !== undefined).sort().slice(-nDays);
    if (dates.length < 5) return null;
    return { x: dates.map(d => r1[d]), y: dates.map(d => r2[d]) };
}

function _pearson(x, y) {
    const n = x.length;
    if (n < 2) return null;
    const mx = x.reduce((a, b) => a + b, 0) / n;
    const my = y.reduce((a, b) => a + b, 0) / n;
    let cov = 0, sx = 0, sy = 0;
    for (let i = 0; i < n; i++) {
        cov += (x[i] - mx) * (y[i] - my);
        sx  += (x[i] - mx) ** 2;
        sy  += (y[i] - my) ** 2;
    }
    if (sx === 0 || sy === 0) return null;
    return cov / Math.sqrt(sx * sy);
}

// ─── Spread Dashboard ───────────────────────────────────────────────────────

function renderSpreadDashboard() {
    const container = document.getElementById('spread-dashboard');
    let html = '';
    let lastCategory = '';

    for (const [name, def] of Object.entries(SPREAD_DEFINITIONS)) {
        const val = computeSpreadValue(name);
        if (val == null) continue;

        if (def.category !== lastCategory) {
            html += `<div class="metric-section">${def.category}</div>`;
            lastCategory = def.category;
        }

        const valColor = val >= 0
            ? (isDarkMode ? '#34d399' : '#059669')
            : (isDarkMode ? '#f87171' : '#dc2626');

        const shortName = name.replace(' Spread', '').replace('Gasoline Crack', 'RBOB Crack').replace('Heating Oil Crack', 'HO Crack');
        const isActive = priceEvoMode === 'spread' && priceEvoSpreadKey === name;

        html += `
            <div class="spread-row${isActive ? ' spread-row-active' : ''}" onclick="selectSpreadForPriceEvo('${name}')" title="${def.description} — Click to chart in Price Evolution">
                <div class="spread-name">${shortName}</div>
                <div class="spread-val" style="color:${valColor}">${val >= 0 ? '+' : ''}${val.toFixed(2)}</div>
                <div class="spread-unit">${def.unit}</div>
            </div>`;
    }

    if (!html) {
        html = '<div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">No spread data</div>';
    }

    container.innerHTML = html;
}

// Show a spread in the Price Evolution chart
function selectSpreadForPriceEvo(name) {
    priceEvoMode = 'spread';
    priceEvoSpreadKey = name;
    spotEvoSelected.clear();
    selectedCommodity = null;
    renderSpotPrices(true);
    renderSpreadDashboard();
    updateTermStructure();
    updateSpotEvolution();
}

// ─── Term Structure ─────────────────────────────────────────────────────────

let tsComparisons = []; // [{ date, commodity, data }, ...]

function updateTermStructure() {
    const cc = getChartColors();

    // Show selected commodity, or empty chart if none selected
    const subtitle = document.getElementById('ts-subtitle');

    if (!selectedCommodity) {
        showChartEmpty('term-structure-chart', 'Select a commodity to view its term structure');
        if (subtitle) subtitle.textContent = 'FORWARD CURVE // DELIVERY MONTH';
        return;
    }

    if (subtitle) subtitle.textContent = `${selectedCommodity} // DELIVERY MONTH`;

    const commodities = marketData?.termStructures?.[selectedCommodity] ? [selectedCommodity] : [];

    if (commodities.length === 0) {
        showChartEmpty('term-structure-chart', 'No term structure data available');
        return;
    }

    const units = new Set();
    commodities.forEach(c => units.add(ENERGY_COMMODITIES[c].unit));
    // Include units from commodity comparisons
    tsComparisons.forEach(c => {
        const cfg = ENERGY_COMMODITIES[c.commodity];
        if (cfg) units.add(cfg.unit);
    });
    const unitList = [...units];
    const multiUnit = unitList.length > 1;

    const traces = [];

    // Current curves (solid)
    for (const commodity of commodities) {
        const ts = getTermStructure(commodity);
        if (!ts) continue;

        const cfg = ENERGY_COMMODITIES[commodity];
        const color = isDarkMode ? cfg.colorDark : cfg.color;
        const shortName = commodity.replace(/\s*\(.*\)/, '').replace('Henry Hub ', '');
        const yAxisIdx = multiUnit ? unitList.indexOf(cfg.unit) : 0;

        const label = tsComparisons.length > 0 ? `${shortName} (now)` : shortName;
        traces.push({
            x: ts.months, y: ts.prices,
            name: label,
            type: 'scatter', mode: 'lines+markers',
            line: { color, width: 2.5 }, marker: { size: 4, color },
            yaxis: yAxisIdx === 0 ? 'y' : 'y2',
            hovertemplate: `${label}<br>%{x}: %{y:.2f} ${cfg.unit}<extra></extra>`,
        });
    }

    // Comparison curves (dashed) — date comparisons and commodity comparisons
    const compColors = ['#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
    for (let ci = 0; ci < tsComparisons.length; ci++) {
        const comp = tsComparisons[ci];
        const cfg = ENERGY_COMMODITIES[comp.commodity];
        if (!cfg) continue;
        const shortName = comp.commodity.replace(/\s*\(.*\)/, '').replace('Henry Hub ', '');
        const yAxisIdx = multiUnit ? unitList.indexOf(cfg.unit) : 0;
        const compColor = compColors[ci % compColors.length];

        const compLabel = comp.type === 'commodity'
            ? `${shortName} (now)`
            : `${shortName} (${comp.date})`;

        traces.push({
            x: comp.data.months, y: comp.data.prices,
            name: compLabel,
            type: 'scatter', mode: 'lines+markers',
            line: { color: compColor, width: 1.5, dash: comp.type === 'commodity' ? 'solid' : 'dash' },
            marker: { size: 3, color: compColor, symbol: comp.type === 'commodity' ? 'circle' : 'diamond' },
            yaxis: yAxisIdx === 0 ? 'y' : 'y2',
            hovertemplate: `${compLabel}<br>%{x}: %{y:.2f} ${cfg.unit}<extra></extra>`,
        });
    }

    const dataTs = getDataTimestamp();
    const stampText = dataTs ? `YAHOO FINANCE — ${_timeAgo(dataTs)}` : 'YAHOO FINANCE';

    const layout = {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        xaxis: { gridcolor: cc.grid, zerolinecolor: cc.zero, tickfont: { size: 9, color: cc.muted }, tickangle: -45 },
        yaxis: {
            gridcolor: cc.grid, zerolinecolor: cc.zero, tickfont: { size: 10, color: cc.muted },
            title: { text: unitList[0] || '', font: { size: 11, color: cc.muted } },
        },
        margin: { l: 55, r: multiUnit ? 55 : 30, t: 25, b: 60 },
        legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 10, color: cc.muted }, orientation: 'h', yanchor: 'bottom', y: 1.02 },
        hovermode: 'x unified',
        annotations: [{
            x: 1, y: -0.18, xref: 'paper', yref: 'paper', xanchor: 'right',
            text: stampText, showarrow: false,
            font: { size: 9, color: cc.dim, family: 'JetBrains Mono, monospace' },
        }],
    };

    if (multiUnit && unitList.length > 1) {
        layout.yaxis2 = {
            overlaying: 'y', side: 'right',
            gridcolor: cc.grid, zerolinecolor: cc.zero,
            tickfont: { size: 10, color: cc.muted },
            title: { text: unitList[1], font: { size: 11, color: cc.muted } },
        };
    }

    Plotly.react('term-structure-chart', traces, layout, CHART_CONFIG);
}

// ─── Term Structure Comparison ──────────────────────────────────────────────

function addTermStructureComparison() {
    const dateStr = document.getElementById('ts-compare-date').value;
    if (!dateStr || !selectedCommodity) return;

    const commodities = marketData?.contractHistory?.[selectedCommodity] ? [selectedCommodity] : [];

    if (tsComparisons.length >= 4) tsComparisons.shift();

    let added = false;
    for (const commodity of commodities) {
        // Prevent duplicates
        if (tsComparisons.find(c => c.date === dateStr && c.commodity === commodity)) continue;

        const data = getTermStructureAtDate(commodity, dateStr);
        if (data) {
            tsComparisons.push({ date: dateStr, commodity, data });
            added = true;
        }
    }

    if (added) {
        renderComparisonTags();
        updateTermStructure();
    }
}

function addCommodityComparison() {
    const select = document.getElementById('ts-compare-commodity');
    const commodity = select.value;
    if (!commodity || !selectedCommodity) return;

    // Prevent duplicates on term structure
    if (tsComparisons.find(c => c.type === 'commodity' && c.commodity === commodity)) return;
    if (tsComparisons.length >= 4) tsComparisons.shift();

    const data = getTermStructure(commodity);
    if (data) {
        tsComparisons.push({ type: 'commodity', commodity, data, date: 'now' });
        select.value = '';
        renderComparisonTags();
        updateTermStructure();
    }
}

function removeComparison(idx) {
    tsComparisons.splice(idx, 1);
    renderComparisonTags();
    updateTermStructure();
}

function clearComparisons() {
    tsComparisons = [];
    renderComparisonTags();
    updateTermStructure();
}

function renderComparisonTags() {
    const container = document.getElementById('ts-comparisons');
    if (!container) return;

    if (tsComparisons.length === 0) {
        container.innerHTML = '';
        return;
    }

    const compColors = ['#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
    let html = '';
    for (let i = 0; i < tsComparisons.length; i++) {
        const c = tsComparisons[i];
        const shortName = c.commodity.replace(/\s*\(.*\)/, '').replace('Henry Hub ', '');
        const color = compColors[i % compColors.length];
        const tagLabel = c.type === 'commodity' ? shortName : `${shortName} ${c.date}`;
        html += `<span class="comp-tag" style="border-left:3px solid ${color}">
            ${tagLabel}
            <button class="comp-remove" onclick="removeComparison(${i})">&times;</button>
        </span>`;
    }
    html += `<button class="comp-clear" onclick="clearComparisons()">Clear all</button>`;
    container.innerHTML = html;
}

// ─── Timespread Analysis ────────────────────────────────────────────────────

function populateTimespreads() {
    const commodity = document.getElementById('ts-spread-commodity').value;
    const select = document.getElementById('ts-spread-select');
    select.innerHTML = '';

    const defs = TIMESPREAD_DEFINITIONS[commodity] || [];
    for (const s of defs) {
        // Only add if we have data for this timespread
        if (marketData?.timespreads?.[s.name]) {
            select.appendChild(new Option(s.name, s.name));
        }
    }
}

function updateTimespread() {
    const cc = getChartColors();
    const spreadName = document.getElementById('ts-spread-select').value;
    const nDays = parseInt(document.getElementById('ts-spread-period').value) || 252;

    if (!spreadName) return;

    const data = getTimespreadHistory(spreadName);
    if (!data) {
        showChartEmpty('timespread-chart', `No data for ${spreadName}`);
        document.getElementById('timespread-subtitle').textContent = 'NO DATA';
        return;
    }

    // Trim to requested period
    const trimmed = _trimToDays(data.dates, data.values, nDays);
    const dates = trimmed.dates;
    const vals = trimmed.values;

    if (vals.length < 2) {
        showChartEmpty('timespread-chart', `Not enough data for ${spreadName}`);
        return;
    }

    document.getElementById('timespread-subtitle').textContent = `${data.name} // ${data.unit}`;

    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const current = vals[vals.length - 1];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const decimals = data.unit.includes('bbl') ? 2 : 3;

    const traces = [
        {
            x: dates, y: vals,
            type: 'scatter', mode: 'lines', name: data.name,
            line: { color: isDarkMode ? '#60a5fa' : '#003061', width: 2 },
            fill: 'tozeroy',
            fillcolor: isDarkMode ? 'rgba(96,165,250,0.08)' : 'rgba(37,99,235,0.06)',
        },
        {
            x: [dates[0], dates[dates.length - 1]], y: [mean, mean],
            type: 'scatter', mode: 'lines', name: `Mean (${mean.toFixed(decimals)})`,
            line: { color: isDarkMode ? '#fbbf24' : '#d97706', width: 1.5, dash: 'dash' },
        },
    ];

    const layout = {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        xaxis: { gridcolor: cc.grid, zerolinecolor: cc.zero, tickfont: { size: 10, color: cc.muted } },
        yaxis: {
            gridcolor: cc.grid, zerolinecolor: cc.zero, tickfont: { size: 10, color: cc.muted },
            title: { text: data.unit, font: { size: 11, color: cc.muted } },
        },
        shapes: [{
            type: 'line', x0: dates[0], x1: dates[dates.length - 1], y0: 0, y1: 0,
            line: { color: cc.zero, width: 1, dash: 'dot' },
        }],
        margin: { l: 55, r: 30, t: 25, b: 40 },
        legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 10, color: cc.muted }, orientation: 'h', yanchor: 'bottom', y: 1.02 },
        hovermode: 'x unified',
        annotations: [{
            x: 0.01, y: 0.98, xref: 'paper', yref: 'paper',
            text: `Current: <b>${current.toFixed(decimals)}</b> | Min: ${min.toFixed(decimals)} | Max: ${max.toFixed(decimals)}`,
            showarrow: false,
            font: { size: 10, color: cc.muted, family: 'JetBrains Mono, monospace' },
            bgcolor: cc.bg, borderpad: 4,
        }],
    };

    Plotly.react('timespread-chart', traces, layout, CHART_CONFIG);
}

function _trimToDays(dates, values, nDays) {
    if (!nDays || dates.length <= nDays) return { dates, values };
    const start = dates.length - nDays;
    return { dates: dates.slice(start), values: values.slice(start) };
}

// ─── Spread Monitor ─────────────────────────────────────────────────────────

function populateSpreads() {
    const select = document.getElementById('spread-select');
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = '';
    for (const [name, def] of Object.entries(SPREAD_DEFINITIONS)) {
        // Skip spreads whose underlyings we don't have historical data for
        if (def.formula !== 'custom') {
            const longCfg = ENERGY_COMMODITIES[def.long];
            const shortCfg = ENERGY_COMMODITIES[def.short];
            if (!longCfg || !shortCfg) continue;
            if (!marketData?.history?.[longCfg.continuous]
                || !marketData?.history?.[shortCfg.continuous]) continue;
        } else {
            // Custom formulas: all required legs must be present
            if (!marketData?.history?.['RB=F']
                || !marketData?.history?.['HO=F']
                || !marketData?.history?.['CL=F']) continue;
        }
        select.appendChild(new Option(name, name));
    }
    // Restore prior selection if still valid, else pick the first
    if (currentValue && [...select.options].some(o => o.value === currentValue)) {
        select.value = currentValue;
    } else if (select.options.length > 0) {
        select.selectedIndex = 0;
    }
}

function onTimespreadCommodityChange() {
    populateTimespreads();
    updateTimespread();
}

function updateSpreadChart() {
    const cc = getChartColors();
    const spreadKey = document.getElementById('spread-select').value;
    const nDays = parseInt(document.getElementById('spread-period').value) || 252;
    if (!spreadKey) return;

    const def = SPREAD_DEFINITIONS[spreadKey];

    const data = getSpreadHistory(spreadKey, nDays);
    if (!data) {
        showChartEmpty('spread-monitor-chart', `No data for ${spreadKey}`);
        document.getElementById('spread-subtitle').textContent = 'NO DATA';
        return;
    }

    document.getElementById('spread-subtitle').textContent = `${def.description} // ${def.unit}`;

    const vals = data.values;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sorted = [...vals].sort((a, b) => a - b);
    const p5 = sorted[Math.floor(sorted.length * 0.05)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const current = vals[vals.length - 1];

    const traces = [
        {
            x: data.dates, y: data.values,
            type: 'scatter', mode: 'lines', name: data.name,
            line: { color: isDarkMode ? '#a78bfa' : '#7c3aed', width: 2 },
            fill: 'tozeroy',
            fillcolor: isDarkMode ? 'rgba(167,139,250,0.08)' : 'rgba(124,58,237,0.06)',
        },
        {
            x: [data.dates[0], data.dates[data.dates.length - 1]], y: [mean, mean],
            type: 'scatter', mode: 'lines', name: `Mean (${mean.toFixed(2)})`,
            line: { color: isDarkMode ? '#fbbf24' : '#d97706', width: 1.5, dash: 'dash' },
        },
        {
            x: [data.dates[0], data.dates[data.dates.length - 1]], y: [p5, p5],
            type: 'scatter', mode: 'lines', name: `P5 (${p5.toFixed(2)})`,
            line: { color: cc.muted, width: 1, dash: 'dot' },
        },
        {
            x: [data.dates[0], data.dates[data.dates.length - 1]], y: [p95, p95],
            type: 'scatter', mode: 'lines', name: `P95 (${p95.toFixed(2)})`,
            line: { color: cc.muted, width: 1, dash: 'dot' },
        },
    ];

    const layout = {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        xaxis: { gridcolor: cc.grid, zerolinecolor: cc.zero, tickfont: { size: 10, color: cc.muted } },
        yaxis: {
            gridcolor: cc.grid, zerolinecolor: cc.zero, tickfont: { size: 10, color: cc.muted },
            title: { text: def.unit, font: { size: 11, color: cc.muted } },
        },
        margin: { l: 55, r: 30, t: 25, b: 40 },
        legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 10, color: cc.muted }, orientation: 'h', yanchor: 'bottom', y: 1.02 },
        hovermode: 'x unified',
        annotations: [{
            x: 0.01, y: 0.98, xref: 'paper', yref: 'paper',
            text: `Current: <b>${current.toFixed(2)}</b> ${def.unit}`,
            showarrow: false,
            font: { size: 10, color: cc.muted, family: 'JetBrains Mono, monospace' },
            bgcolor: cc.bg, borderpad: 4,
        }],
    };

    Plotly.react('spread-monitor-chart', traces, layout, CHART_CONFIG);
}

// ─── Re-render on theme change ──────────────────────────────────────────────

function refreshEnergyMarkets() {
    if (!marketsInitialized) return;
    renderSpotPrices(true);
    renderSpreadDashboard();
    updateTermStructure();
    updateSpotEvolution();
    renderNewsFeed('physical', 'overview-news-feed');
    renderOpecWatchOverview();
}

// ─── OPEC Watch Overview (right sidebar) ────────────────────────────────────

function renderOpecWatchOverview() {
    const container = document.getElementById('opec-watch-overview');
    if (!container || typeof OPEC_WATCH_DATA === 'undefined') return;

    const mtg = getNextOpecMeeting();
    if (!mtg) {
        container.innerHTML = '<div style="font-size:10px;color:var(--text-dim)">No data</div>';
        return;
    }

    const probs = mtg.probabilities || {};
    const prev = mtg.previous || {};
    const dateObj = mtg.date ? new Date(mtg.date + 'T12:00:00') : null;
    const dateStr = dateObj ? dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

    let html = '';

    // Meeting header
    if (dateStr) {
        const daysUntil = dateObj ? Math.ceil((dateObj - new Date()) / 86400000) : null;
        const urgency = daysUntil != null && daysUntil <= 7;
        html += `<div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">
            Next meeting: <span style="font-weight:600;color:${urgency ? (isDarkMode ? '#f87171' : '#dc2626') : 'var(--text)'}">${dateStr}</span>
            ${daysUntil != null && daysUntil > 0 ? `<span style="font-size:8px;color:var(--text-dim)"> (${daysUntil}d)</span>` : ''}
        </div>`;
    }

    // Probability bars
    const outcomes = Object.entries(probs).sort((a, b) => b[1] - a[1]);
    for (const [label, pct] of outcomes) {
        const colors = OPEC_OUTCOME_COLORS[label] || { light: '#6b7280', dark: '#9ca3af' };
        const color = isDarkMode ? colors.dark : colors.light;
        const prevVal = prev[label];
        let shift = '';
        if (prevVal != null) {
            const diff = pct - prevVal;
            if (Math.abs(diff) >= 0.1) {
                const sc = diff >= 0
                    ? (isDarkMode ? '#34d399' : '#059669')
                    : (isDarkMode ? '#f87171' : '#dc2626');
                shift = `<span style="font-family:var(--mono);font-size:8px;color:${sc}">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}</span>`;
            }
        }

        html += `<div style="margin-bottom:6px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
                <span style="font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.3px">${label}</span>
                <span style="font-family:var(--mono);font-size:10px;font-weight:600;color:${color}">${pct.toFixed(1)}% ${shift}</span>
            </div>
            <div style="height:4px;background:var(--input-bg);border-radius:2px;overflow:hidden">
                <div style="height:100%;width:${pct}%;background:${color};border-radius:2px;transition:width 0.3s"></div>
            </div>
        </div>`;
    }

    html += `<div style="font-size:7px;color:var(--text-dim);font-family:var(--mono);margin-top:6px;text-align:right">SOURCE: CME OPEC WATCH (OPTIONS-IMPLIED)</div>`;

    container.innerHTML = html;
}
