/**
 * Energy Derivatives Terminal — UI Controller
 */

// ─── State ───────────────────────────────────────────────────────────────────

let portfolio = [];
let activeMetrics = ['delta'];

const LINE_COLORS = ['#2563eb', '#d97706', '#7c3aed', '#059669', '#dc2626', '#db2777'];
const ALL_METRICS = [
    'payoff', 'price', 'delta', 'gamma', 'vega', 'theta', 'rho',
    'vanna', 'volga',
];
const GREEKS_ONLY = ['price', 'delta', 'gamma', 'vega', 'theta', 'rho', 'vanna', 'volga'];
const SECTION_BREAKS = { 'vanna': '2ND ORDER CROSS' };

const CHART_LAYOUT = {
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    font: { color: '#1e293b', family: 'Inter, sans-serif', size: 11 },
    xaxis: { gridcolor: '#e2e8f0', zerolinecolor: '#cbd5e1', tickfont: { size: 10, color: '#64748b' } },
    yaxis: { gridcolor: '#e2e8f0', zerolinecolor: '#cbd5e1', tickfont: { size: 10, color: '#64748b' } },
    margin: { l: 55, r: 55, t: 25, b: 40 },
    legend: { bgcolor: 'rgba(255,255,255,0)', font: { size: 10, color: '#64748b' }, orientation: 'h', yanchor: 'bottom', y: 1.02 },
    hovermode: 'x unified',
};

const CHART_CONFIG = {
    displayModeBar: true,
    displaylogo: false,
    responsive: true,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
};

// ─── Slider definitions ─────────────────────────────────────────────────────

const SLIDERS = [
    { id: 'futures-price',  decimals: 1 },
    { id: 'time-to-expiry', decimals: 2 },
    { id: 'volatility',     decimals: 1 },
    { id: 'risk-free-rate', decimals: 1 },
    { id: 'div-yield',      decimals: 1 },
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
    return {
        F:      sliderVal('futures-price'),
        r:      sliderVal('risk-free-rate') / 100,
        sigma:  sliderVal('volatility') / 100,
        T:      sliderVal('time-to-expiry'),
        spotMin: numVal('spot-min'),
        spotMax: numVal('spot-max'),
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

// ─── Initialization ──────────────────────────────────────────────────────────

function init() {
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

        slider.addEventListener('input', () => {
            input.value = parseFloat(slider.value).toFixed(s.decimals);
            debouncedUpdate();
        });

        input.addEventListener('input', () => {
            const v = parseFloat(input.value);
            if (!isNaN(v)) {
                // Expand slider range if user types a value beyond current max
                if (v > parseFloat(slider.max)) slider.max = v * 1.5;
                if (v < parseFloat(slider.min) && v >= 0) slider.min = v;
                slider.value = v;
                debouncedUpdate();
            }
        });
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
    Plotly.newPlot('surface-chart', [], {
        ...CHART_LAYOUT,
        scene: {
            xaxis: { title: 'Spot', backgroundcolor: '#ffffff', gridcolor: '#e2e8f0', color: '#64748b' },
            yaxis: { title: 'Time', backgroundcolor: '#ffffff', gridcolor: '#e2e8f0', color: '#64748b' },
            zaxis: { title: 'Delta', backgroundcolor: '#ffffff', gridcolor: '#e2e8f0', color: '#64748b' },
            bgcolor: '#ffffff',
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
}

const debouncedUpdate = debounce(() => updateCharts(), 80);

// ─── Commodity change ────────────────────────────────────────────────────────

function onCommodityChange() {
    const c = COMMODITIES[$('commodity-select').value];
    if (!c) return;

    // Reset portfolio when switching commodity
    portfolio = [];
    renderLegs();

    // Adjust slider range for this commodity
    const fSlider = $('futures-price-slider');
    fSlider.max = Math.max(c.F * 3, 50);
    fSlider.step = c.F < 10 ? 0.05 : 0.5;
    $('futures-price-input').step = c.F < 10 ? 0.05 : 0.5;

    setSlider('futures-price', c.F);
    setSlider('volatility', c.vol);
    setSlider('risk-free-rate', c.rate);

    $('new-strike').value = c.F;
    $('spot-min').value = +(c.F * 0.5).toFixed(2);
    $('spot-max').value = +(c.F * 2.0).toFixed(2);

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
    setSlider('div-yield', 0.0);
    updateCharts();
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
            el.style.borderLeftColor = '#2563eb';
            el.style.backgroundColor = 'rgba(37,99,235,0.08)';
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
            line: { color: '#64748b', width: 1, dash: 'dot' },
        }],
        annotations: portfolio.length === 0 ? [{
            text: 'Add positions to begin analysis',
            xref: 'paper', yref: 'paper', x: 0.5, y: 0.5,
            showarrow: false, font: { size: 13, color: '#64748b' },
        }] : [],
    });

    if (portfolio.length === 0) {
        // Show empty charts with proper axes
        const zeroLine = { x: spotRange, y: spotRange.map(() => 0), type: 'scatter', mode: 'lines',
            line: { color: 'rgba(148,163,184,0.4)', width: 1 }, showlegend: false, hoverinfo: 'skip' };
        Plotly.react('payoff-chart', [zeroLine], emptyLayout('Payoff / Price'), CHART_CONFIG);
        Plotly.react('greeks-chart', [zeroLine], emptyLayout('Greeks'), CHART_CONFIG);
        Plotly.react('theta-chart', [zeroLine], emptyLayout('Portfolio Value'), CHART_CONFIG);
        return;
    }

    // Payoff trace
    const payoffData = portfolioPayoff(portfolio, spotRange);
    const payoffTraces = [{
        x: spotRange,
        y: payoffData,
        name: 'PAYOFF',
        type: 'scatter',
        mode: 'lines',
        line: { color: '#2563eb', width: 2.5 },
        fill: 'tozeroy',
        fillcolor: 'rgba(37,99,235,0.06)',
    }];

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
        line: { color: '#d97706', width: 1.5, dash: 'dash' },
        yaxis: 'y',
    });

    const payoffShapes = [{
        type: 'line', x0: env.F, x1: env.F, y0: 0, y1: 1, yref: 'paper',
        line: { color: '#64748b', width: 1, dash: 'dot' },
    }];

    Plotly.react('payoff-chart', payoffTraces, {
        ...CHART_LAYOUT,
        xaxis: { ...CHART_LAYOUT.xaxis, title: 'Underlying Price (F)' },
        yaxis: { ...CHART_LAYOUT.yaxis, title: { text: 'PAYOFF / PRICE', font: { size: 11, color: '#64748b' } } },
        shapes: payoffShapes,
        showlegend: true,
        annotations: [],
    }, CHART_CONFIG);

    // ─── GREEKS CHART ───
    const greekTraces = [];

    // Filter active metrics to greeks only (no payoff)
    const activeGreeks = activeMetrics.filter(m => m !== 'payoff');

    if (activeGreeks.length === 0) {
        const zeroLine2 = { x: spotRange, y: spotRange.map(() => 0), type: 'scatter', mode: 'lines',
            line: { color: 'rgba(148,163,184,0.4)', width: 1 }, showlegend: false, hoverinfo: 'skip' };
        Plotly.react('greeks-chart', [zeroLine2], {
            ...CHART_LAYOUT,
            xaxis: { ...CHART_LAYOUT.xaxis, title: 'Underlying Price (F)', range: [env.spotMin, env.spotMax] },
            yaxis: { ...CHART_LAYOUT.yaxis, title: 'Greeks' },
            shapes: [{ type: 'line', x0: env.F, x1: env.F, y0: 0, y1: 1, yref: 'paper',
                line: { color: '#64748b', width: 1, dash: 'dot' } }],
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
                    line: { color: `rgba(124,58,237,${alpha})`, width: 1, dash: 'dot' },
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
            line: { color: '#64748b', width: 1, dash: 'dot' },
        }],
        showlegend: true,
        annotations: [],
    };

    if (needsY2) {
        const y2Label = y2Metrics.map(m => m.toUpperCase()).join(' / ');
        const y2ci = activeMetrics.indexOf(y2Metrics[0]) % LINE_COLORS.length;
        greeksLayout.yaxis2 = {
            overlaying: 'y', side: 'right',
            gridcolor: 'rgba(226,232,240,0.5)', zerolinecolor: '#cbd5e1',
            tickfont: { size: 10, color: '#64748b' },
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

    const nSteps = 7;
    const times = linspace(env.T, 0.01, nSteps);
    const DECAY_COLORS = ['#2563eb', '#3b82f6', '#60a5fa', '#d97706', '#f59e0b', '#ef4444', '#dc2626'];
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
            line: { color: DECAY_COLORS[i % DECAY_COLORS.length], width: i === 0 ? 2.5 : 1.5 },
        });
    }

    // Add payoff at expiry
    const payoffData = portfolioPayoff(portfolio, spotRange);
    traces.push({
        x: spotRange, y: payoffData,
        name: 'EXPIRY',
        type: 'scatter', mode: 'lines',
        line: { color: '#64748b', width: 2, dash: 'dash' },
    });

    Plotly.react('theta-chart', traces, {
        ...CHART_LAYOUT,
        xaxis: { ...CHART_LAYOUT.xaxis, title: 'Underlying Price (F)' },
        yaxis: { ...CHART_LAYOUT.yaxis, title: { text: 'PORTFOLIO VALUE', font: { size: 11, color: '#64748b' } } },
        shapes: [{
            type: 'line', x0: env.F, x1: env.F, y0: 0, y1: 1, yref: 'paper',
            line: { color: '#64748b', width: 1, dash: 'dot' },
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

    const trace = {
        type: 'surface',
        x: spotRange,
        y: secondRange,
        z: surface,
        colorscale: 'Viridis',
        opacity: 0.92,
        contours: {
            z: { show: true, usecolormap: true, highlightcolor: '#2563eb', project: { z: true } },
        },
        colorbar: {
            title: { text: greek.toUpperCase(), font: { size: 11, color: '#64748b' } },
            tickfont: { size: 10, color: '#64748b' },
            len: 0.6,
        },
    };

    const layout = {
        ...CHART_LAYOUT,
        scene: {
            xaxis: { title: 'Spot Price', backgroundcolor: '#ffffff', gridcolor: '#e2e8f0', color: '#64748b' },
            yaxis: { title: axisTitle, backgroundcolor: '#ffffff', gridcolor: '#e2e8f0', color: '#64748b' },
            zaxis: { title: greek.toUpperCase(), backgroundcolor: '#ffffff', gridcolor: '#e2e8f0', color: '#64748b' },
            bgcolor: '#ffffff',
        },
        margin: { l: 0, r: 0, t: 10, b: 0 },
    };

    Plotly.react('surface-chart', [trace], layout, CHART_CONFIG);
}

// ─── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
