# Roadmap

Ideas and helpers built on the snapshot, and the findings behind them. Not a spec. Current behaviour is in `README.md`; data rules are in `CLAUDE.md`.

The page is a snapshot of one uploaded HL export and nothing from it is kept (`CLAUDE.md` → Data Handling). Anything that needs history is out of scope.

Last updated 2026-09-22.

---

## 1. Fee drag

Cost of running a multi-stock portfolio against holding one fund. HL SIPP charges are published. Arithmetic only, hand-maintained figure with a source and a date. The share dealing charge is now in `data/platform-charges.json` and used for plan and exit costs; the platform percentage fee is not yet held.

## 2. Stress view

Recompute withdrawal rate, runway and years of drawdown under a user-entered market fall. Snapshot arithmetic only, no new data.

---

## Deferred: anything over time

Out of scope while the page is a snapshot. Kept so the research is not repeated.

**Performance measurement.** The portfolio's own return needs saved exports and transaction history; Data Handling rules that out.

**Alternative-fund returns.** What a UK SIPP holder could have bought instead, over 1, 3, 5 and 10 years. Needs no portfolio data, only fund prices.

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

**Risk measures.** Volatility, beta, maximum drawdown, correlation. All need per-holding price history, one API call per holding against a 25-per-day tier.

---

## Published league tables: researched, rejected

The Investment Association classifies funds into sectors but collects no performance data. Morningstar supplies limited sector averages back to the IA. Trustnet and Morningstar hold the real quartile tables. All of it is web pages and licensed vendor data with no free API. Nothing is machine-readable or licence-clean enough to use here. Do not re-research this.

A portfolio of self-picked stocks is not a fund, so no league table has an entry for it in any case.

---

## Known debt

- **No browser-level testing.** Every change this session was verified headlessly in node. Layout and chart rendering are unverified.

- **Local real-data files still supported.** The `data/live/` file picker, `scan-files.py` (writes real filenames to `file-list.json`) and `data/holdings-map.json` (lists real holdings) conflict with Data Handling. Removal pending a decision on how sectors are classified without the holdings map.
- **Name-based guessing lists in `script.js`** (symbol map, sector and country guessers) were built around real holdings and break the no-hardcoded-classification rule.

## Out of scope

Performance measurement and anything else that needs saved exports (`CLAUDE.md` → Data Handling).

Stock picking or naming a fund to fill a sector gap. The tool has no approved data source for it, and the rebalance plan deliberately labels new positions by sector only.
