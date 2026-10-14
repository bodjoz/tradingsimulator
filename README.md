# Blind Market — historical trading simulator

Open `index.html` in a browser (no server or install needed).

- 1–5 anonymous charts are drawn at random from 59 real indexes and big-name stocks
  (S&P 500, Nasdaq, Nikkei, DAX, Hang Seng…, Apple, GE, Tesla, Citigroup, GameStop…),
  each from a random historical window (or all from the same window, if you choose).
- Optionally, "Set the stage" lets you pick up to five names (grouped as indexes, US stocks and international stocks), the session start date, or both. Names without enough data for the chosen date and settings are greyed out. Picked names are shuffled across chart letters, so you still don't know which chart is which.
- Prices are rescaled and dates hidden; you trade at each day's close, paying the bid–ask spread plus broker commission.
- Optionally, every chart can be normalized to 100 at the start of its visible history (the pre-session period, or the session start when no history is shown), so all charts are on one comparable scale. In this mode prices are shown only as % change, and you trade dollar amounts (fractional shares) instead of share counts.
- `Space` pauses or resumes, `→` steps one day, `+`/`−` changes speed. The `Full`/`1Y`/`3M` buttons and `Log` change the chart view.
- Optional capital-gains tax: you can pick short- or long-term rates, an annual allowance and loss carry-forward. Tax is settled every 252 trading days.
- At the end, open positions are liquidated. You then see which assets and dates you traded and every trade. A table compares your gross and net return, both total and annualized, with:
  - buying and holding each chart you played on its own, and all of them at equal weight
  - buying and holding five major indexes over the same dates: S&P 500, Nasdaq, Nikkei 225, FTSE 100 and DAX.

## Data
`data.js` holds daily split- and dividend-adjusted closes from Yahoo Finance. Run this to refresh it or to add tickers:

    python3 tools/fetch_data.py

Edit the `ASSETS` list in that script to change the universe.
