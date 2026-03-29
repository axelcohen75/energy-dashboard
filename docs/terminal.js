/**
 * Option Pricer — UI Controller
 */

// ─── State ───────────────────────────────────────────────────────────────────

let portfolio = [];
let activeMetrics = ['delta'];
let isDarkMode = false;

const LINE_COLORS_LIGHT = ['#003061', '#d97706', '#7c3aed', '#059669', '#dc2626', '#db2777'];
const LINE_COLORS_DARK  = ['#60a5fa', '#fbbf24', '#a78bfa', '#34d399', '#f87171', '#f472b6'];
let LINE_COLORS = LINE_COLORS_LIGHT;

const ALL_METRICS = [
    'payoff', 'price', 'delta', 'gamma', 'vega', 'theta', 'rho',
    'vanna', 'volga',
];
const GREEKS_ONLY = ['price', 'delta', 'gamma', 'vega', 'theta', 'rho', 'vanna', 'volga'];
const SECTION_BREAKS = { 'vanna': '2ND ORDER CROSS' };

function getChartColors() {
    if (isDarkMode) {
        return {
            bg: '#111827', grid: '#1e293b', zero: '#334155',
            text: '#e2e8f0', muted: '#94a3b8', dim: '#64748b',
            accent: '#60a5fa', accent2: '#fbbf24',
            zeroLine: 'rgba(100,116,139,0.3)',
            sweepColor: (a) => `rgba(167,139,250,${a})`,
            surfaceHighlight: '#60a5fa',
        };
    }
    return {
        bg: '#ffffff', grid: '#e2e8f0', zero: '#cbd5e1',
        text: '#1e293b', muted: '#64748b', dim: '#94a3b8',
        accent: '#003061', accent2: '#d97706',
        zeroLine: 'rgba(148,163,184,0.4)',
        sweepColor: (a) => `rgba(124,58,237,${a})`,
        surfaceHighlight: '#003061',
    };
}

function getChartLayout() {
    const c = getChartColors();
    return {
        paper_bgcolor: c.bg,
        plot_bgcolor: c.bg,
        font: { color: c.text, family: 'Inter, sans-serif', size: 11 },
        xaxis: { gridcolor: c.grid, zerolinecolor: c.zero, tickfont: { size: 10, color: c.muted } },
        yaxis: { gridcolor: c.grid, zerolinecolor: c.zero, tickfont: { size: 10, color: c.muted } },
        margin: { l: 55, r: 55, t: 25, b: 40 },
        legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 10, color: c.muted }, orientation: 'h', yanchor: 'bottom', y: 1.02 },
        hovermode: 'x unified',
    };
}

// Keep CHART_LAYOUT as initial value for init, will be refreshed dynamically
let CHART_LAYOUT = getChartLayout();

const CHART_CONFIG = {
    displayModeBar: true,
    displaylogo: false,
    responsive: true,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
};

// ─── Slider definitions ─────────────────────────────────────────────────────

const SLIDERS = [
    { id: 'spot-price',     decimals: 1 },
    { id: 'conv-yield',     decimals: 1 },
    { id: 'storage-cost',   decimals: 1 },
    { id: 'funding-rate',   decimals: 1 },
    { id: 'futures-price',  decimals: 1 },
    { id: 'time-to-expiry', decimals: 2 },
    { id: 'volatility',     decimals: 1 },
    { id: 'risk-free-rate', decimals: 1 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

function sliderVal(id) {
    return parseFloat($(`${id}-slider`).value) || 0;
}

function numVal(id) {
    return parseFloat($(id).value) || 0;
}

function getEnv() {
    const S = sliderVal('spot-price');
    const r_funding = sliderVal('funding-rate') / 100;
    const u = sliderVal('storage-cost') / 100;
    const y = sliderVal('conv-yield') / 100;
    const T = sliderVal('time-to-expiry');
    const F = computeForward(S, r_funding, u, y, T);

    return {
        S,
        F,
        r:      sliderVal('risk-free-rate') / 100,
        sigma:  sliderVal('volatility') / 100,
        T,
        spotMin: numVal('spot-min'),
        spotMax: numVal('spot-max'),
        convYield: y,
        storageCost: u,
        fundingRate: r_funding,
    };
}

function formatVal(v) {
    if (typeof v !== 'number' || isNaN(v)) return '—';
    const a = Math.abs(v);
    if (a === 0) return '0';
    if (a >= 1000) return v.toLocaleString('en', { maximumFractionDigits: 1 });
    if (a >= 0.01) return v.toFixed(4);
    return v.toExponential(2);
}

function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ─── Theme Toggle ────────────────────────────────────────────────────────────

function toggleTheme() {
    isDarkMode = !isDarkMode;
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
    LINE_COLORS = isDarkMode ? LINE_COLORS_DARK : LINE_COLORS_LIGHT;
    CHART_LAYOUT = getChartLayout();

    // Update toggle icon
    const icon = document.getElementById('theme-icon');
    if (icon) icon.innerHTML = isDarkMode ? '&#9788;' : '&#9790;';

    // Save preference
    try { localStorage.setItem('theme', isDarkMode ? 'dark' : 'light'); } catch(e) {}

    // Re-render all charts
    updateCharts();
    generateSurface();
    if (typeof refreshEnergyMarkets === 'function') refreshEnergyMarkets();
    if (typeof refreshPhysicalMarkets === 'function') refreshPhysicalMarkets();
    if (typeof refreshGeopolitics === 'function') refreshGeopolitics();
    if (typeof refreshCftc === 'function') refreshCftc();
}

function loadThemePreference() {
    try {
        const saved = localStorage.getItem('theme');
        if (saved === 'dark') {
            isDarkMode = true;
            document.documentElement.setAttribute('data-theme', 'dark');
            LINE_COLORS = LINE_COLORS_DARK;
            CHART_LAYOUT = getChartLayout();
            const icon = document.getElementById('theme-icon');
            if (icon) icon.innerHTML = '&#9788;';
        }
    } catch(e) {}
}

// ─── Initialization ──────────────────────────────────────────────────────────

function init() {
    loadThemePreference();

    // Render forward formula with KaTeX
    renderForwardFormula();

    // Populate commodity dropdown
    const sel = $('commodity-select');
    for (const name of Object.keys(COMMODITIES)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
    }
    sel.addEventListener('change', onCommodityChange);

    // Populate strategy dropdown
    const strat = $('strategy-select');
    for (const name of Object.keys(STRATEGIES)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        strat.appendChild(opt);
    }

    // Wire up sliders ↔ inputs (bidirectional sync)
    for (const s of SLIDERS) {
        const slider = $(`${s.id}-slider`);
        const input = $(`${s.id}-input`);
        if (!slider || !input) continue;

        const isForwardParam = FORWARD_SLIDERS.includes(s.id);
        // Time-to-expiry also affects F = S × e^((r+u-y)×T)
        const affectsForward = isForwardParam || s.id === 'time-to-expiry';

        slider.addEventListener('input', () => {
            input.value = parseFloat(slider.value).toFixed(s.decimals);
            if (affectsForward) updateForwardPrice();
            debouncedUpdate();
        });

        input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            if (!isNaN(v)) {
                if (v > parseFloat(slider.max)) slider.max = v * 1.5;
                if (v < parseFloat(slider.min) && v >= 0) slider.min = v;
                slider.value = v;
                if (affectsForward) updateForwardPrice();
                debouncedUpdate();
            }
        });
    }

    // When user manually changes futures price slider, back-solve spot price
    const fSlider = $('futures-price-slider');
    const fInput = $('futures-price-input');
    if (fSlider && fInput) {
        const backSolveSpot = () => {
            const F = parseFloat(fSlider.value);
            const r = sliderVal('funding-rate') / 100;
            const u = sliderVal('storage-cost') / 100;
            const y = sliderVal('conv-yield') / 100;
            const T = sliderVal('time-to-expiry');
            // F = S × e^((r+u-y)×T) → S = F / e^((r+u-y)×T)
            const S = F / Math.exp((r + u - y) * T);
            setSlider('spot-price', +S.toFixed(2));
            const el = $('computed-forward');
            if (el) el.textContent = F.toFixed(2);
        };
        fSlider.addEventListener('input', () => { backSolveSpot(); });
        fInput.addEventListener('input', () => { backSolveSpot(); });
    }

    // Wire up other number inputs
    for (const id of ['spot-min', 'spot-max', 'sweep-from', 'sweep-to', 'sweep-steps']) {
        $(id).addEventListener('input', debouncedUpdate);
    }
    $('sweep-param').addEventListener('change', debouncedUpdate);

    // Build metrics panel
    buildMetricsPanel();

    // Init charts
    Plotly.newPlot('payoff-chart', [], { ...CHART_LAYOUT }, CHART_CONFIG);
    Plotly.newPlot('greeks-chart', [], { ...CHART_LAYOUT }, CHART_CONFIG);
    Plotly.newPlot('theta-chart', [], { ...CHART_LAYOUT }, CHART_CONFIG);
    const ic = getChartColors();
    const initSceneAxis = (title) => ({ title, backgroundcolor: ic.bg, gridcolor: ic.grid, color: ic.muted, showbackground: true });
    Plotly.newPlot('surface-chart', [], {
        paper_bgcolor: ic.bg,
        plot_bgcolor: ic.bg,
        font: { color: ic.text, family: 'Inter, sans-serif', size: 11 },
        scene: {
            xaxis: initSceneAxis('Spot'),
            yaxis: initSceneAxis('Time'),
            zaxis: initSceneAxis('Delta'),
            bgcolor: ic.bg,
        },
        margin: { l: 0, r: 0, t: 10, b: 0 },
    }, CHART_CONFIG);

    // Resize
    window.addEventListener('resize', debounce(() => {
        Plotly.Plots.resize('payoff-chart');
        Plotly.Plots.resize('greeks-chart');
        Plotly.Plots.resize('surface-chart');
        Plotly.Plots.resize('theta-chart');
    }, 150));

    updateCharts();

    // Init default tab (Overview/Energy Markets)
    if (typeof initEnergyMarkets === 'function' && !marketsInitialized) {
        initEnergyMarkets();
        marketsInitialized = true;
    }
}

const debouncedUpdate = debounce(() => updateCharts(), 80);

// ─── Commodity change ────────────────────────────────────────────────────────

function onCommodityChange() {
    const c = COMMODITIES[$('commodity-select').value];
    if (!c) return;

    // Reset portfolio when switching commodity
    portfolio = [];
    renderLegs();

    // Forward curve parameters
    const spotSlider = $('spot-price-slider');
    spotSlider.max = Math.max(c.spot * 3, 50);
    spotSlider.step = c.spot < 10 ? 0.05 : 0.5;
    $('spot-price-input').step = c.spot < 10 ? 0.05 : 0.5;

    setSlider('spot-price', c.spot);
    setSlider('conv-yield', c.convYield);
    setSlider('storage-cost', c.storageCost);
    setSlider('funding-rate', c.rate);
    setSlider('volatility', c.vol);
    setSlider('risk-free-rate', c.rate);

    // Compute forward and set futures price slider
    updateForwardPrice();

    const env = getEnv();
    $('new-strike').value = env.F.toFixed(2);
    $('spot-min').value = +(env.F * 0.5).toFixed(2);
    $('spot-max').value = +(env.F * 2.0).toFixed(2);

    // Adjust futures price slider range
    const fSlider = $('futures-price-slider');
    fSlider.max = Math.max(env.F * 3, 50);
    fSlider.step = c.spot < 10 ? 0.05 : 0.5;
    $('futures-price-input').step = c.spot < 10 ? 0.05 : 0.5;

    updateCharts();
}

function setSlider(id, value) {
    const slider = $(`${id}-slider`);
    const input = $(`${id}-input`);
    const dec = SLIDERS.find(s => s.id === id)?.decimals ?? 1;
    slider.value = value;
    input.value = parseFloat(value).toFixed(dec);
}

function resetEnv() {
    onCommodityChange();
    setSlider('time-to-expiry', 1.0);
    updateForwardPrice();
    updateCharts();
}

// ─── Forward Formula Rendering ──────────────────────────────────────────────

function renderForwardFormula() {
    const el = $('forward-formula');
    if (!el) return;
    if (typeof katex !== 'undefined') {
        katex.render(String.raw`f^T(t) = S(t)\;\cdot\; e^{\left(r\,-\,(y_1\,-\,c)\right)\cdot(T-t)}`, el, {
            throwOnError: false, displayMode: false,
        });
    } else {
        // KaTeX not loaded yet (defer), retry once
        window.addEventListener('load', () => {
            if (typeof katex !== 'undefined') {
                katex.render(String.raw`f^T(t) = S(t)\;\cdot\; e^{\left(r\,-\,(y_1\,-\,c)\right)\cdot(T-t)}`, el, {
                    throwOnError: false, displayMode: false,
                });
            }
        });
    }
}

// ─── Forward Price Computation ──────────────────────────────────────────────

// IDs of sliders that feed the forward price formula
const FORWARD_SLIDERS = ['spot-price', 'conv-yield', 'storage-cost', 'funding-rate'];

function updateForwardPrice() {
    const S = sliderVal('spot-price');
    const r = sliderVal('funding-rate') / 100;
    const u = sliderVal('storage-cost') / 100;
    const y = sliderVal('conv-yield') / 100;
    const T = sliderVal('time-to-expiry');
    const F = computeForward(S, r, u, y, T);

    // Update the computed forward display
    const el = $('computed-forward');
    if (el) el.textContent = F.toFixed(2);

    // Sync the futures price slider on the right panel
    setSlider('futures-price', +F.toFixed(2));

    // Expand futures slider range if needed
    const fSlider = $('futures-price-slider');
    if (F > parseFloat(fSlider.max)) fSlider.max = F * 2;

    return F;
}

// ─── Portfolio Management ────────────────────────────────────────────────────

function addLeg() {
    const leg = {
        type: $('new-type').value,
        position: $('new-position').value,
        strike: parseFloat($('new-strike').value) || 100,
        quantity: parseInt($('new-qty').value) || 1,
    };
    portfolio.push(leg);
    renderLegs();
    updateCharts();
}

function removeLeg(idx) {
    portfolio.splice(idx, 1);
    renderLegs();
    updateCharts();
}

function updateLegStrike(idx, value) {
    const v = parseFloat(value);
    if (!isNaN(v) && v > 0) {
        portfolio[idx].strike = v;
        updateCharts();
    }
}

function clearLegs() {
    portfolio = [];
    renderLegs();
    updateCharts();
}

function applyStrategy() {
    const name = $('strategy-select').value;
    const F = sliderVal('futures-price');
    if (STRATEGIES[name]) {
        portfolio = STRATEGIES[name](F);
        renderLegs();
        updateCharts();
    }
}

function renderLegs() {
    const container = $('legs-container');
    $('leg-count').textContent = portfolio.length;

    if (portfolio.length === 0) {
        container.innerHTML = '<div class="legs-empty">No positions</div>';
        return;
    }

    container.innerHTML = portfolio.map((leg, i) => {
        const side = leg.position === 'long' ? 'Long' : 'Short';
        const typ = leg.type === 'call' ? 'Call' : 'Put';
        const isShort = leg.position === 'short';
        const sign = isShort ? '-' : '+';
        return `
            <div class="leg-item ${isShort ? 'short' : ''}">
                <div style="flex:1">
                    <div class="leg-label">
                        ${side} ${typ} K=<input type="number" class="leg-strike-input"
                            value="${leg.strike.toFixed(2)}" step="0.5"
                            onchange="updateLegStrike(${i}, this.value)"
                            oninput="updateLegStrike(${i}, this.value)">
                    </div>
                    <div class="leg-qty">QTY: ${sign}${leg.quantity}</div>
                </div>
                <button class="leg-remove" onclick="removeLeg(${i})">&times;</button>
            </div>`;
    }).join('');
}

// ─── Metrics Panel ───────────────────────────────────────────────────────────

function buildMetricsPanel() {
    const container = $('metrics-container');
    let html = '';

    for (const name of ALL_METRICS) {
        if (SECTION_BREAKS[name]) {
            html += `<div class="metric-section">${SECTION_BREAKS[name]}</div>`;
        }
        const isPayoff = name === 'payoff';
        html += `
            <div class="metric-row ${activeMetrics.includes(name) ? 'active' : ''} ${isPayoff ? 'payoff-metric' : ''}"
                 id="metric-${name}" onclick="${isPayoff ? '' : `toggleMetric('${name}')`}"
                 ${isPayoff ? 'title="Payoff is always shown in the payoff chart above"' : ''}>
                <span>${name.toUpperCase()}${isPayoff ? ' ↑' : ''}</span>
                <span class="metric-val" id="mval-${name}">&mdash;</span>
            </div>`;
    }
    container.innerHTML = html;
}

function toggleMetric(name) {
    if (name === 'payoff') return; // payoff has its own chart
    const idx = activeMetrics.indexOf(name);
    if (idx >= 0) {
        activeMetrics.splice(idx, 1);
    } else {
        activeMetrics.push(name);
    }
    updateMetricStyles();
    updateCharts();
}

function updateMetricStyles() {
    for (const name of ALL_METRICS) {
        const el = document.getElementById(`metric-${name}`);
        if (!el) continue;

        if (name === 'payoff') {
            el.style.borderLeftColor = LINE_COLORS[0];
            el.style.backgroundColor = isDarkMode ? 'rgba(96,165,250,0.1)' : 'rgba(37,99,235,0.08)';
            el.style.opacity = '0.7';
            el.style.cursor = 'default';
            continue;
        }

        const isActive = activeMetrics.includes(name);
        el.classList.toggle('active', isActive);

        if (isActive) {
            const ci = activeMetrics.indexOf(name) % LINE_COLORS.length;
            el.style.borderLeftColor = LINE_COLORS[ci];
            el.style.backgroundColor = `${LINE_COLORS[ci]}18`;
        } else {
            el.style.borderLeftColor = 'transparent';
            el.style.backgroundColor = 'transparent';
        }
    }
}

// ─── Chart Updates ───────────────────────────────────────────────────────────

function updateCharts() {
    CHART_LAYOUT = getChartLayout();
    const cc = getChartColors();
    const env = getEnv();
    if (env.spotMin >= env.spotMax || env.spotMin < 0) return;

    const spotRange = linspace(env.spotMin, env.spotMax, 200);

    // Current portfolio greeks at F
    const current = portfolio.length > 0
        ? portfolioGreeks(portfolio, env.F, env.r, env.sigma, env.T)
        : {};

    if (portfolio.length > 0) {
        const payoffs = portfolioPayoff(portfolio, [env.F]);
        current.payoff = payoffs[0];
    }

    // Update metric values
    for (const name of ALL_METRICS) {
        const el = document.getElementById(`mval-${name}`);
        if (el) el.textContent = formatVal(current[name]);
    }
    updateMetricStyles();

    // ─── Empty state: show grid with zero line ───
    const emptyLayout = (yTitle) => ({
        ...CHART_LAYOUT,
        xaxis: { ...CHART_LAYOUT.xaxis, title: 'Underlying Price (F)', range: [env.spotMin, env.spotMax] },
        yaxis: { ...CHART_LAYOUT.yaxis, title: yTitle },
        shapes: [{
            type: 'line', x0: env.F, x1: env.F, y0: 0, y1: 1, yref: 'paper',
            line: { color: cc.muted, width: 1, dash: 'dot' },
        }],
        annotations: portfolio.length === 0 ? [{
            text: 'Add positions to begin analysis',
            xref: 'paper', yref: 'paper', x: 0.5, y: 0.5,
            showarrow: false, font: { size: 13, color: cc.muted },
        }] : [],
    });

    if (portfolio.length === 0) {
        const zeroLine = { x: spotRange, y: spotRange.map(() => 0), type: 'scatter', mode: 'lines',
            line: { color: cc.zeroLine, width: 1 }, showlegend: false, hoverinfo: 'skip' };
        Plotly.react('payoff-chart', [zeroLine], emptyLayout('Payoff / Price'), CHART_CONFIG);
        Plotly.react('greeks-chart', [zeroLine], emptyLayout('Greeks'), CHART_CONFIG);
        Plotly.react('theta-chart', [zeroLine], emptyLayout('Portfolio Value'), CHART_CONFIG);
        return;
    }

    // Payoff trace
    const payoffData = portfolioPayoff(portfolio, spotRange);
    const hedgeOn = document.getElementById('hedge-toggle')?.checked;

    const payoffTraces = [{
        x: spotRange,
        y: payoffData,
        name: 'STRATEGY',
        type: 'scatter',
        mode: 'lines',
        line: hedgeOn
            ? { color: isDarkMode ? '#64748b' : '#94a3b8', width: 1.5 }
            : { color: LINE_COLORS[0], width: 2.5 },
        fill: hedgeOn ? undefined : 'tozeroy',
        fillcolor: hedgeOn ? undefined : (isDarkMode ? 'rgba(96,165,250,0.08)' : 'rgba(0,48,97,0.06)'),
    }];

    // Hedge overlay: add underlying + combined payoff
    if (hedgeOn) {
        const hedgePos = document.getElementById('hedge-position')?.value || 'long';
        const hedgeSign = hedgePos === 'long' ? 1 : -1;
        const underlyingPnl = spotRange.map(S => hedgeSign * (S - env.F));
        const combinedPnl = spotRange.map((S, i) => payoffData[i] + underlyingPnl[i]);

        payoffTraces.push({
            x: spotRange,
            y: underlyingPnl,
            name: `${hedgePos.toUpperCase()} UNDERLYING`,
            type: 'scatter',
            mode: 'lines',
            line: { color: isDarkMode ? '#94a3b8' : '#94a3b8', width: 1.5, dash: 'dot' },
        });
        payoffTraces.push({
            x: spotRange,
            y: combinedPnl,
            name: 'COMBINED',
            type: 'scatter',
            mode: 'lines',
            line: { color: LINE_COLORS[0], width: 2.5 },
            fill: 'tozeroy',
            fillcolor: (isDarkMode ? 'rgba(96,165,250,0.08)' : 'rgba(0,48,97,0.06)'),
        });
    }

    // Add price overlay on payoff chart
    const priceData = spotRange.map(S => {
        const g = portfolioGreeks(portfolio, S, env.r, env.sigma, env.T);
        return g.price || 0;
    });
    payoffTraces.push({
        x: spotRange,
        y: priceData,
        name: 'PRICE (CURRENT)',
        type: 'scatter',
        mode: 'lines',
        line: { color: LINE_COLORS[1], width: 1.5, dash: 'dash' },
        yaxis: 'y',
    });

    const payoffShapes = [{
        type: 'line', x0: env.F, x1: env.F, y0: 0, y1: 1, yref: 'paper',
        line: { color: cc.muted, width: 1, dash: 'dot' },
    }];

    // Collect unique strikes for x-axis tick marks (forward shown as annotation instead)
    const strikes = [...new Set(portfolio.map(l => l.strike))].sort((a, b) => a - b);
    const xTickVals = strikes;
    const xTickText = strikes.map(v => `K=${v.toFixed(1)}`);

    // Add vertical lines at each strike
    for (const k of strikes) {
        payoffShapes.push({
            type: 'line', x0: k, x1: k, y0: 0, y1: 1, yref: 'paper',
            line: { color: cc.grid, width: 1, dash: 'dash' },
        });
    }

    // Forward price annotation at top of the dotted line
    const fwdAnnotation = {
        x: env.F, y: 1, xref: 'x', yref: 'paper',
        text: `F = ${env.F.toFixed(2)}`,
        showarrow: false,
        font: { size: 9, color: cc.muted, family: 'JetBrains Mono, monospace' },
        yanchor: 'bottom',
        bgcolor: isDarkMode ? 'rgba(17,24,39,0.85)' : 'rgba(255,255,255,0.85)',
        borderpad: 2,
    };

    Plotly.react('payoff-chart', payoffTraces, {
        ...CHART_LAYOUT,
        xaxis: {
            ...CHART_LAYOUT.xaxis,
            title: { text: 'Underlying Price (F)', standoff: 20 },
            tickvals: xTickVals,
            ticktext: xTickText,
            tickangle: -30,
            tickfont: { size: 9, color: cc.muted, family: 'JetBrains Mono, monospace' },
        },
        yaxis: { ...CHART_LAYOUT.yaxis, title: { text: 'PAYOFF / PRICE', font: { size: 11, color: cc.muted } } },
        shapes: payoffShapes,
        showlegend: true,
        annotations: [fwdAnnotation],
    }, CHART_CONFIG);

    // ─── GREEKS CHART ───
    const greekTraces = [];

    // Filter active metrics to greeks only (no payoff)
    const activeGreeks = activeMetrics.filter(m => m !== 'payoff');

    if (activeGreeks.length === 0) {
        const zeroLine2 = { x: spotRange, y: spotRange.map(() => 0), type: 'scatter', mode: 'lines',
            line: { color: cc.zeroLine, width: 1 }, showlegend: false, hoverinfo: 'skip' };
        Plotly.react('greeks-chart', [zeroLine2], {
            ...CHART_LAYOUT,
            xaxis: { ...CHART_LAYOUT.xaxis, title: 'Underlying Price (F)', range: [env.spotMin, env.spotMax] },
            yaxis: { ...CHART_LAYOUT.yaxis, title: 'Greeks' },
            shapes: [{ type: 'line', x0: env.F, x1: env.F, y0: 0, y1: 1, yref: 'paper',
                line: { color: cc.muted, width: 1, dash: 'dot' } }],
        }, CHART_CONFIG);
        updateThetaDecay(env, spotRange);
        return;
    }

    // Determine Y1 / Y2 split
    const y1Metric = activeGreeks[0];
    const y2Metrics = activeGreeks.slice(1);
    const needsY2 = y2Metrics.length > 0;

    // Y1
    {
        const ci = activeMetrics.indexOf(y1Metric) % LINE_COLORS.length;
        const yData = spotRange.map(S => {
            const g = portfolioGreeks(portfolio, S, env.r, env.sigma, env.T);
            return g[y1Metric] || 0;
        });
        greekTraces.push({
            x: spotRange, y: yData, name: y1Metric.toUpperCase(),
            type: 'scatter', mode: 'lines',
            line: { color: LINE_COLORS[ci], width: 2 }, yaxis: 'y',
        });
    }

    // Y2
    for (const metric of y2Metrics) {
        const ci = activeMetrics.indexOf(metric) % LINE_COLORS.length;
        const yData = spotRange.map(S => {
            const g = portfolioGreeks(portfolio, S, env.r, env.sigma, env.T);
            return g[metric] || 0;
        });
        greekTraces.push({
            x: spotRange, y: yData, name: metric.toUpperCase(),
            type: 'scatter', mode: 'lines',
            line: { color: LINE_COLORS[ci], width: 2 },
            yaxis: needsY2 ? 'y2' : 'y',
        });
    }

    // Sweep lines on greeks chart
    const sweepMetric = activeGreeks[0];
    if (sweepMetric) {
        const param = $('sweep-param').value;
        let from = numVal('sweep-from');
        let to = numVal('sweep-to');
        const steps = parseInt($('sweep-steps').value) || 8;

        if (from > 0 && to > 0 && steps >= 2) {
            if (param === 'volatility') {
                if (from > 1) from /= 100;
                if (to > 1) to /= 100;
            }
            const sweepVals = linspace(from, to, steps);

            for (let si = 0; si < sweepVals.length; si++) {
                const sv = sweepVals[si];
                const alpha = 0.12 + 0.55 * (si / Math.max(steps - 1, 1));
                const yy = spotRange.map(S => {
                    const rr = param === 'risk_free_rate' ? sv : env.r;
                    const ss = param === 'volatility' ? sv : env.sigma;
                    const tt = param === 'time_to_expiry' ? sv : env.T;
                    const g = portfolioGreeks(portfolio, S, rr, ss, tt);
                    return g[sweepMetric] || 0;
                });

                greekTraces.push({
                    x: spotRange, y: yy,
                    name: `${param}=${sv.toFixed(3)}`,
                    type: 'scatter', mode: 'lines',
                    line: { color: cc.sweepColor(alpha), width: 1, dash: 'dot' },
                    showlegend: false, yaxis: 'y',
                    hovertemplate: `${param}=${sv.toFixed(3)}<br>%{x:.2f}: %{y:.4f}<extra></extra>`,
                });
            }
        }
    }

    const greeksLayout = {
        ...CHART_LAYOUT,
        xaxis: { ...CHART_LAYOUT.xaxis, title: 'Underlying Price (F)' },
        yaxis: {
            ...CHART_LAYOUT.yaxis,
            title: { text: y1Metric.toUpperCase(), font: { size: 11, color: LINE_COLORS[activeMetrics.indexOf(y1Metric) % LINE_COLORS.length] } },
        },
        shapes: [{
            type: 'line', x0: env.F, x1: env.F, y0: 0, y1: 1, yref: 'paper',
            line: { color: cc.muted, width: 1, dash: 'dot' },
        }],
        showlegend: true,
        annotations: [],
    };

    if (needsY2) {
        const y2Label = y2Metrics.map(m => m.toUpperCase()).join(' / ');
        const y2ci = activeMetrics.indexOf(y2Metrics[0]) % LINE_COLORS.length;
        greeksLayout.yaxis2 = {
            overlaying: 'y', side: 'right',
            gridcolor: cc.grid, zerolinecolor: cc.zero,
            tickfont: { size: 10, color: cc.muted },
            title: { text: y2Label, font: { size: 11, color: LINE_COLORS[y2ci] } },
        };
    }

    Plotly.react('greeks-chart', greekTraces, greeksLayout, CHART_CONFIG);

    // ─── THETA DECAY CHART ───
    updateThetaDecay(env, spotRange);
}

// ─── Theta Decay ─────────────────────────────────────────────────────────

function updateThetaDecay(env, spotRange) {
    if (portfolio.length === 0) return;
    const cc = getChartColors();

    const nSteps = 7;
    const times = linspace(env.T, 0.01, nSteps);
    const DECAY_COLORS_LIGHT = ['#003061', '#0a4a8a', '#1a6bb5', '#d97706', '#f59e0b', '#ef4444', '#dc2626'];
    const DECAY_COLORS_DARK  = ['#60a5fa', '#93c5fd', '#bfdbfe', '#fbbf24', '#fcd34d', '#f87171', '#fca5a5'];
    const decayColors = isDarkMode ? DECAY_COLORS_DARK : DECAY_COLORS_LIGHT;
    const traces = [];

    for (let i = 0; i < times.length; i++) {
        const t = times[i];
        const yData = spotRange.map(S => {
            const g = portfolioGreeks(portfolio, S, env.r, env.sigma, t);
            return g.price || 0;
        });
        const label = t >= 1 ? `T=${t.toFixed(1)}y` : `T=${(t * 365).toFixed(0)}d`;
        traces.push({
            x: spotRange, y: yData,
            name: label,
            type: 'scatter', mode: 'lines',
            line: { color: decayColors[i % decayColors.length], width: i === 0 ? 2.5 : 1.5 },
        });
    }

    // Add payoff at expiry
    const payoffData = portfolioPayoff(portfolio, spotRange);
    traces.push({
        x: spotRange, y: payoffData,
        name: 'EXPIRY',
        type: 'scatter', mode: 'lines',
        line: { color: cc.muted, width: 2, dash: 'dash' },
    });

    Plotly.react('theta-chart', traces, {
        ...CHART_LAYOUT,
        xaxis: { ...CHART_LAYOUT.xaxis, title: 'Underlying Price (F)' },
        yaxis: { ...CHART_LAYOUT.yaxis, title: { text: 'PORTFOLIO VALUE', font: { size: 11, color: cc.muted } } },
        shapes: [{
            type: 'line', x0: env.F, x1: env.F, y0: 0, y1: 1, yref: 'paper',
            line: { color: cc.muted, width: 1, dash: 'dot' },
        }],
        showlegend: true,
    }, CHART_CONFIG);
}

// ─── 3D Surface ──────────────────────────────────────────────────────────────

function generateSurface() {
    if (portfolio.length === 0) return;

    const env = getEnv();
    const greek = $('surface-greek').value;
    const axis = $('surface-axis').value;

    const nSpot = 40;
    const nSecond = 25;
    const spotRange = linspace(env.spotMin, env.spotMax, nSpot);

    let secondRange, axisTitle;
    if (axis === 'time_to_expiry') {
        secondRange = linspace(0.02, Math.max(env.T * 2, 0.5), nSecond);
        axisTitle = 'Time to Maturity (T)';
    } else {
        secondRange = linspace(Math.max(env.sigma * 0.2, 0.05), env.sigma * 2.5, nSecond);
        axisTitle = 'Volatility (σ)';
    }

    const surface = computeGreekSurface(portfolio, greek, spotRange, secondRange, axis, env);

    const cc = getChartColors();
    const trace = {
        type: 'surface',
        x: spotRange,
        y: secondRange,
        z: surface,
        colorscale: 'Viridis',
        opacity: 0.92,
        contours: {
            z: { show: true, usecolormap: true, highlightcolor: cc.surfaceHighlight, project: { z: true } },
        },
        colorbar: {
            title: { text: greek.toUpperCase(), font: { size: 11, color: cc.muted } },
            tickfont: { size: 10, color: cc.muted },
            len: 0.6,
        },
    };

    const sceneAxis = (title) => ({ title, backgroundcolor: cc.bg, gridcolor: cc.grid, color: cc.muted, showbackground: true });
    const layout = {
        paper_bgcolor: cc.bg,
        plot_bgcolor: cc.bg,
        font: { color: cc.text, family: 'Inter, sans-serif', size: 11 },
        scene: {
            xaxis: sceneAxis('Spot Price'),
            yaxis: sceneAxis(axisTitle),
            zaxis: sceneAxis(greek.toUpperCase()),
            bgcolor: cc.bg,
        },
        margin: { l: 0, r: 0, t: 10, b: 0 },
    };

    Plotly.react('surface-chart', [trace], layout, CHART_CONFIG);
}

// ─── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
