"""
Energy Commodity Derivatives Pricing Platform

A comprehensive options pricing and risk management terminal for energy commodities.
Uses Black-76 model (standard for commodity futures options).

Run: python app.py
"""

import dash
from dash import dcc, html, Input, Output, State, callback, ALL, ctx, no_update
import dash_bootstrap_components as dbc
import plotly.graph_objects as go
import plotly.express as px
import numpy as np
import json

from engine.models import (
    OptionType, PositionSide, BarrierType, OptionLeg,
    MarketEnvironment, Black76, compute_greeks, portfolio_greeks,
    portfolio_payoff, compute_greek_surface, STRATEGIES,
)
from engine.market_data import ENERGY_COMMODITIES

# ---------------------------------------------------------------------------
# Theme & Style
# ---------------------------------------------------------------------------
COLORS = {
    "bg": "#0a0e17",
    "panel": "#111827",
    "panel_border": "#1e293b",
    "accent": "#06b6d4",       # cyan-500
    "accent2": "#8b5cf6",      # violet-500
    "accent3": "#f59e0b",      # amber-500
    "accent4": "#10b981",      # emerald-500
    "danger": "#ef4444",
    "text": "#e2e8f0",
    "text_muted": "#94a3b8",
    "text_dim": "#64748b",
    "input_bg": "#1e293b",
    "input_border": "#334155",
    "card_bg": "#0f172a",
    "success": "#06b6d4",
}

LINE_COLORS = ["#06b6d4", "#f59e0b", "#8b5cf6", "#10b981", "#ef4444", "#ec4899"]

CHART_TEMPLATE = go.layout.Template(
    layout=go.Layout(
        paper_bgcolor=COLORS["panel"],
        plot_bgcolor=COLORS["panel"],
        font=dict(color=COLORS["text"], family="JetBrains Mono, Fira Code, monospace", size=11),
        xaxis=dict(
            gridcolor="#1e293b", zerolinecolor="#334155",
            tickfont=dict(size=10, color=COLORS["text_muted"]),
        ),
        yaxis=dict(
            gridcolor="#1e293b", zerolinecolor="#334155",
            tickfont=dict(size=10, color=COLORS["text_muted"]),
        ),
        margin=dict(l=50, r=20, t=30, b=40),
        legend=dict(
            bgcolor="rgba(0,0,0,0)", font=dict(size=10, color=COLORS["text_muted"]),
            orientation="h", yanchor="bottom", y=1.02,
        ),
    )
)

# ---------------------------------------------------------------------------
# Reusable style helpers
# ---------------------------------------------------------------------------

def panel_style(extra=None):
    s = {
        "backgroundColor": COLORS["panel"],
        "border": f"1px solid {COLORS['panel_border']}",
        "borderRadius": "8px",
        "padding": "16px",
        "marginBottom": "12px",
    }
    if extra:
        s.update(extra)
    return s


def label_style():
    return {
        "color": COLORS["text_muted"],
        "fontSize": "10px",
        "fontWeight": "600",
        "letterSpacing": "1.2px",
        "textTransform": "uppercase",
        "marginBottom": "4px",
        "fontFamily": "JetBrains Mono, Fira Code, monospace",
    }


def input_style():
    return {
        "backgroundColor": COLORS["input_bg"],
        "border": f"1px solid {COLORS['input_border']}",
        "borderRadius": "6px",
        "color": COLORS["text"],
        "padding": "6px 10px",
        "fontSize": "13px",
        "fontFamily": "JetBrains Mono, Fira Code, monospace",
        "width": "100%",
    }


def btn_style(variant="primary"):
    base = {
        "fontFamily": "JetBrains Mono, Fira Code, monospace",
        "fontSize": "11px",
        "fontWeight": "600",
        "letterSpacing": "0.5px",
        "textTransform": "uppercase",
        "borderRadius": "6px",
        "padding": "8px 16px",
        "cursor": "pointer",
        "border": "none",
        "transition": "all 0.2s",
    }
    if variant == "primary":
        base.update({"backgroundColor": COLORS["accent"], "color": "#000"})
    elif variant == "danger":
        base.update({"backgroundColor": COLORS["danger"], "color": "#fff"})
    elif variant == "ghost":
        base.update({
            "backgroundColor": "transparent",
            "color": COLORS["text_muted"],
            "border": f"1px solid {COLORS['input_border']}",
        })
    return base


def dropdown_style():
    return {
        "backgroundColor": COLORS["input_bg"],
        "color": COLORS["text"],
        "border": f"1px solid {COLORS['input_border']}",
        "borderRadius": "6px",
        "fontFamily": "JetBrains Mono, Fira Code, monospace",
        "fontSize": "12px",
    }


# ---------------------------------------------------------------------------
# Layout components
# ---------------------------------------------------------------------------

def build_header():
    return html.Div(
        style={
            "display": "flex",
            "justifyContent": "space-between",
            "alignItems": "center",
            "padding": "12px 24px",
            "backgroundColor": COLORS["bg"],
            "borderBottom": f"1px solid {COLORS['panel_border']}",
        },
        children=[
            html.Div([
                html.Span("///  ", style={"color": COLORS["accent"], "fontWeight": "700"}),
                html.Span("ENERGY DERIVATIVES", style={
                    "color": COLORS["text"], "fontWeight": "700",
                    "fontSize": "15px", "letterSpacing": "2px",
                    "fontFamily": "JetBrains Mono, Fira Code, monospace",
                }),
                html.Span("  TERMINAL", style={
                    "color": COLORS["accent"], "fontWeight": "700",
                    "fontSize": "15px", "letterSpacing": "2px",
                    "fontFamily": "JetBrains Mono, Fira Code, monospace",
                }),
            ]),
            html.Div([
                html.Span("MODEL ", style={"color": COLORS["text_dim"], "fontSize": "11px",
                                            "fontFamily": "JetBrains Mono, monospace"}),
                html.Span("BLACK-76", style={"color": COLORS["accent"], "fontWeight": "600",
                                              "fontSize": "11px",
                                              "fontFamily": "JetBrains Mono, monospace"}),
                html.Span("  |  STATUS ", style={"color": COLORS["text_dim"], "fontSize": "11px",
                                                   "fontFamily": "JetBrains Mono, monospace"}),
                html.Span("READY", style={"color": COLORS["accent4"], "fontWeight": "600",
                                           "fontSize": "11px",
                                           "fontFamily": "JetBrains Mono, monospace"}),
            ]),
        ],
    )


def build_commodity_selector():
    return html.Div(style=panel_style(), children=[
        html.Div("COMMODITY", style=label_style()),
        dcc.Dropdown(
            id="commodity-select",
            options=[{"label": name, "value": name} for name in ENERGY_COMMODITIES],
            value="WTI Crude Oil",
            clearable=False,
            style={"fontFamily": "JetBrains Mono, monospace", "fontSize": "12px"},
            className="dark-dropdown",
        ),
    ])


def build_environment_panel():
    return html.Div(style=panel_style(), children=[
        html.Div("ENVIRONMENT", style=label_style()),
        html.Div(style={"display": "grid", "gridTemplateColumns": "1fr 1fr", "gap": "10px",
                         "marginTop": "10px"}, children=[
            html.Div([
                html.Div("SPOT MIN", style={**label_style(), "fontSize": "9px"}),
                dcc.Input(id="spot-min", type="number", value=50, style=input_style()),
            ]),
            html.Div([
                html.Div("SPOT MAX", style={**label_style(), "fontSize": "9px"}),
                dcc.Input(id="spot-max", type="number", value=150, style=input_style()),
            ]),
            html.Div([
                html.Div("FUTURES PRICE (F)", style={**label_style(), "fontSize": "9px"}),
                dcc.Input(id="futures-price", type="number", value=75.0, step=0.5,
                          style=input_style()),
            ]),
            html.Div([
                html.Div("EXPIRY T (YRS)", style={**label_style(), "fontSize": "9px"}),
                dcc.Input(id="time-to-expiry", type="number", value=1.0, step=0.05,
                          min=0.01, style=input_style()),
            ]),
            html.Div([
                html.Div("RATE r (%)", style={**label_style(), "fontSize": "9px"}),
                dcc.Input(id="risk-free-rate", type="number", value=5.0, step=0.1,
                          style=input_style()),
            ]),
            html.Div([
                html.Div("YIELD q (%)", style={**label_style(), "fontSize": "9px"}),
                dcc.Input(id="div-yield", type="number", value=0.0, step=0.1,
                          style=input_style()),
            ]),
        ]),
        html.Div(style={"marginTop": "10px"}, children=[
            html.Div("VOLATILITY σ (%)", style={**label_style(), "fontSize": "9px"}),
            dcc.Input(id="volatility", type="number", value=35.0, step=0.5, style=input_style()),
        ]),
        html.Button("RESET", id="reset-env", style={**btn_style("ghost"), "marginTop": "12px",
                                                      "width": "100%"}),
    ])


def build_new_position():
    return html.Div(style=panel_style(), children=[
        html.Div("NEW POSITION", style=label_style()),
        html.Div(style={"display": "grid", "gridTemplateColumns": "1fr 1fr", "gap": "10px",
                         "marginTop": "8px"}, children=[
            html.Div([
                html.Div("TYPE", style={**label_style(), "fontSize": "9px"}),
                dcc.Dropdown(
                    id="new-option-type",
                    options=[{"label": "CALL", "value": "call"}, {"label": "PUT", "value": "put"}],
                    value="call", clearable=False, className="dark-dropdown",
                    style={"fontSize": "12px", "fontFamily": "JetBrains Mono, monospace"},
                ),
            ]),
            html.Div([
                html.Div("POSITION", style={**label_style(), "fontSize": "9px"}),
                dcc.Dropdown(
                    id="new-position-side",
                    options=[{"label": "LONG", "value": "long"},
                             {"label": "SHORT", "value": "short"}],
                    value="long", clearable=False, className="dark-dropdown",
                    style={"fontSize": "12px", "fontFamily": "JetBrains Mono, monospace"},
                ),
            ]),
        ]),
        html.Div(style={"display": "grid", "gridTemplateColumns": "1fr 1fr", "gap": "10px",
                         "marginTop": "8px"}, children=[
            html.Div([
                html.Div("STRIKE (K)", style={**label_style(), "fontSize": "9px"}),
                dcc.Input(id="new-strike", type="number", value=75.0, step=0.5,
                          style=input_style()),
            ]),
            html.Div([
                html.Div("QUANTITY", style={**label_style(), "fontSize": "9px"}),
                dcc.Input(id="new-quantity", type="number", value=1, min=1, step=1,
                          style=input_style()),
            ]),
        ]),
        html.Button("APPEND LEG", id="add-leg-btn",
                     style={**btn_style("primary"), "width": "100%", "marginTop": "12px"}),
    ])


def build_strategy_selector():
    return html.Div(style=panel_style(), children=[
        html.Div("STRUCTURED PRODUCT", style=label_style()),
        html.Div(style={"display": "flex", "gap": "8px", "marginTop": "8px"}, children=[
            html.Div(style={"flex": "1"}, children=[
                dcc.Dropdown(
                    id="strategy-select",
                    options=[{"label": s, "value": s} for s in STRATEGIES],
                    value="Straddle", clearable=False, className="dark-dropdown",
                    style={"fontSize": "12px", "fontFamily": "JetBrains Mono, monospace"},
                ),
            ]),
            html.Button("APPLY", id="apply-strategy-btn", style=btn_style("primary")),
        ]),
    ])


def build_portfolio_legs():
    return html.Div(style=panel_style({"minHeight": "120px"}), children=[
        html.Div(style={"display": "flex", "justifyContent": "space-between",
                         "alignItems": "center"}, children=[
            html.Div("PORTFOLIO LEGS", style=label_style()),
            html.Div(id="leg-count-badge", style={
                "backgroundColor": COLORS["accent"],
                "color": "#000",
                "borderRadius": "10px",
                "padding": "1px 8px",
                "fontSize": "11px",
                "fontWeight": "700",
                "fontFamily": "JetBrains Mono, monospace",
            }),
        ]),
        html.Div(id="legs-container", style={"marginTop": "8px"}),
        html.Button("CLEAR ALL", id="clear-legs-btn",
                     style={**btn_style("danger"), "width": "100%", "marginTop": "8px",
                            "fontSize": "10px", "padding": "6px"}),
    ])


def build_sweep_panel():
    return html.Div(style=panel_style(), children=[
        html.Div("PARAMETER SWEEP", style=label_style()),
        html.Div(style={"display": "flex", "gap": "8px", "marginTop": "8px",
                         "alignItems": "flex-end"}, children=[
            html.Div(style={"flex": "1"}, children=[
                html.Div("ANIMATE VARIABLE", style={**label_style(), "fontSize": "9px"}),
                dcc.Dropdown(
                    id="sweep-param",
                    options=[
                        {"label": "EXPIRY T (YRS)", "value": "time_to_expiry"},
                        {"label": "VOLATILITY σ", "value": "volatility"},
                        {"label": "RATE r", "value": "risk_free_rate"},
                    ],
                    value="time_to_expiry", clearable=False, className="dark-dropdown",
                    style={"fontSize": "11px", "fontFamily": "JetBrains Mono, monospace"},
                ),
            ]),
        ]),
        html.Div(style={"display": "grid", "gridTemplateColumns": "1fr 1fr 1fr", "gap": "6px",
                         "marginTop": "8px"}, children=[
            html.Div([
                html.Div("FROM", style={**label_style(), "fontSize": "9px"}),
                dcc.Input(id="sweep-from", type="number", value=0.05, step=0.05,
                          style=input_style()),
            ]),
            html.Div([
                html.Div("TO", style={**label_style(), "fontSize": "9px"}),
                dcc.Input(id="sweep-to", type="number", value=2.0, step=0.05,
                          style=input_style()),
            ]),
            html.Div([
                html.Div("STEPS", style={**label_style(), "fontSize": "9px"}),
                dcc.Input(id="sweep-steps", type="number", value=10, min=2, max=30, step=1,
                          style=input_style()),
            ]),
        ]),
    ])


def build_active_metrics():
    greeks_1st = ["payoff", "price", "delta", "gamma", "vega", "theta", "rho"]
    greeks_2nd = ["vanna", "volga"]
    greeks_3rd = ["speed", "zomma", "color", "ultima"]

    def metric_row(name, section_class=""):
        return html.Div(
            id={"type": "metric-toggle", "name": name},
            n_clicks=0,
            style={
                "display": "flex",
                "justifyContent": "space-between",
                "alignItems": "center",
                "padding": "6px 10px",
                "borderRadius": "4px",
                "cursor": "pointer",
                "fontSize": "12px",
                "fontFamily": "JetBrains Mono, monospace",
                "transition": "all 0.15s",
                "color": COLORS["text_muted"],
                "backgroundColor": "transparent",
                "borderLeft": f"3px solid transparent",
            },
            children=[
                html.Span(name.upper()),
                html.Span(id={"type": "metric-value", "name": name}, children="—",
                          style={"fontSize": "11px"}),
            ],
        )

    def section_header(title):
        return html.Div(title, style={
            **label_style(),
            "marginTop": "12px",
            "marginBottom": "4px",
            "paddingLeft": "10px",
            "fontSize": "9px",
            "color": COLORS["text_dim"],
        })

    return html.Div(style=panel_style({"maxHeight": "calc(100vh - 380px)", "overflowY": "auto"}),
                     children=[
        html.Div("ACTIVE METRICS", style=label_style()),
        html.Div(style={"marginTop": "6px"}, children=[
            *[metric_row(g) for g in greeks_1st],
            section_header("2ND ORDER CROSS"),
            *[metric_row(g) for g in greeks_2nd],
            section_header("3RD ORDER GREEKS"),
            *[metric_row(g) for g in greeks_3rd],
        ]),
    ])


def build_surface_controls():
    return html.Div(style=panel_style(), children=[
        html.Div("3D GREEK SURFACE", style=label_style()),
        html.Div("METRIC × SPOT × VARIABLE", style={
            "color": COLORS["accent"], "fontSize": "10px", "marginBottom": "8px",
            "fontFamily": "JetBrains Mono, monospace",
        }),
        html.Div(style={"display": "flex", "gap": "8px", "alignItems": "flex-end"}, children=[
            html.Div(style={"flex": "1"}, children=[
                html.Div("GREEK", style={**label_style(), "fontSize": "9px"}),
                dcc.Dropdown(
                    id="surface-greek",
                    options=[{"label": g.upper(), "value": g} for g in
                             ["delta", "gamma", "vega", "theta", "rho", "price"]],
                    value="delta", clearable=False, className="dark-dropdown",
                    style={"fontSize": "11px", "fontFamily": "JetBrains Mono, monospace"},
                ),
            ]),
            html.Div(style={"flex": "1"}, children=[
                html.Div("2ND AXIS", style={**label_style(), "fontSize": "9px"}),
                dcc.Dropdown(
                    id="surface-second-axis",
                    options=[
                        {"label": "EXPIRY T", "value": "time_to_expiry"},
                        {"label": "VOLATILITY σ", "value": "volatility"},
                    ],
                    value="time_to_expiry", clearable=False, className="dark-dropdown",
                    style={"fontSize": "11px", "fontFamily": "JetBrains Mono, monospace"},
                ),
            ]),
            html.Button("GENERATE", id="generate-surface-btn", style=btn_style("primary")),
        ]),
    ])


# ---------------------------------------------------------------------------
# App initialization
# ---------------------------------------------------------------------------

app = dash.Dash(
    __name__,
    title="Energy Derivatives Terminal",
    external_stylesheets=[dbc.themes.SLATE],
    suppress_callback_exceptions=True,
)

app.layout = html.Div(
    style={
        "backgroundColor": COLORS["bg"],
        "minHeight": "100vh",
        "fontFamily": "JetBrains Mono, Fira Code, Consolas, monospace",
        "color": COLORS["text"],
    },
    children=[
        # Hidden stores
        dcc.Store(id="portfolio-store", data=[]),
        dcc.Store(id="active-metrics-store", data=["payoff"]),

        build_header(),

        html.Div(
            style={
                "display": "grid",
                "gridTemplateColumns": "260px 1fr 320px",
                "gap": "12px",
                "padding": "12px 16px",
                "height": "calc(100vh - 56px)",
                "overflow": "hidden",
            },
            children=[
                # LEFT COLUMN
                html.Div(style={"overflowY": "auto", "paddingRight": "4px"}, children=[
                    build_commodity_selector(),
                    build_portfolio_legs(),
                    build_strategy_selector(),
                    build_new_position(),
                ]),

                # CENTER COLUMN
                html.Div(style={"display": "flex", "flexDirection": "column", "gap": "12px",
                                 "overflow": "hidden"}, children=[
                    # Analytics engine
                    html.Div(style=panel_style({"flex": "1", "minHeight": "0",
                                                 "display": "flex", "flexDirection": "column"}),
                             children=[
                        html.Div(style={"display": "flex", "justifyContent": "space-between",
                                         "alignItems": "center", "marginBottom": "4px"},
                                 children=[
                            html.Div([
                                html.Span("ANALYTICS ENGINE", style={
                                    **label_style(), "fontSize": "12px", "marginBottom": "0"}),
                                html.Div("MULTI-METRIC OVERLAY // UNDERLYING F", style={
                                    "color": COLORS["accent"], "fontSize": "10px",
                                    "fontFamily": "JetBrains Mono, monospace",
                                }),
                            ]),
                        ]),
                        dcc.Graph(id="main-chart", style={"flex": "1"},
                                  config={"displayModeBar": True, "displaylogo": False,
                                          "modeBarButtonsToRemove": ["lasso2d", "select2d"]}),
                    ]),

                    # 3D Surface
                    html.Div(style=panel_style({"flex": "1", "minHeight": "0",
                                                 "display": "flex", "flexDirection": "column"}),
                             children=[
                        build_surface_controls(),
                        dcc.Graph(id="surface-chart", style={"flex": "1"},
                                  config={"displayModeBar": True, "displaylogo": False}),
                    ]),
                ]),

                # RIGHT COLUMN
                html.Div(style={"overflowY": "auto", "paddingLeft": "4px"}, children=[
                    build_environment_panel(),
                    build_sweep_panel(),
                    build_active_metrics(),
                ]),
            ],
        ),

        # CSS is loaded from assets/style.css
    ],
)


# ---------------------------------------------------------------------------
# Callbacks
# ---------------------------------------------------------------------------

@callback(
    Output("futures-price", "value"),
    Output("volatility", "value"),
    Output("risk-free-rate", "value"),
    Output("new-strike", "value"),
    Output("spot-min", "value"),
    Output("spot-max", "value"),
    Input("commodity-select", "value"),
    prevent_initial_call=True,
)
def update_commodity(commodity):
    spec = ENERGY_COMMODITIES[commodity]
    F = spec.default_futures_price
    return (
        F,
        round(spec.default_volatility * 100, 1),
        round(spec.typical_rate * 100, 1),
        F,
        round(F * 0.5, 1),
        round(F * 2.0, 1),
    )


@callback(
    Output("futures-price", "value", allow_duplicate=True),
    Output("volatility", "value", allow_duplicate=True),
    Output("risk-free-rate", "value", allow_duplicate=True),
    Output("time-to-expiry", "value", allow_duplicate=True),
    Output("div-yield", "value", allow_duplicate=True),
    Input("reset-env", "n_clicks"),
    State("commodity-select", "value"),
    prevent_initial_call=True,
)
def reset_environment(n, commodity):
    spec = ENERGY_COMMODITIES[commodity]
    return (
        spec.default_futures_price,
        round(spec.default_volatility * 100, 1),
        round(spec.typical_rate * 100, 1),
        1.0,
        0.0,
    )


# --- Portfolio management ---

@callback(
    Output("portfolio-store", "data"),
    Input("add-leg-btn", "n_clicks"),
    Input("apply-strategy-btn", "n_clicks"),
    Input("clear-legs-btn", "n_clicks"),
    Input({"type": "remove-leg", "index": ALL}, "n_clicks"),
    State("new-option-type", "value"),
    State("new-position-side", "value"),
    State("new-strike", "value"),
    State("new-quantity", "value"),
    State("strategy-select", "value"),
    State("futures-price", "value"),
    State("portfolio-store", "data"),
    prevent_initial_call=True,
)
def update_portfolio(add_click, strat_click, clear_click, remove_clicks,
                     opt_type, pos_side, strike, qty, strategy, F, portfolio):
    triggered = ctx.triggered_id

    if triggered == "clear-legs-btn":
        return []

    if triggered == "add-leg-btn":
        if strike is None or qty is None:
            return no_update
        leg = {
            "option_type": opt_type,
            "strike": float(strike),
            "position": pos_side,
            "quantity": int(qty),
            "barrier_type": "none",
            "barrier_level": None,
            "label": None,
        }
        return portfolio + [leg]

    if triggered == "apply-strategy-btn":
        if strategy in STRATEGIES and F is not None:
            legs = STRATEGIES[strategy](float(F))
            return [
                {
                    "option_type": l.option_type.value,
                    "strike": l.strike,
                    "position": l.position.value,
                    "quantity": l.quantity,
                    "barrier_type": l.barrier_type.value,
                    "barrier_level": l.barrier_level,
                    "label": l.label,
                }
                for l in legs
            ]
        return no_update

    if isinstance(triggered, dict) and triggered.get("type") == "remove-leg":
        idx = triggered["index"]
        if 0 <= idx < len(portfolio):
            return portfolio[:idx] + portfolio[idx + 1:]
        return no_update

    return no_update


@callback(
    Output("legs-container", "children"),
    Output("leg-count-badge", "children"),
    Input("portfolio-store", "data"),
)
def render_legs(portfolio):
    if not portfolio:
        return html.Div("No positions", style={
            "color": COLORS["text_dim"], "fontSize": "11px", "padding": "8px",
            "fontFamily": "JetBrains Mono, monospace", "textAlign": "center",
        }), "0"

    items = []
    for i, leg in enumerate(portfolio):
        side = "Long" if leg["position"] == "long" else "Short"
        typ = "Call" if leg["option_type"] == "call" else "Put"
        lbl = leg.get("label") or f"{side} {typ} K={leg['strike']:.2f}"
        is_short = leg["position"] == "short"
        border_color = COLORS["danger"] if is_short else COLORS["accent"]

        items.append(html.Div(
            style={
                "display": "flex",
                "justifyContent": "space-between",
                "alignItems": "center",
                "padding": "8px 10px",
                "borderLeft": f"3px solid {border_color}",
                "backgroundColor": COLORS["card_bg"],
                "borderRadius": "4px",
                "marginBottom": "4px",
            },
            children=[
                html.Div([
                    html.Div(lbl, style={"fontSize": "11px", "fontWeight": "600",
                                          "fontFamily": "JetBrains Mono, monospace",
                                          "color": COLORS["text"]}),
                    html.Div(f"QTY: {'+'if not is_short else '-'}{leg['quantity']}", style={
                        "fontSize": "10px", "color": COLORS["text_dim"],
                        "fontFamily": "JetBrains Mono, monospace",
                    }),
                ]),
                html.Div("×", id={"type": "remove-leg", "index": i}, n_clicks=0,
                          style={
                    "cursor": "pointer",
                    "color": COLORS["text_dim"],
                    "fontSize": "16px",
                    "padding": "0 4px",
                    "fontWeight": "400",
                }),
            ],
        ))

    return items, str(len(portfolio))


# --- Active metrics toggle ---
@callback(
    Output("active-metrics-store", "data"),
    Input({"type": "metric-toggle", "name": ALL}, "n_clicks"),
    State("active-metrics-store", "data"),
    prevent_initial_call=True,
)
def toggle_metric(clicks, active):
    triggered = ctx.triggered_id
    if triggered is None:
        return no_update
    name = triggered["name"]
    if name in active:
        if len(active) > 0:
            active = [m for m in active if m != name]
    else:
        active = active + [name]
    return active


# --- Main chart ---
@callback(
    Output("main-chart", "figure"),
    Output({"type": "metric-toggle", "name": ALL}, "style"),
    Output({"type": "metric-value", "name": ALL}, "children"),
    Input("portfolio-store", "data"),
    Input("active-metrics-store", "data"),
    Input("futures-price", "value"),
    Input("time-to-expiry", "value"),
    Input("risk-free-rate", "value"),
    Input("volatility", "value"),
    Input("div-yield", "value"),
    Input("spot-min", "value"),
    Input("spot-max", "value"),
    Input("sweep-param", "value"),
    Input("sweep-from", "value"),
    Input("sweep-to", "value"),
    Input("sweep-steps", "value"),
)
def update_main_chart(portfolio, active_metrics, F, T, r, sigma, q,
                      spot_min, spot_max, sweep_param, sweep_from, sweep_to, sweep_steps):
    # Defaults
    F = float(F or 75)
    T = float(T or 1.0)
    r = float(r or 5.0) / 100.0
    sigma = float(sigma or 35.0) / 100.0
    q = float(q or 0.0) / 100.0
    spot_min = float(spot_min or F * 0.5)
    spot_max = float(spot_max or F * 2.0)

    all_metrics = ["payoff", "price", "delta", "gamma", "vega", "theta", "rho",
                   "vanna", "volga", "speed", "zomma", "color", "ultima"]

    spot_range = np.linspace(spot_min, spot_max, 200)

    legs = [
        OptionLeg(
            option_type=OptionType(lg["option_type"]),
            strike=lg["strike"],
            position=PositionSide(lg["position"]),
            quantity=lg["quantity"],
            barrier_type=BarrierType(lg["barrier_type"]),
            barrier_level=lg.get("barrier_level"),
            label=lg.get("label"),
        )
        for lg in portfolio
    ] if portfolio else []

    fig = go.Figure()
    fig.update_layout(template=CHART_TEMPLATE)
    fig.update_layout(
        xaxis_title="Underlying Price (F)",
        hovermode="x unified",
        showlegend=True,
    )

    # Compute portfolio values at current env for the metric panel
    env_now = MarketEnvironment(F, r, sigma, T, q)
    current_greeks = portfolio_greeks(legs, env_now) if legs else {}
    current_payoff = float(np.interp(F, spot_range,
                                      portfolio_payoff(legs, spot_range))) if legs else 0.0
    current_greeks["payoff"] = current_payoff

    # Build styles and values for metric toggles
    styles = []
    values = []
    for name in all_metrics:
        is_active = name in active_metrics
        val = current_greeks.get(name, 0.0)

        base_style = {
            "display": "flex",
            "justifyContent": "space-between",
            "alignItems": "center",
            "padding": "6px 10px",
            "borderRadius": "4px",
            "cursor": "pointer",
            "fontSize": "12px",
            "fontFamily": "JetBrains Mono, monospace",
            "transition": "all 0.15s",
        }

        if is_active:
            color_idx = active_metrics.index(name) % len(LINE_COLORS)
            line_color = LINE_COLORS[color_idx]
            base_style.update({
                "color": "#000" if name in ("payoff", "price") else COLORS["text"],
                "backgroundColor": line_color if name in active_metrics[:2] else "rgba(6,182,212,0.1)",
                "borderLeft": f"3px solid {line_color}",
                "fontWeight": "600",
            })
        else:
            base_style.update({
                "color": COLORS["text_muted"],
                "backgroundColor": "transparent",
                "borderLeft": "3px solid transparent",
            })

        styles.append(base_style)

        # Format value
        if isinstance(val, (int, float)):
            if abs(val) >= 1000:
                values.append(f"{val:,.1f}")
            elif abs(val) >= 1:
                values.append(f"{val:.4f}")
            elif abs(val) >= 0.001:
                values.append(f"{val:.6f}")
            else:
                values.append(f"{val:.2e}")
        else:
            values.append("—")

    if not legs:
        fig.add_annotation(
            text="Add positions to begin analysis",
            xref="paper", yref="paper", x=0.5, y=0.5,
            showarrow=False, font=dict(size=14, color=COLORS["text_dim"]),
        )
        return fig, styles, values

    # Plot active metrics
    for metric_name in active_metrics:
        color_idx = active_metrics.index(metric_name) % len(LINE_COLORS)
        color = LINE_COLORS[color_idx]

        if metric_name == "payoff":
            payoff = portfolio_payoff(legs, spot_range)
            fig.add_trace(go.Scatter(
                x=spot_range, y=payoff, name="PAYOFF",
                line=dict(color=color, width=2),
                fill="tozeroy",
                fillcolor=f"rgba({int(color[1:3],16)},{int(color[3:5],16)},{int(color[5:7],16)},0.05)",
            ))
        else:
            y_vals = []
            for spot in spot_range:
                env_i = MarketEnvironment(spot, r, sigma, T, q)
                g = portfolio_greeks(legs, env_i)
                y_vals.append(g.get(metric_name, 0.0))

            fig.add_trace(go.Scatter(
                x=spot_range, y=y_vals, name=metric_name.upper(),
                line=dict(color=color, width=2),
                yaxis="y" if metric_name == active_metrics[0] else "y2" if len(active_metrics) > 1 and metric_name != active_metrics[0] else "y",
            ))

    # Add secondary y-axis if multiple metrics
    if len(active_metrics) > 1:
        fig.update_layout(
            yaxis2=dict(
                overlaying="y", side="right",
                gridcolor="rgba(30,41,59,0.3)", zerolinecolor="#334155",
                tickfont=dict(size=10, color=COLORS["text_muted"]),
            ),
        )

    # Add vertical line at current futures price
    fig.add_vline(x=F, line_dash="dot", line_color=COLORS["text_dim"], line_width=1)

    # Add sweep lines if multiple metrics and sweep is configured
    if sweep_from is not None and sweep_to is not None and sweep_steps is not None:
        try:
            sweep_from_val = float(sweep_from)
            sweep_to_val = float(sweep_to)
            n_steps = int(sweep_steps)

            if sweep_param == "volatility":
                sweep_from_val /= 100.0 if sweep_from_val > 1 else 1
                sweep_to_val /= 100.0 if sweep_to_val > 1 else 1

            sweep_values = np.linspace(sweep_from_val, sweep_to_val, n_steps)

            # Only add sweep lines for the first active non-payoff metric
            sweep_metric = None
            for m in active_metrics:
                if m != "payoff":
                    sweep_metric = m
                    break

            if sweep_metric:
                for idx, sv in enumerate(sweep_values):
                    alpha = 0.15 + 0.6 * (idx / max(n_steps - 1, 1))
                    y_sweep = []
                    for spot in spot_range:
                        env_s = MarketEnvironment(
                            futures_price=spot,
                            risk_free_rate=r if sweep_param != "risk_free_rate" else sv,
                            volatility=sigma if sweep_param != "volatility" else sv,
                            time_to_expiry=T if sweep_param != "time_to_expiry" else sv,
                            dividend_yield=q,
                        )
                        g = portfolio_greeks(legs, env_s)
                        y_sweep.append(g.get(sweep_metric, 0.0))

                    fig.add_trace(go.Scatter(
                        x=spot_range, y=y_sweep,
                        name=f"{sweep_param}={sv:.2f}",
                        line=dict(color=f"rgba(139,92,246,{alpha})", width=1, dash="dot"),
                        showlegend=False,
                        hovertemplate=f"{sweep_param}={sv:.3f}<br>%{{x:.2f}}: %{{y:.4f}}<extra></extra>",
                    ))
        except (ValueError, TypeError):
            pass

    return fig, styles, values


# --- 3D Surface ---
@callback(
    Output("surface-chart", "figure"),
    Input("generate-surface-btn", "n_clicks"),
    State("portfolio-store", "data"),
    State("surface-greek", "value"),
    State("surface-second-axis", "value"),
    State("futures-price", "value"),
    State("time-to-expiry", "value"),
    State("risk-free-rate", "value"),
    State("volatility", "value"),
    State("div-yield", "value"),
    State("spot-min", "value"),
    State("spot-max", "value"),
    prevent_initial_call=False,
)
def update_surface(n_clicks, portfolio, greek_name, second_axis, F, T, r, sigma, q,
                   spot_min, spot_max):
    F = float(F or 75)
    T = float(T or 1.0)
    r = float(r or 5.0) / 100.0
    sigma = float(sigma or 35.0) / 100.0
    q = float(q or 0.0) / 100.0
    spot_min = float(spot_min or F * 0.5)
    spot_max = float(spot_max or F * 2.0)

    fig = go.Figure()

    scene = dict(
        xaxis=dict(title="Spot Price", backgroundcolor=COLORS["panel"],
                    gridcolor="#1e293b", color=COLORS["text_muted"]),
        yaxis=dict(title="Time to Maturity" if second_axis == "time_to_expiry" else "Volatility",
                    backgroundcolor=COLORS["panel"], gridcolor="#1e293b",
                    color=COLORS["text_muted"]),
        zaxis=dict(title=greek_name.upper(), backgroundcolor=COLORS["panel"],
                    gridcolor="#1e293b", color=COLORS["text_muted"]),
        bgcolor=COLORS["panel"],
    )

    fig.update_layout(
        template=CHART_TEMPLATE,
        scene=scene,
        margin=dict(l=0, r=0, t=10, b=0),
    )

    if not portfolio:
        fig.add_annotation(
            text="Add positions and click GENERATE",
            xref="paper", yref="paper", x=0.5, y=0.5,
            showarrow=False, font=dict(size=13, color=COLORS["text_dim"]),
        )
        return fig

    legs = [
        OptionLeg(
            option_type=OptionType(lg["option_type"]),
            strike=lg["strike"],
            position=PositionSide(lg["position"]),
            quantity=lg["quantity"],
        )
        for lg in portfolio
    ]

    env = MarketEnvironment(F, r, sigma, T, q)
    n_spot = 40
    n_second = 25

    spot_range = np.linspace(spot_min, spot_max, n_spot)

    if second_axis == "time_to_expiry":
        second_range = np.linspace(0.02, max(T * 2, 0.5), n_second)
    else:
        second_range = np.linspace(max(sigma * 0.2, 0.05), sigma * 2.5, n_second)

    surface = compute_greek_surface(legs, env, greek_name, spot_range, second_range, second_axis)

    fig.add_trace(go.Surface(
        x=spot_range,
        y=second_range,
        z=surface,
        colorscale="Viridis",
        opacity=0.9,
        contours=dict(
            z=dict(show=True, usecolormap=True, highlightcolor="#06b6d4", project_z=True),
        ),
        colorbar=dict(
            title=greek_name.upper(),
            tickfont=dict(size=10, color=COLORS["text_muted"]),
            titlefont=dict(size=11, color=COLORS["text_muted"]),
            len=0.6,
        ),
    ))

    return fig


# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=8050)
