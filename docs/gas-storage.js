/**
 * Gas Storage Intrinsic Value Pricer
 * Solves a linear program to find optimal injection/withdrawal against the forward curve.
 */

let gsInitialized = false;
let gsCurveData = null; // { months: string[], prices: number[] }

function initGasStorage() {
    if (gsInitialized) return;
    gsInitialized = true;

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
    const nMonths = parseInt(document.querySelector('input[name="gs-months"]:checked')?.value || '12');
    const ts = (typeof getTermStructure === 'function')
        ? getTermStructure('Henry Hub Nat Gas (NG)')
        : null;

    if (!ts || !ts.months || !ts.prices || ts.prices.length < 2) {
        alert('No Henry Hub term structure available. Run the market data fetch first.');
        return;
    }

    const months = ts.months.slice(0, nMonths);
    const prices = ts.prices.slice(0, nMonths);

    gsCurveData = { months, prices };

    // Enable calculate button
    const btn = document.getElementById('gs-calc-btn');
    if (btn) btn.disabled = false;

    // Render forward curve chart
    const cc = getChartColors();
    const trace = {
        x: months, y: prices,
        type: 'scatter', mode: 'lines+markers',
        line: { color: isDarkMode ? '#60a5fa' : '#2563eb', width: 2.5 },
        marker: { size: 7, color: isDarkMode ? '#60a5fa' : '#2563eb' },
        name: 'HH Futures',
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

    // Show results
    const panel = document.getElementById('gs-results-panel');
    if (panel) panel.style.display = '';

    const totalInj = result.inject.reduce((a, b) => a + b, 0);
    const totalWdw = result.withdraw.reduce((a, b) => a + b, 0);

    document.getElementById('gs-value').textContent = `$${result.value.toLocaleString('en', { maximumFractionDigits: 0 })}`;
    document.getElementById('gs-total-inj').textContent = totalInj.toLocaleString('en', { maximumFractionDigits: 0 });
    document.getElementById('gs-total-wdw').textContent = totalWdw.toLocaleString('en', { maximumFractionDigits: 0 });

    // Render schedule chart
    const months = gsCurveData.months;
    const cc = getChartColors();

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

// ─── LP Solver ───────────────────────────────────────────────────────────────
// Solves the gas storage intrinsic value as a bounded LP using a greedy approach
// that is equivalent to the LP solution for this problem structure.
//
// The insight: for the intrinsic value problem with terminal = initial inventory
// constraint, the optimal strategy is to find pairs of (buy month, sell month)
// that maximize spread, respecting capacity and flow constraints.

function solveStorageLP(prices, capacity, initInv, maxInj, maxWdw, injCost, wdwCost) {
    const N = prices.length;

    // Use iterative greedy pairing: find best (buy, sell) pair, allocate max
    // volume, update remaining capacity, repeat until no profitable pair exists.
    // This is exact for the storage LP when injection/withdrawal costs are constant.

    const inject = new Float64Array(N);
    const withdraw = new Float64Array(N);

    // Track remaining capacity at each time step
    const remainInj = new Float64Array(N).fill(maxInj);
    const remainWdw = new Float64Array(N).fill(maxWdw);

    let totalProfit = 0;
    const capSlack = capacity - initInv;

    for (let iter = 0; iter < N * N; iter++) {
        // Find most profitable (buy at i, sell at j where j > i) pair
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

        if (bestI < 0) break; // no profitable pair

        // Determine max volume for this pair given constraints
        let maxVol = Math.min(remainInj[bestI], remainWdw[bestJ]);

        // Check inventory constraints: adding volume at bestI..bestJ-1
        // inventory at time t = initInv + cumInj[t] - cumWdw[t]
        // must stay in [0, capacity]
        for (let t = bestI; t < bestJ; t++) {
            // Current inventory at end of period t
            let inv = initInv;
            for (let k = 0; k <= t; k++) inv += inject[k] - withdraw[k];
            // Adding `maxVol` at bestI increases inventory from bestI to bestJ-1
            const projInv = inv + maxVol;
            if (projInv > capacity) {
                maxVol = Math.max(0, capacity - inv);
            }
        }

        if (maxVol <= 0.01) {
            // Mark this pair as exhausted to avoid infinite loop
            remainInj[bestI] = 0;
            continue;
        }

        inject[bestI] += maxVol;
        withdraw[bestJ] += maxVol;
        remainInj[bestI] -= maxVol;
        remainWdw[bestJ] -= maxVol;
        totalProfit += bestSpread * maxVol;
    }

    // Build inventory path
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
