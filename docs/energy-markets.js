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
            try { Plotly.Plots.resize('timespread-chart'); } catch(e) {}
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

// ─── Overview Sector Switching ──────────────────────────────────────────────

let currentSector = 'oil';

function sectorCommodities() {
    const cfg = MARKET_SECTORS[currentSector];
    return (cfg?.commodities || []).filter(name => liveSpots[name] != null);
}

function switchOverviewSector(sector) {
    if (!MARKET_SECTORS[sector]) return;
    currentSector = sector;

    document.querySelectorAll('.ov-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sector === sector);
    });

    // Reset selection to the sector's default commodity
    const cfg = MARKET_SECTORS[sector];
    selectedSpreadForEvolution = null;
    spotEvoSelected.clear();
    tsComparisons = [];
    renderComparisonTags();

    const def = liveSpots[cfg.defaultCommodity] != null
        ? cfg.defaultCommodity
        : sectorCommodities()[0] || null;
    if (def) {
        selectedCommodity = def;
        spotEvoSelected.add(def);
    } else {
        selectedCommodity = null;
    }

    // OPEC panel only makes sense for oil
    const opecPanel = document.getElementById('overview-opec-panel');
    if (opecPanel) opecPanel.style.display = cfg.showOpec ? '' : 'none';

    // Re-populate sector-aware dropdowns
    populateSectorDropdowns();

    // Re-render everything
    renderTickerStrip();
    renderSpotPrices(true);
    renderSpreadDashboard();
    renderSeasonalOverview();
    renderSectorBriefing();
    renderOverviewNews();
    updateTermStructure();
    updateSpotEvolution();
    renderSpotEvolutionInfo();
    if (document.getElementById('ts-spread-select').options.length > 0) {
        updateTimespread();
    } else {
        showChartEmpty('timespread-chart', 'No futures timespread data for this sector');
        document.getElementById('timespread-subtitle').textContent = 'NO DATA';
    }

    setTimeout(() => {
        try { Plotly.Plots.resize('spot-evo-chart'); } catch(e) {}
        try { Plotly.Plots.resize('term-structure-chart'); } catch(e) {}
        try { Plotly.Plots.resize('timespread-chart'); } catch(e) {}
    }, 50);
}

function populateSectorDropdowns() {
    const cfg = MARKET_SECTORS[currentSector];

    // Term structure overlay dropdown: any commodity with curve data
    const tsCompare = document.getElementById('ts-compare-commodity');
    if (tsCompare) {
        tsCompare.innerHTML = '<option value="">+ Overlay</option>';
        for (const [name] of Object.entries(ENERGY_COMMODITIES)) {
            if (liveSpots[name] != null && marketData?.termStructures?.[name]) {
                tsCompare.appendChild(new Option(name, name));
            }
        }
    }

    // Timespread commodity dropdown: sector commodities with timespread data
    const tsSpread = document.getElementById('ts-spread-commodity');
    if (tsSpread) {
        tsSpread.innerHTML = '';
        for (const name of cfg.commodities) {
            if (liveSpots[name] != null && TIMESPREAD_DEFINITIONS[name]) {
                tsSpread.appendChild(new Option(name, name));
            }
        }
        populateTimespreads();
    }
}

// ─── Ticker Strip ──────────────────────────────────────────────────────────

function renderTickerStrip() {
    const container = document.getElementById('ticker-strip');
    if (!container) return;
    let html = '';

    for (const [name, cfg] of Object.entries(ENERGY_COMMODITIES)) {
        const price = liveSpots[name];
        if (price == null) continue;
        const shortName = name
            .replace('WTI Crude Oil (CL)', 'WTI')
            .replace('Brent Crude Oil (BZ)', 'BRENT')
            .replace('Henry Hub Nat Gas (NG)', 'HH GAS')
            .replace('TTF Natural Gas', 'TTF')
            .replace('RBOB Gasoline (RB)', 'RBOB')
            .replace('Heating Oil (HO)', 'HO')
            .replace('ICE Gasoil (GO)', 'GASOIL')
            .replace('EU Carbon EUA (CO2)', 'EUA')
            .replace('German Power (DE)', 'DE PWR');

        const chg1d = _getChange(cfg.continuous, 1);
        const decimals = price < 10 ? 3 : 2;
        const chgStr = chg1d != null ? `${chg1d >= 0 ? '+' : ''}${chg1d.toFixed(2)}%` : '';
        const chgColor = chg1d == null ? 'var(--text-dim)'
            : chg1d >= 0 ? (isDarkMode ? '#34d399' : '#059669')
            : (isDarkMode ? '#f87171' : '#dc2626');
        const isActive = selectedCommodity === name;
        const borderColor = isDarkMode ? cfg.colorDark : cfg.color;

        html += `<div class="ticker-card${isActive ? ' active' : ''}" onclick="selectCommodity('${name}')" style="border-bottom:2px solid ${isActive ? borderColor : 'transparent'}">
            <span class="ticker-name">${shortName}</span>
            <span class="ticker-price">${price.toFixed(decimals)}</span>
            <span class="ticker-change" style="color:${chgColor}">${chgStr}</span>
        </div>`;
    }

    if (marketData?.indices) {
        html += `<div style="border-left:2px solid var(--panel-border);margin-left:4px"></div>`;
        for (const [sym, info] of Object.entries(MARKET_INDICES)) {
            const data = marketData.indices[sym];
            if (!data) continue;
            const p = data.price;
            const decimals = p > 1000 ? 0 : 2;
            const chg = data.chg1d;
            const chgStr = chg != null ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '';
            const chgColor = chg == null ? 'var(--text-dim)'
                : chg >= 0 ? (isDarkMode ? '#34d399' : '#059669')
                : (isDarkMode ? '#f87171' : '#dc2626');
            html += `<div class="ticker-card" style="opacity:0.8">
                <span class="ticker-name">${info.label.replace('Energy ETF', 'ETF').replace('Oil & Gas E&P', 'E&P').replace('Dollar Index', 'DXY').replace('Oil Fund', 'USO')}</span>
                <span class="ticker-price" style="font-size:12px">${p.toFixed(decimals)}</span>
                <span class="ticker-change" style="color:${chgColor}">${chgStr}</span>
            </div>`;
        }
    }

    container.innerHTML = html;
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
    Plotly.newPlot('timespread-chart', [], { ...emptyLayout }, CHART_CONFIG);

    // Show loading
    showChartLoading('term-structure-chart');
    showChartEmpty('spot-evo-chart', 'Select a commodity');
    renderSpotPrices(false);

    // Load market data
    await loadMarketData();

    // Sector-aware dropdowns
    populateSectorDropdowns();

    // Draw initial temporal spread chart now that dropdowns are filled
    if (document.getElementById('ts-spread-select').options.length > 0) {
        updateTimespread();
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

    // Default: the current sector's lead commodity
    const sectorCfg = MARKET_SECTORS[currentSector];
    const defaultCommodity = liveSpots[sectorCfg.defaultCommodity] != null
        ? sectorCfg.defaultCommodity
        : sectorCommodities()[0] || null;
    if (defaultCommodity) {
        selectedCommodity = defaultCommodity;
        spotEvoSelected.add(defaultCommodity);
    }

    // Render everything
    renderTickerStrip();
    renderSpotPrices(true);
    renderSpreadDashboard();
    renderSeasonalOverview();
    renderSectorBriefing();
    updateTermStructure();
    updateSpotEvolution();
    renderSpotEvolutionInfo();

    // News feed (sector-filtered)
    await loadAndRenderNews('physical', 'overview-news-feed');
    renderOverviewNews();

    // OPEC Watch in right sidebar
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

let selectedCommodity = null;  // currently selected commodity for term structure

function selectCommodity(name) {
    // Clicking a ticker that belongs to another sector jumps to that sector
    const home = Object.keys(MARKET_SECTORS)
        .find(s => MARKET_SECTORS[s].commodities.includes(name));
    if (home && home !== currentSector) {
        switchOverviewSector(home);
        if (selectedCommodity === name) return;
        spotEvoSelected.clear();
    }

    selectedSpreadForEvolution = null;
    selectedCommodity = name;
    if (spotEvoSelected.has(name)) {
        if (spotEvoSelected.size > 1) {
            spotEvoSelected.delete(name);
            selectedCommodity = [...spotEvoSelected][spotEvoSelected.size - 1] || name;
        }
    } else {
        spotEvoSelected.add(name);
    }
    renderTickerStrip();
    renderSpotPrices(true);
    renderSpreadDashboard();
    renderSectorBriefing();
    updateTermStructure();
    updateSpotEvolution();
    renderSpotEvolutionInfo();
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

    const sectorList = MARKET_SECTORS[currentSector]?.commodities || Object.keys(ENERGY_COMMODITIES);
    for (const name of sectorList) {
        const cfg = ENERGY_COMMODITIES[name];
        if (!cfg) continue;
        const price = liveSpots[name];
        if (loaded && price == null) continue;

        const shortName = name
            .replace('WTI Crude Oil (CL)', 'WTI Crude')
            .replace('Brent Crude Oil (BZ)', 'Brent Crude')
            .replace('Henry Hub Nat Gas (NG)', 'HH Nat Gas')
            .replace('TTF Natural Gas', 'TTF Gas')
            .replace('RBOB Gasoline (RB)', 'RBOB Gasoline')
            .replace('Heating Oil (HO)', 'Heating Oil')
            .replace('ICE Gasoil (GO)', 'ICE Gasoil')
            .replace('EU Carbon EUA (CO2)', 'EU Carbon EUA')
            .replace('German Power (DE)', 'German Power');
        const color = isDarkMode ? cfg.colorDark : cfg.color;
        const decimals = price != null && price < 10 ? 3 : 2;
        const isSelected = spotEvoSelected.has(name);
        const chg1d = loaded ? _getChange(cfg.continuous, 1) : null;
        const chgYtd = loaded ? _getYtdChange(cfg.continuous) : null;

        html += `
            <div class="spot-row${isSelected ? ' spot-row-active' : ''}" onclick="selectCommodity('${name}')" style="cursor:pointer">
                <div class="spot-name" style="border-left: 3px solid ${color}; padding-left: 8px">
                    ${shortName}
                </div>
                <div class="spot-val" style="display:flex;align-items:center;gap:8px">
                    <span class="spot-price">${loaded ? price.toFixed(decimals) : '...'}</span>
                    <span class="spot-unit">${cfg.unit}</span>
                    ${_fmtChange(chg1d)}
                    ${_fmtChange(chgYtd)}
                </div>
            </div>`;
    }

    // Market indices separator (oil sector only — saves space elsewhere)
    if (loaded && marketData?.indices && MARKET_SECTORS[currentSector]?.showIndices) {
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
let selectedSpreadForEvolution = null;

function toggleSpotEvoCommodity(name) {
    selectedSpreadForEvolution = null;
    if (spotEvoSelected.has(name)) {
        spotEvoSelected.delete(name);
    } else {
        spotEvoSelected.add(name);
    }
    renderSpotEvoChips();
    renderSpotPrices(true);
    renderSpreadDashboard();
    updateSpotEvolution();
    renderSpotEvolutionInfo();
}

function renderSpotEvoChips() {
    // Selection now lives directly in the Spot Prices table.
}

function setSpotEvoPeriod(period) {
    spotEvoPeriod = period;
    document.querySelectorAll('#spot-evo-periods .btn-xs').forEach(btn => {
        btn.classList.toggle('active', btn.textContent.trim() === period);
    });
    updateSpotEvolution();
    renderSpotEvolutionInfo();
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
    if (selectedSpreadForEvolution) {
        updateSpreadEvolutionChart(selectedSpreadForEvolution);
        return;
    }

    if (spotEvoSelected.size === 0) {
        showChartEmpty('spot-evo-chart', 'Select commodities on the left');
        renderSpotEvolutionInfo();
        return;
    }
    if (!marketData?.history) {
        showChartEmpty('spot-evo-chart', 'No data');
        renderSpotEvolutionInfo();
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
            // Normalize to % change for comparison
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
            const yMin = prices.reduce((a, b) => a < b ? a : b, prices[0]);
            traces.push({
                x: dates, y: dates.map(() => yMin),
                type: 'scatter', mode: 'lines',
                line: { width: 0, color: 'transparent' },
                showlegend: false, hoverinfo: 'skip',
            });
            traces.push({
                x: dates,
                y: prices,
                type: 'scatter',
                mode: 'lines',
                name: shortName,
                line: { color, width: 2 },
                fill: 'tonexty',
                fillcolor: color + '15',
            });
        }
    }

    if (traces.length === 0) {
        showChartEmpty('spot-evo-chart', 'No price history available');
        return;
    }

    // Subtitle
    const subtitle = document.getElementById('spot-evo-subtitle');
    const names = [...spotEvoSelected].map(n => n.replace(/ \(.*/, '').toUpperCase());
    if (subtitle) subtitle.textContent = names.join(' vs ') + ' // ' + spotEvoPeriod;

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
    renderSpotEvolutionInfo();
}

function updateSpreadEvolutionChart(spreadKey) {
    const cc = getChartColors();
    const nDays = _getPeriodDays(spotEvoPeriod);
    const def = SPREAD_DEFINITIONS[spreadKey];
    const data = getSpreadHistory(spreadKey, nDays);
    const subtitle = document.getElementById('spot-evo-subtitle');

    if (!data || !def) {
        showChartEmpty('spot-evo-chart', `No data for ${spreadKey}`);
        if (subtitle) subtitle.textContent = 'SPREAD // NO DATA';
        renderSpotEvolutionInfo();
        return;
    }

    if (subtitle) subtitle.textContent = `${spreadKey.toUpperCase()} // ${spotEvoPeriod}`;

    const vals = data.values;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const current = vals[vals.length - 1];
    const traces = [
        {
            x: data.dates, y: vals,
            type: 'scatter', mode: 'lines', name: spreadKey,
            line: { color: isDarkMode ? '#a78bfa' : '#7c3aed', width: 2.5 },
            fill: 'tozeroy',
            fillcolor: isDarkMode ? 'rgba(167,139,250,0.08)' : 'rgba(124,58,237,0.06)',
        },
        {
            x: [data.dates[0], data.dates[data.dates.length - 1]], y: [mean, mean],
            type: 'scatter', mode: 'lines', name: `Mean (${mean.toFixed(2)})`,
            line: { color: isDarkMode ? '#fbbf24' : '#d97706', width: 1.5, dash: 'dash' },
        },
    ];

    const layout = {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        margin: { l: 55, r: 30, t: 10, b: 40 },
        xaxis: { gridcolor: cc.grid, zerolinecolor: cc.zero, tickfont: { size: 9, color: cc.muted } },
        yaxis: {
            gridcolor: cc.grid, zerolinecolor: cc.zero, tickfont: { size: 9, color: cc.muted },
            title: { text: def.unit, font: { size: 10, color: cc.muted } },
        },
        showlegend: true,
        legend: { x: 0, y: 1, font: { size: 9, color: cc.muted }, bgcolor: 'transparent' },
        hovermode: 'x unified',
        annotations: [{
            x: 0.01, y: 0.98, xref: 'paper', yref: 'paper',
            text: `Current: <b>${current.toFixed(2)}</b> ${def.unit}`,
            showarrow: false,
            font: { size: 10, color: cc.muted, family: 'JetBrains Mono, monospace' },
            bgcolor: cc.bg, borderpad: 4,
        }],
    };

    Plotly.react('spot-evo-chart', traces, layout, CHART_CONFIG);
    renderSpotEvolutionInfo();
}

function _shortCommodityName(name) {
    return name
        .replace('WTI Crude Oil (CL)', 'WTI')
        .replace('Brent Crude Oil (BZ)', 'Brent')
        .replace('Henry Hub Nat Gas (NG)', 'HH')
        .replace('TTF Natural Gas', 'TTF')
        .replace('RBOB Gasoline (RB)', 'RBOB')
        .replace('Heating Oil (HO)', 'HO')
        .replace('ICE Gasoil (GO)', 'GO')
        .replace(/ \(.*/, '');
}

function _fmtSignedValue(v, suffix = '%') {
    if (v == null || Number.isNaN(v)) return '<span style="color:var(--text-dim)">—</span>';
    const color = v >= 0
        ? (isDarkMode ? '#34d399' : '#059669')
        : (isDarkMode ? '#f87171' : '#dc2626');
    const sign = v >= 0 ? '+' : '';
    return `<span style="color:${color}">${sign}${v.toFixed(2)}${suffix}</span>`;
}

function _historyStats(sym, lookback = 252) {
    const hist = marketData?.history?.[sym];
    if (!hist?.close?.length) return null;
    const values = hist.close.slice(Math.max(0, hist.close.length - lookback)).filter(v => v != null);
    if (values.length < 2) return null;
    const latest = values[values.length - 1];
    const returns = [];
    for (let i = 1; i < values.length; i++) {
        if (values[i - 1]) returns.push((values[i] / values[i - 1]) - 1);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (returns.length || 1);
    return {
        latest,
        high: Math.max(...values),
        low: Math.min(...values),
        vol: Math.sqrt(variance) * Math.sqrt(252) * 100,
    };
}

function _statRow(label, valueHtml) {
    return `<div class="overview-stat-row"><span>${label}</span><span>${valueHtml}</span></div>`;
}

function _renderCommodityStats(name) {
    const cfg = ENERGY_COMMODITIES[name];
    if (!cfg) return '<div style="color:var(--text-dim);font-size:11px">No commodity selected</div>';
    const stats = _historyStats(cfg.continuous);
    const price = liveSpots[name] ?? stats?.latest;
    const decimals = price != null && price < 10 ? 3 : 2;
    const priceHtml = price != null ? `${price.toFixed(decimals)}` : '—';

    return `
        <div class="overview-stat-title">${_shortCommodityName(name)}</div>
        ${_statRow('Price', priceHtml)}
        ${_statRow('1W', _fmtSignedValue(_getChange(cfg.continuous, 5)))}
        ${_statRow('1M', _fmtSignedValue(_getChange(cfg.continuous, 21)))}
        ${_statRow('3M', _fmtSignedValue(_getChange(cfg.continuous, 63)))}
        ${_statRow('YTD', _fmtSignedValue(_getYtdChange(cfg.continuous)))}
        ${_statRow('1Y', _fmtSignedValue(_getChange(cfg.continuous, 252)))}
        ${_statRow('Vol (ann.)', stats ? `${stats.vol.toFixed(1)}%` : '—')}
        ${_statRow('52w High', stats ? stats.high.toFixed(decimals) : '—')}
        ${_statRow('52w Low', stats ? stats.low.toFixed(decimals) : '—')}
    `;
}

function _renderSpreadStats(spreadKey) {
    const data = getSpreadHistory(spreadKey, 252);
    const def = SPREAD_DEFINITIONS[spreadKey];
    if (!data || !def) return '<div style="color:var(--text-dim);font-size:11px">No spread selected</div>';
    const vals = data.values;
    const current = vals[vals.length - 1];
    const delta = days => vals.length > days ? current - vals[vals.length - days - 1] : null;
    return `
        <div class="overview-stat-title">${spreadKey}</div>
        ${_statRow('Current', `${current.toFixed(2)} ${def.unit}`)}
        ${_statRow('1W Δ', _fmtSignedValue(delta(5), ''))}
        ${_statRow('1M Δ', _fmtSignedValue(delta(21), ''))}
        ${_statRow('3M Δ', _fmtSignedValue(delta(63), ''))}
        ${_statRow('1Y Δ', _fmtSignedValue(delta(252), ''))}
        ${_statRow('52w High', Math.max(...vals).toFixed(2))}
        ${_statRow('52w Low', Math.min(...vals).toFixed(2))}
    `;
}

function _returnsByDate(name, nDays) {
    const cfg = ENERGY_COMMODITIES[name];
    const hist = cfg ? marketData?.history?.[cfg.continuous] : null;
    if (!hist?.dates?.length || !hist.close?.length) return {};
    const start = Math.max(1, hist.dates.length - nDays);
    const out = {};
    for (let i = start; i < hist.dates.length; i++) {
        const prev = hist.close[i - 1];
        const curr = hist.close[i];
        if (prev && curr != null) out[hist.dates[i]] = (curr / prev) - 1;
    }
    return out;
}

function _corr(a, b) {
    const dates = Object.keys(a).filter(d => b[d] != null);
    if (dates.length < 5) return null;
    const xs = dates.map(d => a[d]);
    const ys = dates.map(d => b[d]);
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let cov = 0, vx = 0, vy = 0;
    for (let i = 0; i < xs.length; i++) {
        const dx = xs[i] - mx;
        const dy = ys[i] - my;
        cov += dx * dy;
        vx += dx * dx;
        vy += dy * dy;
    }
    return vx && vy ? cov / Math.sqrt(vx * vy) : null;
}

function _renderCorrelationPanel(names) {
    const periods = [
        ['1M', 21],
        ['3M', 63],
        ['6M', 126],
        ['1Y', 252],
    ];
    const displayNames = names.map(_shortCommodityName);

    let html = '<div class="overview-stat-title">Correlation</div>';
    for (const [label, days] of periods) {
        const maps = names.map(n => _returnsByDate(n, days));
        html += `<div class="corr-block"><div class="corr-label">${label}</div><table class="corr-table"><thead><tr><th></th>`;
        for (const n of displayNames) html += `<th>${n}</th>`;
        html += '</tr></thead><tbody>';
        for (let i = 0; i < names.length; i++) {
            html += `<tr><th>${displayNames[i]}</th>`;
            for (let j = 0; j < names.length; j++) {
                if (i === j) {
                    html += '<td class="corr-self">1.00</td>';
                } else {
                    const c = _corr(maps[i], maps[j]);
                    const color = c != null && c >= 0.7
                        ? (isDarkMode ? '#34d399' : '#059669')
                        : c != null && c >= 0.4
                            ? (isDarkMode ? '#fbbf24' : '#d97706')
                            : (isDarkMode ? '#60a5fa' : '#003061');
                    html += `<td style="color:${color}">${c == null ? '—' : c.toFixed(2)}</td>`;
                }
            }
            html += '</tr>';
        }
        html += '</tbody></table></div>';
    }
    return html;
}

function renderSpotEvolutionInfo() {
    const title = document.getElementById('spot-evo-info-title');
    const container = document.getElementById('spot-evo-info');
    if (!container) return;

    if (selectedSpreadForEvolution) {
        if (title) title.textContent = 'SPREAD SNAPSHOT';
        container.innerHTML = _renderSpreadStats(selectedSpreadForEvolution);
        return;
    }

    const selected = [...spotEvoSelected];
    if (selected.length === 0) {
        if (title) title.textContent = 'MARKET SNAPSHOT';
        container.innerHTML = '<div style="color:var(--text-dim);font-size:11px">Select a spot row to populate the chart.</div>';
    } else if (selected.length === 1) {
        if (title) title.textContent = 'MARKET SNAPSHOT';
        container.innerHTML = _renderCommodityStats(selected[0]);
    } else {
        if (title) title.textContent = 'CORRELATION';
        container.innerHTML = _renderCorrelationPanel(selected.slice(0, 5));
    }
}

// ─── Spread Dashboard ───────────────────────────────────────────────────────

function renderSpreadDashboard() {
    const container = document.getElementById('spread-dashboard');
    const wrap = document.getElementById('spread-dashboard-wrap');
    const allowedCats = MARKET_SECTORS[currentSector]?.spreadCategories || null;
    let html = '';
    let lastCategory = '';

    for (const [name, def] of Object.entries(SPREAD_DEFINITIONS)) {
        if (allowedCats && !allowedCats.includes(def.category)) continue;
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

        const isSpreadSelected = selectedSpreadForEvolution === name;

        html += `
            <div class="spread-row${isSpreadSelected ? ' spread-row-active' : ''}" onclick="selectSpread('${name}')" title="${def.description}">
                <div class="spread-name">${shortName}</div>
                <div class="spread-val" style="color:${valColor}">${val >= 0 ? '+' : ''}${val.toFixed(2)}</div>
                <div class="spread-unit">${def.unit}</div>
            </div>`;
    }

    // Hide the whole block when the sector has no computable spreads
    if (wrap) wrap.style.display = html ? '' : 'none';
    container.innerHTML = html;
}

function selectSpread(name) {
    selectedSpreadForEvolution = name;
    spotEvoSelected.clear();
    renderSpotPrices(true);
    renderSpreadDashboard();
    updateSpotEvolution();
    renderSpotEvolutionInfo();
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

function onTimespreadCommodityChange() {
    populateTimespreads();
    updateTimespread();
}

// ─── Re-render on theme change ──────────────────────────────────────────────

function refreshEnergyMarkets() {
    if (!marketsInitialized) return;
    renderTickerStrip();
    renderSpotPrices(true);
    renderSpotEvoChips();
    renderSpreadDashboard();
    renderSeasonalOverview();
    renderSectorBriefing();
    updateTermStructure();
    updateSpotEvolution();
    renderSpotEvolutionInfo();
    renderOverviewNews();
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

// ─── Sector Briefing (AI + computed recap) ─────────────────────────────────

let briefingData = null;       // loaded from data/daily-briefing.json
let briefingLoadAttempted = false;

function _computeMA(close, n) {
    if (close.length < n) return null;
    const slice = close.slice(-n);
    return slice.reduce((a, b) => a + b, 0) / n;
}

function _computeRealizedVol(close, n) {
    if (close.length < n + 1) return null;
    const returns = [];
    for (let i = close.length - n; i < close.length; i++) {
        if (close[i - 1] > 0) returns.push(Math.log(close[i] / close[i - 1]));
    }
    if (returns.length < 5) return null;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function _pctChange(arr, nDays) {
    if (!arr || arr.length < nDays + 1) return null;
    const current = arr[arr.length - 1];
    const prev = arr[arr.length - 1 - nDays];
    if (!prev) return null;
    return ((current - prev) / prev) * 100;
}

async function renderSectorBriefing() {
    const container = document.getElementById('overview-briefing');
    if (!container) return;

    // Load the AI briefing JSON once
    if (!briefingLoadAttempted) {
        briefingLoadAttempted = true;
        try {
            const resp = await fetch('data/daily-briefing.json');
            if (resp.ok) briefingData = await resp.json();
        } catch (e) { /* file absent — show setup notice */ }
    }

    let html = '';

    // ── AI summary block (from real news + prices via Claude in CI) ──
    const sec = briefingData?.sectors?.[currentSector];
    if (sec?.summary) {
        const gen = briefingData.generated ? new Date(briefingData.generated) : null;
        html += `<div class="briefing-recap" style="font-size:11.5px;line-height:1.6">${sec.summary}</div>`;
        if (Array.isArray(sec.drivers) && sec.drivers.length) {
            html += '<div style="margin-top:8px">';
            for (const d of sec.drivers) {
                html += `<div style="display:flex;gap:6px;font-size:10.5px;color:var(--text-muted);padding:2px 0">
                    <span style="color:var(--accent)">▸</span><span>${d}</span></div>`;
            }
            html += '</div>';
        }
        const srcs = (sec.sources || []).join(', ');
        html += `<div style="font-size:7.5px;color:var(--text-dim);font-family:var(--mono);margin-top:8px;line-height:1.5">
            ${gen ? `GENERATED ${_timeAgo(gen).toUpperCase()} · ` : ''}${briefingData.model || 'CLAUDE'} ·
            BASED ON ${sec.headlineCount || '?'} HEADLINES${srcs ? ` (${srcs})` : ''}</div>`;
    } else {
        html += `<div style="font-size:10.5px;color:var(--text-dim);line-height:1.6;padding:4px 0">
            AI briefing not yet generated.<br>
            Add an <span style="font-family:var(--mono);color:var(--text-muted)">ANTHROPIC_API_KEY</span>
            secret to the GitHub Actions workflow to enable a daily news-based
            summary written by Claude from the day's real headlines.</div>`;
    }

    // ── Computed session recap (always available, 100% from price data) ──
    const lead = selectedCommodity || MARKET_SECTORS[currentSector]?.defaultCommodity;
    const cfg = ENERGY_COMMODITIES[lead];
    const hist = cfg ? marketData?.history?.[cfg.continuous] : null;
    if (cfg && hist?.close?.length >= 10) {
        const close = hist.close;
        const last = close[close.length - 1];
        const decimals = last < 10 ? 4 : 2;
        const s = {
            last, decimals,
            chg1d: _pctChange(close, 1),
            chg1w: _pctChange(close, 5),
            chg1m: _pctChange(close, 21),
            ma50: _computeMA(close, 50),
            ma200: _computeMA(close, 200),
            rvol10: _computeRealizedVol(close, 10),
            rvol30: _computeRealizedVol(close, 30),
            high52w: Math.max(...close.slice(-252)),
            low52w: Math.min(...close.slice(-252)),
        };
        html += `<div style="border-top:1px solid var(--input-border);margin-top:10px;padding-top:8px">
            <div class="lbl lbl-sm" style="margin-bottom:6px">SESSION RECAP — ${lead.replace(/ \(.*/, '').toUpperCase()}</div>
            <div class="briefing-recap" style="font-size:10.5px;line-height:1.55">${_recapHtml(lead, cfg, s)}</div>
        </div>`;
    }

    container.innerHTML = html;
}

function _recapHtml(commodity, cfg, s) {
    const shortName = commodity.replace(/ \(.*/, '');
    const lines = [];

    if (s.chg1d != null) {
        const dir = s.chg1d >= 0 ? 'gaining' : 'declining';
        lines.push(`${shortName} closed at <b>${s.last.toFixed(s.decimals)} ${cfg.unit}</b>, ${dir} <b>${Math.abs(s.chg1d).toFixed(2)}%</b> on the session.`);
    }
    const parts = [];
    if (s.chg1w != null) parts.push(`${s.chg1w >= 0 ? '+' : ''}${s.chg1w.toFixed(1)}% on the week`);
    if (s.chg1m != null) parts.push(`${s.chg1m >= 0 ? '+' : ''}${s.chg1m.toFixed(1)}% on the month`);
    if (parts.length) lines.push(`It is ${parts.join(' and ')}.`);

    if (s.ma200 != null) {
        const above = s.last > s.ma200;
        const dist = Math.abs((s.last - s.ma200) / s.ma200 * 100);
        lines.push(`Price is ${dist.toFixed(1)}% ${above ? 'above' : 'below'} the 200-day MA — ${above ? 'bullish' : 'bearish'} medium-term trend.`);
    }
    if (s.high52w != null && s.low52w != null) {
        const range = s.high52w - s.low52w;
        const pos = range > 0 ? ((s.last - s.low52w) / range * 100).toFixed(0) : '50';
        lines.push(`Sitting at the <b>${pos}th percentile</b> of the 52-week range (${s.low52w.toFixed(s.decimals)} – ${s.high52w.toFixed(s.decimals)}).`);
    }
    if (s.rvol30 != null) {
        let volNote = '';
        if (s.rvol10 != null) {
            if (s.rvol10 > s.rvol30 * 1.2) volNote = ' — short-term vol elevated';
            else if (s.rvol10 < s.rvol30 * 0.8) volNote = ' — short-term vol compressed';
        }
        lines.push(`30-day realized vol: <b>${s.rvol30.toFixed(1)}%</b>${volNote}.`);
    }

    const tsDefs = TIMESPREAD_DEFINITIONS[commodity];
    if (tsDefs && marketData?.timespreads) {
        const front = tsDefs[0];
        const tsData = marketData.timespreads[front?.name];
        if (tsData?.values?.length) {
            const cur = tsData.values[tsData.values.length - 1];
            lines.push(`Front spread (${front.name}): <b>${cur >= 0 ? '+' : ''}${cur.toFixed(s.decimals)}</b> — <b>${cur > 0 ? 'backwardation' : 'contango'}</b>.`);
        }
    }

    return lines.map(l => `<p style="margin-bottom:5px">${l}</p>`).join('');
}

// ─── Sector-filtered News ───────────────────────────────────────────────────

const SECTOR_NEWS_KEYWORDS = {
    gas: ['gas', 'lng', 'ttf', 'henry hub', 'storage', 'pipeline', 'freeport',
          'methane', 'gazprom', 'injection', 'withdrawal', 'nord stream'],
    power: ['power', 'electricity', 'carbon', 'eua', 'ets', 'emission', 'renewable',
            'solar', 'wind', 'nuclear', 'grid', 'utility', 'baseload', 'mwh'],
};

function renderOverviewNews() {
    const container = document.getElementById('overview-news-feed');
    if (!container || typeof newsData === 'undefined' || !newsData) return;

    const kws = SECTOR_NEWS_KEYWORDS[currentSector];
    if (!kws) {
        // Oil: default feed (most articles are oil-centric anyway)
        renderNewsFeed('physical', 'overview-news-feed');
        return;
    }

    const all = [...(newsData.physical || []), ...(newsData.geopolitics || [])];
    const matches = all.filter(a => {
        const text = ((a.title || '') + ' ' + (a.summary || '')).toLowerCase();
        return kws.some(kw => text.includes(kw));
    });

    // Fall back to the full feed when too few sector hits
    const articles = matches.length >= 3 ? matches : (newsData.physical || []);

    let html = '';
    for (const a of articles.slice(0, 12)) {
        const timeAgo = formatTimeAgo(a.published);
        const sourceTag = a.source ? getSourceTag(a.source) : '';
        const sentimentBadge = getSentimentBadge(a.sentiment);
        html += `<div class="news-item">
            <div class="news-header">${sourceTag}${sentimentBadge}<span class="news-time">${timeAgo}</span></div>
            <div class="news-title">${a.title}</div>
            <div class="news-summary">${a.summary || ''}</div>
            <a href="${a.url}" target="_blank" rel="noopener" class="news-link">READ ARTICLE &rarr;</a>
        </div>`;
    }
    if (!html) html = '<div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">No sector news</div>';
    container.innerHTML = html;
}

// ─── Seasonal Pattern (sector-aware) ────────────────────────────────────────

const SECTOR_SEASONS = {
    oil: [
        { name: 'Refinery Maintenance', months: [2, 3], desc: 'Spring turnaround — lower runs, crude builds', color: '#d97706' },
        { name: 'Summer Driving Season', months: [4, 5, 6, 7], desc: 'Peak gasoline demand — draws accelerate', color: '#dc2626' },
        { name: 'Hurricane Season', months: [5, 6, 7, 8, 9, 10], desc: 'Gulf supply risk — Jun-Nov', color: '#7c3aed' },
        { name: 'Winter Heating', months: [10, 11, 0, 1], desc: 'Peak distillate demand', color: '#003061' },
    ],
    gas: [
        { name: 'Injection Season', months: [3, 4, 5, 6, 7, 8, 9], desc: 'Apr-Oct — storage builds', color: '#059669' },
        { name: 'Withdrawal Season', months: [10, 11, 0, 1, 2], desc: 'Nov-Mar — storage draws', color: '#0891b2' },
        { name: 'Hurricane Season', months: [5, 6, 7, 8, 9, 10], desc: 'Gulf LNG export risk — Jun-Nov', color: '#7c3aed' },
        { name: 'Winter Heating', months: [10, 11, 0, 1], desc: 'Peak gas demand, TTF/HH volatility', color: '#003061' },
        { name: 'Summer Cooling', months: [5, 6, 7], desc: 'Power-burn demand for AC load', color: '#dc2626' },
    ],
    power: [
        { name: 'Winter Heating Demand', months: [10, 11, 0, 1], desc: 'Peak load + low solar — price spikes', color: '#003061' },
        { name: 'Summer Cooling Demand', months: [5, 6, 7], desc: 'AC load peaks, hydro/nuclear constraints', color: '#dc2626' },
        { name: 'EUA Compliance Cycle', months: [7, 8], desc: 'Surrender deadline Sep 30 — compliance buying', color: '#166534' },
        { name: 'Solar Peak Season', months: [4, 5, 6, 7], desc: 'Midday price depression, negative hours', color: '#d97706' },
        { name: 'Dunkelflaute Risk', months: [10, 11, 0], desc: 'Low wind + low solar — scarcity pricing', color: '#7c3aed' },
    ],
};

function renderSeasonalOverview() {
    const container = document.getElementById('overview-seasonal');
    if (!container) return;

    const month = new Date().getMonth();
    const seasons = SECTOR_SEASONS[currentSector] || SECTOR_SEASONS.oil;

    let html = '';
    for (const s of seasons) {
        const isActive = s.months.includes(month);
        const opacity = isActive ? '1' : '0.35';
        const activeColor = isDarkMode ? s.color + 'cc' : s.color;
        const indicator = isActive ? `<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${activeColor};margin-right:4px;animation:pulse 2s infinite"></span>` : '';
        html += `<div style="padding:4px 6px;opacity:${opacity};font-size:10px;${isActive ? `border-left:2px solid ${activeColor};` : ''}">
            <div style="color:${isActive ? activeColor : 'var(--text-muted)'};font-weight:${isActive ? '600' : '400'};font-size:10px">${indicator}${s.name}</div>
            <div style="color:var(--text-dim);font-size:9px;margin-top:1px">${s.desc}</div>
        </div>`;
    }
    container.innerHTML = html;
}
