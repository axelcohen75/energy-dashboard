/**
 * Gas Storage Intrinsic Value Pricer
 * Solves a linear program to find optimal injection/withdrawal against the forward curve.
 * Standalone version — manual forward curve input.
 */

let gsInitialized = false;
let gsCurveData = null;

const DEFAULT_HH_CURVE = [
    { month: '2025-01', price: 3.45 },
    { month: '2025-02', price: 3.52 },
    { month: '2025-03', price: 3.38 },
    { month: '2025-04', price: 3.15 },
    { month: '2025-05', price: 2.95 },
    { month: '2025-06', price: 2.85 },
    { month: '2025-07', price: 2.90 },
    { month: '2025-08', price: 2.92 },
    { month: '2025-09', price: 2.88 },
    { month: '2025-10', price: 3.10 },
    { month: '2025-11', price: 3.55 },
    { month: '2025-12', price: 3.80 },
];

function initGasStorage() {
    if (gsInitialized) return;
    gsInitialized = true;

    const ta = document.getElementById('gs-curve-input');
    if (ta && !ta.value.trim()) {
        ta.value = DEFAULT_HH_CURVE.map(p => `${p.month},${p.price}`).join('\n');
    }

    const cc = getChartColors();
    const emptyLayout = {
        ...getChartLayout(),
        margin: { l: 50, r: 50, t: 10, b: 40 },
        annotations: [{
            text: 'Load forward curve to begin',
            xref: 'paper', yref: 'paper', x: 0.5, y: 0.5,
            showarrow: false, font: { size: 13, color: cc.muted },
        }],
    };
    Plotly.react('gs-curve-chart', [], emptyLayout, CHART_CONFIG);
    Plotly.react('gs-schedule-chart', [], emptyLayout, CHART_CONFIG);
}

function loadGasStorageCurve() {
    const ta = document.getElementById('gs-curve-input');
    if (!ta) return;

    const lines = ta.value.trim().split('\n').filter(l => l.trim());
    const months = [];
    const prices = [];

    for (const line of lines) {
        const parts = line.split(/[,\t;]+/).map(s => s.trim());
        if (parts.length >= 2) {
            months.push(parts[0]);
            const p = parseFloat(parts[1]);
            if (!isNaN(p)) prices.push(p);
            else prices.push(0);
        }
    }

    if (months.length < 2) {
        alert('Enter at least 2 months of forward prices (format: YYYY-MM, price).');
        return;
    }

    gsCurveData = { months, prices };

    const btn = document.getElementById('gs-calc-btn');
    if (btn) btn.disabled = false;

    const cc = getChartColors();
    const trace = {
        x: months, y: prices,
        type: 'scatter', mode: 'lines+markers',
        line: { color: isDarkMode ? '#60a5fa' : '#2563eb', width: 2.5 },
        marker: { size: 7, color: isDarkMode ? '#60a5fa' : '#2563eb' },
        name: 'Forward Curve',
    };
    const layout = {
        ...getChartLayout(),
        margin: { l: 50, r: 20, t: 10, b: 50 },
        xaxis: { ...getChartLayout().xaxis, title: 'Delivery Month', tickangle: -45 },
        yaxis: { ...getChartLayout().yaxis, title: 'Price ($/MMBtu)' },
    };
    Plotly.react('gs-curve-chart', [trace], layout, CHART_CONFIG);
}

function runGasStorageCalc() {
    if (!gsCurveData) return;

    const capacity = parseFloat(document.getElementById('gs-capacity')?.value || 1e6);
    const initInv = parseFloat(document.getElementById('gs-init-inv')?.value || 0);
    const maxInj = parseFloat(document.getElementById('gs-max-inj')?.value || 300000);
    const maxWdw = parseFloat(document.getElementById('gs-max-wdw')?.value || 500000);
    const injCost = parseFloat(document.getElementById('gs-inj-cost')?.value || 0.01);
    const wdwCost = parseFloat(document.getElementById('gs-wdw-cost')?.value || 0.01);

    const prices = gsCurveData.prices;
    const N = prices.length;
    if (N < 2) return;

    const result = solveStorageLP(prices, capacity, initInv, maxInj, maxWdw, injCost, wdwCost);

    if (!result.success) {
        alert('Optimization infeasible — check parameters.');
        return;
    }

    const panel = document.getElementById('gs-results-panel');
    if (panel) panel.style.display = '';

    const totalInj = result.inject.reduce((a, b) => a + b, 0);
    const totalWdw = result.withdraw.reduce((a, b) => a + b, 0);

    document.getElementById('gs-value').textContent = `$${result.value.toLocaleString('en', { maximumFractionDigits: 0 })}`;
    document.getElementById('gs-total-inj').textContent = totalInj.toLocaleString('en', { maximumFractionDigits: 0 });
    document.getElementById('gs-total-wdw').textContent = totalWdw.toLocaleString('en', { maximumFractionDigits: 0 });

    const months = gsCurveData.months;

    const traces = [
        {
            x: months, y: result.inject,
            type: 'bar', name: 'Inject',
            marker: { color: isDarkMode ? '#34d399' : '#16a34a' },
        },
        {
            x: months, y: result.withdraw.map(v => -v),
            type: 'bar', name: 'Withdraw',
            marker: { color: isDarkMode ? '#f87171' : '#dc2626' },
        },
        {
            x: months, y: result.inventory,
            type: 'scatter', mode: 'lines+markers',
            name: 'Inventory', yaxis: 'y2',
            line: { color: isDarkMode ? '#fbbf24' : '#d97706', width: 2.5 },
            marker: { size: 5 },
        },
    ];

    const cc = getChartColors();
    const layout = {
        ...getChartLayout(),
        margin: { l: 60, r: 60, t: 10, b: 50 },
        barmode: 'relative',
        xaxis: { ...getChartLayout().xaxis, title: 'Delivery Month', tickangle: -45 },
        yaxis: { ...getChartLayout().yaxis, title: 'Volume (MMBtu)' },
        yaxis2: {
            title: 'Inventory (MMBtu)',
            overlaying: 'y', side: 'right',
            gridcolor: 'rgba(0,0,0,0)',
            tickfont: { size: 10, color: cc.muted },
            titlefont: { color: cc.muted },
        },
        legend: { ...getChartLayout().legend },
    };

    Plotly.react('gs-schedule-chart', traces, layout, CHART_CONFIG);
}

function solveStorageLP(prices, capacity, initInv, maxInj, maxWdw, injCost, wdwCost) {
    const N = prices.length;
    const inject = new Float64Array(N);
    const withdraw = new Float64Array(N);
    const remainInj = new Float64Array(N).fill(maxInj);
    const remainWdw = new Float64Array(N).fill(maxWdw);

    let totalProfit = 0;

    for (let iter = 0; iter < N * N; iter++) {
        let bestSpread = 0, bestI = -1, bestJ = -1;
        for (let i = 0; i < N; i++) {
            if (remainInj[i] <= 0) continue;
            for (let j = i + 1; j < N; j++) {
                if (remainWdw[j] <= 0) continue;
                const spread = prices[j] - prices[i] - injCost - wdwCost;
                if (spread > bestSpread) {
                    bestSpread = spread;
                    bestI = i;
                    bestJ = j;
                }
            }
        }

        if (bestI < 0) break;

        let maxVol = Math.min(remainInj[bestI], remainWdw[bestJ]);

        for (let t = bestI; t < bestJ; t++) {
            let inv = initInv;
            for (let k = 0; k <= t; k++) inv += inject[k] - withdraw[k];
            const projInv = inv + maxVol;
            if (projInv > capacity) {
                maxVol = Math.max(0, capacity - inv);
            }
        }

        if (maxVol <= 0.01) {
            remainInj[bestI] = 0;
            continue;
        }

        inject[bestI] += maxVol;
        withdraw[bestJ] += maxVol;
        remainInj[bestI] -= maxVol;
        remainWdw[bestJ] -= maxVol;
        totalProfit += bestSpread * maxVol;
    }

    const inventory = new Float64Array(N);
    inventory[0] = initInv + inject[0] - withdraw[0];
    for (let t = 1; t < N; t++) {
        inventory[t] = inventory[t - 1] + inject[t] - withdraw[t];
    }

    return {
        success: true,
        value: totalProfit,
        inject: Array.from(inject),
        withdraw: Array.from(withdraw),
        inventory: Array.from(inventory),
    };
}
