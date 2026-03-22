/**
 * Physical Markets — UI Controller
 *
 * Displays EIA inventory data, OPEC Watch (meeting outcome probabilities),
 * OPEC+ decisions history, calendar, key dates, and supply analytics.
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
    Plotly.newPlot('opec-watch-chart', [], { ...emptyLayout }, CHART_CONFIG);

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
    initOpecWatch();
    renderOpecDecisions();
    renderOpecCalendar();
    renderKeyDates();
    renderSupplySnapshot();
    renderVs5YearAvg();
    renderSeasonalIndicator();
    updateInventoryChart();
}

// ─── Inventory Panel ────────────────────────────────────────────────────────

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

    // Populate hidden select for chart logic
    const select = document.getElementById('inv-select');
    if (select && select.options.length === 0) {
        for (const [key, cfg] of Object.entries(INVENTORY_CONFIG)) {
            if (physicalData.eia[key]) {
                select.appendChild(new Option(cfg.label, key));
            }
        }
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

    const start = Math.max(0, series.dates.length - nWeeks);
    const dates = series.dates.slice(start);
    const values = series.values.slice(start);

    const current = values[values.length - 1];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const decimals = series.unit === 'Bcf' ? 0 : 1;

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
            line: { width: 0 }, hoverinfo: 'skip',
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
            high.push(null); low.push(null); avg.push(null);
        }
    }

    return { dates, high, low, avg };
}

function getWeekOfYear(date) {
    const start = new Date(date.getFullYear(), 0, 1);
    return Math.floor((date - start) / (7 * 24 * 60 * 60 * 1000));
}

// ─── OPEC Watch Data ────────────────────────────────────────────────────────

// Hardcoded OPEC Watch data — probabilities derived from WTI options
// Updated periodically via scripts/fetch_opec_watch.py
const OPEC_WATCH_DATA = {
    meetings: [
        {
            date: '2026-04-05',
            label: 'Apr 5, 2026 — OPEC Meeting',
            probabilities: { 'Decrease': 22.33, 'No Change': 67.26, 'Increase': 10.41 },
            previous: { 'Decrease': 25.80, 'No Change': 67.68, 'Increase': 6.52 },
            previousDate: '2026-03-20',
        },
    ],
    // Historical OPEC+ decisions (Jan 2024 - Mar 2026)
    decisions: [
        { date: '2024-01-04', meeting: 'JMMC', decision: 'No Change', detail: 'Maintained voluntary cuts of 2.2M bpd through Q1 2024', impact: 'neutral' },
        { date: '2024-03-03', meeting: 'JMMC', decision: 'No Change', detail: 'Extended voluntary cuts of 2.2M bpd through Q2 2024', impact: 'neutral' },
        { date: '2024-06-02', meeting: 'Ministerial', decision: 'Gradual Increase', detail: 'Agreed to begin unwinding 2.2M bpd voluntary cuts from Oct 2024, +180K bpd/month', impact: 'bearish' },
        { date: '2024-08-01', meeting: 'JMMC', decision: 'No Change', detail: 'Confirmed Oct 2024 start for gradual production increase', impact: 'neutral' },
        { date: '2024-09-05', meeting: 'JMMC', decision: 'Delay Increase', detail: 'Postponed production increase by 2 months to Dec 2024 due to weak demand outlook', impact: 'bullish' },
        { date: '2024-11-03', meeting: 'JMMC', decision: 'Delay Increase', detail: 'Delayed production increase again to Q1 2025, citing oversupply concerns', impact: 'bullish' },
        { date: '2024-12-05', meeting: 'Ministerial', decision: 'Delay + Slower Unwind', detail: 'Pushed back production increases to Apr 2025, slower unwind over 18 months (vs 12)', impact: 'bullish' },
        { date: '2025-02-03', meeting: 'JMMC', decision: 'No Change', detail: 'Confirmed Apr 2025 start for gradual unwind. Compliance push on Iraq/Kazakhstan', impact: 'neutral' },
        { date: '2025-03-13', meeting: 'JMMC', decision: 'Small Increase', detail: 'Confirmed +138K bpd for April 2025, first actual increase since cuts began', impact: 'bearish' },
        { date: '2025-04-03', meeting: 'JMMC', decision: 'Accelerate Increase', detail: 'Surprised markets with +411K bpd for May 2025 (3x expected), punishing overproducers', impact: 'bearish' },
        { date: '2025-05-05', meeting: 'JMMC', decision: 'Large Increase', detail: '+411K bpd again for June 2025, continuing accelerated unwind pace', impact: 'bearish' },
        { date: '2025-06-01', meeting: 'Ministerial', decision: 'Large Increase', detail: '+411K bpd for July 2025, Saudi signaling willingness to accept lower prices', impact: 'bearish' },
        { date: '2025-07-28', meeting: 'JMMC', decision: 'Increase', detail: '+411K bpd for August 2025, cumulative unwind of ~1.6M bpd since April', impact: 'bearish' },
        { date: '2025-09-04', meeting: 'JMMC', decision: 'Increase', detail: '+411K bpd for September 2025, maintained aggressive unwind pace', impact: 'bearish' },
        { date: '2025-10-01', meeting: 'JMMC', decision: 'Moderate', detail: '+300K bpd for October 2025, slight slowdown in unwind pace', impact: 'neutral' },
        { date: '2025-12-04', meeting: 'Ministerial', decision: 'Slow Down', detail: 'Reduced pace to +200K bpd/month for Q1 2026 amid price weakness', impact: 'bullish' },
        { date: '2026-02-03', meeting: 'JMMC', decision: 'Pause', detail: 'Paused production increases for March 2026, reassessing market conditions', impact: 'bullish' },
    ],
};

const OPEC_OUTCOME_COLORS = {
    // 5-category format (legacy)
    'Large Cut (>1M)': { light: '#dc2626', dark: '#f87171' },
    'Small Cut':       { light: '#f59e0b', dark: '#fbbf24' },
    'No Change':       { light: '#6b7280', dark: '#9ca3af' },
    'Small Increase':  { light: '#059669', dark: '#34d399' },
    'Large Increase (>1M)': { light: '#2563eb', dark: '#60a5fa' },
    // 3-category format (CME current)
    'Decrease':        { light: '#dc2626', dark: '#f87171' },
    'Increase':        { light: '#059669', dark: '#34d399' },
};

function initOpecWatch() {
    const select = document.getElementById('opec-meeting-select');
    if (!select) return;

    select.innerHTML = '';
    const now = new Date().toISOString().slice(0, 10);

    for (const mtg of OPEC_WATCH_DATA.meetings) {
        if (mtg.date >= now) {
            select.appendChild(new Option(mtg.label, mtg.date));
        }
    }

    updateOpecWatch();
}

function updateOpecWatch() {
    const cc = getChartColors();
    const select = document.getElementById('opec-meeting-select');
    const selectedDate = select ? select.value : null;

    const mtg = OPEC_WATCH_DATA.meetings.find(m => m.date === selectedDate);
    if (!mtg) {
        Plotly.react('opec-watch-chart', [], {
            paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
            font: { color: cc.text, size: 11 }, margin: { l: 55, r: 30, t: 25, b: 40 },
            annotations: [{ text: 'No meeting data', xref: 'paper', yref: 'paper', x: 0.5, y: 0.5, showarrow: false, font: { size: 12, color: cc.dim } }],
        }, CHART_CONFIG);
        return;
    }

    const subtitle = document.getElementById('opec-watch-subtitle');
    if (subtitle) subtitle.textContent = `${mtg.label} // IMPLIED FROM OPTIONS`;

    const outcomes = Object.keys(mtg.probabilities);
    const probs = Object.values(mtg.probabilities);
    const colors = outcomes.map(o => {
        const c = OPEC_OUTCOME_COLORS[o] || { light: '#6b7280', dark: '#9ca3af' };
        return isDarkMode ? c.dark : c.light;
    });

    const traces = [{
        x: outcomes,
        y: probs,
        type: 'bar',
        marker: {
            color: colors,
            line: { width: 1, color: colors.map(c => c + '80') },
        },
        text: probs.map(p => `${p.toFixed(1)}%`),
        textposition: 'outside',
        textfont: { size: 11, color: cc.text, family: 'JetBrains Mono, monospace' },
        hovertemplate: '%{x}<br><b>%{y:.1f}%</b><extra></extra>',
    }];

    const maxProb = Math.max(...probs);
    const layout = {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        xaxis: {
            gridcolor: cc.grid, zerolinecolor: cc.zero,
            tickfont: { size: 9, color: cc.muted },
        },
        yaxis: {
            gridcolor: cc.grid, zerolinecolor: cc.zero,
            tickfont: { size: 10, color: cc.muted },
            title: { text: 'PROBABILITY %', font: { size: 11, color: cc.muted } },
            range: [0, maxProb + 12],
            ticksuffix: '%',
        },
        margin: { l: 55, r: 30, t: 25, b: 50 },
        bargap: 0.25, showlegend: false,
        annotations: [{
            x: 1, y: -0.2, xref: 'paper', yref: 'paper', xanchor: 'right',
            text: 'SOURCE: CME OPEC WATCH (OPTIONS-IMPLIED)', showarrow: false,
            font: { size: 9, color: cc.dim, family: 'JetBrains Mono, monospace' },
        }],
    };

    Plotly.react('opec-watch-chart', traces, layout, CHART_CONFIG);

    // Render probability shift table (like CME FedWatch)
    renderOpecShiftTable(mtg);
}

function renderOpecShiftTable(mtg) {
    let container = document.getElementById('opec-watch-shift-table');
    if (!container) {
        // Create container after chart if it doesn't exist
        const chart = document.getElementById('opec-watch-chart');
        if (!chart) return;
        container = document.createElement('div');
        container.id = 'opec-watch-shift-table';
        chart.parentNode.insertBefore(container, chart.nextSibling);
    }

    const prev = mtg.previous || {};
    const hasPrev = Object.keys(prev).length > 0;
    const prevDate = mtg.previousDate || '';
    const prevLabel = prevDate ? formatShiftDate(prevDate) : '';

    const outcomes = Object.keys(mtg.probabilities);
    let html = `<table class="opec-shift-tbl">
        <thead><tr>
            <th class="opec-shift-outcome">OUTCOME</th>
            <th class="opec-shift-now">NOW</th>
            ${hasPrev ? `<th class="opec-shift-prev">1 DAY<br><span class="opec-shift-date">${prevLabel}</span></th>` : ''}
        </tr></thead><tbody>`;

    for (const o of outcomes) {
        const now = mtg.probabilities[o];
        const prevVal = prev[o];
        const diff = hasPrev && prevVal != null ? now - prevVal : null;

        let diffHtml = '';
        if (diff !== null) {
            const sign = diff > 0 ? '+' : '';
            const cls = diff > 0 ? 'opec-shift-up' : diff < 0 ? 'opec-shift-down' : 'opec-shift-flat';
            diffHtml = `<span class="${cls}">${sign}${diff.toFixed(2)}%</span>`;
        }

        // Color dot for outcome
        const c = OPEC_OUTCOME_COLORS[o] || { light: '#6b7280', dark: '#9ca3af' };
        const dotColor = isDarkMode ? c.dark : c.light;

        html += `<tr>
            <td class="opec-shift-outcome"><span class="opec-dot" style="background:${dotColor}"></span>${o}</td>
            <td class="opec-shift-now">${now.toFixed(2)}%</td>
            ${hasPrev ? `<td class="opec-shift-prev">${prevVal != null ? prevVal.toFixed(2) + '%' : '—'} ${diffHtml}</td>` : ''}
        </tr>`;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
}

function formatShiftDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── OPEC Decisions History ─────────────────────────────────────────────────

function renderOpecDecisions() {
    const container = document.getElementById('opec-decisions');
    if (!container) return;

    const decisions = OPEC_WATCH_DATA.decisions;
    let html = '';

    for (const d of decisions.slice().reverse()) {
        const dateObj = new Date(d.date + 'T12:00:00');
        const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

        let impactColor, impactIcon;
        if (d.impact === 'bullish') {
            impactColor = isDarkMode ? '#34d399' : '#059669';
            impactIcon = '▲';
        } else if (d.impact === 'bearish') {
            impactColor = isDarkMode ? '#f87171' : '#dc2626';
            impactIcon = '▼';
        } else {
            impactColor = isDarkMode ? '#9ca3af' : '#6b7280';
            impactIcon = '●';
        }

        let decisionColor;
        if (d.decision.includes('Cut') || d.decision.includes('Delay') || d.decision.includes('Slow') || d.decision === 'Pause') {
            decisionColor = isDarkMode ? '#fbbf24' : '#d97706';
        } else if (d.decision.includes('Increase') || d.decision.includes('Accelerate')) {
            decisionColor = isDarkMode ? '#60a5fa' : '#2563eb';
        } else {
            decisionColor = isDarkMode ? '#9ca3af' : '#6b7280';
        }

        html += `<div class="pm-row" style="border-left:3px solid ${impactColor};padding-left:8px">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
                <span style="font-family:var(--mono);font-size:9px;color:var(--text-muted)">${dateStr}</span>
                <span style="font-size:9px;color:var(--text-dim)">${d.meeting}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
                <span style="color:${impactColor};font-size:11px">${impactIcon}</span>
                <span style="font-weight:600;color:${decisionColor};font-size:11px">${d.decision}</span>
            </div>
            <div style="font-size:9px;color:var(--text-muted);line-height:1.3">${d.detail}</div>
        </div>`;
    }

    container.innerHTML = html;
}

// ─── OPEC+ Calendar (Left sidebar) ─────────────────────────────────────────

function renderOpecCalendar() {
    const container = document.getElementById('opec-calendar');
    if (!container) return;

    // OPEC+ 2026 meeting dates (JMMC + full ministerial)
    const events = [
        { date: '2026-02-03', type: 'JMMC', label: '54th JMMC', status: 'past' },
        { date: '2026-04-05', type: 'JMMC', label: '55th JMMC', status: 'upcoming' },
        { date: '2026-05-28', type: 'OPEC+', label: '39th OPEC+ Ministerial', status: 'upcoming' },
        { date: '2026-06-01', type: 'JMMC', label: '56th JMMC', status: 'upcoming' },
        { date: '2026-08-03', type: 'JMMC', label: '57th JMMC', status: 'upcoming' },
        { date: '2026-10-05', type: 'JMMC', label: '58th JMMC', status: 'upcoming' },
        { date: '2026-12-01', type: 'OPEC+', label: '40th OPEC+ Ministerial', status: 'upcoming' },
    ];

    const now = new Date().toISOString().slice(0, 10);
    let html = '';
    for (const evt of events) {
        const isPast = evt.date < now;
        const isNext = !isPast && events.filter(e => e.date >= now).indexOf(evt) === 0;
        const dateObj = new Date(evt.date + 'T12:00:00');
        const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const typeColor = evt.type === 'OPEC+'
            ? (isDarkMode ? '#f87171' : '#dc2626')
            : (isDarkMode ? '#fbbf24' : '#d97706');
        const opacity = isPast ? '0.4' : '1';
        const highlight = isNext ? `background:${isDarkMode ? 'rgba(59,130,246,0.1)' : 'rgba(37,99,235,0.05)'};border-radius:4px;` : '';

        html += `<div style="display:flex;align-items:center;gap:8px;padding:4px 6px;opacity:${opacity};${highlight}font-size:11px">
            <span style="font-family:var(--mono);font-size:10px;color:var(--text-muted);min-width:50px">${dateStr}</span>
            <span style="font-size:9px;font-weight:700;color:${typeColor};min-width:40px">${evt.type}</span>
            <span style="color:var(--text);font-size:10px;flex:1">${evt.label}</span>
            ${isNext ? '<span style="font-size:8px;color:var(--accent);font-weight:600">NEXT</span>' : ''}
            ${isPast ? '<span style="font-size:8px;color:var(--text-dim)">DONE</span>' : ''}
        </div>`;
    }

    container.innerHTML = html;
}

// ─── Key Dates (Left sidebar) ───────────────────────────────────────────────

function renderKeyDates() {
    const container = document.getElementById('key-dates');
    if (!container) return;

    // Recurring key dates
    const now = new Date();
    const dates = [];

    // EIA Weekly Petroleum Status Report: Wednesdays 10:30 ET
    const nextWed = getNextWeekday(now, 3);
    dates.push({ date: fmtDate(nextWed), label: 'EIA Petroleum Report', type: 'EIA', recurring: 'Weekly Wed' });

    // EIA Natural Gas Storage: Thursdays 10:30 ET
    const nextThu = getNextWeekday(now, 4);
    dates.push({ date: fmtDate(nextThu), label: 'EIA Gas Storage', type: 'EIA', recurring: 'Weekly Thu' });

    // FOMC 2026 dates
    const fomc = ['2026-03-18', '2026-05-06', '2026-06-17', '2026-07-29', '2026-09-16', '2026-11-04', '2026-12-16'];
    const nowStr = now.toISOString().slice(0, 10);
    const nextFomc = fomc.find(d => d >= nowStr);
    if (nextFomc) {
        dates.push({ date: nextFomc, label: 'FOMC Decision', type: 'FED', recurring: '' });
    }

    // US CPI release (typically mid-month)
    const cpiDates = ['2026-03-12', '2026-04-10', '2026-05-13', '2026-06-10', '2026-07-14'];
    const nextCpi = cpiDates.find(d => d >= nowStr);
    if (nextCpi) {
        dates.push({ date: nextCpi, label: 'US CPI Release', type: 'ECON', recurring: '' });
    }

    dates.sort((a, b) => a.date.localeCompare(b.date));

    let html = '';
    for (const d of dates) {
        const dateObj = new Date(d.date + 'T12:00:00');
        const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const typeColor = d.type === 'EIA' ? (isDarkMode ? '#22d3ee' : '#0891b2')
            : d.type === 'FED' ? (isDarkMode ? '#a78bfa' : '#7c3aed')
            : (isDarkMode ? '#fbbf24' : '#d97706');

        html += `<div style="display:flex;align-items:center;gap:8px;padding:3px 6px;font-size:11px">
            <span style="font-family:var(--mono);font-size:10px;color:var(--text-muted);min-width:50px">${dateStr}</span>
            <span style="font-size:8px;font-weight:700;color:${typeColor};min-width:30px">${d.type}</span>
            <span style="color:var(--text);font-size:10px;flex:1">${d.label}</span>
            ${d.recurring ? `<span style="font-size:8px;color:var(--text-dim)">${d.recurring}</span>` : ''}
        </div>`;
    }

    container.innerHTML = html;
}

function getNextWeekday(from, targetDay) {
    const d = new Date(from);
    const diff = (targetDay - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d;
}

function fmtDate(d) {
    return d.toISOString().slice(0, 10);
}

// ─── Right Sidebar: Supply Snapshot ─────────────────────────────────────────

function renderSupplySnapshot() {
    const container = document.getElementById('supply-snapshot');
    if (!container || !physicalData?.eia) return;

    let html = '<div style="font-size:10px">';
    html += '<div style="color:var(--text-dim);font-size:9px;margin-bottom:6px;font-family:var(--mono)">WEEK-OVER-WEEK CHANGES</div>';

    for (const [key, cfg] of Object.entries(INVENTORY_CONFIG)) {
        const series = physicalData.eia[key];
        if (!series || series.values.length < 2) continue;

        const vals = series.values;
        const latest = vals[vals.length - 1];
        const prev = vals[vals.length - 2];
        const change = latest - prev;
        const pctChange = (change / prev * 100);
        const decimals = series.unit === 'Bcf' ? 0 : 1;

        const color = isDarkMode ? cfg.colorDark : cfg.color;
        const chgColor = change >= 0
            ? (isDarkMode ? '#34d399' : '#059669')
            : (isDarkMode ? '#f87171' : '#dc2626');
        const arrow = change >= 0 ? '▲' : '▼';

        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:${color};font-weight:500;font-size:10px">${cfg.label}</span>
            <span style="font-family:var(--mono);font-size:10px;color:${chgColor}">
                ${arrow} ${Math.abs(change).toFixed(decimals)} <span style="font-size:8px">(${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}%)</span>
            </span>
        </div>`;
    }
    html += '</div>';

    // Last update
    if (physicalData.updated) {
        const upd = new Date(physicalData.updated);
        html += `<div style="font-size:8px;color:var(--text-dim);font-family:var(--mono);margin-top:6px;text-align:right">
            Updated: ${upd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${upd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </div>`;
    }

    container.innerHTML = html;
}

// ─── Right Sidebar: vs 5-Year Average ───────────────────────────────────────

function renderVs5YearAvg() {
    const container = document.getElementById('inv-vs-avg');
    if (!container || !physicalData?.eia) return;

    let html = '<div style="font-size:10px">';

    for (const [key, cfg] of Object.entries(INVENTORY_CONFIG)) {
        const series = physicalData.eia[key];
        if (!series || series.values.length < 260) continue;

        const vals = series.values;
        const dates = series.dates;
        const latest = vals[vals.length - 1];
        const latestDate = new Date(dates[dates.length - 1]);
        const week = getWeekOfYear(latestDate);

        // Compute 5-year avg for this week
        const weekMap = {};
        for (let i = 0; i < dates.length; i++) {
            const d = new Date(dates[i]);
            const w = getWeekOfYear(d);
            const y = d.getFullYear();
            if (!weekMap[w]) weekMap[w] = {};
            weekMap[w][y] = vals[i];
        }

        const currentYear = latestDate.getFullYear();
        const yearVals = weekMap[week] || {};
        const prevYears = Object.entries(yearVals)
            .filter(([y]) => parseInt(y) < currentYear && parseInt(y) >= currentYear - 5)
            .map(([, v]) => v);

        if (prevYears.length === 0) continue;

        const avg5y = prevYears.reduce((a, b) => a + b, 0) / prevYears.length;
        const diff = latest - avg5y;
        const pctDiff = (diff / avg5y * 100);
        const decimals = series.unit === 'Bcf' ? 0 : 1;

        const color = isDarkMode ? cfg.colorDark : cfg.color;
        const diffColor = diff >= 0
            ? (isDarkMode ? '#34d399' : '#059669')
            : (isDarkMode ? '#f87171' : '#dc2626');

        // Visual bar showing position relative to 5y range
        const min5y = Math.min(...prevYears);
        const max5y = Math.max(...prevYears);
        const range = max5y - min5y || 1;
        const pct = Math.max(0, Math.min(100, ((latest - min5y) / range) * 100));

        html += `<div style="padding:5px 0;border-bottom:1px solid var(--input-border)">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="color:${color};font-weight:500;font-size:10px">${cfg.label}</span>
                <span style="font-family:var(--mono);font-size:10px;color:${diffColor}">
                    ${diff >= 0 ? '+' : ''}${diff.toFixed(decimals)} (${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(1)}%)
                </span>
            </div>
            <div style="height:4px;background:var(--input-bg);border-radius:2px;margin-top:3px;position:relative">
                <div style="position:absolute;left:0;top:0;height:100%;width:${pct}%;background:${color};border-radius:2px;opacity:0.6"></div>
                <div style="position:absolute;left:${pct}%;top:-2px;width:3px;height:8px;background:${color};border-radius:1px;transform:translateX(-50%)"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:8px;color:var(--text-dim);font-family:var(--mono);margin-top:1px">
                <span>5Y Min: ${min5y.toFixed(decimals)}</span>
                <span>5Y Max: ${max5y.toFixed(decimals)}</span>
            </div>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

// ─── Right Sidebar: Seasonal Pattern ────────────────────────────────────────

function renderSeasonalIndicator() {
    const container = document.getElementById('seasonal-indicator');
    if (!container) return;

    const now = new Date();
    const month = now.getMonth(); // 0-11

    const seasons = [
        { name: 'Refinery Maintenance', months: [2, 3], desc: 'Spring turnaround — lower runs, crude builds', color: '#d97706' },
        { name: 'Summer Driving Season', months: [4, 5, 6, 7], desc: 'Peak gasoline demand — draws accelerate', color: '#dc2626' },
        { name: 'Hurricane Season', months: [5, 6, 7, 8, 9, 10], desc: 'Gulf supply risk — Jun-Nov', color: '#7c3aed' },
        { name: 'Winter Heating', months: [10, 11, 0, 1], desc: 'Peak distillate & NG demand', color: '#2563eb' },
        { name: 'NG Injection Season', months: [3, 4, 5, 6, 7, 8, 9], desc: 'Apr-Oct — storage builds', color: '#059669' },
        { name: 'NG Withdrawal Season', months: [10, 11, 0, 1, 2], desc: 'Nov-Mar — storage draws', color: '#0891b2' },
    ];

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

// ─── Refresh on theme change ────────────────────────────────────────────────

function refreshPhysicalMarkets() {
    if (!physicalInitialized) return;
    renderInventoryPanel();
    updateOpecWatch();
    renderOpecDecisions();
    renderOpecCalendar();
    renderKeyDates();
    renderSupplySnapshot();
    renderVs5YearAvg();
    renderSeasonalIndicator();
    updateInventoryChart();
}
