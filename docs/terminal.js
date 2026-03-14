/**
 * Energy Derivatives Terminal — UI Controller
 */

// ─── State ───────────────────────────────────────────────────────────────────

let portfolio = [];
let activeMetrics = ['payoff'];

const LINE_COLORS = ['#06b6d4', '#f59e0b', '#8b5cf6', '#10b981', '#ef4444', '#ec4899'];
const ALL_METRICS = [
    'payoff', 'price', 'delta', 'gamma', 'vega', 'theta', 'rho',
    'vanna', 'volga',
    'speed', 'zomma', 'color', 'ultima'
];
const SECTION_BREAKS = { 'vanna': '2ND ORDER CROSS', 'speed': '3RD ORDER GREEKS' };

const CHART_LAYOUT = {
    paper_bgcolor: '#111827',
    plot_bgcolor: '#111827',
    font: { color: '#e2e8f0', family: 'JetBrains Mono, monospace', size: 11 },
    xaxis: { gridcolor: '#1e293b', zerolinecolor: '#334155', tickfont: { size: 10, color: '#94a3b8' } },
    yaxis: { gridcolor: '#1e293b', zerolinecolor: '#334155', tickfont: { size: 10, color: '#94a3b8' } },
    margin: { l: 55, r: 55, t: 25, b: 40 },
    legend: { bgcolor: 'rgba(0,0,0,0)', font: { size: 10, color: '#94a3b8' }, orientation: 'h', yanchor: 'bottom', y: 1.02 },
    hovermode: 'x unified',
};

const CHART_CONFIG = {
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const val = id => parseFloat($(id).value) || 0;

function getEnv() {
    return {
        F: val('futures-price'),
        r: val('risk-free-rate') / 100,
        sigma: val('volatility') / 100,
        T: val('time-to-expiry'),
        spotMin: val('spot-min'),
        spotMax: val('spot-max'),
    };
}

function formatVal(v) {
    if (typeof v !== 'number' || isNaN(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1000) return v.toLocaleString('en', { maximumFractionDigits: 1 });
    if (a >= 1) return v.toFixed(4);
    if (a >= 0.001) return v.toFixed(6);
    return v.toExponential(2);
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

    // Build metrics panel
    buildMetricsPanel();

    // Attach input listeners for live updates
    const inputs = ['futures-price', 'time-to-expiry', 'risk-free-rate', 'volatility',
                    'div-yield', 'spot-min', 'spot-max', 'sweep-param', 'sweep-from',
                    'sweep-to', 'sweep-steps'];
    for (const id of inputs) {
        $(id).addEventListener('input', debounce(updateCharts, 150));
    }

    // Init charts
    Plotly.newPlot('main-chart', [], { ...CHART_LAYOUT }, CHART_CONFIG);
    Plotly.newPlot('surface-chart', [], {
        ...CHART_LAYOUT,
        scene: {
            xaxis: { title: 'Spot', backgroundcolor: '#111827', gridcolor: '#1e293b', color: '#94a3b8' },
            yaxis: { title: 'Time', backgroundcolor: '#111827', gridcolor: '#1e293b', color: '#94a3b8' },
            zaxis: { title: 'Delta', backgroundcolor: '#111827', gridcolor: '#1e293b', color: '#94a3b8' },
            bgcolor: '#111827',
        },
        margin: { l: 0, r: 0, t: 10, b: 0 },
    }, CHART_CONFIG);

    // Resize handling
    const resizeObs = new ResizeObserver(debounce(() => {
        Plotly.Plots.resize('main-chart');
        Plotly.Plots.resize('surface-chart');
    }, 100));
    resizeObs.observe($('main-chart'));
    resizeObs.observe($('surface-chart'));

    updateCharts();
}

function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ─── Commodity change ────────────────────────────────────────────────────────

function onCommodityChange() {
    const c = COMMODITIES[$('commodity-select').value];
    if (!c) return;
    $('futures-price').value = c.F;
    $('volatility').value = c.vol;
    $('risk-free-rate').value = c.rate;
    $('new-strike').value = c.F;
    $('spot-min').value = +(c.F * 0.5).toFixed(1);
    $('spot-max').value = +(c.F * 2.0).toFixed(1);
    updateCharts();
}

function resetEnv() {
    onCommodityChange();
    $('time-to-expiry').value = '1.00';
    $('div-yield').value = '0.0';
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

function clearLegs() {
    portfolio = [];
    renderLegs();
    updateCharts();
}

function applyStrategy() {
    const name = $('strategy-select').value;
    const F = val('futures-price');
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
        const label = leg.label || `${side} ${typ} K=${leg.strike.toFixed(2)}`;
        const isShort = leg.position === 'short';
        const sign = isShort ? '-' : '+';
        return `
            <div class="leg-item ${isShort ? 'short' : ''}">
                <div>
                    <div class="leg-label">${label}</div>
                    <div class="leg-qty">QTY: ${sign}${leg.quantity}</div>
                </div>
                <button class="leg-remove" onclick="removeLeg(${i})">×</button>
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
        html += `
            <div class="metric-row ${activeMetrics.includes(name) ? 'active' : ''}"
                 id="metric-${name}" onclick="toggleMetric('${name}')">
                <span>${name.toUpperCase()}</span>
                <span class="metric-val" id="mval-${name}">—</span>
            </div>`;
    }
    container.innerHTML = html;
}

function toggleMetric(name) {
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
    const spotRange = linspace(env.spotMin, env.spotMax, 200);

    // Current portfolio greeks at F
    const current = portfolio.length > 0
        ? portfolioGreeks(portfolio, env.F, env.r, env.sigma, env.T)
        : {};

    // Add payoff value
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

    // Build traces
    const traces = [];

    if (portfolio.length === 0) {
        Plotly.react('main-chart', [], {
            ...CHART_LAYOUT,
            xaxis: { ...CHART_LAYOUT.xaxis, title: 'Underlying Price (F)' },
            annotations: [{
                text: 'Add positions to begin analysis',
                xref: 'paper', yref: 'paper', x: 0.5, y: 0.5,
                showarrow: false, font: { size: 14, color: '#64748b' },
            }],
        }, CHART_CONFIG);
        return;
    }

    // Determine if we need dual Y axes
    const needsY2 = activeMetrics.length > 1;

    for (let mi = 0; mi < activeMetrics.length; mi++) {
        const metric = activeMetrics[mi];
        const ci = mi % LINE_COLORS.length;
        const color = LINE_COLORS[ci];

        let y;
        if (metric === 'payoff') {
            y = portfolioPayoff(portfolio, spotRange);
        } else {
            y = spotRange.map(S => {
                const g = portfolioGreeks(portfolio, S, env.r, env.sigma, env.T);
                return g[metric] || 0;
            });
        }

        traces.push({
            x: spotRange,
            y: y,
            name: metric.toUpperCase(),
            type: 'scatter',
            mode: 'lines',
            line: { color, width: 2 },
            yaxis: mi === 0 ? 'y' : 'y2',
            fill: metric === 'payoff' ? 'tozeroy' : undefined,
            fillcolor: metric === 'payoff' ? `${color}0d` : undefined,
        });
    }

    // Sweep lines for the first non-payoff active metric
    const sweepMetric = activeMetrics.find(m => m !== 'payoff');
    if (sweepMetric) {
        const param = $('sweep-param').value;
        let from = val('sweep-from');
        let to = val('sweep-to');
        const steps = parseInt($('sweep-steps').value) || 8;

        if (from > 0 && to > 0 && steps >= 2) {
            // Convert vol sweep values if entered as percentages
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

                traces.push({
                    x: spotRange,
                    y: yy,
                    name: `${param}=${sv.toFixed(3)}`,
                    type: 'scatter',
                    mode: 'lines',
                    line: { color: `rgba(139,92,246,${alpha})`, width: 1, dash: 'dot' },
                    showlegend: false,
                    yaxis: activeMetrics.indexOf(sweepMetric) === 0 ? 'y' : 'y2',
                    hovertemplate: `${param}=${sv.toFixed(3)}<br>%{x:.2f}: %{y:.4f}<extra></extra>`,
                });
            }
        }
    }

    // Vertical line at F
    const shapes = [{
        type: 'line',
        x0: env.F, x1: env.F,
        y0: 0, y1: 1, yref: 'paper',
        line: { color: '#64748b', width: 1, dash: 'dot' },
    }];

    const layout = {
        ...CHART_LAYOUT,
        xaxis: { ...CHART_LAYOUT.xaxis, title: 'Underlying Price (F)' },
        shapes,
        showlegend: true,
        annotations: [],
    };

    if (needsY2) {
        layout.yaxis2 = {
            overlaying: 'y', side: 'right',
            gridcolor: 'rgba(30,41,59,0.3)', zerolinecolor: '#334155',
            tickfont: { size: 10, color: '#94a3b8' },
        };
    }

    Plotly.react('main-chart', traces, layout, CHART_CONFIG);
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
            z: { show: true, usecolormap: true, highlightcolor: '#06b6d4', project: { z: true } },
        },
        colorbar: {
            title: { text: greek.toUpperCase(), font: { size: 11, color: '#94a3b8' } },
            tickfont: { size: 10, color: '#94a3b8' },
            len: 0.6,
        },
    };

    const layout = {
        ...CHART_LAYOUT,
        scene: {
            xaxis: { title: 'Spot Price', backgroundcolor: '#111827', gridcolor: '#1e293b', color: '#94a3b8' },
            yaxis: { title: axisTitle, backgroundcolor: '#111827', gridcolor: '#1e293b', color: '#94a3b8' },
            zaxis: { title: greek.toUpperCase(), backgroundcolor: '#111827', gridcolor: '#1e293b', color: '#94a3b8' },
            bgcolor: '#111827',
        },
        margin: { l: 0, r: 0, t: 10, b: 0 },
    };

    Plotly.react('surface-chart', [trace], layout, CHART_CONFIG);
}

// ─── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
