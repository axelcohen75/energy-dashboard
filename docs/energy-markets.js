/**
 * Energy Markets — UI Controller
 *
 * Handles the Energy Markets tab: term structures, timespreads, and spread monitoring.
 * Uses Yahoo Finance for real data with synthetic fallback.
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

    setTimeout(() => {
        if (tab === 'markets') {
            Plotly.Plots.resize('term-structure-chart');
            Plotly.Plots.resize('timespread-chart');
            Plotly.Plots.resize('spread-monitor-chart');
        } else {
            Plotly.Plots.resize('payoff-chart');
            Plotly.Plots.resize('greeks-chart');
            Plotly.Plots.resize('surface-chart');
            Plotly.Plots.resize('theta-chart');
        }
    }, 50);
}

// ─── Loading State Helpers ──────────────────────────────────────────────────

function showChartLoading(chartId) {
    const el = document.getElementById(chartId);
    if (!el) return;
    const cc = getChartColors();
    Plotly.react(chartId, [], {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        xaxis: { visible: false }, yaxis: { visible: false },
        annotations: [{
            text: 'Loading data...',
            xref: 'paper', yref: 'paper', x: 0.5, y: 0.5,
            showarrow: false, font: { size: 13, color: cc.muted },
        }],
        margin: { l: 55, r: 30, t: 25, b: 40 },
    }, CHART_CONFIG);
}

function showSourceBadge(chartId, source) {
    // Update subtitle to show data source
    const subtitleMap = {
        'term-structure-chart': null, // no subtitle element for this one
        'timespread-chart': 'timespread-subtitle',
        'spread-monitor-chart': 'spread-subtitle',
    };
    // Source badge is shown via annotations in the chart itself
}

// ─── Energy Markets Init ────────────────────────────────────────────────────

function initEnergyMarkets() {
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

    // Populate commodity dropdowns
    const tsCommodity = document.getElementById('ts-commodity');
    const tsSpreadCommodity = document.getElementById('ts-spread-commodity');
    for (const name of Object.keys(ENERGY_COMMODITIES)) {
        tsCommodity.appendChild(new Option(name, name));
        tsSpreadCommodity.appendChild(new Option(name, name));
    }

    tsSpreadCommodity.addEventListener('change', populateTimespreads);
    document.getElementById('spread-category').addEventListener('change', populateSpreads);

    populateTimespreads();
    populateSpreads();

    // Fetch real spot prices then render everything
    fetchAndRenderSpots();
    updateTermStructure();
    updateTimespread();
    updateSpreadChart();
}

// ─── Spot Prices ────────────────────────────────────────────────────────────

async function fetchAndRenderSpots() {
    renderSpotPrices(false);
    try {
        await fetchAllSpotPrices();
    } catch { /* use defaults */ }
    renderSpotPrices(true);
    renderSpreadDashboard();
}

function renderSpotPrices(loaded) {
    const container = document.getElementById('spot-prices-table');
    let html = '';

    for (const [name, cfg] of Object.entries(ENERGY_COMMODITIES)) {
        const shortName = name.replace(/\s*\(.*\)/, '').replace('Henry Hub ', 'HH ').replace('German ', '');
        const color = isDarkMode ? cfg.colorDark : cfg.color;
        const hasYahoo = !!cfg.yahoo;
        const sourceTag = hasYahoo
            ? `<span class="source-tag source-live">LIVE</span>`
            : `<span class="source-tag source-synth">SYNTH</span>`;

        html += `
            <div class="spot-row">
                <div class="spot-name" style="border-left: 3px solid ${color}; padding-left: 8px">
                    ${shortName}
                </div>
                <div class="spot-price">${cfg.spot.toFixed(cfg.spot < 10 ? 2 : 1)}</div>
                <div class="spot-unit">${cfg.unit}</div>
                <div class="spot-source">${loaded ? sourceTag : '<span class="loading-dot">...</span>'}</div>
            </div>`;
    }

    container.innerHTML = html;
}

// ─── Spread Dashboard ───────────────────────────────────────────────────────

function renderSpreadDashboard() {
    const container = document.getElementById('spread-dashboard');
    let html = '';
    let lastCategory = '';

    for (const [name, def] of Object.entries(SPREAD_DEFINITIONS)) {
        if (def.category !== lastCategory) {
            html += `<div class="metric-section">${def.category}</div>`;
            lastCategory = def.category;
        }

        const val = computeSpreadValue(name);
        const isPositive = val >= 0;
        const valColor = isPositive
            ? (isDarkMode ? '#34d399' : '#059669')
            : (isDarkMode ? '#f87171' : '#dc2626');

        const shortName = name.replace(' Spread', '').replace('Gasoline Crack', 'Gas Crack').replace('Heating Oil Crack', 'HO Crack');

        html += `
            <div class="spread-row" onclick="selectSpread('${name}')" title="${def.description}">
                <div class="spread-name">${shortName}</div>
                <div class="spread-val" style="color:${valColor}">${val >= 0 ? '+' : ''}${val.toFixed(2)}</div>
                <div class="spread-unit">${def.unit}</div>
            </div>`;
    }

    container.innerHTML = html;
}

function selectSpread(name) {
    document.getElementById('spread-select').value = name;
    updateSpreadChart();
}

// ─── Term Structure ─────────────────────────────────────────────────────────

async function updateTermStructure() {
    const cc = getChartColors();
    const selected = document.getElementById('ts-commodity').value;
    const commodities = selected === 'all' ? Object.keys(ENERGY_COMMODITIES) : [selected];

    showChartLoading('term-structure-chart');

    const units = new Set();
    commodities.forEach(c => units.add(ENERGY_COMMODITIES[c].unit));
    const unitList = [...units];
    const multiUnit = unitList.length > 1;

    // Fetch all term structures in parallel
    const tsResults = await Promise.all(
        commodities.map(async (commodity, ci) => {
            try {
                return { commodity, ts: await fetchTermStructure(commodity) };
            } catch {
                return { commodity, ts: generateTermStructureSynthetic(commodity, 42 + ci) };
            }
        })
    );

    const traces = [];
    let hasLive = false;
    let hasSynth = false;

    for (const { commodity, ts } of tsResults) {
        if (!ts) continue;
        const cfg = ENERGY_COMMODITIES[commodity];
        const color = isDarkMode ? cfg.colorDark : cfg.color;
        const shortName = commodity.replace(/\s*\(.*\)/, '').replace('Henry Hub ', '').replace('German ', '');
        const yAxisIdx = multiUnit ? unitList.indexOf(cfg.unit) : 0;

        if (ts.source === 'yahoo') hasLive = true; else hasSynth = true;

        traces.push({
            x: ts.months, y: ts.prices,
            name: shortName,
            type: 'scatter', mode: 'lines+markers',
            line: { color, width: 2 }, marker: { size: 3, color },
            yaxis: yAxisIdx === 0 ? 'y' : 'y2',
            hovertemplate: `${shortName}<br>%{x}: %{y:.2f} ${cfg.unit}<extra></extra>`,
        });
    }

    const sourceText = hasLive && hasSynth ? 'YAHOO FINANCE + SYNTHETIC'
        : hasLive ? 'YAHOO FINANCE' : 'SYNTHETIC DATA';

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
            text: sourceText, showarrow: false,
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

// ─── Timespread Analysis ────────────────────────────────────────────────────

function populateTimespreads() {
    const commodity = document.getElementById('ts-spread-commodity').value;
    const select = document.getElementById('ts-spread-select');
    select.innerHTML = '';
    for (const s of (TIMESPREAD_DEFINITIONS[commodity] || [])) {
        select.appendChild(new Option(s.name, JSON.stringify(s)));
    }
}

async function updateTimespread() {
    const cc = getChartColors();
    const commodity = document.getElementById('ts-spread-commodity').value;
    const spreadStr = document.getElementById('ts-spread-select').value;
    const nDays = parseInt(document.getElementById('ts-spread-period').value) || 252;

    if (!spreadStr) return;
    let spreadDef;
    try { spreadDef = JSON.parse(spreadStr); } catch { return; }

    showChartLoading('timespread-chart');

    let data;
    try {
        data = await fetchTimespreadHistory(commodity, spreadDef, nDays);
    } catch {
        data = generateTimespreadHistorySynthetic(commodity, spreadDef, nDays);
    }
    if (!data) return;

    const sourceTag = data.source === 'yahoo' ? ' [LIVE]' : ' [SYNTHETIC]';
    document.getElementById('timespread-subtitle').textContent = `${data.name} // ${data.unit}${sourceTag}`;

    const vals = data.values;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const current = vals[vals.length - 1];
    const min = Math.min(...vals);
    const max = Math.max(...vals);

    const traces = [
        {
            x: data.dates, y: data.values,
            type: 'scatter', mode: 'lines', name: data.name,
            line: { color: isDarkMode ? '#60a5fa' : '#2563eb', width: 2 },
            fill: 'tozeroy',
            fillcolor: isDarkMode ? 'rgba(96,165,250,0.08)' : 'rgba(37,99,235,0.06)',
        },
        {
            x: [data.dates[0], data.dates[data.dates.length - 1]],
            y: [mean, mean],
            type: 'scatter', mode: 'lines', name: `Mean (${mean.toFixed(3)})`,
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
            type: 'line', x0: data.dates[0], x1: data.dates[data.dates.length - 1], y0: 0, y1: 0,
            line: { color: cc.zero, width: 1, dash: 'dot' },
        }],
        margin: { l: 55, r: 30, t: 25, b: 40 },
        legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 10, color: cc.muted }, orientation: 'h', yanchor: 'bottom', y: 1.02 },
        hovermode: 'x unified',
        annotations: [{
            x: 0.01, y: 0.98, xref: 'paper', yref: 'paper',
            text: `Current: <b>${current.toFixed(3)}</b> | Min: ${min.toFixed(3)} | Max: ${max.toFixed(3)}`,
            showarrow: false,
            font: { size: 10, color: cc.muted, family: 'JetBrains Mono, monospace' },
            bgcolor: cc.bg, borderpad: 4,
        }],
    };

    Plotly.react('timespread-chart', traces, layout, CHART_CONFIG);
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

async function updateSpreadChart() {
    const cc = getChartColors();
    const spreadKey = document.getElementById('spread-select').value;
    const nDays = parseInt(document.getElementById('spread-period').value) || 252;
    if (!spreadKey) return;

    const def = SPREAD_DEFINITIONS[spreadKey];

    showChartLoading('spread-monitor-chart');

    let data;
    try {
        data = await fetchSpreadHistory(spreadKey, nDays);
    } catch {
        data = generateSpreadHistorySynthetic(spreadKey, nDays);
    }
    if (!data) return;

    const sourceTag = data.source === 'yahoo' ? ' [LIVE]' : ' [SYNTHETIC]';
    document.getElementById('spread-subtitle').textContent = `${def.description} // ${def.unit}${sourceTag}`;

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
    if (document.getElementById('ts-spread-select').value) updateTimespread();
    if (document.getElementById('spread-select').value) updateSpreadChart();
}
