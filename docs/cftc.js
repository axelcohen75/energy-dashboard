/**
 * CFTC Tab — Commitments of Traders Positioning
 *
 * Displays net positioning charts, long/short breakdown,
 * data table, and commodity comparison.
 * Reads from data/cftc-data.json.
 */

let cftcInitialized = false;
let cftcData = null;

async function initCftc() {
    if (cftcInitialized) return;
    cftcInitialized = true;

    const cc = getChartColors();
    const emptyLayout = {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        margin: { l: 60, r: 30, t: 25, b: 40 },
    };
    Plotly.newPlot('cftc-net-chart', [], { ...emptyLayout }, CHART_CONFIG);
    Plotly.newPlot('cftc-ls-chart', [], { ...emptyLayout }, CHART_CONFIG);

    try {
        const resp = await fetch('data/cftc-data.json');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        cftcData = await resp.json();
        console.log(`[CFTC] Loaded — updated ${cftcData.updated}`);
    } catch (e) {
        console.error('[CFTC] Failed to load cftc-data.json:', e.message);
        return;
    }

    updateCftcCharts();
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const CFTC_CATEGORIES = {
    mm:    { label: 'MANAGED MONEY',       longKey: 'mm_long',    shortKey: 'mm_short',    netKey: 'mm_net' },
    prod:  { label: 'PRODUCER / MERCHANT', longKey: 'prod_long',  shortKey: 'prod_short',  netKey: 'prod_net' },
    swap:  { label: 'SWAP DEALER',         longKey: 'swap_long',  shortKey: 'swap_short',  netKey: 'swap_net' },
    other: { label: 'OTHER REPORTABLE',    longKey: 'other_long', shortKey: 'other_short', netKey: 'other_net' },
};

const CFTC_COLORS = {
    mm:    { light: '#003061', dark: '#60a5fa' },
    prod:  { light: '#d97706', dark: '#fbbf24' },
    swap:  { light: '#7c3aed', dark: '#a78bfa' },
    other: { light: '#64748b', dark: '#94a3b8' },
};

const CFTC_COMMODITY_COLORS = {
    'WTI Crude Oil (CL)':       { light: '#003061', dark: '#60a5fa' },
    'Brent Crude Oil (BZ)':     { light: '#7c3aed', dark: '#a78bfa' },
    'Henry Hub Nat Gas (NG)':   { light: '#059669', dark: '#34d399' },
    'RBOB Gasoline (RB)':       { light: '#db2777', dark: '#f472b6' },
    'Heating Oil (HO)':         { light: '#0891b2', dark: '#22d3ee' },
};

function getCftcCommodity() {
    return document.getElementById('cftc-commodity')?.value || 'WTI Crude Oil (CL)';
}

function getCftcCategory() {
    return document.getElementById('cftc-category')?.value || 'mm';
}

function getCftcCompare() {
    return document.getElementById('cftc-compare')?.value || '';
}

function onCftcCommodityChange() {
    // Remove current commodity from compare dropdown
    const compare = document.getElementById('cftc-compare');
    const current = getCftcCommodity();
    for (const opt of compare.options) {
        opt.disabled = (opt.value === current);
    }
    if (compare.value === current) compare.value = '';
    updateCftcCharts();
}

function fmtContracts(v) {
    const abs = Math.abs(v);
    if (abs >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return v.toString();
}

// ─── Main Update ────────────────────────────────────────────────────────────

function updateCftcCharts() {
    if (!cftcData) return;
    renderCftcNetChart();
    renderCftcLsChart();
    renderCftcTable();
    renderCftcSnapshot();
}

// ─── Net Positioning Chart ──────────────────────────────────────────────────

function renderCftcNetChart() {
    const cc = getChartColors();
    const commodity = getCftcCommodity();
    const category = getCftcCategory();
    const compareCommodity = getCftcCompare();
    const records = cftcData.commodities[commodity];
    if (!records) return;

    const data = records.slice().reverse(); // chronological order
    const dates = data.map(r => r.date);
    const traces = [];

    const subtitle = document.getElementById('cftc-chart-subtitle');

    if (category === 'all') {
        // Show all categories for this commodity
        for (const [key, cfg] of Object.entries(CFTC_CATEGORIES)) {
            const color = isDarkMode ? CFTC_COLORS[key].dark : CFTC_COLORS[key].light;
            traces.push({
                x: dates,
                y: data.map(r => r[cfg.netKey]),
                name: cfg.label,
                type: 'scatter', mode: 'lines',
                line: { color, width: 2 },
            });
        }
        if (subtitle) subtitle.textContent = `${commodity} // ALL CATEGORIES — NET CONTRACTS`;
    } else {
        const cfg = CFTC_CATEGORIES[category];
        const color = isDarkMode ? CFTC_COMMODITY_COLORS[commodity]?.dark : CFTC_COMMODITY_COLORS[commodity]?.light;
        traces.push({
            x: dates,
            y: data.map(r => r[cfg.netKey]),
            name: commodity.split(' (')[0],
            type: 'scatter', mode: 'lines',
            line: { color: color || cc.text, width: 2.5 },
            fill: 'tozeroy',
            fillcolor: (isDarkMode ? color + '15' : color + '12'),
        });

        // Compare commodity
        if (compareCommodity && cftcData.commodities[compareCommodity]) {
            const cmpData = cftcData.commodities[compareCommodity].slice().reverse();
            const cmpDates = cmpData.map(r => r.date);
            const cmpColor = isDarkMode ? CFTC_COMMODITY_COLORS[compareCommodity]?.dark : CFTC_COMMODITY_COLORS[compareCommodity]?.light;
            traces.push({
                x: cmpDates,
                y: cmpData.map(r => r[cfg.netKey]),
                name: compareCommodity.split(' (')[0],
                type: 'scatter', mode: 'lines',
                line: { color: cmpColor || cc.muted, width: 2, dash: 'dash' },
            });
        }

        if (subtitle) {
            const cmpText = compareCommodity ? ` vs ${compareCommodity.split(' (')[0]}` : '';
            subtitle.textContent = `${commodity}${cmpText} // ${cfg.label} — NET CONTRACTS`;
        }
    }

    const layout = {
        ...getChartLayout(),
        xaxis: { ...getChartLayout().xaxis, type: 'date' },
        yaxis: { ...getChartLayout().yaxis, title: { text: 'NET CONTRACTS', font: { size: 11, color: cc.muted } } },
        showlegend: traces.length > 1,
        legend: { x: 0, y: 1.12, orientation: 'h', font: { size: 10 } },
        shapes: [{
            type: 'line', x0: dates[0], x1: dates[dates.length - 1],
            y0: 0, y1: 0, line: { color: cc.muted, width: 1, dash: 'dot' },
        }],
    };

    Plotly.react('cftc-net-chart', traces, layout, CHART_CONFIG);
}

// ─── Long / Short Breakdown Chart ───────────────────────────────────────────

function renderCftcLsChart() {
    const cc = getChartColors();
    const commodity = getCftcCommodity();
    const category = getCftcCategory();
    const records = cftcData.commodities[commodity];
    if (!records) return;

    const data = records.slice().reverse();
    const dates = data.map(r => r.date);
    const traces = [];

    if (category === 'all') {
        // Stacked bar for all categories
        for (const [key, cfg] of Object.entries(CFTC_CATEGORIES)) {
            const color = isDarkMode ? CFTC_COLORS[key].dark : CFTC_COLORS[key].light;
            traces.push({
                x: dates,
                y: data.map(r => r[cfg.netKey]),
                name: cfg.label,
                type: 'bar',
                marker: { color },
            });
        }
    } else {
        const cfg = CFTC_CATEGORIES[category];
        const longColor = isDarkMode ? '#34d399' : '#059669';
        const shortColor = isDarkMode ? '#f87171' : '#dc2626';

        traces.push({
            x: dates,
            y: data.map(r => r[cfg.longKey]),
            name: 'LONG',
            type: 'bar',
            marker: { color: longColor },
        });
        traces.push({
            x: dates,
            y: data.map(r => -r[cfg.shortKey]),
            name: 'SHORT',
            type: 'bar',
            marker: { color: shortColor },
        });
    }

    const layout = {
        ...getChartLayout(),
        barmode: category === 'all' ? 'relative' : 'relative',
        xaxis: { ...getChartLayout().xaxis, type: 'date' },
        yaxis: { ...getChartLayout().yaxis, title: { text: 'CONTRACTS', font: { size: 11, color: cc.muted } } },
        showlegend: true,
        legend: { x: 0, y: 1.12, orientation: 'h', font: { size: 10 } },
        shapes: [{
            type: 'line', x0: dates[0], x1: dates[dates.length - 1],
            y0: 0, y1: 0, line: { color: cc.muted, width: 1, dash: 'dot' },
        }],
    };

    Plotly.react('cftc-ls-chart', traces, layout, CHART_CONFIG);
}

// ─── Data Table ─────────────────────────────────────────────────────────────

function renderCftcTable() {
    const container = document.getElementById('cftc-table');
    if (!container) return;

    const commodity = getCftcCommodity();
    const records = cftcData.commodities[commodity];
    if (!records || records.length === 0) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;text-align:center;padding:12px">No data</div>';
        return;
    }

    const fmtN = (v) => v != null ? v.toLocaleString() : '—';
    const fmtChg = (curr, prev) => {
        if (prev == null) return '';
        const diff = curr - prev;
        if (diff === 0) return '<span style="color:var(--text-dim)">—</span>';
        const color = diff > 0 ? (isDarkMode ? '#34d399' : '#059669') : (isDarkMode ? '#f87171' : '#dc2626');
        const arrow = diff > 0 ? '&#9650;' : '&#9660;';
        return `<span style="color:${color}">${arrow}${fmtContracts(Math.abs(diff))}</span>`;
    };

    let html = `<table class="cftc-data-table">
        <thead>
            <tr>
                <th>DATE</th>
                <th>OI</th>
                <th>MM NET</th>
                <th>CHG</th>
                <th>PROD NET</th>
                <th>CHG</th>
                <th>SWAP NET</th>
                <th>CHG</th>
            </tr>
        </thead>
        <tbody>`;

    for (let i = 0; i < Math.min(records.length, 26); i++) {
        const r = records[i];
        const prev = records[i + 1];
        const date = new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
        const mmColor = r.mm_net >= 0 ? (isDarkMode ? '#34d399' : '#059669') : (isDarkMode ? '#f87171' : '#dc2626');
        const prodColor = r.prod_net >= 0 ? (isDarkMode ? '#34d399' : '#059669') : (isDarkMode ? '#f87171' : '#dc2626');
        const swapColor = r.swap_net >= 0 ? (isDarkMode ? '#34d399' : '#059669') : (isDarkMode ? '#f87171' : '#dc2626');

        html += `<tr${i === 0 ? ' class="cftc-latest"' : ''}>
            <td>${date}</td>
            <td>${fmtContracts(r.oi)}</td>
            <td style="color:${mmColor}">${fmtContracts(r.mm_net)}</td>
            <td>${fmtChg(r.mm_net, prev?.mm_net)}</td>
            <td style="color:${prodColor}">${fmtContracts(r.prod_net)}</td>
            <td>${fmtChg(r.prod_net, prev?.prod_net)}</td>
            <td style="color:${swapColor}">${fmtContracts(r.swap_net)}</td>
            <td>${fmtChg(r.swap_net, prev?.swap_net)}</td>
        </tr>`;
    }

    html += '</tbody></table>';

    if (cftcData.updated) {
        const upd = new Date(cftcData.updated);
        html += `<div style="font-size:8px;color:var(--text-dim);font-family:var(--mono);margin-top:6px;text-align:right">
            Source: CFTC COT Report | Updated: ${upd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </div>`;
    }

    container.innerHTML = html;
}

// ─── Snapshot Panel ─────────────────────────────────────────────────────────

function renderCftcSnapshot() {
    const container = document.getElementById('cftc-snapshot');
    if (!container) return;

    const commodity = getCftcCommodity();
    const records = cftcData.commodities[commodity];
    if (!records || records.length === 0) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;text-align:center;padding:8px">No data</div>';
        return;
    }

    const latest = records[0];
    const prev = records[1] || latest;
    const reportDate = new Date(latest.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });

    const fmtK = (v) => {
        const abs = Math.abs(v);
        const str = abs >= 1000 ? `${(abs / 1000).toFixed(1)}K` : `${abs}`;
        return (v >= 0 ? '+' : '-') + str;
    };

    const chgHtml = (chg) => {
        if (chg === 0) return '<span style="color:var(--text-dim)">—</span>';
        const color = chg > 0 ? (isDarkMode ? '#34d399' : '#059669') : (isDarkMode ? '#f87171' : '#dc2626');
        const arrow = chg > 0 ? '&#9650;' : '&#9660;';
        return `<span style="color:${color};font-size:9px">${arrow} ${fmtK(chg)}</span>`;
    };

    const barRow = (label, long, short, net, chg, color) => {
        const total = long + short || 1;
        const longPct = (long / total * 100).toFixed(0);
        const netColor = net >= 0 ? (isDarkMode ? '#34d399' : '#059669') : (isDarkMode ? '#f87171' : '#dc2626');

        return `<div class="cftc-row">
            <div class="cftc-row-header">
                <span class="cftc-cat" style="color:${color}">${label}</span>
                <span class="cftc-net" style="color:${netColor}">${fmtK(net)}</span>
                ${chgHtml(chg)}
            </div>
            <div class="cftc-bar">
                <div class="cftc-bar-long" style="width:${longPct}%"></div>
                <div class="cftc-bar-short" style="width:${100 - longPct}%"></div>
            </div>
            <div class="cftc-row-footer">
                <span style="color:${isDarkMode ? '#34d399' : '#059669'}">${long.toLocaleString()} L</span>
                <span style="color:${isDarkMode ? '#f87171' : '#dc2626'}">${short.toLocaleString()} S</span>
            </div>
        </div>`;
    };

    const mmColor = isDarkMode ? CFTC_COLORS.mm.dark : CFTC_COLORS.mm.light;
    const prodColor = isDarkMode ? CFTC_COLORS.prod.dark : CFTC_COLORS.prod.light;
    const swapColor = isDarkMode ? CFTC_COLORS.swap.dark : CFTC_COLORS.swap.light;
    const otherColor = isDarkMode ? CFTC_COLORS.other.dark : CFTC_COLORS.other.light;

    let html = `<div style="font-size:8px;color:var(--text-dim);font-family:var(--mono);margin-bottom:6px">
        ${reportDate} | OI: ${latest.oi.toLocaleString()}
    </div>`;

    html += barRow('MANAGED MONEY', latest.mm_long, latest.mm_short, latest.mm_net, latest.mm_net - prev.mm_net, mmColor);
    html += barRow('PRODUCER', latest.prod_long, latest.prod_short, latest.prod_net, latest.prod_net - prev.prod_net, prodColor);
    html += barRow('SWAP DEALER', latest.swap_long, latest.swap_short, latest.swap_net, latest.swap_net - prev.swap_net, swapColor);
    html += barRow('OTHER', latest.other_long, latest.other_short, latest.other_net, latest.other_net - prev.other_net, otherColor);

    container.innerHTML = html;
}

// ─── Refresh on theme change ────────────────────────────────────────────────

function refreshCftc() {
    if (!cftcInitialized) return;
    updateCftcCharts();
}
