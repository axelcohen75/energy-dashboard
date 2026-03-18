/**
 * Physical Markets — UI Controller
 *
 * Displays EIA inventory data and Polymarket predictions.
 * Reads from data/physical-data.json.
 */

let physicalData = null;
let physicalInitialized = false;

async function initPhysicalMarkets() {
    if (physicalInitialized) return;
    physicalInitialized = true;

    const cc = getChartColors();
    const emptyLayout = {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        margin: { l: 55, r: 30, t: 25, b: 40 },
    };
    Plotly.newPlot('inventory-chart', [], { ...emptyLayout }, CHART_CONFIG);
    Plotly.newPlot('pm-term-chart', [], { ...emptyLayout }, CHART_CONFIG);

    // Load data
    try {
        const resp = await fetch('data/physical-data.json');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        physicalData = await resp.json();
        console.log(`[Physical] Loaded — updated ${physicalData.updated}`);
    } catch (e) {
        console.error('[Physical] Failed to load physical-data.json:', e.message);
        return;
    }

    renderInventoryPanel();
    renderPolymarketPanels();
    populatePmTopicSelect();
    updateInventoryChart();
    updatePmTermStructure();
}

// ─── Inventory Panel (left sidebar) ─────────────────────────────────────────

const INVENTORY_CONFIG = {
    us_crude_stocks: { label: 'US Crude Oil', color: '#2563eb', colorDark: '#60a5fa' },
    cushing_stocks: { label: 'Cushing, OK', color: '#7c3aed', colorDark: '#a78bfa' },
    spr: { label: 'SPR', color: '#dc2626', colorDark: '#f87171' },
    gasoline_stocks: { label: 'Gasoline', color: '#db2777', colorDark: '#f472b6' },
    distillate_stocks: { label: 'Distillates', color: '#0891b2', colorDark: '#22d3ee' },
    ng_storage: { label: 'NG Storage', color: '#059669', colorDark: '#34d399' },
};

function renderInventoryPanel() {
    const container = document.getElementById('inventory-table');
    if (!container || !physicalData?.eia) return;

    let html = '';
    let firstKey = null;
    for (const [key, cfg] of Object.entries(INVENTORY_CONFIG)) {
        const series = physicalData.eia[key];
        if (!series) continue;
        if (!firstKey) firstKey = key;

        const vals = series.values;
        const latest = vals[vals.length - 1];
        const prev = vals.length > 1 ? vals[vals.length - 2] : latest;
        const change = latest - prev;
        const color = isDarkMode ? cfg.colorDark : cfg.color;
        const chgColor = change >= 0
            ? (isDarkMode ? '#34d399' : '#059669')
            : (isDarkMode ? '#f87171' : '#dc2626');
        const chgSign = change >= 0 ? '+' : '';
        const decimals = series.unit === 'Bcf' ? 0 : 1;

        html += `
            <div class="inv-row" onclick="selectInventory('${key}')" data-key="${key}">
                <div class="inv-name" style="border-left:3px solid ${color};padding-left:8px">${cfg.label}</div>
                <div class="inv-val">${latest.toFixed(decimals)}</div>
                <div class="inv-chg" style="color:${chgColor}">${chgSign}${change.toFixed(decimals)}</div>
                <div class="inv-unit">${series.unit}</div>
            </div>`;
    }

    container.innerHTML = html;

    // Populate dropdown
    const select = document.getElementById('inv-select');
    if (select && select.options.length === 0) {
        for (const [key, cfg] of Object.entries(INVENTORY_CONFIG)) {
            if (physicalData.eia[key]) {
                select.appendChild(new Option(cfg.label, key));
            }
        }
        // Select first item and highlight
        if (firstKey) {
            select.value = firstKey;
            const firstRow = container.querySelector(`[data-key="${firstKey}"]`);
            if (firstRow) firstRow.classList.add('active');
        }
    }
}

function selectInventory(key) {
    document.getElementById('inv-select').value = key;
    updateInventoryChart();
    document.querySelectorAll('.inv-row').forEach(r => {
        r.classList.toggle('active', r.dataset.key === key);
    });
}

// ─── Inventory Chart ────────────────────────────────────────────────────────

function updateInventoryChart() {
    const cc = getChartColors();
    const key = document.getElementById('inv-select').value;
    const nWeeks = parseInt(document.getElementById('inv-period').value) || 260;

    if (!key || !physicalData?.eia?.[key]) return;

    const series = physicalData.eia[key];
    const cfg = INVENTORY_CONFIG[key];
    const color = isDarkMode ? cfg.colorDark : cfg.color;

    // Trim to period
    const start = Math.max(0, series.dates.length - nWeeks);
    const dates = series.dates.slice(start);
    const values = series.values.slice(start);

    const current = values[values.length - 1];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const decimals = series.unit === 'Bcf' ? 0 : 1;

    // 5-year range if we have enough data
    let rangeBand = null;
    if (series.dates.length > 260) {
        rangeBand = compute5YearRange(series, nWeeks);
    }

    const traces = [];

    if (rangeBand) {
        traces.push({
            x: [...rangeBand.dates, ...rangeBand.dates.slice().reverse()],
            y: [...rangeBand.high, ...rangeBand.low.slice().reverse()],
            type: 'scatter', fill: 'toself', name: '5Y Range',
            fillcolor: isDarkMode ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.12)',
            line: { width: 0 },
            hoverinfo: 'skip',
        });
        traces.push({
            x: rangeBand.dates, y: rangeBand.avg,
            type: 'scatter', mode: 'lines', name: '5Y Avg',
            line: { color: cc.muted, width: 1, dash: 'dot' },
        });
    }

    traces.push({
        x: dates, y: values,
        type: 'scatter', mode: 'lines', name: cfg.label,
        line: { color, width: 2.5 },
        fill: 'tozeroy',
        fillcolor: isDarkMode ? `${color}11` : `${color}0a`,
    });

    const layout = {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        xaxis: { gridcolor: cc.grid, zerolinecolor: cc.zero, tickfont: { size: 10, color: cc.muted } },
        yaxis: {
            gridcolor: cc.grid, zerolinecolor: cc.zero, tickfont: { size: 10, color: cc.muted },
            title: { text: series.unit, font: { size: 11, color: cc.muted } },
        },
        margin: { l: 60, r: 30, t: 25, b: 40 },
        legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 10, color: cc.muted }, orientation: 'h', yanchor: 'bottom', y: 1.02 },
        hovermode: 'x unified',
        annotations: [{
            x: 0.01, y: 0.98, xref: 'paper', yref: 'paper',
            text: `Latest: <b>${current.toFixed(decimals)}</b> ${series.unit} | Min: ${min.toFixed(decimals)} | Max: ${max.toFixed(decimals)}`,
            showarrow: false,
            font: { size: 10, color: cc.muted, family: 'JetBrains Mono, monospace' },
            bgcolor: cc.bg, borderpad: 4,
        }, {
            x: 1, y: -0.12, xref: 'paper', yref: 'paper', xanchor: 'right',
            text: 'SOURCE: EIA', showarrow: false,
            font: { size: 9, color: cc.dim, family: 'JetBrains Mono, monospace' },
        }],
    };

    Plotly.react('inventory-chart', traces, layout, CHART_CONFIG);
}

function compute5YearRange(series, nWeeks) {
    const weekMap = {};
    for (let i = 0; i < series.dates.length; i++) {
        const d = new Date(series.dates[i]);
        const week = getWeekOfYear(d);
        const year = d.getFullYear();
        if (!weekMap[week]) weekMap[week] = {};
        weekMap[week][year] = series.values[i];
    }

    const start = Math.max(0, series.dates.length - nWeeks);
    const dates = series.dates.slice(start);
    const high = [], low = [], avg = [];

    for (const dateStr of dates) {
        const d = new Date(dateStr);
        const week = getWeekOfYear(d);
        const currentYear = d.getFullYear();
        const yearVals = weekMap[week] || {};
        const prevYears = Object.entries(yearVals)
            .filter(([y]) => parseInt(y) < currentYear && parseInt(y) >= currentYear - 5)
            .map(([, v]) => v);

        if (prevYears.length > 0) {
            high.push(Math.max(...prevYears));
            low.push(Math.min(...prevYears));
            avg.push(prevYears.reduce((a, b) => a + b, 0) / prevYears.length);
        } else {
            high.push(null);
            low.push(null);
            avg.push(null);
        }
    }

    return { dates, high, low, avg };
}

function getWeekOfYear(date) {
    const start = new Date(date.getFullYear(), 0, 1);
    return Math.floor((date - start) / (7 * 24 * 60 * 60 * 1000));
}

// ─── Polymarket Panels (split into Geopolitics + OPEC/Physical) ─────────────

function renderPolymarketPanels() {
    if (!physicalData?.polymarket) return;

    const geoContainer = document.getElementById('pm-geopolitics');
    const opecContainer = document.getElementById('pm-opec-physical');

    const geo = [];
    const opec = [];

    for (const m of physicalData.polymarket) {
        if (m.category === 'opec_physical') {
            opec.push(m);
        } else {
            geo.push(m);
        }
    }

    if (geoContainer) geoContainer.innerHTML = renderPmList(geo) || emptyPmHtml('No geopolitics data');
    if (opecContainer) opecContainer.innerHTML = renderPmList(opec) || emptyPmHtml('No OPEC/physical data');
}

function renderPmList(markets) {
    let html = '';
    for (const m of markets) {
        const probs = m.probabilities || [];
        const mainProb = probs[0] || 0;
        const question = m.question || '';
        const vol = m.volume || 0;
        const endDate = m.endDate ? new Date(m.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '';

        let barColor;
        if (mainProb >= 70) barColor = isDarkMode ? '#34d399' : '#059669';
        else if (mainProb >= 40) barColor = isDarkMode ? '#fbbf24' : '#d97706';
        else barColor = isDarkMode ? '#f87171' : '#dc2626';

        const volStr = vol >= 1000000 ? `$${(vol / 1000000).toFixed(1)}M`
            : vol >= 1000 ? `$${(vol / 1000).toFixed(0)}K`
            : `$${vol}`;

        html += `
            <div class="pm-row">
                <div class="pm-question">${question}</div>
                <div class="pm-bar-wrap">
                    <div class="pm-bar" style="width:${mainProb}%;background:${barColor}"></div>
                </div>
                <div class="pm-stats">
                    <span class="pm-prob" style="color:${barColor}">${mainProb.toFixed(0)}%</span>
                    <span class="pm-vol">${volStr}</span>
                    <span class="pm-expiry" style="color:var(--text-dim);font-size:9px;margin-left:4px">${endDate}</span>
                </div>
            </div>`;
    }
    return html;
}

function emptyPmHtml(msg) {
    return `<div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">${msg}</div>`;
}

// ─── Polymarket Term Structure ───────────────────────────────────────────────

function populatePmTopicSelect() {
    const select = document.getElementById('pm-topic-select');
    if (!select || !physicalData?.pmTermGroups) return;

    select.innerHTML = '';
    const groups = physicalData.pmTermGroups;
    if (!groups.length) {
        select.appendChild(new Option('No term structure data', ''));
        return;
    }

    for (let i = 0; i < groups.length; i++) {
        select.appendChild(new Option(groups[i].label, i.toString()));
    }
}

function updatePmTermStructure() {
    const cc = getChartColors();
    const select = document.getElementById('pm-topic-select');
    if (!select || !physicalData?.pmTermGroups) return;

    const idx = parseInt(select.value);
    const groups = physicalData.pmTermGroups;
    if (isNaN(idx) || !groups[idx]) {
        Plotly.react('pm-term-chart', [], {
            paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
            font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
            margin: { l: 55, r: 30, t: 25, b: 40 },
        }, CHART_CONFIG);
        return;
    }

    const group = groups[idx];
    const points = group.points.filter(p => p.prob != null);

    if (!points.length) return;

    // Build x-axis labels (end dates) and y-axis (probabilities)
    const labels = [];
    const probs = [];
    const hoverTexts = [];
    const colors = [];

    for (const p of points) {
        const endDate = p.endDate ? new Date(p.endDate) : null;
        const label = endDate
            ? endDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
            : 'N/A';
        labels.push(label);
        probs.push(p.prob);
        hoverTexts.push(`${p.question}<br>${p.prob.toFixed(1)}%<br>Vol: $${p.volume.toLocaleString()}`);

        // Color by probability
        if (p.prob >= 70) colors.push(isDarkMode ? '#34d399' : '#059669');
        else if (p.prob >= 40) colors.push(isDarkMode ? '#fbbf24' : '#d97706');
        else colors.push(isDarkMode ? '#f87171' : '#dc2626');
    }

    const traces = [{
        x: labels,
        y: probs,
        type: 'bar',
        marker: { color: colors, line: { width: 0 } },
        text: probs.map(p => `${p.toFixed(0)}%`),
        textposition: 'outside',
        textfont: { size: 11, color: cc.text, family: 'JetBrains Mono, monospace' },
        hovertext: hoverTexts,
        hoverinfo: 'text',
    }];

    // Also add a line connecting the points
    if (points.length > 2) {
        traces.push({
            x: labels,
            y: probs,
            type: 'scatter',
            mode: 'lines+markers',
            line: { color: isDarkMode ? '#60a5fa' : '#2563eb', width: 2, shape: 'spline' },
            marker: { size: 8, color: isDarkMode ? '#60a5fa' : '#2563eb' },
            showlegend: false,
            hoverinfo: 'skip',
        });
    }

    const layout = {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        xaxis: {
            gridcolor: cc.grid, zerolinecolor: cc.zero,
            tickfont: { size: 10, color: cc.muted },
            title: { text: 'MATURITY', font: { size: 10, color: cc.muted } },
        },
        yaxis: {
            gridcolor: cc.grid, zerolinecolor: cc.zero,
            tickfont: { size: 10, color: cc.muted },
            title: { text: 'PROBABILITY %', font: { size: 11, color: cc.muted } },
            range: [0, 105],
            ticksuffix: '%',
        },
        margin: { l: 55, r: 30, t: 25, b: 55 },
        bargap: 0.3,
        showlegend: false,
        annotations: [{
            x: 1, y: -0.18, xref: 'paper', yref: 'paper', xanchor: 'right',
            text: 'SOURCE: POLYMARKET', showarrow: false,
            font: { size: 9, color: cc.dim, family: 'JetBrains Mono, monospace' },
        }],
    };

    Plotly.react('pm-term-chart', traces, layout, CHART_CONFIG);
}

// ─── Refresh on theme change ────────────────────────────────────────────────

function refreshPhysicalMarkets() {
    if (!physicalInitialized) return;
    renderInventoryPanel();
    renderPolymarketPanels();
    updateInventoryChart();
    updatePmTermStructure();
}
