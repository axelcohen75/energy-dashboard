/**
 * Geopolitics Tab — UI Controller
 *
 * Displays Polymarket predictions (geopolitics + OPEC/physical),
 * Hormuz reopening signals, and summary analytics.
 * Reads from data/physical-data.json (shared with Physical tab).
 */

let geopoliticsInitialized = false;

async function initGeopolitics() {
    if (geopoliticsInitialized) return;
    geopoliticsInitialized = true;

    const cc = getChartColors();
    const emptyLayout = {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        margin: { l: 55, r: 30, t: 25, b: 40 },
    };
    Plotly.newPlot('pm-term-chart', [], { ...emptyLayout }, CHART_CONFIG);

    // Reuse physicalData if already loaded, otherwise fetch
    if (!physicalData) {
        try {
            const resp = await fetch('data/physical-data.json?v=20260601-hormuz');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            physicalData = await resp.json();
            console.log(`[Geopolitics] Loaded — updated ${physicalData.updated}`);
        } catch (e) {
            console.error('[Geopolitics] Failed to load physical-data.json:', e.message);
            return;
        }
    }

    renderGeoPolymarketPanels();
    renderGeoHormuzMonitor();
    renderGeoRiskSummary();
    renderGeoOpecSummary();
    renderGeoMarketStats();
    renderGeoHighProb();
    renderGeoHormuzSummary();
    loadAndRenderNews('geopolitics');
}

// ─── Polymarket Panels ──────────────────────────────────────────────────────

function renderGeoPolymarketPanels() {
    if (!physicalData?.polymarket) return;

    const geoContainer = document.getElementById('pm-geopolitics');
    const opecContainer = document.getElementById('pm-opec-physical');

    const geo = [], opec = [];
    for (const m of physicalData.polymarket) {
        if (m.category === 'opec_physical') opec.push(m);
        else geo.push(m);
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
            : vol >= 1000 ? `$${(vol / 1000).toFixed(0)}K` : `$${vol}`;

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

// ─── Hormuz Reopening Monitor ───────────────────────────────────────────────

function renderGeoHormuzMonitor() {
    const cc = getChartColors();
    const points = physicalData?.hormuzReopeningSignals || [];
    if (!points || !points.length) {
        Plotly.react('pm-term-chart', [], {
            paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
            font: { color: cc.text, size: 11 }, margin: { l: 55, r: 30, t: 25, b: 40 },
        }, CHART_CONFIG);
        return;
    }

    const active = points.filter(p => p.prob > 0);
    const labels = active.map(p => p.label);
    const probs = active.map(p => p.prob);
    const colors = active.map(p => {
        if (p.prob >= 60) return isDarkMode ? '#34d399' : '#059669';
        if (p.prob >= 30) return isDarkMode ? '#fbbf24' : '#d97706';
        return isDarkMode ? '#f87171' : '#dc2626';
    });

    const hoverTexts = active.map(p =>
        `${p.question}<br><b>${p.prob.toFixed(1)}%</b><br>Vol: $${p.volume.toLocaleString()}`);

    const traces = [{
        x: labels, y: probs,
        type: 'bar',
        marker: { color: colors, line: { width: 0 } },
        text: probs.map(p => `${p.toFixed(0)}%`),
        textposition: 'outside',
        textfont: { size: 11, color: cc.text, family: 'JetBrains Mono, monospace' },
        hovertext: hoverTexts, hoverinfo: 'text',
    }];

    if (active.length > 2) {
        traces.push({
            x: labels, y: probs,
            type: 'scatter', mode: 'lines+markers',
            line: { color: isDarkMode ? '#60a5fa' : '#003061', width: 2, shape: 'spline' },
            marker: { size: 8, color: isDarkMode ? '#60a5fa' : '#003061' },
            showlegend: false, hoverinfo: 'skip',
        });
    }

    const layout = {
        paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        xaxis: {
            gridcolor: cc.grid, zerolinecolor: cc.zero,
            tickfont: { size: 10, color: cc.muted },
            title: { text: 'HORMUZ SIGNAL', font: { size: 10, color: cc.muted } },
        },
        yaxis: {
            gridcolor: cc.grid, zerolinecolor: cc.zero,
            tickfont: { size: 10, color: cc.muted },
            title: { text: 'PROBABILITY %', font: { size: 11, color: cc.muted } },
            range: [0, Math.max(...probs) + 15],
            ticksuffix: '%',
        },
        margin: { l: 55, r: 30, t: 25, b: 55 },
        bargap: 0.3, showlegend: false,
        annotations: [{
            x: 1, y: -0.18, xref: 'paper', yref: 'paper', xanchor: 'right',
            text: 'SOURCE: POLYMARKET', showarrow: false,
            font: { size: 9, color: cc.dim, family: 'JetBrains Mono, monospace' },
        }],
    };

    Plotly.react('pm-term-chart', traces, layout, CHART_CONFIG);
}

// ─── Left Sidebar: Risk Summary ─────────────────────────────────────────────

function renderGeoRiskSummary() {
    const container = document.getElementById('geo-risk-summary');
    if (!container || !physicalData?.polymarket) return;

    const geo = physicalData.polymarket.filter(m => m.category === 'geopolitics');
    let html = '<div style="font-size:10px">';

    for (const m of geo.slice(0, 8)) {
        const prob = (m.probabilities || [])[0] || 0;
        let barColor;
        if (prob >= 70) barColor = isDarkMode ? '#34d399' : '#059669';
        else if (prob >= 40) barColor = isDarkMode ? '#fbbf24' : '#d97706';
        else barColor = isDarkMode ? '#f87171' : '#dc2626';

        const q = (m.question || '').length > 45 ? m.question.slice(0, 45) + '...' : m.question;
        html += `<div style="padding:4px 0;border-bottom:1px solid var(--input-border)">
            <div style="color:var(--text);font-size:10px;margin-bottom:2px">${q}</div>
            <div style="display:flex;align-items:center;gap:6px">
                <div style="flex:1;height:4px;background:var(--input-bg);border-radius:2px;overflow:hidden">
                    <div style="width:${prob}%;height:100%;background:${barColor};border-radius:2px"></div>
                </div>
                <span style="font-family:var(--mono);font-size:10px;color:${barColor};min-width:30px;text-align:right">${prob.toFixed(0)}%</span>
            </div>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

function renderGeoOpecSummary() {
    const container = document.getElementById('geo-opec-summary');
    if (!container || !physicalData?.polymarket) return;

    const opec = physicalData.polymarket.filter(m => m.category === 'opec_physical');
    let html = '<div style="font-size:10px">';

    for (const m of opec.slice(0, 8)) {
        const prob = (m.probabilities || [])[0] || 0;
        let barColor;
        if (prob >= 70) barColor = isDarkMode ? '#34d399' : '#059669';
        else if (prob >= 40) barColor = isDarkMode ? '#fbbf24' : '#d97706';
        else barColor = isDarkMode ? '#f87171' : '#dc2626';

        const q = (m.question || '').length > 45 ? m.question.slice(0, 45) + '...' : m.question;
        html += `<div style="padding:4px 0;border-bottom:1px solid var(--input-border)">
            <div style="color:var(--text);font-size:10px;margin-bottom:2px">${q}</div>
            <div style="display:flex;align-items:center;gap:6px">
                <div style="flex:1;height:4px;background:var(--input-bg);border-radius:2px;overflow:hidden">
                    <div style="width:${prob}%;height:100%;background:${barColor};border-radius:2px"></div>
                </div>
                <span style="font-family:var(--mono);font-size:10px;color:${barColor};min-width:30px;text-align:right">${prob.toFixed(0)}%</span>
            </div>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

// ─── Right Sidebar: Market Stats ────────────────────────────────────────────

function renderGeoMarketStats() {
    const container = document.getElementById('geo-market-stats');
    if (!container || !physicalData?.polymarket) return;

    const markets = physicalData.polymarket;
    const totalVol = markets.reduce((sum, m) => sum + (m.volume || 0), 0);
    const geoCount = markets.filter(m => m.category === 'geopolitics').length;
    const opecCount = markets.filter(m => m.category === 'opec_physical').length;
    const avgProb = markets.reduce((sum, m) => sum + ((m.probabilities || [])[0] || 0), 0) / (markets.length || 1);

    const volStr = totalVol >= 1e6 ? `$${(totalVol / 1e6).toFixed(1)}M` : `$${(totalVol / 1e3).toFixed(0)}K`;

    let html = `<div style="font-size:10px">
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:var(--text-muted)">Total Markets</span>
            <span style="font-family:var(--mono);color:var(--text)">${markets.length}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:var(--text-muted)">Geopolitics</span>
            <span style="font-family:var(--mono);color:var(--text)">${geoCount}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:var(--text-muted)">OPEC / Physical</span>
            <span style="font-family:var(--mono);color:var(--text)">${opecCount}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:var(--text-muted)">Total Volume</span>
            <span style="font-family:var(--mono);color:var(--accent)">${volStr}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0">
            <span style="color:var(--text-muted)">Avg Probability</span>
            <span style="font-family:var(--mono);color:var(--text)">${avgProb.toFixed(1)}%</span>
        </div>
    </div>`;

    if (physicalData.updated) {
        const upd = new Date(physicalData.updated);
        html += `<div style="font-size:8px;color:var(--text-dim);font-family:var(--mono);margin-top:6px;text-align:right">
            Updated: ${upd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${upd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
        </div>`;
    }

    container.innerHTML = html;
}

// ─── Right Sidebar: High Probability Events ─────────────────────────────────

function renderGeoHighProb() {
    const container = document.getElementById('geo-high-prob');
    if (!container || !physicalData?.polymarket) return;

    const highProb = physicalData.polymarket
        .filter(m => ((m.probabilities || [])[0] || 0) >= 65)
        .sort((a, b) => ((b.probabilities || [])[0] || 0) - ((a.probabilities || [])[0] || 0))
        .slice(0, 6);

    if (highProb.length === 0) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">No high-probability events (>65%)</div>';
        return;
    }

    let html = '<div style="font-size:10px">';
    for (const m of highProb) {
        const prob = (m.probabilities || [])[0] || 0;
        const color = isDarkMode ? '#34d399' : '#059669';
        const q = (m.question || '').length > 50 ? m.question.slice(0, 50) + '...' : m.question;
        html += `<div style="padding:4px 0;border-bottom:1px solid var(--input-border)">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="color:var(--text);font-size:10px;flex:1">${q}</span>
                <span style="font-family:var(--mono);font-size:11px;color:${color};font-weight:600;margin-left:8px">${prob.toFixed(0)}%</span>
            </div>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

// ─── Right Sidebar: Hormuz Summary ──────────────────────────────────────────

function renderGeoHormuzSummary() {
    const container = document.getElementById('geo-hormuz-summary');
    if (!container) return;

    const points = physicalData?.hormuzReopeningSignals;
    if (!points || !points.length) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">No Hormuz data</div>';
        return;
    }

    const active = points.filter(p => p.prob > 0);
    if (active.length === 0) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">No active signal</div>';
        return;
    }

    const primary = active[0];
    const highest = active.reduce((best, p) => p.prob > best.prob ? p : best, active[0]);
    const avgProb = active.reduce((s, p) => s + p.prob, 0) / active.length;

    let html = `<div style="font-size:10px">
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:var(--text-muted)">Signals</span>
            <span style="font-family:var(--mono);color:var(--text)">${active.length}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:var(--text-muted)">Primary</span>
            <span style="font-family:var(--mono);font-size:9px;color:var(--text)">${primary.label} (${primary.prob.toFixed(0)}%)</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:var(--text-muted)">Highest</span>
            <span style="font-family:var(--mono);font-size:9px;color:var(--text)">${highest.label} (${highest.prob.toFixed(0)}%)</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0">
            <span style="color:var(--text-muted)">Avg Probability</span>
            <span style="font-family:var(--mono);color:var(--text)">${avgProb.toFixed(1)}%</span>
        </div>
    </div>`;

    container.innerHTML = html;
}

// ─── Refresh on theme change ────────────────────────────────────────────────

function refreshGeopolitics() {
    if (!geopoliticsInitialized) return;
    renderGeoPolymarketPanels();
    renderGeoHormuzMonitor();
    renderGeoRiskSummary();
    renderGeoOpecSummary();
    renderGeoMarketStats();
    renderGeoHighProb();
    renderGeoHormuzSummary();
    renderNewsFeed('geopolitics');
}
