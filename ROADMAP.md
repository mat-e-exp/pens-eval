# Roadmap

Future enhancements and the findings behind them. Not a spec. Current behaviour is in `README.md`; data rules are in `CLAUDE.md`.

Last updated 2026-09-15.

---

## Blocking everything about return

The portfolio's own return cannot be computed. One snapshot has no purchase dates and no cashflows. Until that is fixed the tool can say what the alternatives returned but not whether this portfolio beat them. Do not approximate from cost basis; see `CLAUDE.md` → Performance Measurement.

**Snapshots held:** `data/live/20251001pens-acc-sum.csv` only. The 12 Sep 2026 export was loaded through the browser upload, which does not write to disk, so it is not saved. Recover it and drop it in `data/live/` before it is lost.

---

## 1. Start the clock

Persist a dated copy of every CSV that is loaded, into `data/history/` or `data/live/`. Cheapest item here and a prerequisite for everything in section 2. Every month without it is a month that can never be measured.

With the two snapshots above, a first money-weighted return becomes possible as soon as the HL transaction history export is added. That export format is unverified.

## 2. Opportunity-cost table

Rank what a UK SIPP holder could actually have bought instead, over 1, 3, 5 and 10 years. Once the portfolio's own return exists it slots into the same ranking.

**Verified 2026-09-15 on the existing Alpha Vantage key.** London-listed tickers return dividend-adjusted monthly history through `TIME_SERIES_MONTHLY_ADJUSTED`. Adjusted close is total return and is already net of the fund's own charges.

| Ticker | Fund | History from | 5y total return |
|---|---|---|---|
| SWDA.LON | iShares Core MSCI World | Dec 2009 | 72.2% |
| VUSA.LON | Vanguard S&P 500 | Jun 2012 | 82.0% |
| FCIT.LON | F&C Investment Trust | Feb 2005 | 67.6% |
| VMID.LON | Vanguard FTSE 250 | Nov 2014 | 15.4% |
| VWRL.LON | Vanguard FTSE All-World | Jun 2012 | not computed |

Investment trusts work, so the comparison set is not limited to trackers. Store the ticker list hand-maintained with sources, the way `data/benchmarks.json` and `data/peer-benchmarks.json` are.

**Must verify first:** which currency line the API returns for tickers listed in both USD and GBP, SWDA being one. Cross-comparison is not trustworthy until that is settled.

**Rate limit:** 25 calls per day, one request per second. Two of four test calls were refused for burst. Space them and cache.

## 3. Fee drag

Cost of running 44 positions against holding one fund. HL SIPP charges are published. Arithmetic only, hand-maintained figure with a source and a date.

## 4. Risk measures not present

Volatility, beta, maximum drawdown, correlation. All need per-holding price history, which is one API call per holding against a 25-per-day tier. Low value for a personal tool until section 2 exists.

Cheaper and buildable without new data: a stress view that recomputes withdrawal rate, runway and years of drawdown under a user-entered market fall.

---

## Published league tables: researched, rejected

The Investment Association classifies funds into sectors but collects no performance data. Morningstar supplies limited sector averages back to the IA. Trustnet and Morningstar hold the real quartile tables. All of it is web pages and licensed vendor data with no free API. Nothing is machine-readable or licence-clean enough to use here. Do not re-research this.

This portfolio is 44 self-picked stocks, not a fund, so no league table has an entry for it in any case. Section 2 is the answer to that question.

---

## Known debt

- **Market cap band is generated in code.** A name-based guess with a "Large Cap" default for anything unrecognised. This breaks the no-mock-data rule in `CLAUDE.md`. Either source it from Alpha Vantage Company Overview alongside the sector call, or remove the chart.
- **Finnhub and FMP keys are read and cached but nothing renders.** Dead code path. Either surface an earnings and dividend calendar or strip it.
- **Benchmark selection is not remembered** and resets to MSCI World on reload. Composition comparison against an index is weak for a portfolio that is around 88% US-listed. Section 2 matters more than fixing this.
- **`debug.html`, `test.html`, `list-files.php`** are early scaffolding, unused by the current page.
- **No browser-level testing.** Every change this session was verified headlessly in node. Layout and chart rendering are unverified.

## Out of scope

Stock picking or naming a fund to fill a sector gap. The tool has no approved data source for it, and the rebalance plan deliberately labels new positions by sector only.
