# Blind Market — historical trading simulator

Open `index.html` in a browser (no server or install needed).

- 1–5 anonymous charts are drawn at random from 59 real indexes and big-name stocks
  (S&P 500, Nasdaq, Nikkei, DAX, Hang Seng…, Apple, GE, Tesla, Citigroup, GameStop…),
  each from a random historical window (or all from the same window, if you choose).
- Prices are rescaled and dates hidden; you trade at each day's close, paying the bid–ask spread plus broker commission.
- `Space` pauses or resumes, `→` steps one day, `+`/`−` changes speed. The `Full`/`1Y`/`3M` buttons and `Log` change the chart view.
- Optional capital-gains tax: you can pick short- or long-term rates, an annual allowance and loss carry-forward. Tax is settled every 252 trading days.
- At the end, open positions are liquidated. You then see which assets and dates you traded, every trade, and a comparison with an equal-weight buy-and-hold.

## Data
`data.js` holds daily split- and dividend-adjusted closes from Yahoo Finance. Run this to refresh it or to add tickers:

    python3 tools/fetch_data.py

Edit the `ASSETS` list in that script to change the universe.
