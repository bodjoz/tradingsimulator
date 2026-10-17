# Blind Market — historical trading simulator

Open `index.html` in a browser (no server or install needed).

- 1–5 anonymous charts are drawn at random from 229 real series, each from a random historical window
  (or all from the same window, if you choose): developed and emerging-market indexes, US sector, industry,
  country and leveraged ETFs, US large caps, airlines, biotech and micro caps, UK, European, Japanese,
  Australian and China A-share stocks, Bitcoin and Ether, and commodities, bonds and FX.
  The Universe setting narrows the draw (e.g. indexes + ETFs, US stocks only, crypto/commodities).
- Optionally, "Set the stage" lets you pick up to five names (grouped by category, with a search box for name, ticker, sector or country), the session start date, or both. Names without enough data for the chosen date and settings are greyed out. Picked names are shuffled across chart letters, so you still don't know which chart is which.
- Prices are rescaled and dates hidden; you trade at each day's close, paying the bid–ask spread plus broker commission.
- Optionally, every chart can be normalized to 100 at the start of its visible history (the pre-session period, or the session start when no history is shown), so all charts are on one comparable scale. In this mode prices are shown only as % change, and you trade dollar amounts (fractional shares) instead of share counts.
- `Space` pauses or resumes, `→` steps one day, `+`/`−` changes speed. The `Full`/`1Y`/`3M` buttons and `Log` change the chart view.
- Optional capital-gains tax: you can pick short- or long-term rates, an annual allowance and loss carry-forward. Tax is settled every 252 trading days.
- Optional session log ("Record a session log" on the setup screen): the reveal screen gets a "Download session log" button that saves one JSON file per game with
  - `setup`: every setting (capital, charts, period, display mode, fee and tax model and presets, picked names/date)
  - `charts`: each chart's identity, its real dates and real prices, the prices as shown, and the display scale
  - `events`: every action (play/pause and why, step, speed, view, log scale, quick-fill buttons, orders including rejected ones), each with the wall-clock time and game day; orders and the end of the game carry a `seen` snapshot of what was on screen (displayed prices, bid/ask, daily and since-start change, chart view and the game days it showed, positions, cash, fees, tax)
  - `result`: final and gross value and returns, fees, spread, taxes, rank, the full comparison table, every trade, and the daily equity curves.
- At the end, open positions are liquidated. You then see which assets and dates you traded and every trade. A table compares your gross and net return, both total and annualized, with:
  - buying and holding each chart you played on its own, and all of them at equal weight
  - buying and holding five major indexes over the same dates: S&P 500, Nasdaq, Nikkei 225, FTSE 100 and DAX.

## Data
`data.js` (~19 MB) holds daily split- and dividend-adjusted closes from Yahoo Finance, rounded to 5 significant digits.
It is built from the full-precision universe in `data/` (copied from the `priceanalysis` project):

- `data/universe.csv`: ticker, name, type, group, sector, region, currency
- `data/prices.parquet`: ticker, date, close (split-adjusted), adjclose (split- and dividend-adjusted), volume
- `data/splits.csv`: split events

To refresh or add tickers (edit the list in `tools/fetch_universe.py`), then rebuild `data.js`:

    uv run --with pandas --with pyarrow python tools/fetch_universe.py [TICKER ...]
    uv run --with pandas --with pyarrow python tools/build_data.py

`build_data.py` skips series you can't buy (bond yields, VIX), drops one-day bad ticks that fully reverse,
and trims early history with known errors (`START_AFTER`).

Refreshing never loses data by accident:
- `fetch_universe.py` replaces only the tickers it downloads successfully. If a download fails, or comes back
  with noticeably less history than what is stored, the stored data is kept. Files are replaced atomically.
- `build_data.py` carries over any asset of the current `data.js` that `data/` lacks, and refuses to write
  if an asset would lose more than 2% of its history (pass `--force` when that is intended, e.g. after adding
  a `START_AFTER` cut).
