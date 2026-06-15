/**
 * Crack Spread Pricer — UI controller
 *
 * Uses Kirk's approximation on the synthetic 2-asset spread
 *   (refined-product basket vs WTI crude).
 *
 * Inputs are quoted on a per-barrel-of-crude basis ($/bbl).
 */

let crackInitialized = false;

const CRACK_FIELDS = [
    { id: 'crack-fwti',   decimals: 1 },
    { id: 'crack-frbob',  decimals: 1 },
    { id: 'crack-fho',    decimals: 1 },
    { id: 'crack-volwti', decimals: 1 },
    { id: 'crack-volrbob',decimals: 1 },
    { id: 'crack-volho',  decimals: 1 },
    { id: 'crack-strike', decimals: 2 },
    { id: 'crack-T',      decimals: 2 },
    { id: 'crack-rate',   decimals: 1 },
    { id: 'crack-rwr',    decimals: 2 },
    { id: 'crack-rwh',    decimals: 2 },
    { id: 'crack-rrh',    decimals: 2 },
];

function _$(id) { return document.getElementById(id); }

function syncCrackInput(id) {
    const slider = _$(`${id}-slider`);
    const input  = _$(`${id}-input`);
    if (!slider || !input) return;
    const dec = CRACK_FIELDS.find(f => f.id === id)?.decimals ?? 2;
    input.value = parseFloat(slider.value).toFixed(dec);
    debouncedCrackUpdate();
}

function syncCrackSlider(id) {
    const slider = _$(`${id}-slider`);
    const input  = _$(`${id}-input`);
    if (!slider || !input) return;
    const v = parseFloat(input.value);
    if (isNaN(v)) return;
    if (v > parseFloat(slider.max)) slider.max = v * 1.5;
    if (v < parseFloat(slider.min)) slider.min = v;
    slider.value = v;
    debouncedCrackUpdate();
}

function _crackVal(id) {
    const s = _$(`${id}-slider`);
    return s ? parseFloat(s.value) || 0 : 0;
}

function _setCrack(id, value, decimals = 2) {
    const slider = _$(`${id}-slider`);
    const input  = _$(`${id}-input`);
    if (!slider || !input) return;
    if (value > parseFloat(slider.max)) slider.max = value * 1.5;
    if (value < parseFloat(slider.min)) slider.min = value;
    slider.value = value;
    input.value = parseFloat(value).toFixed(decimals);
}

function getCrackEnv() {
    const ratios = {
        wti:  Math.max(parseInt(_$('crack-ratio-wti').value)  || 1, 1),
        rbob: Math.max(parseInt(_$('crack-ratio-rbob').value) || 0, 0),
        ho:   Math.max(parseInt(_$('crack-ratio-ho').value)   || 0, 0),
    };
    return {
        ratios,
        F_wti:      _crackVal('crack-fwti'),
        F_rbob:     _crackVal('crack-frbob'),
        F_ho:       _crackVal('crack-fho'),
        sigma_wti:  _crackVal('crack-volwti')  / 100,
        sigma_rbob: _crackVal('crack-volrbob') / 100,
        sigma_ho:   _crackVal('crack-volho')   / 100,
        K:          _crackVal('crack-strike'),
        T:          _crackVal('crack-T'),
        r:          _crackVal('crack-rate') / 100,
        rho_wr:     _crackVal('crack-rwr'),
        rho_wh:     _crackVal('crack-rwh'),
        rho_rh:     _crackVal('crack-rrh'),
        isCall:     _$('crack-opt-type').value === 'call',
        isLong:     _$('crack-opt-side').value === 'long',
        netOfPrem:  _$('crack-show-premium').checked,
    };
}

function crackBasket(env) {
    return buildCrackBasket({
        F_wti: env.F_wti, sigma_wti: env.sigma_wti,
        F_rbob: env.F_rbob, sigma_rbob: env.sigma_rbob,
        F_ho: env.F_ho, sigma_ho: env.sigma_ho,
        rho_wr: env.rho_wr, rho_wh: env.rho_wh, rho_rh: env.rho_rh,
        ratios: env.ratios,
    });
}

function spotCrack(env) {
    const b = crackBasket(env);
    return b.F_basket - env.F_wti;
}

// ─── Init ────────────────────────────────────────────────────────────────────

function initCrackSpread() {
    if (crackInitialized) return;

    // Populate crack preset dropdown
    const sel = _$('crack-preset');
    for (const name of Object.keys(CRACK_PRESETS)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
    }
    sel.value = '3:2:1 Crack';
    onCrackPresetChange();

    // Init plotly charts
    Plotly.newPlot('crack-payoff-chart', [], { ...getChartLayout() }, CHART_CONFIG);
    Plotly.newPlot('crack-rho-chart',    [], { ...getChartLayout() }, CHART_CONFIG);
    Plotly.newPlot('crack-term-chart',   [], { ...getChartLayout() }, CHART_CONFIG);
    Plotly.newPlot('crack-spot-chart',   [], { ...getChartLayout() }, CHART_CONFIG);

    window.addEventListener('resize', debounce(() => {
        ['crack-payoff-chart', 'crack-rho-chart', 'crack-term-chart', 'crack-spot-chart']
            .forEach(id => { try { Plotly.Plots.resize(id); } catch(e){} });
    }, 150));

    crackInitialized = true;
    updateCrack();
}

function onCrackPresetChange() {
    const name = _$('crack-preset').value;
    const preset = CRACK_PRESETS[name];
    if (!preset) return;
    _$('crack-ratio-wti').value  = preset.ratios.wti;
    _$('crack-ratio-rbob').value = preset.ratios.rbob;
    _$('crack-ratio-ho').value   = preset.ratios.ho;
    _$('crack-formula').textContent = preset.label;
    updateCrack();
}

function updateCrack() {
    if (!crackInitialized) return;
    const env = getCrackEnv();
    const basket = crackBasket(env);

    // ── Spot crack value display ──
    const spot = basket.F_basket - env.F_wti;
    _$('crack-spread-value').textContent = `$${spot.toFixed(2)}`;

    // Live formula label (rebuilt from current ratios)
    const formulaEl = _$('crack-formula');
    if (formulaEl) {
        const r = env.ratios;
        const refined = [];
        if (r.rbob > 0) refined.push(`${r.rbob}×RBOB`);
        if (r.ho   > 0) refined.push(`${r.ho}×HO`);
        formulaEl.textContent = `${r.wti}×WTI → ${refined.join(' + ') || '—'}`;
    }

    // ── Price the option via Kirk on (basket vs crude) ──
    const greeks = KirkSpread.greeks(
        basket.F_basket, env.F_wti, env.K,
        basket.sigma_basket, env.sigma_wti, basket.rho_eff,
        env.r, env.T, env.isCall,
    );
    const sign = env.isLong ? 1 : -1;
    const premium = sign * greeks.price;

    _$('crack-premium').textContent = `$${premium.toFixed(3)}`;

    // ── Greeks display ──
    const fmt = v => (Math.abs(v) < 0.0001 ? '0.0000'
                    : Math.abs(v) >= 1000 ? v.toFixed(0)
                    : v.toFixed(4));
    const g = greeks;
    _$('crack-greeks').innerHTML = `
        <div class="metric-row"><span>SYNTH BASKET F</span><span class="metric-val">${basket.F_basket.toFixed(2)}</span></div>
        <div class="metric-row"><span>BASKET &sigma;</span><span class="metric-val">${(basket.sigma_basket * 100).toFixed(1)}%</span></div>
        <div class="metric-row"><span>EFF. &rho;</span><span class="metric-val">${basket.rho_eff.toFixed(3)}</span></div>
        <div class="metric-row"><span>&sigma;<sub>EQ</sub> (KIRK)</span><span class="metric-val">${(KirkSpread.sigmaEq(basket.F_basket, env.F_wti, basket.sigma_basket, env.sigma_wti, basket.rho_eff, env.K) * 100).toFixed(1)}%</span></div>
        <div class="metric-section">SENSITIVITIES</div>
        <div class="metric-row"><span>&Delta;<sub>PROD</sub></span><span class="metric-val">${fmt(sign * g.delta1)}</span></div>
        <div class="metric-row"><span>&Delta;<sub>CRUDE</sub></span><span class="metric-val">${fmt(sign * g.delta2)}</span></div>
        <div class="metric-row"><span>&Gamma;<sub>PROD</sub></span><span class="metric-val">${fmt(sign * g.gamma1)}</span></div>
        <div class="metric-row"><span>&Gamma;<sub>CRUDE</sub></span><span class="metric-val">${fmt(sign * g.gamma2)}</span></div>
        <div class="metric-row"><span>VEGA<sub>PROD</sub> /1%</span><span class="metric-val">${fmt(sign * g.vega1)}</span></div>
        <div class="metric-row"><span>VEGA<sub>CRUDE</sub> /1%</span><span class="metric-val">${fmt(sign * g.vega2)}</span></div>
        <div class="metric-row"><span>CEGA /1%&rho;</span><span class="metric-val">${fmt(sign * g.cega)}</span></div>
        <div class="metric-row"><span>&Theta; / day</span><span class="metric-val">${fmt(sign * g.theta)}</span></div>
    `;

    drawCrackPayoff(env, basket, greeks.price, premium, sign);
    drawCrackRhoChart(env, basket);
    drawCrackTermChart(env, basket);
    drawCrackSpotChart(env, basket);
}

const debouncedCrackUpdate = debounce(() => updateCrack(), 60);

// ─── Charts ──────────────────────────────────────────────────────────────────

function _crackColors() {
    return getChartColors();
}

function drawCrackPayoff(env, basket, premiumAbs, premiumSigned, sign) {
    const cc = _crackColors();
    // Spread grid: from K - 4σ to K + 4σ (with a sensible floor/ceiling)
    const sigmaE = KirkSpread.sigmaEq(basket.F_basket, env.F_wti,
        basket.sigma_basket, env.sigma_wti, basket.rho_eff, env.K);
    // approximate dollar-vol on the spread
    const dollarVol = sigmaE * (basket.F_basket + env.K) * Math.sqrt(env.T);
    const center = (basket.F_basket - env.F_wti);
    const width  = Math.max(dollarVol * 2.5, Math.abs(center) + 15);
    const lo = center - width;
    const hi = center + width;
    const grid = linspace(lo, hi, 121);

    // Intrinsic payoff at expiry (no time value)
    const payoff = grid.map(s => {
        const v = env.isCall ? Math.max(s - env.K, 0) : Math.max(env.K - s, 0);
        return sign * (v - (env.netOfPrem ? premiumAbs : 0));
    });

    const traces = [{
        x: grid, y: payoff,
        name: env.isLong ? 'LONG' : 'SHORT',
        type: 'scatter', mode: 'lines',
        line: { color: LINE_COLORS[0], width: 2.5 },
        fill: 'tozeroy',
        fillcolor: isDarkMode ? 'rgba(96,165,250,0.10)' : 'rgba(0,48,97,0.07)',
    }];

    const shapes = [
        { type: 'line', x0: env.K, x1: env.K, y0: 0, y1: 1, yref: 'paper',
          line: { color: cc.grid, width: 1, dash: 'dash' } },
        { type: 'line', x0: center, x1: center, y0: 0, y1: 1, yref: 'paper',
          line: { color: cc.muted, width: 1, dash: 'dot' } },
    ];

    const annotations = [
        { x: env.K, y: 1, xref: 'x', yref: 'paper', yanchor: 'bottom',
          text: `K=${env.K.toFixed(2)}`, showarrow: false,
          font: { size: 9, color: cc.muted, family: 'JetBrains Mono, monospace' },
          bgcolor: isDarkMode ? 'rgba(17,24,39,0.85)' : 'rgba(255,255,255,0.85)',
          borderpad: 2 },
        { x: center, y: 1, xref: 'x', yref: 'paper', yanchor: 'bottom',
          text: `Spot=${center.toFixed(2)}`, showarrow: false,
          font: { size: 9, color: cc.muted, family: 'JetBrains Mono, monospace' },
          bgcolor: isDarkMode ? 'rgba(17,24,39,0.85)' : 'rgba(255,255,255,0.85)',
          borderpad: 2 },
    ];

    Plotly.react('crack-payoff-chart', traces, {
        ...getChartLayout(),
        xaxis: { ...getChartLayout().xaxis, title: { text: 'Crack Spread ($/bbl)', standoff: 15 } },
        yaxis: { ...getChartLayout().yaxis, title: { text: 'P&L ($/bbl)', font: { size: 11, color: cc.muted } } },
        shapes,
        annotations,
        showlegend: true,
    }, CHART_CONFIG);
}

function drawCrackRhoChart(env, basket) {
    const cc = _crackColors();
    const rhos = linspace(-0.99, 0.99, 41);
    const prices = rhos.map(r => KirkSpread.price(
        basket.F_basket, env.F_wti, env.K,
        basket.sigma_basket, env.sigma_wti, r,
        env.r, env.T, env.isCall,
    ));

    const traces = [{
        x: rhos, y: prices,
        type: 'scatter', mode: 'lines',
        line: { color: LINE_COLORS[2], width: 2.5 },
        name: 'PREMIUM',
    }];

    const shapes = [{
        type: 'line', x0: basket.rho_eff, x1: basket.rho_eff, y0: 0, y1: 1, yref: 'paper',
        line: { color: cc.muted, width: 1, dash: 'dash' },
    }];
    const annotations = [{
        x: basket.rho_eff, y: 1, xref: 'x', yref: 'paper', yanchor: 'bottom',
        text: `&rho;=${basket.rho_eff.toFixed(2)}`,
        showarrow: false,
        font: { size: 9, color: cc.muted, family: 'JetBrains Mono, monospace' },
        bgcolor: isDarkMode ? 'rgba(17,24,39,0.85)' : 'rgba(255,255,255,0.85)',
        borderpad: 2,
    }];

    Plotly.react('crack-rho-chart', traces, {
        ...getChartLayout(),
        xaxis: { ...getChartLayout().xaxis, title: { text: 'Correlation &rho;', standoff: 12 } },
        yaxis: { ...getChartLayout().yaxis, title: { text: 'Premium ($)', font: { size: 11, color: cc.muted } } },
        shapes, annotations,
        showlegend: false,
    }, CHART_CONFIG);
}

function drawCrackTermChart(env, basket) {
    const cc = _crackColors();
    const Tmax = Math.max(env.T * 2, 1.5);
    const ts = linspace(0.02, Tmax, 50);
    const prices = ts.map(t => KirkSpread.price(
        basket.F_basket, env.F_wti, env.K,
        basket.sigma_basket, env.sigma_wti, basket.rho_eff,
        env.r, t, env.isCall,
    ));

    const traces = [{
        x: ts, y: prices,
        type: 'scatter', mode: 'lines',
        line: { color: LINE_COLORS[1], width: 2.5 },
        name: 'PREMIUM',
    }];

    const shapes = [{
        type: 'line', x0: env.T, x1: env.T, y0: 0, y1: 1, yref: 'paper',
        line: { color: cc.muted, width: 1, dash: 'dash' },
    }];

    Plotly.react('crack-term-chart', traces, {
        ...getChartLayout(),
        xaxis: { ...getChartLayout().xaxis, title: { text: 'Time to Expiry (years)', standoff: 12 } },
        yaxis: { ...getChartLayout().yaxis, title: { text: 'Premium ($)', font: { size: 11, color: cc.muted } } },
        shapes,
        showlegend: false,
    }, CHART_CONFIG);
}

function drawCrackSpotChart(env, basket) {
    const cc = _crackColors();
    // Vary WTI ±25% holding products fixed → moves the spread
    const wtis = linspace(env.F_wti * 0.75, env.F_wti * 1.25, 60);
    const prices = wtis.map(w => KirkSpread.price(
        basket.F_basket, w, env.K,
        basket.sigma_basket, env.sigma_wti, basket.rho_eff,
        env.r, env.T, env.isCall,
    ));
    const spreads = wtis.map(w => basket.F_basket - w);

    const traces = [{
        x: spreads, y: prices,
        type: 'scatter', mode: 'lines',
        line: { color: LINE_COLORS[3], width: 2.5 },
        name: 'PREMIUM',
    }];

    const currentSpread = basket.F_basket - env.F_wti;
    const shapes = [
        { type: 'line', x0: env.K, x1: env.K, y0: 0, y1: 1, yref: 'paper',
          line: { color: cc.grid, width: 1, dash: 'dash' } },
        { type: 'line', x0: currentSpread, x1: currentSpread, y0: 0, y1: 1, yref: 'paper',
          line: { color: cc.muted, width: 1, dash: 'dot' } },
    ];

    Plotly.react('crack-spot-chart', traces, {
        ...getChartLayout(),
        xaxis: { ...getChartLayout().xaxis, title: { text: 'Spot Crack Spread ($/bbl)', standoff: 12 } },
        yaxis: { ...getChartLayout().yaxis, title: { text: 'Premium ($)', font: { size: 11, color: cc.muted } } },
        shapes,
        showlegend: false,
    }, CHART_CONFIG);
}

// ─── Pricer mode switch ──────────────────────────────────────────────────────

function switchPricerMode(mode) {
    document.querySelectorAll('.pricer-mode-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
    });
    document.querySelectorAll('.pricer-mode-content').forEach(c => {
        c.classList.toggle('active', c.id === `pricer-${mode}`);
    });
    const meta = _$('pricer-mode-meta');
    if (meta) {
        if (mode === 'crack') meta.innerHTML = "KIRK&nbsp;APPROX // SPREAD&nbsp;OPTION";
        else if (mode === 'storage') meta.innerHTML = "LINEAR&nbsp;PROGRAM // INTRINSIC&nbsp;VALUE";
        else meta.innerHTML = "BLACK\u201176 // SINGLE\u2011ASSET";
    }
    if (mode === 'crack') {
        initCrackSpread();
        setTimeout(() => updateCrack(), 30);
    }
    if (mode === 'storage' && typeof initGasStorage === 'function') {
        initGasStorage();
    }
}
