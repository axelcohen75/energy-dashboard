"""
Pricing models for energy commodity derivatives.

Black-76 model: Standard for pricing options on futures (oil, gas, power).
The key difference from Black-Scholes is that Black-76 uses the futures/forward
price directly instead of the spot price, making it more suitable for commodities
where the cost-of-carry is embedded in the futures price.
"""

import numpy as np
from scipy.stats import norm
from dataclasses import dataclass
from enum import Enum
from typing import Optional


class OptionType(Enum):
    CALL = "call"
    PUT = "put"


class PositionSide(Enum):
    LONG = "long"
    SHORT = "short"


class BarrierType(Enum):
    NONE = "none"
    UP_AND_IN = "up_and_in"
    UP_AND_OUT = "up_and_out"
    DOWN_AND_IN = "down_and_in"
    DOWN_AND_OUT = "down_and_out"


@dataclass
class OptionLeg:
    """Single option leg in a portfolio."""
    option_type: OptionType
    strike: float
    position: PositionSide
    quantity: int = 1
    barrier_type: BarrierType = BarrierType.NONE
    barrier_level: Optional[float] = None
    label: Optional[str] = None

    def sign(self) -> int:
        return 1 if self.position == PositionSide.LONG else -1

    def display_label(self) -> str:
        if self.label:
            return self.label
        side = "Long" if self.position == PositionSide.LONG else "Short"
        typ = "Call" if self.option_type == OptionType.CALL else "Put"
        lbl = f"{side} {typ} K={self.strike:.2f}"
        if self.barrier_type != BarrierType.NONE:
            lbl += f" [{self.barrier_type.value} @ {self.barrier_level:.2f}]"
        return lbl


@dataclass
class MarketEnvironment:
    """Market parameters for pricing."""
    futures_price: float  # F: Current futures/forward price
    risk_free_rate: float  # r: Risk-free interest rate (annualized)
    volatility: float  # sigma: Implied volatility (annualized)
    time_to_expiry: float  # T: Time to expiry in years
    dividend_yield: float = 0.0  # q: Convenience yield (for commodities)


class Black76:
    """
    Black-76 model for pricing options on futures.

    This is the standard model for energy commodity options.
    Unlike Black-Scholes, it takes the futures price as input
    rather than the spot price, which avoids the need to model
    the cost-of-carry (storage, convenience yield) separately.
    """

    @staticmethod
    def d1(F: float, K: float, r: float, sigma: float, T: float) -> float:
        if T <= 0 or sigma <= 0:
            return 0.0
        return (np.log(F / K) + 0.5 * sigma**2 * T) / (sigma * np.sqrt(T))

    @staticmethod
    def d2(F: float, K: float, r: float, sigma: float, T: float) -> float:
        if T <= 0 or sigma <= 0:
            return 0.0
        return Black76.d1(F, K, r, sigma, T) - sigma * np.sqrt(T)

    @staticmethod
    def price(F: float, K: float, r: float, sigma: float, T: float,
              option_type: OptionType) -> float:
        """Price a European option on a futures contract using Black-76."""
        if T <= 1e-10:
            # At expiry
            if option_type == OptionType.CALL:
                return max(F - K, 0.0)
            else:
                return max(K - F, 0.0)

        d1 = Black76.d1(F, K, r, sigma, T)
        d2 = Black76.d2(F, K, r, sigma, T)
        df = np.exp(-r * T)

        if option_type == OptionType.CALL:
            return df * (F * norm.cdf(d1) - K * norm.cdf(d2))
        else:
            return df * (K * norm.cdf(-d2) - F * norm.cdf(-d1))

    @staticmethod
    def delta(F: float, K: float, r: float, sigma: float, T: float,
              option_type: OptionType) -> float:
        if T <= 1e-10:
            if option_type == OptionType.CALL:
                return 1.0 if F > K else (0.5 if F == K else 0.0)
            else:
                return -1.0 if F < K else (-0.5 if F == K else 0.0)
        d1 = Black76.d1(F, K, r, sigma, T)
        df = np.exp(-r * T)
        if option_type == OptionType.CALL:
            return df * norm.cdf(d1)
        else:
            return df * (norm.cdf(d1) - 1.0)

    @staticmethod
    def gamma(F: float, K: float, r: float, sigma: float, T: float) -> float:
        if T <= 1e-10 or sigma <= 0:
            return 0.0
        d1 = Black76.d1(F, K, r, sigma, T)
        df = np.exp(-r * T)
        return df * norm.pdf(d1) / (F * sigma * np.sqrt(T))

    @staticmethod
    def vega(F: float, K: float, r: float, sigma: float, T: float) -> float:
        if T <= 1e-10 or sigma <= 0:
            return 0.0
        d1 = Black76.d1(F, K, r, sigma, T)
        df = np.exp(-r * T)
        return df * F * norm.pdf(d1) * np.sqrt(T) / 100.0  # per 1% vol move

    @staticmethod
    def theta(F: float, K: float, r: float, sigma: float, T: float,
              option_type: OptionType) -> float:
        if T <= 1e-10 or sigma <= 0:
            return 0.0
        d1 = Black76.d1(F, K, r, sigma, T)
        d2 = Black76.d2(F, K, r, sigma, T)
        df = np.exp(-r * T)

        term1 = -df * F * norm.pdf(d1) * sigma / (2.0 * np.sqrt(T))
        if option_type == OptionType.CALL:
            term2 = r * df * (F * norm.cdf(d1) - K * norm.cdf(d2))
        else:
            term2 = r * df * (K * norm.cdf(-d2) - F * norm.cdf(-d1))
        return (term1 - term2) / 365.0  # per calendar day

    @staticmethod
    def rho(F: float, K: float, r: float, sigma: float, T: float,
            option_type: OptionType) -> float:
        if T <= 1e-10:
            return 0.0
        price = Black76.price(F, K, r, sigma, T, option_type)
        return -T * price / 100.0  # per 1% rate move

    @staticmethod
    def vanna(F: float, K: float, r: float, sigma: float, T: float) -> float:
        """d(delta)/d(sigma) = d(vega)/d(F)"""
        if T <= 1e-10 or sigma <= 0:
            return 0.0
        d1 = Black76.d1(F, K, r, sigma, T)
        d2 = Black76.d2(F, K, r, sigma, T)
        df = np.exp(-r * T)
        return -df * norm.pdf(d1) * d2 / sigma

    @staticmethod
    def volga(F: float, K: float, r: float, sigma: float, T: float) -> float:
        """d(vega)/d(sigma) - also called vomma."""
        if T <= 1e-10 or sigma <= 0:
            return 0.0
        d1 = Black76.d1(F, K, r, sigma, T)
        d2 = Black76.d2(F, K, r, sigma, T)
        df = np.exp(-r * T)
        vega_val = Black76.vega(F, K, r, sigma, T) * 100.0  # undo scaling
        return vega_val * d1 * d2 / sigma / 100.0

    @staticmethod
    def speed(F: float, K: float, r: float, sigma: float, T: float) -> float:
        """d(gamma)/d(F) - third order."""
        if T <= 1e-10 or sigma <= 0:
            return 0.0
        d1 = Black76.d1(F, K, r, sigma, T)
        g = Black76.gamma(F, K, r, sigma, T)
        return -g / F * (d1 / (sigma * np.sqrt(T)) + 1.0)

    @staticmethod
    def zomma(F: float, K: float, r: float, sigma: float, T: float) -> float:
        """d(gamma)/d(sigma)."""
        if T <= 1e-10 or sigma <= 0:
            return 0.0
        d1 = Black76.d1(F, K, r, sigma, T)
        d2 = Black76.d2(F, K, r, sigma, T)
        g = Black76.gamma(F, K, r, sigma, T)
        return g * (d1 * d2 - 1.0) / sigma

    @staticmethod
    def color(F: float, K: float, r: float, sigma: float, T: float) -> float:
        """d(gamma)/d(T)."""
        if T <= 1e-10 or sigma <= 0:
            return 0.0
        d1 = Black76.d1(F, K, r, sigma, T)
        d2 = Black76.d2(F, K, r, sigma, T)
        df = np.exp(-r * T)
        return -df * norm.pdf(d1) / (2.0 * F * T * sigma * np.sqrt(T)) * \
            (2 * r * T + 1 + d1 * (2.0 * r * T - d2 * sigma * np.sqrt(T)) /
             (sigma * np.sqrt(T)))

    @staticmethod
    def ultima(F: float, K: float, r: float, sigma: float, T: float) -> float:
        """d(volga)/d(sigma) - third order vol sensitivity."""
        if T <= 1e-10 or sigma <= 0:
            return 0.0
        d1 = Black76.d1(F, K, r, sigma, T)
        d2 = Black76.d2(F, K, r, sigma, T)
        vega_val = Black76.vega(F, K, r, sigma, T) * 100.0
        return -vega_val / (sigma**2) * (d1 * d2 * (1 - d1 * d2) + d1**2 + d2**2) / 100.0


def compute_greeks(leg: OptionLeg, env: MarketEnvironment) -> dict:
    """Compute all Greeks for a single option leg."""
    F = env.futures_price
    K = leg.strike
    r = env.risk_free_rate
    sigma = env.volatility
    T = env.time_to_expiry
    ot = leg.option_type
    s = leg.sign() * leg.quantity

    return {
        "price": s * Black76.price(F, K, r, sigma, T, ot),
        "delta": s * Black76.delta(F, K, r, sigma, T, ot),
        "gamma": s * Black76.gamma(F, K, r, sigma, T),
        "vega": s * Black76.vega(F, K, r, sigma, T),
        "theta": s * Black76.theta(F, K, r, sigma, T, ot),
        "rho": s * Black76.rho(F, K, r, sigma, T, ot),
        "vanna": s * Black76.vanna(F, K, r, sigma, T),
        "volga": s * Black76.volga(F, K, r, sigma, T),
        "speed": s * Black76.speed(F, K, r, sigma, T),
        "zomma": s * Black76.zomma(F, K, r, sigma, T),
        "color": s * Black76.color(F, K, r, sigma, T),
        "ultima": s * Black76.ultima(F, K, r, sigma, T),
    }


def portfolio_greeks(legs: list[OptionLeg], env: MarketEnvironment) -> dict:
    """Aggregate Greeks across all legs."""
    totals = {}
    for leg in legs:
        g = compute_greeks(leg, env)
        for k, v in g.items():
            totals[k] = totals.get(k, 0.0) + v
    return totals


def portfolio_payoff(legs: list[OptionLeg], spot_range: np.ndarray) -> np.ndarray:
    """Compute portfolio payoff at expiry across a range of spot prices."""
    payoff = np.zeros_like(spot_range, dtype=float)
    for leg in legs:
        s = leg.sign() * leg.quantity
        if leg.option_type == OptionType.CALL:
            payoff += s * np.maximum(spot_range - leg.strike, 0.0)
        else:
            payoff += s * np.maximum(leg.strike - spot_range, 0.0)
    return payoff


def compute_greek_surface(legs: list[OptionLeg], env: MarketEnvironment,
                          greek_name: str, spot_range: np.ndarray,
                          second_range: np.ndarray,
                          second_param: str = "time_to_expiry") -> np.ndarray:
    """Compute a 2D surface of a Greek over spot and a second parameter."""
    surface = np.zeros((len(second_range), len(spot_range)))

    for i, val2 in enumerate(second_range):
        for j, spot in enumerate(spot_range):
            env_copy = MarketEnvironment(
                futures_price=spot,
                risk_free_rate=env.risk_free_rate,
                volatility=env.volatility if second_param != "volatility" else val2,
                time_to_expiry=env.time_to_expiry if second_param != "time_to_expiry" else val2,
                dividend_yield=env.dividend_yield,
            )
            if second_param == "volatility":
                env_copy.time_to_expiry = env.time_to_expiry
            elif second_param == "time_to_expiry":
                env_copy.volatility = env.volatility

            greeks = portfolio_greeks(legs, env_copy)
            surface[i, j] = greeks.get(greek_name, 0.0)

    return surface


# Pre-defined commodity option strategies
STRATEGIES = {
    "Straddle": lambda K: [
        OptionLeg(OptionType.CALL, K, PositionSide.LONG),
        OptionLeg(OptionType.PUT, K, PositionSide.LONG),
    ],
    "Strangle": lambda K: [
        OptionLeg(OptionType.CALL, K * 1.05, PositionSide.LONG),
        OptionLeg(OptionType.PUT, K * 0.95, PositionSide.LONG),
    ],
    "Bull Call Spread": lambda K: [
        OptionLeg(OptionType.CALL, K, PositionSide.LONG),
        OptionLeg(OptionType.CALL, K * 1.10, PositionSide.SHORT),
    ],
    "Bear Put Spread": lambda K: [
        OptionLeg(OptionType.PUT, K * 1.10, PositionSide.LONG),
        OptionLeg(OptionType.PUT, K, PositionSide.SHORT),
    ],
    "Butterfly": lambda K: [
        OptionLeg(OptionType.CALL, K * 0.95, PositionSide.LONG),
        OptionLeg(OptionType.CALL, K, PositionSide.SHORT, quantity=2),
        OptionLeg(OptionType.CALL, K * 1.05, PositionSide.LONG),
    ],
    "Iron Condor": lambda K: [
        OptionLeg(OptionType.PUT, K * 0.90, PositionSide.LONG),
        OptionLeg(OptionType.PUT, K * 0.95, PositionSide.SHORT),
        OptionLeg(OptionType.CALL, K * 1.05, PositionSide.SHORT),
        OptionLeg(OptionType.CALL, K * 1.10, PositionSide.LONG),
    ],
    "Risk Reversal": lambda K: [
        OptionLeg(OptionType.CALL, K * 1.05, PositionSide.LONG),
        OptionLeg(OptionType.PUT, K * 0.95, PositionSide.SHORT),
    ],
    "Collar": lambda K: [
        OptionLeg(OptionType.CALL, K * 1.05, PositionSide.SHORT),
        OptionLeg(OptionType.PUT, K * 0.95, PositionSide.LONG),
    ],
    "Calendar Spread": lambda K: [
        OptionLeg(OptionType.CALL, K, PositionSide.LONG, label="Long Call (far)"),
        OptionLeg(OptionType.CALL, K, PositionSide.SHORT, label="Short Call (near)"),
    ],
    "Crack Spread Proxy": lambda K: [
        OptionLeg(OptionType.CALL, K, PositionSide.LONG, label="Long Gasoline Call"),
        OptionLeg(OptionType.CALL, K, PositionSide.SHORT, label="Short Crude Call"),
    ],
}
