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
    for (const id of ['spot-min', 'spot-max']) {
        const el = $(id);
        if (el) el.addEventListener('input', debouncedUpdate);
    }

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

    // Pick a step size appropriate for the price scale
    const step = c.spot < 1 ? 0.005 : c.spot < 10 ? 0.05 : c.spot < 100 ? 0.5 : 1;

    // Forward curve parameters
    const spotSlider = $('spot-price-slider');
    spotSlider.max = Math.max(c.spot * 3, 50);
    spotSlider.min = Math.max(c.spot * 0.1, 0.01);
    spotSlider.step = step;
    $('spot-price-input').step = step;

    setSlider('spot-price', c.spot);
    setSlider('conv-yield', c.convYield);
    setSlider('storage-cost', c.storageCost);
    setSlider('funding-rate', c.rate);
    setSlider('volatility', c.vol);
    setSlider('risk-free-rate', c.rate);

    // Reset the auto-strike tracker so the strike default follows the new F
    _lastAutoStrike = null;

    // Compute forward and set futures price slider
    updateForwardPrice();

    const env = getEnv();
    $('new-strike').value = env.F.toFixed(c.spot < 5 ? 3 : 2);
    $('new-strike').step = step;
    _lastAutoStrike = parseFloat($('new-strike').value);
    $('spot-min').value = +(env.F * 0.5).toFixed(c.spot < 5 ? 3 : 2);
    $('spot-max').value = +(env.F * 1.5).toFixed(c.spot < 5 ? 3 : 2);

    // Adjust futures price slider range
    const fSlider = $('futures-price-slider');
    fSlider.max = Math.max(env.F * 3, 50);
    fSlider.min = Math.max(env.F * 0.1, 0.01);
    fSlider.step = step;
    $('futures-price-input').step = step;

    // Update underlying display
    updateUnderlyingDisplay();
    computeRealizedVolDisplay();

    updateCharts();
}

function updateUnderlyingDisplay() {
    const env = getEnv();
    const c = COMMODITIES[$('commodity-select')?.value];
    const el = $('underlying-f-display');
    if (el) {
        const unit = c ? (c.spot < 5 ? '$/MMBtu' : '¢/lb') : '';
        el.textContent = `F = ${env.F.toFixed(c && c.spot < 5 ? 3 : 2)} ${unit}`;
    }
}

function computeRealizedVolDisplay() {
    const row = $('realized-vol-row');
    const display = $('realized-vol-display');
    if (!row || !display) return;

    const commodityName = $('commodity-select')?.value;
    const edCfg = typeof ENERGY_COMMODITIES !== 'undefined' ? ENERGY_COMMODITIES[commodityName] : null;
    const sym = edCfg?.continuous;
    const hist = sym && typeof marketData !== 'undefined' ? marketData?.history?.[sym] : null;

    if (!hist?.close || hist.close.length < 30) {
        row.style.display = 'none';
        return;
    }

    const close = hist.close;
    const rv20 = _annualizedRV(close, 20);
    const rv60 = _annualizedRV(close, 60);
    const rv120 = _annualizedRV(close, 120);

    row.style.display = '';
    const fmt = v => v !== null ? `${v.toFixed(1)}%` : '—';
    display.innerHTML = `20d: <b>${fmt(rv20)}</b>&nbsp;&nbsp;60d: <b>${fmt(rv60)}</b>&nbsp;&nbsp;120d: <b>${fmt(rv120)}</b>`;

    _cachedRV60 = rv60;
}

let _cachedRV60 = null;

function _annualizedRV(close, n) {
    if (close.length < n + 1) return null;
    const returns = [];
    for (let i = close.length - n; i < close.length; i++) {
        if (close[i - 1] > 0) returns.push(Math.log(close[i] / close[i - 1]));
    }
    if (returns.length < 5) return null;
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
    return Math.sqrt(variance * 252) * 100;
}

function useRealizedVol() {
    if (_cachedRV60 != null) {
        setSlider('volatility', _cachedRV60.toFixed(1));
        updateCharts();
    }
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
    if (F < parseFloat(fSlider.min)) fSlider.min = Math.max(F * 0.25, 0.01);

    // Also keep the spot slider wide enough for the current price
    const sSlider = $('spot-price-slider');
    if (S > parseFloat(sSlider.max)) sSlider.max = S * 2;
    if (S < parseFloat(sSlider.min)) sSlider.min = Math.max(S * 0.25, 0.01);

    updateUnderlyingDisplay();
    rescalePlotWindowIfNeeded(F);

    return F;
}

/**
 * Keep the payoff x-axis range and the new-strike default aligned with
 * the current forward. Triggered whenever F is recomputed.
 *
 * Rules:
 *   - If F is outside (or near the edge of) the current [spotMin, spotMax],
 *     reset the window to [0.5·F, 1.5·F] so F sits near the middle.
 *   - If the user hasn't customised the new-strike value (i.e. it's still
 *     the previous forward we remembered), update it to the new F.
 */
let _lastAutoStrike = null;
function rescalePlotWindowIfNeeded(F) {
    if (!isFinite(F) || F <= 0) return;

    const spotMinEl = $('spot-min');
    const spotMaxEl = $('spot-max');
    const strikeEl = $('new-strike');
    if (!spotMinEl || !spotMaxEl) return;

    const sMin = parseFloat(spotMinEl.value);
    const sMax = parseFloat(spotMaxEl.value);
    const width = sMax - sMin;

    // Window is invalid, degenerate, or F sits outside the central 80% of it
    const pad = width * 0.10;
    const outOfWindow = !isFinite(sMin) || !isFinite(sMax) || sMin >= sMax
                     || F < sMin + pad || F > sMax - pad;
    // Also re-center if F differs from the window midpoint by more than 3x the half-width
    const midpoint = (sMin + sMax) / 2;
    const halfWidth = width / 2;
    const offScale = halfWidth > 0 && Math.abs(F - midpoint) > halfWidth * 3;

    if (outOfWindow || offScale) {
        const newMin = +(F * 0.5).toFixed(F < 5 ? 3 : 2);
        const newMax = +(F * 1.5).toFixed(F < 5 ? 3 : 2);
        spotMinEl.value = newMin;
        spotMaxEl.value = newMax;

        // Sweep presets rescale with the new window too
        const sweepFrom = $('sweep-from');
        const sweepTo = $('sweep-to');
        if (sweepFrom && sweepTo && $('sweep-param')?.value === 'time_to_expiry') {
            // leave sweep alone for time/vol sweeps — they're not price-based
        }
    }

    // Update new-strike default unless the user has manually set it to
    // something different from the last auto value.
    if (strikeEl) {
        const currentStrike = parseFloat(strikeEl.value);
        if (_lastAutoStrike == null || Math.abs(currentStrike - _lastAutoStrike) < 1e-6) {
            const fmt = F < 5 ? F.toFixed(3) : F.toFixed(2);
            strikeEl.value = fmt;
            _lastAutoStrike = parseFloat(fmt);
        }
    }
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

    const globalVolPct = sliderVal('volatility'); // already in %
    const c = COMMODITIES[$('commodity-select').value];
    const strikeStep = (c && c.spot < 5) ? 0.05 : (c && c.spot > 500 ? 1 : 0.5);

    container.innerHTML = portfolio.map((leg, i) => {
        const side = leg.position === 'long' ? 'Long' : 'Short';
        const typ = leg.type === 'call' ? 'Call' : 'Put';
        const isShort = leg.position === 'short';
        const sign = isShort ? '-' : '+';
        // Use the leg's own IV if set, otherwise show the global vol as a
        // placeholder so the user can see what's being used.
        const hasOverride = typeof leg.iv === 'number' && isFinite(leg.iv) && leg.iv > 0;
        const ivPctValue = hasOverride ? (leg.iv * 100).toFixed(1) : '';
        const ivPlaceholder = globalVolPct.toFixed(1);
        const ivClass = hasOverride ? 'leg-iv-input override' : 'leg-iv-input';
        return `
            <div class="leg-item ${isShort ? 'short' : ''}">
                <div style="flex:1">
                    <div class="leg-label">
                        ${side} ${typ} K=<input type="number" class="leg-strike-input"
                            value="${leg.strike.toFixed(c && c.spot < 5 ? 3 : 2)}" step="${strikeStep}"
                            onchange="updateLegStrike(${i}, this.value)"
                            oninput="updateLegStrike(${i}, this.value)">
                    </div>
                    <div class="leg-qty-row">
                        <span class="leg-qty">QTY: ${sign}${leg.quantity}</span>
                        <span class="leg-iv-wrap" title="Implied vol override (leave blank to use portfolio σ)">
                            σ=<input type="number" class="${ivClass}"
                                value="${ivPctValue}" placeholder="${ivPlaceholder}"
                                min="0" step="0.5"
                                onchange="updateLegIv(${i}, this.value)"
                                oninput="updateLegIv(${i}, this.value)">%
                        </span>
                    </div>
                </div>
                <button class="leg-remove" onclick="removeLeg(${i})">&times;</button>
            </div>`;
    }).join('');
}

function updateLegIv(idx, value) {
    const leg = portfolio[idx];
    if (!leg) return;
    const raw = (value ?? '').toString().trim();
    if (raw === '') {
        // Clear the override — fall back to portfolio σ
        delete leg.iv;
    } else {
        const pct = parseFloat(raw);
        if (!isNaN(pct) && pct > 0) {
            leg.iv = pct / 100; // store as decimal
        }
    }
    // Only rerender the single row's class if we toggled override state;
    // for simplicity, just update charts. The text input keeps focus.
    updateCharts();
}

// ─── Metrics Panel ───────────────────────────────────────────────────────────

function toggleMetric(name) {
    if (name === 'payoff') return;
    const idx = activeMetrics.indexOf(name);
    if (idx >= 0) {
        activeMetrics.splice(idx, 1);
    } else {
        activeMetrics.push(name);
    }
    updateMetricStyles();
    updateQuickGreekBtns();
    updateCharts();
}

function quickGreek(name) {
    activeMetrics = [name];
    updateMetricStyles();
    updateQuickGreekBtns();
    updateCharts();
}

function updateQuickGreekBtns() {
    document.querySelectorAll('.greek-qbtn').forEach(btn => {
        const g = btn.textContent.toLowerCase();
        btn.classList.toggle('active', activeMetrics.includes(g));
    });
    const sub = document.getElementById('greeks-subtitle');
    if (sub) sub.textContent = activeMetrics.map(m => m.toUpperCase()).join(' / ');
}

function updateMetricStyles() {
    updateQuickGreekBtns();
}

// ─── Chart Updates ───────────────────────────────────────────────────────────

function updateCharts() {
    CHART_LAYOUT = getChartLayout();
    const cc = getChartColors();
    const env = getEnv();
    if (env.spotMin >= env.spotMax || env.spotMin < 0) return;

    updateGreeksByLeg();

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

    // Sweep lines on greeks chart (disabled if sweep panel absent)
    const sweepMetric = activeGreeks[0];
    if (sweepMetric && $('sweep-param')) {
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

// ─── Portfolio Leg Tags + Greeks-by-Leg Table ────────────────────────────────

function updateGreeksByLeg() {
    const tagsEl = document.getElementById('portfolio-leg-tags');
    const tableEl = document.getElementById('greeks-by-leg-table');
    if (!tagsEl || !tableEl) return;

    if (portfolio.length === 0) {
        tagsEl.innerHTML = '<span style="color:var(--text-dim);font-size:10px">No positions</span>';
        tableEl.innerHTML = '';
        return;
    }

    const env = getEnv();

    const globalVolPct = sliderVal('volatility');
    tagsEl.innerHTML = portfolio.map((leg, i) => {
        const sign = leg.position === 'long' ? '+' : '-';
        const type = leg.type === 'call' ? 'CALL' : 'PUT';
        const g = computeGreeks(leg, env.F, env.r, env.sigma, env.T);
        const price = Math.abs(g.price || 0);
        const hasIv = typeof leg.iv === 'number' && isFinite(leg.iv) && leg.iv > 0;
        const ivVal = hasIv ? (leg.iv * 100).toFixed(1) : '';
        const ivPh = globalVolPct.toFixed(1);
        return `<span class="leg-tag">${sign}${leg.quantity} ${type} K=${leg.strike.toFixed(1)}
            <span class="tag-price">${price.toFixed(2)}</span>
            <span class="tag-iv" title="IV override (blank = portfolio σ)">σ=<input type="number"
                class="tag-iv-input${hasIv ? ' override' : ''}" value="${ivVal}" placeholder="${ivPh}"
                min="0" step="0.5" onchange="updateLegIv(${i}, this.value)"
                oninput="updateLegIv(${i}, this.value)">%</span>
            <span class="tag-close" onclick="removeLeg(${i})">&times;</span></span>`;
    }).join('');

    // Greeks table
    const cols = ['Leg', 'Value', 'Delta', 'Gamma', 'Vega', 'Theta/d', 'Rho'];
    let rows = '';
    const totals = { price: 0, delta: 0, gamma: 0, vega: 0, theta: 0, rho: 0 };

    for (const leg of portfolio) {
        const g = computeGreeks(leg, env.F, env.r, env.sigma, env.T);
        const sign = leg.position === 'long' ? '+' : '-';
        const type = leg.type === 'call' ? 'CALL' : 'PUT';
        const label = `${sign}${leg.quantity} ${type} K=${leg.strike.toFixed(1)}`;
        const style = leg.position === 'short' ? ' style="color:#ef4444"' : ' style="color:#22c55e"';

        totals.price += g.price || 0;
        totals.delta += g.delta || 0;
        totals.gamma += g.gamma || 0;
        totals.vega  += g.vega || 0;
        totals.theta += g.theta || 0;
        totals.rho   += g.rho || 0;

        rows += `<tr>
            <td${style}>${label}</td>
            <td>${fmtG(g.price)}</td><td>${fmtG(g.delta, 4)}</td><td>${fmtG(g.gamma, 6)}</td>
            <td>${fmtG(g.vega, 4)}</td><td>${fmtG(g.theta, 4)}</td><td>${fmtG(g.rho, 4)}</td>
        </tr>`;
    }

    rows += `<tr class="row-total">
        <td>TOTAL</td>
        <td>${fmtG(totals.price)}</td><td>${fmtG(totals.delta, 4)}</td><td>${fmtG(totals.gamma, 6)}</td>
        <td>${fmtG(totals.vega, 4)}</td><td>${fmtG(totals.theta, 4)}</td><td>${fmtG(totals.rho, 4)}</td>
    </tr>`;

    tableEl.innerHTML = `<table class="greeks-leg-table">
        <thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
        <tbody>${rows}</tbody></table>`;
}

function fmtG(v, dec = 2) {
    if (typeof v !== 'number' || isNaN(v)) return '—';
    return v.toFixed(dec);
}

// ─── Risk Management ─────────────────────────────────────────────────────────

function runRiskAnalysis() {
    if (portfolio.length === 0) return;
    const env = getEnv();
    const conf = parseFloat(document.getElementById('risk-confidence')?.value || 0.99);
    const horizon = parseInt(document.getElementById('risk-horizon')?.value || 10);
    const nSims = parseInt(document.getElementById('risk-mc-sims')?.value || 10000);

    const sigma = env.sigma;
    const F = env.F;
    const dt = horizon / 252;
    const sqrtDt = Math.sqrt(dt);

    // Current portfolio value
    const curVal = portfolioValue(portfolio, F, env.r, sigma, env.T);

    // --- Monte Carlo simulation ---
    const pnls = [];
    for (let i = 0; i < nSims; i++) {
        const z = randomNormal();
        const Fnew = F * Math.exp(-0.5 * sigma * sigma * dt + sigma * sqrtDt * z);
        const Tnew = Math.max(env.T - dt, 0.001);
        const newVal = portfolioValue(portfolio, Fnew, env.r, sigma, Tnew);
        pnls.push(newVal - curVal);
    }
    pnls.sort((a, b) => a - b);

    const mcVarIdx = Math.floor(nSims * (1 - conf));
    const mcVar1d = -pnls[Math.floor(nSims * (1 - conf) * (1 / horizon))] || 0;
    const mcVarHorizon = -pnls[mcVarIdx] || 0;

    // CVaR (expected shortfall)
    const tailPnls = pnls.slice(0, mcVarIdx + 1);
    const mcES = tailPnls.length > 0 ? -(tailPnls.reduce((a, b) => a + b, 0) / tailPnls.length) : 0;

    // --- Parametric (delta-gamma) VaR ---
    const greeks = portfolioGreeks(portfolio, F, env.r, sigma, env.T);
    const zConf = conf === 0.99 ? 2.326 : 1.645;
    const dollarDelta = (greeks.delta || 0) * F;
    const dollarGamma = 0.5 * (greeks.gamma || 0) * F * F;
    const paramVar1d = Math.abs(dollarDelta * sigma * Math.sqrt(1/252) * zConf + dollarGamma * (sigma * Math.sqrt(1/252) * zConf) ** 2);
    const paramVarH = paramVar1d * Math.sqrt(horizon);

    // --- Historical simulation (using MC as proxy for daily shocks) ---
    const dailyPnls = [];
    const dt1d = 1 / 252;
    const sqrt1d = Math.sqrt(dt1d);
    for (let i = 0; i < 500; i++) {
        const z = randomNormal();
        const Fd = F * Math.exp(-0.5 * sigma * sigma * dt1d + sigma * sqrt1d * z);
        const Td = Math.max(env.T - dt1d, 0.001);
        dailyPnls.push(portfolioValue(portfolio, Fd, env.r, sigma, Td) - curVal);
    }
    dailyPnls.sort((a, b) => a - b);
    const histVar1d = -dailyPnls[Math.floor(500 * (1 - conf))] || 0;
    const histVarH = histVar1d * Math.sqrt(horizon);
    const histTail = dailyPnls.slice(0, Math.floor(500 * (1 - conf)) + 1);
    const histES = histTail.length > 0 ? -(histTail.reduce((a, b) => a + b, 0) / histTail.length) : 0;

    // --- Maximum Drawdown from MC paths ---
    let avgDD = 0, dd95 = 0, worstDD = 0;
    const ddSamples = [];
    for (let i = 0; i < Math.min(nSims, 2000); i++) {
        let peak = curVal, maxDD = 0, val = curVal;
        for (let d = 1; d <= horizon; d++) {
            const z = randomNormal();
            const Fd = F * Math.exp(-0.5 * sigma * sigma * (d / 252) + sigma * Math.sqrt(d / 252) * z);
            val = portfolioValue(portfolio, Fd, env.r, sigma, Math.max(env.T - d / 252, 0.001));
            if (val > peak) peak = val;
            const dd = peak - val;
            if (dd > maxDD) maxDD = dd;
        }
        ddSamples.push(maxDD);
    }
    ddSamples.sort((a, b) => a - b);
    avgDD = ddSamples.reduce((a, b) => a + b, 0) / ddSamples.length;
    dd95 = ddSamples[Math.floor(ddSamples.length * 0.95)] || 0;
    worstDD = ddSamples[ddSamples.length - 1] || 0;

    // Render tables
    renderVarTable(conf, horizon, histVar1d, histVarH, paramVar1d, paramVarH, mcVar1d, mcVarHorizon);
    renderCvarTable(conf, histES, mcES);
    renderDrawdownTable(avgDD, dd95, worstDD);
    renderMcChart(pnls, mcVarHorizon, conf);
    renderStressTests(env, curVal);
}

function portfolioValue(legs, F, r, sigma, T) {
    let val = 0;
    for (const leg of legs) {
        const s = legSigma(leg, sigma);
        const price = Black76.price(F, leg.strike, r, s, T, leg.type === 'call');
        const sign = leg.position === 'long' ? 1 : -1;
        val += sign * leg.quantity * price;
    }
    return val;
}

function randomNormal() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function renderVarTable(conf, horizon, hVar1d, hVarH, pVar1d, pVarH, mcVar1d, mcVarH) {
    const confPct = (conf * 100).toFixed(0);
    const el = document.getElementById('risk-var-table');
    if (!el) return;
    el.innerHTML = `<table class="risk-table">
        <thead><tr><th style="text-align:left">VALUE-AT-RISK</th><th>VaR 1d (${confPct}%)</th><th>VaR ${horizon}d (${confPct}%)</th></tr></thead>
        <tbody>
            <tr><td>Historical</td><td class="val-neg">${hVar1d.toFixed(2)}</td><td class="val-neg">${hVarH.toFixed(2)}</td></tr>
            <tr><td>Parametric (&Delta;-&Gamma;)</td><td class="val-neg">${pVar1d.toFixed(2)}</td><td class="val-neg">${pVarH.toFixed(2)}</td></tr>
            <tr><td>Monte Carlo</td><td class="val-neg">${mcVar1d.toFixed(2)}</td><td class="val-neg">${mcVarH.toFixed(2)}</td></tr>
        </tbody></table>`;
}

function renderCvarTable(conf, histES, mcES) {
    const confPct = (conf * 100).toFixed(0);
    const el = document.getElementById('risk-cvar-table');
    if (!el) return;
    el.innerHTML = `<table class="risk-table">
        <thead><tr><th colspan="2" style="text-align:left">CVaR / EXPECTED SHORTFALL (${confPct}%)</th></tr></thead>
        <tbody>
            <tr><td>Historical ES</td><td class="val-neg">${histES.toFixed(2)}</td></tr>
            <tr><td>Monte Carlo ES</td><td class="val-neg">${mcES.toFixed(2)}</td></tr>
        </tbody></table>`;
}

function renderDrawdownTable(avg, p95, worst) {
    const el = document.getElementById('risk-drawdown-table');
    if (!el) return;
    const horizon = parseInt(document.getElementById('risk-horizon')?.value || 10);
    el.innerHTML = `<table class="risk-table">
        <thead><tr><th colspan="2" style="text-align:left">MAXIMUM DRAWDOWN (${horizon}D, MC)</th></tr></thead>
        <tbody>
            <tr><td>Avg Drawdown</td><td class="val-neg">${avg.toFixed(2)}</td></tr>
            <tr><td>95th pctl DD</td><td class="val-neg">${p95.toFixed(2)}</td></tr>
            <tr><td>Worst-case DD</td><td class="val-neg">${worst.toFixed(2)}</td></tr>
        </tbody></table>`;
}

function renderMcChart(pnls, varLine, conf) {
    const cc = getChartColors();
    const layout = {
        ...getChartLayout(),
        xaxis: { ...getChartLayout().xaxis, title: 'P&L' },
        yaxis: { ...getChartLayout().yaxis, title: 'Frequency' },
        margin: { l: 50, r: 20, t: 30, b: 40 },
        bargap: 0.02,
        shapes: [{
            type: 'line', x0: -varLine, x1: -varLine, y0: 0, y1: 1, yref: 'paper',
            line: { color: '#ef4444', width: 2, dash: 'dash' },
        }],
        annotations: [{
            x: -varLine, y: 1, yref: 'paper', text: `VaR ${(conf * 100).toFixed(0)}%`,
            showarrow: true, arrowhead: 2, ax: 30, ay: -20,
            font: { size: 10, color: '#ef4444' },
        }],
        title: { text: 'MC P&L DISTRIBUTION', font: { size: 12, color: cc.text } },
    };

    const trace = {
        x: pnls, type: 'histogram', nbinsx: 80,
        marker: { color: isDarkMode ? '#2dd4bf' : '#0d9488' },
    };

    Plotly.react('risk-mc-chart', [trace], layout, CHART_CONFIG);
}

function renderStressTests(env, curVal) {
    const el = document.getElementById('risk-stress-table');
    if (!el) return;

    const scenarios = [
        { name: 'Crash -20%',      dPrice: -0.20, dVol: 0.50 },
        { name: 'Sell-off -10%',    dPrice: -0.10, dVol: 0.25 },
        { name: 'Dip -5%',          dPrice: -0.05, dVol: 0.10 },
        { name: 'Rally +5%',        dPrice: 0.05,  dVol: -0.05 },
        { name: 'Rally +10%',       dPrice: 0.10,  dVol: -0.10 },
        { name: 'Rally +20%',       dPrice: 0.20,  dVol: -0.15 },
        { name: 'Vol Spike +50%',   dPrice: 0,     dVol: 0.50 },
        { name: 'Vol Crush -50%',   dPrice: 0,     dVol: -0.50 },
        { name: '1 Week Decay',     dPrice: 0,     dVol: 0,     dT: 5/252 },
        { name: '1 Month Decay',    dPrice: 0,     dVol: 0,     dT: 21/252 },
    ];

    // Add commodity-specific scenarios
    const preset = COMMODITIES[$('commodity-select')?.value];
    if (preset) {
        const label = $('commodity-select')?.value || 'Commodity';
        if (label.includes('Coffee') || label.includes('KC')) {
            scenarios.push({ name: 'Frost Event', dPrice: 0.30, dVol: 0.80 });
            scenarios.push({ name: 'Brazil Crisis', dPrice: 0.15, dVol: 0.40 });
        } else if (label.includes('NG') || label.includes('Gas')) {
            scenarios.push({ name: 'Cold Snap', dPrice: 0.25, dVol: 0.60 });
            scenarios.push({ name: 'Storage Surplus', dPrice: -0.15, dVol: 0.20 });
        } else if (label.includes('CL') || label.includes('Crude')) {
            scenarios.push({ name: 'OPEC Cut', dPrice: 0.10, dVol: 0.15 });
            scenarios.push({ name: 'Demand Shock', dPrice: -0.25, dVol: 0.40 });
        }
    }

    let rows = '';
    for (const s of scenarios) {
        const Fnew = env.F * (1 + s.dPrice);
        const sigNew = env.sigma * (1 + s.dVol);
        const Tnew = Math.max(env.T - (s.dT || 0), 0.001);
        const newVal = portfolioValue(portfolio, Fnew, env.r, sigNew, Tnew);
        const pnl = newVal - curVal;
        const pnlPct = curVal !== 0 ? (pnl / Math.abs(curVal) * 100) : 0;
        const priceLbl = s.dPrice ? `${(s.dPrice * 100).toFixed(0)}%` : '—';
        const volLbl = s.dVol ? `${(s.dVol * 100).toFixed(0)}%` : (s.dT ? '—' : '—');
        const cls = pnl >= 0 ? 'val-pos' : 'val-neg';
        rows += `<tr>
            <td>${s.name}</td>
            <td>${priceLbl}</td><td>${volLbl}</td>
            <td>${newVal.toFixed(2)}</td>
            <td class="${cls}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}</td>
            <td class="${cls}">${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%</td>
        </tr>`;
    }

    el.innerHTML = `<table class="risk-table">
        <thead><tr><th style="text-align:left">STRESS TESTS</th><th>Price &Delta;</th><th>Vol &Delta;</th><th>New Value</th><th>P&L</th><th>P&L %</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
}

// ─── Boot ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
