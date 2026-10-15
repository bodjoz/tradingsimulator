#!/usr/bin/env python3
"""Build ../data.js (loaded by index.html, works from file://) from the full
universe in ../data/ (written by fetch_universe.py).

- Uses the split- and dividend-adjusted close (total return).
- Drops non-tradable series (yields, VIX) and isolated bad ticks (one-day
  spikes that fully reverse, e.g. a UK price quoted in pounds instead of pence).
- Never loses data by accident: any asset of the current data.js that the
  universe lacks is carried over, and the build refuses to write if an asset
  would end up with noticeably less history than data.js has now (e.g. after a
  bad download). Pass --force to accept that, e.g. after adding a START_AFTER cut.

Usage: uv run --with pandas --with pyarrow python tools/build_data.py [--force]
"""
import json, math, os, sys

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..")
OUT = os.path.join(ROOT, "data.js")

SKIP = {"^TNX", "^IRX", "^VIX"}            # yields and volatility: not prices you can buy
# Early history with known data errors (unadjusted splits, pence/pound flips, level shifts).
START_AFTER = {"MCD": "1972-01-01", "ULVR.L": "1999-05-04", "SHEL.L": "1997-07-01", "ASML.AS": "2000-01-03"}

KIND = {"index": "Index", "etf": "ETF", "stock": "Stock", "crypto": "Crypto", "factor": "Macro"}

# Universe group -> game picker group (in display order).
GROUPS = {
    "Broad index (developed)": "Developed-market indexes",
    "Small/mid-cap index": "US small & mid-cap indexes",
    "Emerging-market index": "Emerging-market indexes",
    "Sector index (US)": "US sector ETFs",
    "Industry index (US)": "US industry ETFs",
    "Developed index in USD (ETF)": "Country ETFs (developed)",
    "EM index in USD (ETF)": "Country ETFs (emerging)",
    "Equal-weighted index": "Equal-weight & leveraged ETFs",
    "Leveraged/inverse": "Equal-weight & leveraged ETFs",
    "Large-cap stock (US)": "US large caps",
    "Airline/travel stock (US)": "US airlines & travel",
    "Small-cap biotech stock (US)": "US biotech",
    "Small/micro-cap stock (US)": "US small & micro caps",
    "ADR / foreign stock (US-listed)": "Foreign stocks listed in the US",
    "Large-cap stock (UK)": "UK stocks",
    "Large-cap stock (Europe)": "European stocks",
    "Large-cap stock (Japan)": "Japanese stocks",
    "Large-cap stock (Australia)": "Australian stocks",
    "China A-share stock": "China A-shares",
    "Crypto": "Crypto",
    "Factor": "Commodities, bonds & FX",
}
GROUP_ORDER = list(dict.fromkeys(GROUPS.values()))

# Names and countries more specific than the universe's region column.
NAME = {"GOOGL": "Alphabet (Google)", "META": "Meta (Facebook)"}
REGION = {
    "NOK": "Finland", "SONY": "Japan", "TM": "Japan", "TSM": "Taiwan", "BABA": "China",
    "VALE": "Brazil", "GME": "USA", "SAP": "Germany", "ASML": "Netherlands",
    "EWZ": "Brazil", "EWY": "South Korea", "EWT": "Taiwan", "EWW": "Mexico",
    "EZA": "South Africa", "FXI": "China", "TUR": "Turkey",
    "EWJ": "Japan", "EWU": "UK", "EWG": "Germany", "EEM": "Emerging markets",
}
SUFFIX_REGION = {".DE": "Germany", ".PA": "France", ".SW": "Switzerland", ".AS": "Netherlands"}
GROUP_FIX = {"GME": "US large caps"}        # GameStop is a US company, not an ADR
EXTRA_META = {                              # assets kept from the old data.js
    "SAP": ("Foreign stocks listed in the US", "Tech"),
    "ASML": ("Foreign stocks listed in the US", "Tech"),
}


def sig(x, n=5):
    return 0 if x == 0 else float(f"{x:.{n}g}")


def bad_ticks(px: pd.Series) -> pd.Index:
    """Dates of isolated spikes: |log r| > 0.4, > 10 robust sigmas, and the next
    day undoes >= 90% of it. Same rule as priceanalysis/analysis/data.py."""
    r = np.log(px).diff()
    mad = (r - r.rolling(63, min_periods=20).median()).abs().rolling(63, min_periods=20).median()
    scale = (1.4826 * mad).shift(1)
    nxt = r.shift(-1)
    hit = (r.abs() > 0.4) & (r.abs() > 10 * scale) & ((r + nxt).abs() < 0.1 * r.abs())
    return px.index[hit.fillna(False).to_numpy()]


def encode(days, px):
    deltas = [int(days[0])] + [int(days[i] - days[i - 1]) for i in range(1, len(days))]
    return {"d": deltas, "p": [sig(float(v)) for v in px]}


def load_old():
    if not os.path.exists(OUT):
        return []
    s = open(OUT).read()
    return json.loads(s[s.index("["):s.rindex("]") + 1])


def main():
    uni = pd.read_csv(os.path.join(ROOT, "data", "universe.csv")).fillna("")
    prices = pd.read_parquet(os.path.join(ROOT, "data", "prices.parquet"))
    prices["ticker"] = prices.ticker.astype(str)
    by_ticker = dict(tuple(prices.groupby("ticker", sort=False)))

    out, dropped = [], 0
    for row in uni.itertuples():
        tk = row.ticker
        if tk in SKIP or tk not in by_ticker:
            continue
        s = by_ticker[tk].set_index("date")["adjclose"].sort_index()
        s = s[~s.index.duplicated(keep="last")]
        if tk in START_AFTER:
            s = s[s.index >= START_AFTER[tk]]
        bad = bad_ticks(s)
        dropped += len(bad)
        s = s.drop(bad)
        days = (s.index.values.astype("datetime64[D]").astype(np.int64))
        region = REGION.get(tk) or next((v for k, v in SUFFIX_REGION.items() if tk.endswith(k)), row.region)
        out.append({"ticker": tk, "name": NAME.get(tk, row.name), "kind": KIND[row.type],
                    "group": GROUP_FIX.get(tk, GROUPS[row.group]), "sector": row.sector,
                    "region": region, "currency": row.currency, **encode(days, s.values)})

    have = {a["ticker"] for a in out}
    old = load_old()
    for a in old:
        if a["ticker"] in have:
            continue
        group, sector = EXTRA_META.get(a["ticker"], ("Foreign stocks listed in the US" if a["region"] != "USA" else "US large caps", ""))
        out.append({"ticker": a["ticker"], "name": a["name"], "kind": a["kind"], "group": a.get("group", group),
                    "sector": a.get("sector", sector), "region": REGION.get(a["ticker"], a["region"]),
                    "currency": a.get("currency", "USD"), "d": a["d"], "p": a["p"]})
        print(f"kept {a['ticker']} from the previous data.js")

    new_len = {a["ticker"]: len(a["p"]) for a in out}
    shrunk = [f"{a['ticker']} {len(a['p'])} → {new_len[a['ticker']]}" for a in old
              if new_len[a["ticker"]] < 0.98 * len(a["p"])]
    if shrunk and "--force" not in sys.argv:
        sys.exit("refusing to overwrite data.js: these assets would lose history (days before → after):\n  "
                 + "\n  ".join(shrunk) + "\nre-download them, or pass --force if that is intended.")

    out.sort(key=lambda a: GROUP_ORDER.index(a["group"]))   # stable: universe order within a group
    with open(OUT + ".tmp", "w") as f:
        f.write("// Generated by tools/build_data.py from data/prices.parquet — daily split- and dividend-adjusted closes from Yahoo Finance.\n")
        f.write("window.MARKET_DATA = ")
        json.dump(out, f, separators=(",", ":"))
        f.write(";\n")
    os.replace(OUT + ".tmp", OUT)    # atomic: an interrupted build leaves data.js intact
    n = sum(len(a["p"]) for a in out)
    print(f"wrote {len(out)} assets, {n:,} prices, {dropped} bad ticks dropped, {os.path.getsize(OUT) / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
