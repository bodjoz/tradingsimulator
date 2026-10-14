#!/usr/bin/env python3
"""Download daily history for the game's asset universe from Yahoo Finance
and write it to ../data.js (loaded by index.html, works from file://).

Usage: python3 tools/fetch_data.py
"""
import json, math, os, sys, time, urllib.request, urllib.parse

ASSETS = [
    # (ticker, display name, kind, region)
    ("^GSPC", "S&P 500", "Index", "USA"),
    ("^DJI", "Dow Jones Industrial Average", "Index", "USA"),
    ("^IXIC", "Nasdaq Composite", "Index", "USA"),
    ("^RUT", "Russell 2000", "Index", "USA"),
    ("^N225", "Nikkei 225", "Index", "Japan"),
    ("^FTSE", "FTSE 100", "Index", "UK"),
    ("^GDAXI", "DAX", "Index", "Germany"),
    ("^FCHI", "CAC 40", "Index", "France"),
    ("^HSI", "Hang Seng", "Index", "Hong Kong"),
    ("^BVSP", "Bovespa", "Index", "Brazil"),
    ("^BSESN", "BSE Sensex", "Index", "India"),
    ("^KS11", "KOSPI", "Index", "South Korea"),
    ("000001.SS", "Shanghai Composite", "Index", "China"),
    ("^AXJO", "S&P/ASX 200", "Index", "Australia"),
    ("AAPL", "Apple", "Stock", "USA"),
    ("MSFT", "Microsoft", "Stock", "USA"),
    ("AMZN", "Amazon", "Stock", "USA"),
    ("GOOGL", "Alphabet (Google)", "Stock", "USA"),
    ("META", "Meta (Facebook)", "Stock", "USA"),
    ("NVDA", "Nvidia", "Stock", "USA"),
    ("TSLA", "Tesla", "Stock", "USA"),
    ("NFLX", "Netflix", "Stock", "USA"),
    ("INTC", "Intel", "Stock", "USA"),
    ("CSCO", "Cisco", "Stock", "USA"),
    ("ORCL", "Oracle", "Stock", "USA"),
    ("AMD", "AMD", "Stock", "USA"),
    ("IBM", "IBM", "Stock", "USA"),
    ("GE", "General Electric", "Stock", "USA"),
    ("KO", "Coca-Cola", "Stock", "USA"),
    ("PEP", "PepsiCo", "Stock", "USA"),
    ("XOM", "ExxonMobil", "Stock", "USA"),
    ("CVX", "Chevron", "Stock", "USA"),
    ("JPM", "JPMorgan Chase", "Stock", "USA"),
    ("BAC", "Bank of America", "Stock", "USA"),
    ("C", "Citigroup", "Stock", "USA"),
    ("AIG", "AIG", "Stock", "USA"),
    ("WMT", "Walmart", "Stock", "USA"),
    ("MCD", "McDonald's", "Stock", "USA"),
    ("DIS", "Disney", "Stock", "USA"),
    ("BA", "Boeing", "Stock", "USA"),
    ("CAT", "Caterpillar", "Stock", "USA"),
    ("F", "Ford", "Stock", "USA"),
    ("PG", "Procter & Gamble", "Stock", "USA"),
    ("JNJ", "Johnson & Johnson", "Stock", "USA"),
    ("PFE", "Pfizer", "Stock", "USA"),
    ("MRK", "Merck", "Stock", "USA"),
    ("NKE", "Nike", "Stock", "USA"),
    ("SBUX", "Starbucks", "Stock", "USA"),
    ("HD", "Home Depot", "Stock", "USA"),
    ("T", "AT&T", "Stock", "USA"),
    ("BRK-A", "Berkshire Hathaway", "Stock", "USA"),
    ("NOK", "Nokia", "Stock", "Finland"),
    ("SONY", "Sony", "Stock", "Japan"),
    ("TM", "Toyota", "Stock", "Japan"),
    ("SAP", "SAP", "Stock", "Germany"),
    ("ASML", "ASML", "Stock", "Netherlands"),
    ("TSM", "TSMC", "Stock", "Taiwan"),
    ("BABA", "Alibaba", "Stock", "China"),
    ("GME", "GameStop", "Stock", "USA"),
]

# Drop early history with known data errors (e.g. unadjusted splits).
START_AFTER = {"MCD": "1972-01-01"}

def fetch(ticker):
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
           + urllib.parse.quote(ticker)
           + "?period1=-1500000000&period2=%d&interval=1d&events=div,split" % int(time.time()))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        js = json.load(r)
    res = js["chart"]["result"][0]
    ts = res["timestamp"]
    q = res["indicators"]
    closes = q["quote"][0]["close"]
    adj = q.get("adjclose", [{}])[0].get("adjclose") or closes
    out_days, out_px = [], []
    for t, c, a in zip(ts, closes, adj):
        if c is None or a is None or c <= 0 or a <= 0:
            continue
        d = int((t + res["meta"].get("gmtoffset", 0)) // 86400)
        if out_days and d <= out_days[-1]:
            continue
        out_days.append(d); out_px.append(a)
    return out_days, out_px

def sig(x, n=5):
    if x == 0: return 0
    return float(f"{x:.{n}g}")

def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out = []
    for tk, name, kind, region in ASSETS:
        try:
            days, px = fetch(tk)
        except Exception as e:
            print(f"!! {tk}: {e}", file=sys.stderr); continue
        if tk in START_AFTER:
            cut = int(time.mktime(time.strptime(START_AFTER[tk], "%Y-%m-%d")) // 86400)
            keep = [i for i, d in enumerate(days) if d >= cut]
            days = [days[i] for i in keep]; px = [px[i] for i in keep]
        if len(days) < 600:
            print(f"!! {tk}: too short ({len(days)})", file=sys.stderr); continue
        # Adjusted closes include splits & reinvested dividends (total return).
        deltas = [days[0]] + [days[i] - days[i-1] for i in range(1, len(days))]
        out.append({"ticker": tk, "name": name, "kind": kind, "region": region,
                    "d": deltas, "p": [sig(v) for v in px]})
        print(f"{tk:10s} {len(days):6d} days from day {days[0]}")
        time.sleep(0.3)
    with open(os.path.join(here, "..", "data.js"), "w") as f:
        f.write("// Generated by tools/fetch_data.py — daily (dividend/split-adjusted) closes from Yahoo Finance.\n")
        f.write("window.MARKET_DATA = ")
        json.dump(out, f, separators=(",", ":"))
        f.write(";\n")
    print(f"wrote {len(out)} assets")

if __name__ == "__main__":
    main()
