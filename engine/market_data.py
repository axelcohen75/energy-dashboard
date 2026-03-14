"""
Reference market data for energy commodities.

Provides realistic default parameters for major energy commodity markets.
In production, these would come from a real-time data feed.
"""

from dataclasses import dataclass


@dataclass
class CommoditySpec:
    """Specification for an energy commodity."""
    name: str
    ticker: str
    unit: str
    default_futures_price: float
    default_volatility: float  # annualized implied vol
    typical_rate: float  # typical risk-free rate
    contract_size: float
    currency: str
    exchange: str


# Reference data for major energy commodities
ENERGY_COMMODITIES = {
    "WTI Crude Oil": CommoditySpec(
        name="WTI Crude Oil",
        ticker="CL",
        unit="USD/bbl",
        default_futures_price=75.0,
        default_volatility=0.35,
        typical_rate=0.05,
        contract_size=1000,
        currency="USD",
        exchange="NYMEX",
    ),
    "Brent Crude Oil": CommoditySpec(
        name="Brent Crude Oil",
        ticker="BZ",
        unit="USD/bbl",
        default_futures_price=78.0,
        default_volatility=0.33,
        typical_rate=0.05,
        contract_size=1000,
        currency="USD",
        exchange="ICE",
    ),
    "Henry Hub Natural Gas": CommoditySpec(
        name="Henry Hub Natural Gas",
        ticker="NG",
        unit="USD/MMBtu",
        default_futures_price=3.50,
        default_volatility=0.55,
        typical_rate=0.05,
        contract_size=10000,
        currency="USD",
        exchange="NYMEX",
    ),
    "TTF Natural Gas": CommoditySpec(
        name="TTF Natural Gas",
        ticker="TTF",
        unit="EUR/MWh",
        default_futures_price=35.0,
        default_volatility=0.60,
        typical_rate=0.04,
        contract_size=1000,
        currency="EUR",
        exchange="ICE",
    ),
    "German Power (Baseload)": CommoditySpec(
        name="German Power (Baseload)",
        ticker="DEPW",
        unit="EUR/MWh",
        default_futures_price=85.0,
        default_volatility=0.50,
        typical_rate=0.04,
        contract_size=1000,
        currency="EUR",
        exchange="EEX",
    ),
    "UK Power (Baseload)": CommoditySpec(
        name="UK Power (Baseload)",
        ticker="UKPW",
        unit="GBP/MWh",
        default_futures_price=95.0,
        default_volatility=0.48,
        typical_rate=0.045,
        contract_size=1000,
        currency="GBP",
        exchange="ICE",
    ),
    "RBOB Gasoline": CommoditySpec(
        name="RBOB Gasoline",
        ticker="RB",
        unit="USD/gal",
        default_futures_price=2.50,
        default_volatility=0.38,
        typical_rate=0.05,
        contract_size=42000,
        currency="USD",
        exchange="NYMEX",
    ),
    "Heating Oil": CommoditySpec(
        name="Heating Oil",
        ticker="HO",
        unit="USD/gal",
        default_futures_price=2.60,
        default_volatility=0.36,
        typical_rate=0.05,
        contract_size=42000,
        currency="USD",
        exchange="NYMEX",
    ),
    "EU Carbon (EUA)": CommoditySpec(
        name="EU Carbon Allowance",
        ticker="EUA",
        unit="EUR/tCO2",
        default_futures_price=65.0,
        default_volatility=0.45,
        typical_rate=0.04,
        contract_size=1000,
        currency="EUR",
        exchange="ICE",
    ),
    "Coal (API2)": CommoditySpec(
        name="Coal (API2 Rotterdam)",
        ticker="API2",
        unit="USD/mt",
        default_futures_price=120.0,
        default_volatility=0.40,
        typical_rate=0.05,
        contract_size=1000,
        currency="USD",
        exchange="ICE",
    ),
    "LNG (JKM)": CommoditySpec(
        name="LNG Japan/Korea Marker",
        ticker="JKM",
        unit="USD/MMBtu",
        default_futures_price=12.0,
        default_volatility=0.65,
        typical_rate=0.05,
        contract_size=10000,
        currency="USD",
        exchange="ICE",
    ),
    "Ethanol": CommoditySpec(
        name="Ethanol",
        ticker="EH",
        unit="USD/gal",
        default_futures_price=1.80,
        default_volatility=0.35,
        typical_rate=0.05,
        contract_size=29000,
        currency="USD",
        exchange="CBOT",
    ),
}
