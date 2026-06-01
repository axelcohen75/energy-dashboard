/**
 * Polymarket Quote Tab — UI Controller
 *
 * Displays liquid Polymarket quotes for Hormuz traffic, oil prices,
 * and Iran/Hormuz policy risk.
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
            const resp = await fetch('data/physical-data.json?v=20260601-polymarket-quote');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            physicalData = await resp.json();
            console.log(`[Geopolitics] Loaded — updated ${physicalData.updated}`);
        } catch (e) {
            console.error('[Geopolitics] Failed to load physical-data.json:', e.message);
            return;
        }
    }

    renderPolymarketQuotePanels();
    renderGeoHormuzMonitor();
    renderGeoMarketStats();
    renderGeoHighProb();
    renderGeoHormuzSummary();
    loadAndRenderNews('geopolitics');
}

// ─── Quote Board Panels ─────────────────────────────────────────────────────

function getPolymarketQuotes() {
    return physicalData?.polymarketQuotes || physicalData?.polymarket || [];
}

function byLiquidity(a, b) {
    return ((b.liquidity || 0) - (a.liquidity || 0)) || ((b.volume || 0) - (a.volume || 0));
}

function renderPolymarketQuotePanels() {
    const quotes = getPolymarketQuotes();
    if (!quotes.length) return;

    const oil = quotes.filter(m => m.quoteGroup === 'oil_price').sort(byLiquidity);
    const hormuz = quotes
        .filter(m => ['hormuz_traffic', 'hormuz_policy'].includes(m.quoteGroup))
        .sort(byLiquidity);
    const iran = quotes
        .filter(m => !['oil_price', 'hormuz_traffic', 'hormuz_policy'].includes(m.quoteGroup))
        .sort(byLiquidity);

    const oilContainer = document.getElementById('pm-oil-quotes');
    const hormuzContainer = document.getElementById('pm-hormuz-quotes');
    const iranContainer = document.getElementById('pm-iran-quotes');

    if (oilContainer) oilContainer.innerHTML = renderPmList(oil, 10) || emptyPmHtml('No oil quotes above $50K liquidity');
    if (hormuzContainer) hormuzContainer.innerHTML = renderPmList(hormuz, 12) || emptyPmHtml('No Hormuz quotes above $50K liquidity');
    if (iranContainer) iranContainer.innerHTML = renderPmList(iran, 10) || emptyPmHtml('No Iran/macro quotes above $50K liquidity');
}

function renderPmList(markets, limit = 12) {
    let html = '';
    for (const m of markets.slice(0, limit)) {
        const probs = m.probabilities || [];
        const mainProb = probs[0] || 0;
        const question = m.question || '';
        const vol = m.volume || 0;
        const liq = m.liquidity || 0;
        const label = m.label || m.groupTitle || '';
        const endDate = m.endDate ? new Date(m.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '';

        let barColor;
        if (mainProb >= 70) barColor = isDarkMode ? '#34d399' : '#059669';
        else if (mainProb >= 40) barColor = isDarkMode ? '#fbbf24' : '#d97706';
        else barColor = isDarkMode ? '#f87171' : '#dc2626';

        const volStr = vol >= 1000000 ? `$${(vol / 1000000).toFixed(1)}M`
            : vol >= 1000 ? `$${(vol / 1000).toFixed(0)}K` : `$${vol}`;
        const liqStr = liq >= 1000000 ? `$${(liq / 1000000).toFixed(1)}M`
            : liq >= 1000 ? `$${(liq / 1000).toFixed(0)}K` : `$${liq}`;

        html += `
            <div class="pm-row">
                <div class="pm-row-top">
                    <span class="pm-label">${label}</span>
                    <span class="pm-liq">LIQ ${liqStr}</span>
                </div>
                <div class="pm-question">${question}</div>
                <div class="pm-bar-wrap">
                    <div class="pm-bar" style="width:${mainProb}%;background:${barColor}"></div>
                </div>
                <div class="pm-stats">
                    <span class="pm-prob" style="color:${barColor}">${mainProb.toFixed(0)}%</span>
                    <span class="pm-vol">VOL ${volStr}</span>
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
    const points = physicalData?.hormuzTermStructure || physicalData?.hormuzReopeningSignals || [];
    if (!points || !points.length) {
        Plotly.react('pm-term-chart', [], {
            paper_bgcolor: cc.bg, plot_bgcolor: cc.bg,
            font: { color: cc.text, size: 11 }, margin: { l: 55, r: 30, t: 25, b: 40 },
        }, CHART_CONFIG);
        return;
    }

    const active = points.filter(p => (p.probabilities || [p.prob || 0])[0] >= 0);
    const labels = active.map(p => p.label);
    const probs = active.map(p => (p.probabilities || [p.prob || 0])[0]);
    const colors = active.map(p => {
        const prob = (p.probabilities || [p.prob || 0])[0];
        if (prob >= 60) return isDarkMode ? '#34d399' : '#059669';
        if (prob >= 30) return isDarkMode ? '#fbbf24' : '#d97706';
        return isDarkMode ? '#f87171' : '#dc2626';
    });

    const hoverTexts = active.map(p =>
        `${p.question}<br><b>${((p.probabilities || [p.prob || 0])[0]).toFixed(1)}%</b><br>` +
        `Liq: $${(p.liquidity || 0).toLocaleString()}<br>Vol: $${(p.volume || 0).toLocaleString()}`);

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
            title: { text: 'MATURITY', font: { size: 10, color: cc.muted } },
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

// ─── Right Sidebar: Market Stats ────────────────────────────────────────────

function renderGeoMarketStats() {
    const container = document.getElementById('geo-market-stats');
    const markets = getPolymarketQuotes();
    if (!container || !markets.length) return;

    const totalVol = markets.reduce((sum, m) => sum + (m.volume || 0), 0);
    const totalLiq = markets.reduce((sum, m) => sum + (m.liquidity || 0), 0);
    const oilCount = markets.filter(m => m.quoteGroup === 'oil_price').length;
    const hormuzCount = markets.filter(m => ['hormuz_traffic', 'hormuz_policy'].includes(m.quoteGroup)).length;
    const avgProb = markets.reduce((sum, m) => sum + ((m.probabilities || [])[0] || 0), 0) / (markets.length || 1);

    const volStr = totalVol >= 1e6 ? `$${(totalVol / 1e6).toFixed(1)}M` : `$${(totalVol / 1e3).toFixed(0)}K`;
    const liqStr = totalLiq >= 1e6 ? `$${(totalLiq / 1e6).toFixed(1)}M` : `$${(totalLiq / 1e3).toFixed(0)}K`;

    let html = `<div style="font-size:10px">
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:var(--text-muted)">Liquid Quotes</span>
            <span style="font-family:var(--mono);color:var(--text)">${markets.length}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:var(--text-muted)">Hormuz Quotes</span>
            <span style="font-family:var(--mono);color:var(--text)">${hormuzCount}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:var(--text-muted)">Oil Price Quotes</span>
            <span style="font-family:var(--mono);color:var(--text)">${oilCount}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:var(--text-muted)">Total Liquidity</span>
            <span style="font-family:var(--mono);color:var(--accent)">${liqStr}</span>
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
    const markets = getPolymarketQuotes();
    if (!container || !markets.length) return;

    const topLiquid = markets
        .slice()
        .sort(byLiquidity)
        .slice(0, 6);

    if (topLiquid.length === 0) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">No liquid quotes</div>';
        return;
    }

    let html = '<div style="font-size:10px">';
    for (const m of topLiquid) {
        const prob = (m.probabilities || [])[0] || 0;
        const color = prob >= 40 ? (isDarkMode ? '#fbbf24' : '#d97706') : (isDarkMode ? '#60a5fa' : '#003061');
        const q = (m.question || '').length > 50 ? m.question.slice(0, 50) + '...' : m.question;
        const liq = m.liquidity >= 1e6 ? `$${(m.liquidity / 1e6).toFixed(1)}M` : `$${(m.liquidity / 1e3).toFixed(0)}K`;
        html += `<div style="padding:4px 0;border-bottom:1px solid var(--input-border)">
            <div style="display:flex;justify-content:space-between;align-items:center">
                <span style="color:var(--text);font-size:10px;flex:1">${q}</span>
                <span style="font-family:var(--mono);font-size:11px;color:${color};font-weight:600;margin-left:8px">${prob.toFixed(0)}%</span>
            </div>
            <div style="font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:2px">LIQ ${liq}</div>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
}

// ─── Right Sidebar: Hormuz Summary ──────────────────────────────────────────

function renderGeoHormuzSummary() {
    const container = document.getElementById('geo-hormuz-summary');
    if (!container) return;

    const points = physicalData?.hormuzTermStructure || physicalData?.hormuzReopeningSignals;
    if (!points || !points.length) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">No Hormuz data</div>';
        return;
    }

    const active = points.filter(p => (p.probabilities || [p.prob || 0])[0] >= 0);
    if (active.length === 0) {
        container.innerHTML = '<div style="color:var(--text-dim);font-size:11px;padding:12px;text-align:center">No active signal</div>';
        return;
    }

    const front = active[0];
    const back = active[active.length - 1];
    const mostLiquid = active.reduce((best, p) => (p.liquidity || 0) > (best.liquidity || 0) ? p : best, active[0]);
    const avgProb = active.reduce((s, p) => s + ((p.probabilities || [p.prob || 0])[0]), 0) / active.length;

    let html = `<div style="font-size:10px">
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:var(--text-muted)">Maturities</span>
            <span style="font-family:var(--mono);color:var(--text)">${active.length}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:var(--text-muted)">Front</span>
            <span style="font-family:var(--mono);font-size:9px;color:var(--text)">${front.label} (${((front.probabilities || [front.prob || 0])[0]).toFixed(0)}%)</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:var(--text-muted)">Back</span>
            <span style="font-family:var(--mono);font-size:9px;color:var(--text)">${back.label} (${((back.probabilities || [back.prob || 0])[0]).toFixed(0)}%)</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--input-border)">
            <span style="color:var(--text-muted)">Most Liquid</span>
            <span style="font-family:var(--mono);font-size:9px;color:var(--text)">${mostLiquid.label} ($${((mostLiquid.liquidity || 0) / 1000).toFixed(0)}K)</span>
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
    renderPolymarketQuotePanels();
    renderGeoHormuzMonitor();
    renderGeoMarketStats();
    renderGeoHighProb();
    renderGeoHormuzSummary();
    renderNewsFeed('geopolitics');
}
