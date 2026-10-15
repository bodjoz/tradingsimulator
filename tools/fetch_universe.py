#!/usr/bin/env python3
"""Download the analysis universe from Yahoo Finance at full precision.

Unlike fetch_data.py (which writes the compact, rounded data.js used by the
stocksimulator game), this keeps both the split-adjusted close and the
dividend-adjusted close, the volume and the split events, and covers more
categories: sector and industry ETFs, small and micro caps, biotech, airlines,
Chinese A-shares, UK/Australian/European stocks, crypto and macro factors.

Writes data/universe.csv, data/prices.parquet and data/splits.csv. Existing data
is never lost: a ticker that fails to download, or comes back with noticeably
less history than what is already stored, keeps its stored data. Files are
replaced atomically, so an interrupted run leaves the old ones intact.

Usage: uv run --with pandas --with pyarrow python tools/fetch_universe.py [TICKER ...]
"""
import json, os, sys, time, urllib.parse, urllib.request

import pandas as pd

# (ticker, name, type, group, sector, region, currency)
# type:  index | etf | stock | crypto | factor
# group: the finer category the analysis compares
U = []

def add(group, typ, region, currency, rows):
    for r in rows:
        tk, name = r[0], r[1]
        sector = r[2] if len(r) > 2 else ""
        U.append((tk, name, typ, group, sector, region, currency))

# --- Indexes -----------------------------------------------------------------
add("Broad index (developed)", "index", "USA", "USD", [
    ("^GSPC", "S&P 500"), ("^DJI", "Dow Jones Industrial Average"),
    ("^IXIC", "Nasdaq Composite"), ("^NYA", "NYSE Composite")])
add("Small/mid-cap index", "index", "USA", "USD", [
    ("^RUT", "Russell 2000"), ("^SP600", "S&P SmallCap 600"), ("^SP400", "S&P MidCap 400")])
add("Broad index (developed)", "index", "Canada", "CAD", [("^GSPTSE", "S&P/TSX Composite")])
add("Broad index (developed)", "index", "Japan", "JPY", [("^N225", "Nikkei 225")])
add("Broad index (developed)", "index", "UK", "GBP", [("^FTSE", "FTSE 100")])
add("Broad index (developed)", "index", "Germany", "EUR", [("^GDAXI", "DAX")])
add("Broad index (developed)", "index", "France", "EUR", [("^FCHI", "CAC 40")])
add("Broad index (developed)", "index", "Eurozone", "EUR", [("^STOXX50E", "Euro Stoxx 50")])
add("Broad index (developed)", "index", "Netherlands", "EUR", [("^AEX", "AEX")])
add("Broad index (developed)", "index", "Switzerland", "CHF", [("^SSMI", "SMI")])
add("Broad index (developed)", "index", "Spain", "EUR", [("^IBEX", "IBEX 35")])
add("Broad index (developed)", "index", "Australia", "AUD", [("^AXJO", "S&P/ASX 200")])
add("Broad index (developed)", "index", "Hong Kong", "HKD", [("^HSI", "Hang Seng")])
add("Broad index (developed)", "index", "Singapore", "SGD", [("^STI", "Straits Times")])
add("Broad index (developed)", "index", "New Zealand", "NZD", [("^NZ50", "NZX 50")])
add("Emerging-market index", "index", "Brazil", "BRL", [("^BVSP", "Bovespa")])
add("Emerging-market index", "index", "India", "INR", [("^BSESN", "BSE Sensex")])
add("Emerging-market index", "index", "South Korea", "KRW", [("^KS11", "KOSPI")])
add("Emerging-market index", "index", "China", "CNY", [("000001.SS", "Shanghai Composite")])
add("Emerging-market index", "index", "Taiwan", "TWD", [("^TWII", "Taiwan Weighted")])
add("Emerging-market index", "index", "Indonesia", "IDR", [("^JKSE", "Jakarta Composite")])
add("Emerging-market index", "index", "Mexico", "MXN", [("^MXX", "IPC Mexico")])
add("Emerging-market index", "index", "Malaysia", "MYR", [("^KLSE", "FTSE Bursa Malaysia KLCI")])
add("Emerging-market index", "index", "Argentina", "ARS", [("^MERV", "Merval")])

# --- ETFs: sectors, industries, EM in USD, style, leveraged -------------------
add("Sector index (US)", "etf", "USA", "USD", [
    ("XLK", "Technology Select Sector SPDR", "Tech"),
    ("XLF", "Financial Select Sector SPDR", "Financials"),
    ("XLE", "Energy Select Sector SPDR", "Energy"),
    ("XLU", "Utilities Select Sector SPDR", "Utilities"),
    ("XLP", "Consumer Staples Select Sector SPDR", "Staples"),
    ("XLV", "Health Care Select Sector SPDR", "Health"),
    ("XLI", "Industrial Select Sector SPDR", "Industrials"),
    ("XLB", "Materials Select Sector SPDR", "Materials"),
    ("XLY", "Consumer Discretionary Select Sector SPDR", "Discretionary")])
add("Industry index (US)", "etf", "USA", "USD", [
    ("KBE", "SPDR S&P Bank", "Financials"), ("XBI", "SPDR S&P Biotech (equal-wt)", "Health"),
    ("IBB", "iShares Biotechnology", "Health"), ("SMH", "VanEck Semiconductor", "Tech"),
    ("XOP", "SPDR S&P Oil & Gas E&P", "Energy"), ("GDX", "VanEck Gold Miners", "Materials"),
    ("ITB", "iShares US Home Construction", "Discretionary"),
    ("JETS", "US Global Jets (airlines)", "Industrials")])
add("EM index in USD (ETF)", "etf", "Emerging", "USD", [
    ("EEM", "iShares MSCI Emerging Markets"), ("EWZ", "iShares MSCI Brazil"),
    ("EWY", "iShares MSCI South Korea"), ("EWT", "iShares MSCI Taiwan"),
    ("EWW", "iShares MSCI Mexico"), ("EZA", "iShares MSCI South Africa"),
    ("FXI", "iShares China Large-Cap"), ("TUR", "iShares MSCI Turkey")])
add("Developed index in USD (ETF)", "etf", "International", "USD", [
    ("EWJ", "iShares MSCI Japan"), ("EWU", "iShares MSCI UK"), ("EWG", "iShares MSCI Germany")])
add("Equal-weighted index", "etf", "USA", "USD", [("RSP", "Invesco S&P 500 Equal Weight")])
add("Leveraged/inverse", "etf", "USA", "USD", [
    ("SSO", "ProShares Ultra S&P 500 (2x)"), ("TQQQ", "ProShares UltraPro QQQ (3x)"),
    ("SQQQ", "ProShares UltraPro Short QQQ (-3x)")])

# --- Single stocks -----------------------------------------------------------
add("Large-cap stock (US)", "stock", "USA", "USD", [
    ("AAPL", "Apple", "Tech"), ("MSFT", "Microsoft", "Tech"), ("NVDA", "Nvidia", "Tech"),
    ("INTC", "Intel", "Tech"), ("CSCO", "Cisco", "Tech"), ("ORCL", "Oracle", "Tech"),
    ("AMD", "AMD", "Tech"), ("IBM", "IBM", "Tech"), ("TXN", "Texas Instruments", "Tech"),
    ("AMZN", "Amazon", "Discretionary"), ("TSLA", "Tesla", "Discretionary"),
    ("HD", "Home Depot", "Discretionary"), ("MCD", "McDonald's", "Discretionary"),
    ("NKE", "Nike", "Discretionary"), ("SBUX", "Starbucks", "Discretionary"),
    ("F", "Ford", "Discretionary"), ("GOOGL", "Alphabet", "Communication"),
    ("META", "Meta", "Communication"), ("NFLX", "Netflix", "Communication"),
    ("DIS", "Disney", "Communication"), ("T", "AT&T", "Communication"),
    ("VZ", "Verizon", "Communication"),
    ("JPM", "JPMorgan Chase", "Financials"), ("BAC", "Bank of America", "Financials"),
    ("C", "Citigroup", "Financials"), ("WFC", "Wells Fargo", "Financials"),
    ("GS", "Goldman Sachs", "Financials"), ("MS", "Morgan Stanley", "Financials"),
    ("USB", "U.S. Bancorp", "Financials"), ("AIG", "AIG", "Financials"),
    ("BRK-A", "Berkshire Hathaway", "Financials"),
    ("XOM", "ExxonMobil", "Energy"), ("CVX", "Chevron", "Energy"),
    ("COP", "ConocoPhillips", "Energy"), ("OXY", "Occidental", "Energy"),
    ("APA", "APA Corp", "Energy"), ("DVN", "Devon Energy", "Energy"),
    ("SLB", "Schlumberger", "Energy"), ("HAL", "Halliburton", "Energy"),
    ("NEE", "NextEra Energy", "Utilities"), ("DUK", "Duke Energy", "Utilities"),
    ("SO", "Southern Co", "Utilities"), ("D", "Dominion Energy", "Utilities"),
    ("ED", "Consolidated Edison", "Utilities"), ("AEP", "American Electric Power", "Utilities"),
    ("KO", "Coca-Cola", "Staples"), ("PEP", "PepsiCo", "Staples"),
    ("PG", "Procter & Gamble", "Staples"), ("WMT", "Walmart", "Staples"),
    ("CL", "Colgate-Palmolive", "Staples"), ("GIS", "General Mills", "Staples"),
    ("MO", "Altria", "Staples"), ("KMB", "Kimberly-Clark", "Staples"),
    ("JNJ", "Johnson & Johnson", "Health"), ("PFE", "Pfizer", "Health"),
    ("MRK", "Merck", "Health"), ("AMGN", "Amgen", "Health"), ("GILD", "Gilead", "Health"),
    ("BIIB", "Biogen", "Health"), ("REGN", "Regeneron", "Health"), ("VRTX", "Vertex", "Health"),
    ("GE", "General Electric", "Industrials"), ("BA", "Boeing", "Industrials"),
    ("CAT", "Caterpillar", "Industrials"), ("MMM", "3M", "Industrials"),
    ("HON", "Honeywell", "Industrials"), ("UNP", "Union Pacific", "Industrials"),
    ("FCX", "Freeport-McMoRan", "Materials"), ("NEM", "Newmont", "Materials"),
    ("AA", "Alcoa", "Materials"), ("DD", "DuPont", "Materials"),
    ("NUE", "Nucor", "Materials")])
add("Airline/travel stock (US)", "stock", "USA", "USD", [
    ("DAL", "Delta Air Lines", "Industrials"), ("UAL", "United Airlines", "Industrials"),
    ("AAL", "American Airlines", "Industrials"), ("LUV", "Southwest Airlines", "Industrials"),
    ("CCL", "Carnival", "Discretionary"), ("RCL", "Royal Caribbean", "Discretionary"),
    ("MAR", "Marriott", "Discretionary"), ("EXPE", "Expedia", "Discretionary")])
add("Small-cap biotech stock (US)", "stock", "USA", "USD", [
    ("SRPT", "Sarepta", "Health"), ("NVAX", "Novavax", "Health"), ("ALNY", "Alnylam", "Health"),
    ("INCY", "Incyte", "Health"), ("EXEL", "Exelixis", "Health"), ("IONS", "Ionis", "Health"),
    ("ACAD", "Acadia Pharmaceuticals", "Health"), ("ARWR", "Arrowhead", "Health"),
    ("SGMO", "Sangamo", "Health"), ("VNDA", "Vanda", "Health"), ("OPK", "OPKO Health", "Health"),
    ("NKTR", "Nektar", "Health")])
add("Small/micro-cap stock (US)", "stock", "USA", "USD", [
    ("BDL", "Flanigan's", "Discretionary"), ("MAYS", "J.W. Mays", "Financials"),
    ("ESP", "Espey Mfg", "Industrials"), ("CKX", "CKX Lands", "Energy"),
    ("SIEB", "Siebert Financial", "Financials"), ("LWAY", "Lifeway Foods", "Staples"),
    ("DJCO", "Daily Journal", "Communication"), ("NATH", "Nathan's Famous", "Discretionary"),
    ("UTMD", "Utah Medical", "Health"), ("CRMT", "America's Car-Mart", "Discretionary"),
    ("SMID", "Smith-Midland", "Materials"), ("CVR", "Chicago Rivet & Machine", "Industrials")])
add("Large-cap stock (UK)", "stock", "UK", "GBp", [
    ("BP.L", "BP", "Energy"), ("SHEL.L", "Shell", "Energy"), ("HSBA.L", "HSBC", "Financials"),
    ("BARC.L", "Barclays", "Financials"), ("LLOY.L", "Lloyds", "Financials"),
    ("ULVR.L", "Unilever", "Staples"), ("TSCO.L", "Tesco", "Staples"),
    ("GSK.L", "GSK", "Health"), ("AZN.L", "AstraZeneca", "Health"),
    ("RIO.L", "Rio Tinto", "Materials"), ("VOD.L", "Vodafone", "Communication"),
    ("BATS.L", "British American Tobacco", "Staples")])
add("Large-cap stock (Australia)", "stock", "Australia", "AUD", [
    ("BHP.AX", "BHP", "Materials"), ("CBA.AX", "Commonwealth Bank", "Financials"),
    ("WBC.AX", "Westpac", "Financials"), ("NAB.AX", "National Australia Bank", "Financials"),
    ("ANZ.AX", "ANZ", "Financials"), ("CSL.AX", "CSL", "Health"),
    ("WES.AX", "Wesfarmers", "Discretionary"), ("WOW.AX", "Woolworths", "Staples"),
    ("TLS.AX", "Telstra", "Communication"), ("WDS.AX", "Woodside", "Energy")])
add("Large-cap stock (Europe)", "stock", "Europe", "EUR", [
    ("SIE.DE", "Siemens", "Industrials"), ("ALV.DE", "Allianz", "Financials"),
    ("BAS.DE", "BASF", "Materials"), ("SAP.DE", "SAP", "Tech"),
    ("MC.PA", "LVMH", "Discretionary"), ("TTE.PA", "TotalEnergies", "Energy"),
    ("SAN.PA", "Sanofi", "Health"), ("NESN.SW", "Nestle", "Staples"),
    ("NOVN.SW", "Novartis", "Health"), ("ASML.AS", "ASML", "Tech")])
add("Large-cap stock (Japan)", "stock", "Japan", "JPY", [
    ("7203.T", "Toyota", "Discretionary"), ("6758.T", "Sony", "Tech"),
    ("8306.T", "Mitsubishi UFJ", "Financials"), ("9984.T", "SoftBank Group", "Communication"),
    ("6501.T", "Hitachi", "Industrials")])
add("China A-share stock", "stock", "China", "CNY", [
    ("600519.SS", "Kweichow Moutai", "Staples"), ("601398.SS", "ICBC", "Financials"),
    ("600036.SS", "China Merchants Bank", "Financials"), ("600028.SS", "Sinopec", "Energy"),
    ("000858.SZ", "Wuliangye", "Staples"), ("000002.SZ", "China Vanke", "Financials"),
    ("600104.SS", "SAIC Motor", "Discretionary"), ("000651.SZ", "Gree Electric", "Discretionary")])
add("ADR / foreign stock (US-listed)", "stock", "International", "USD", [
    ("NOK", "Nokia", "Tech"), ("SONY", "Sony ADR", "Tech"), ("TM", "Toyota ADR", "Discretionary"),
    ("TSM", "TSMC", "Tech"), ("BABA", "Alibaba", "Discretionary"), ("VALE", "Vale", "Materials"),
    ("GME", "GameStop", "Discretionary"), ("SAP", "SAP ADR", "Tech"), ("ASML", "ASML (Nasdaq)", "Tech")])

# --- Crypto & macro factors --------------------------------------------------
add("Crypto", "crypto", "Global", "USD", [("BTC-USD", "Bitcoin"), ("ETH-USD", "Ether")])
add("Factor", "factor", "Global", "USD", [
    ("CL=F", "WTI crude oil (front month)"), ("GC=F", "Gold (front month)"),
    ("HG=F", "Copper (front month)"), ("^TNX", "US 10-year Treasury yield"),
    ("^IRX", "US 13-week T-bill yield"), ("DX-Y.NYB", "US Dollar Index"),
    ("TLT", "iShares 20+ Year Treasury"), ("LQD", "iShares IG Corporate Bond"),
    ("HYG", "iShares High Yield Corporate Bond"), ("^VIX", "CBOE VIX"),
    ("EURUSD=X", "EUR/USD"), ("JPY=X", "USD/JPY")])


def fetch(ticker):
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/"
           + urllib.parse.quote(ticker)
           + "?period1=-2500000000&period2=%d&interval=1d&events=div,split" % int(time.time()))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=40) as r:
        js = json.load(r)
    res = js["chart"]["result"][0]
    off = res["meta"].get("gmtoffset", 0)
    q = res["indicators"]
    df = pd.DataFrame({
        "t": res["timestamp"],
        "close": q["quote"][0]["close"],
        "volume": q["quote"][0].get("volume"),
        "adjclose": (q.get("adjclose", [{}])[0].get("adjclose") or q["quote"][0]["close"]),
    })
    df["date"] = pd.to_datetime((df["t"] + off) // 86400, unit="D")
    df = df.drop(columns="t").dropna(subset=["close", "adjclose"])
    df = df[(df.close > 0) & (df.adjclose > 0)]
    df = df.drop_duplicates("date", keep="last").sort_values("date")
    splits = []
    for s in (res.get("events", {}).get("splits") or {}).values():
        splits.append({"date": pd.to_datetime((s["date"] + off) // 86400, unit="D"),
                       "numerator": s["numerator"], "denominator": s["denominator"]})
    return df, splits


def write_atomic(path, write):
    tmp = path + ".tmp"
    write(tmp)
    os.replace(tmp, path)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "..", "data")
    os.makedirs(out_dir, exist_ok=True)
    paths = {k: os.path.join(out_dir, k) for k in ("prices.parquet", "splits.csv", "universe.csv")}
    only = set(sys.argv[1:])
    meta = pd.DataFrame(U, columns=["ticker", "name", "type", "group", "sector", "region", "currency"])
    assert meta.ticker.is_unique
    unknown = only - set(meta.ticker)
    if unknown:
        sys.exit(f"not in the universe list: {', '.join(sorted(unknown))}")

    old = old_s = None
    if os.path.exists(paths["prices.parquet"]):
        old = pd.read_parquet(paths["prices.parquet"])
        old["ticker"] = old.ticker.astype(str)
        old_s = pd.read_csv(paths["splits.csv"], parse_dates=["date"])
    old_rows = old.ticker.value_counts() if old is not None else pd.Series(dtype=int)

    frames, split_rows, ok, kept = [], [], [], []
    for row in meta.itertuples():
        if only and row.ticker not in only:
            continue
        try:
            df, splits = fetch(row.ticker)
        except Exception as e:
            print(f"!! {row.ticker}: {e}", file=sys.stderr); kept.append(row.ticker); continue
        if len(df) < 500:
            print(f"!! {row.ticker}: too short ({len(df)})", file=sys.stderr); kept.append(row.ticker); continue
        if len(df) < 0.98 * old_rows.get(row.ticker, 0):
            print(f"!! {row.ticker}: only {len(df)} rows vs {old_rows[row.ticker]} stored — keeping the stored data",
                  file=sys.stderr); kept.append(row.ticker); continue
        df.insert(0, "ticker", row.ticker)
        frames.append(df)
        split_rows += [{"ticker": row.ticker, **s} for s in splits]
        ok.append(row.ticker)
        print(f"{row.ticker:10s} {len(df):6d} rows {df.date.iloc[0].date()} → {df.date.iloc[-1].date()}")
        time.sleep(0.3)
    if not frames:
        sys.exit("nothing downloaded; existing data left unchanged")

    # Replace only the tickers downloaded successfully; keep everything else stored.
    prices = pd.concat(frames, ignore_index=True)
    splits = pd.DataFrame(split_rows, columns=["ticker", "date", "numerator", "denominator"])
    if old is not None:
        prices = pd.concat([old[~old.ticker.isin(ok)], prices], ignore_index=True)
        splits = pd.concat([old_s[~old_s.ticker.isin(ok)], splits], ignore_index=True)
    have = set(prices.ticker)
    prices["ticker"] = prices.ticker.astype("category")
    write_atomic(paths["prices.parquet"], lambda p: prices.to_parquet(p, index=False, compression="zstd"))
    write_atomic(paths["splits.csv"], lambda p: splits.to_csv(p, index=False))
    write_atomic(paths["universe.csv"], lambda p: meta[meta.ticker.isin(have)].to_csv(p, index=False))
    print(f"updated {len(ok)} assets, kept stored data for {len([t for t in kept if t in have])} that failed; "
          f"{len(have)} assets stored")


if __name__ == "__main__":
    main()
