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

    setTimeout(() => {
        if (tab === 'markets') {
            Plotly.Plots.resize('term-structure-chart');
            Plotly.Plots.resize('timespread-chart');
            Plotly.Plots.resize('spread-monitor-chart');
        } else if (tab === 'physical') {
            Plotly.Plots.resize('inventory-chart');
            try { Plotly.Plots.resize('opec-watch-chart'); } catch(e) {}
        } else if (tab === 'geopolitics') {
            try { Plotly.Plots.resize('pm-term-chart'); } catch(e) {}
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

    Plotly.newPlot('term-structure-chart', [], { ...emptyLayout }, CHART_CONFIG);
    Plotly.newPlot('timespread-chart', [], { ...emptyLayout }, CHART_CONFIG);
    Plotly.newPlot('spread-monitor-chart', [], { ...emptyLayout }, CHART_CONFIG);

    // Show loading
    showChartLoading('term-structure-chart');
    renderSpotPrices(false);

    // Load market data
    await loadMarketData();

    // Populate dropdowns (only commodities that have data)
    const tsCompareCommodity = document.getElementById('ts-compare-commodity');
    const tsSpreadCommodity = document.getElementById('ts-spread-commodity');

    for (const [name] of Object.entries(ENERGY_COMMODITIES)) {
        if (liveSpots[name] != null) {
            // Compare commodity dropdown: only if we have term structure data
            if (marketData?.termStructures?.[name]) {
                tsCompareCommodity.appendChild(new Option(name, name));
            }
            // Timespread dropdown: only if we have timespread data
            if (TIMESPREAD_DEFINITIONS[name]) {
                tsSpreadCommodity.appendChild(new Option(name, name));
            }
        }
    }

    tsSpreadCommodity.addEventListener('change', populateTimespreads);
    document.getElementById('spread-category').addEventListener('change', populateSpreads);

    populateTimespreads();
    populateSpreads();

    // Set date input default
    const dateInput = document.getElementById('ts-compare-date');
    if (dateInput) {
        const today = new Date().toISOString().slice(0, 10);
        const twoYearsAgo = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10);
        dateInput.max = today;
        dateInput.min = twoYearsAgo;
        dateInput.value = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    }

    // Render everything — no term structure by default (user clicks a commodity)
    renderSpotPrices(true);
    renderSpreadDashboard();
    updateTermStructure();  // shows empty "Select a commodity" message

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
    selectedCommodity = name;
    renderSpotPrices(true);
    updateTermStructure();
}

function renderSpotPrices(loaded) {
    const container = document.getElementById('spot-prices-table');
    let html = '';

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
        const isSelected = selectedCommodity === name;

        html += `
            <div class="spot-row${isSelected ? ' spot-row-active' : ''}" onclick="selectCommodity('${name}')" style="cursor:pointer">
                <div class="spot-name" style="border-left: 3px solid ${color}; padding-left: 8px">
                    ${shortName}
                </div>
                <div class="spot-val">
                    <span class="spot-price">${loaded ? price.toFixed(decimals) : '...'}</span>
                    <span class="spot-unit">${cfg.unit}</span>
                </div>
            </div>`;
    }

    if (loaded && !html) {
        html = '<div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">No data. Run: python scripts/fetch_market_data.py</div>';
    }

    container.innerHTML = html;
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

        html += `
            <div class="spread-row" onclick="selectSpread('${name}')" title="${def.description}">
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

function selectSpread(name) {
    document.getElementById('spread-select').value = name;
    updateSpreadChart();
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

    // Prevent duplicates
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
    const category = document.getElementById('spread-category').value;
    const select = document.getElementById('spread-select');
    select.innerHTML = '';
    for (const [name, def] of Object.entries(SPREAD_DEFINITIONS)) {
        if (category !== 'all' && def.category !== category) continue;
        select.appendChild(new Option(name, name));
    }
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
}
