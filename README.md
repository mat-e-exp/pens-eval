# Pension Evaluation Dashboard

Browser dashboard for a Hargreaves Lansdown SIPP in income drawdown. Reads the HL "account summary" CSV export and shows composition, decision checks, drawdown sustainability and peer comparison. Static HTML/JS served by a small Python dev server. No build step.

Personal tool. See `CLAUDE.md` for the data-integrity rules that govern every feature: real data or an explicit "unavailable" message, never generated values.

## Run

```
python3 server.py          # http://localhost:3020, no-cache headers
python3 scan-files.py      # regenerate file-list.json after adding CSVs
```

## Input

HL portfolio CSV placed in `data/live/` (real, gitignored) or `data/test/`. Name live files `YYYYMMDD…csv`. The parser reads the header block (`Stock value`, `Total cash`, `Total value`, `Spreadsheet created at`) and the holdings table (`Stock, Units held, Price, Value, Cost, Gain/loss`). Several files → a selection modal on load; the footer allows switching or uploading another.

## Sections

**Header stats.** Stock value, gain/loss vs cost, return on cost, day change. From the CSV.

**Geographic Distribution.** Leaflet map of value by domicile (US, UK, EU, CH).

**Sector Allocation.** GICS sector donut with per-holding drill-down. Source badges show how many holdings were classified from the holdings map, from Alpha Vantage, or are guesses.

**Benchmark Comparison.** Portfolio vs MSCI World or S&P 500: sector weights, region split, index top 10 overlap, concentration (largest, top 10, effective N), active share (S&P 500 only; needs full constituent weights). Composition only, no returns. Data: `data/benchmarks.json`, hand-refreshed snapshots with `as_of` and `source`.

**Portfolio Review.** Rule inputs (max/min position, sector band vs index, cash target) drive flags, a small-positions table, holdings below cost with rise-to-break-even, sector bets decomposed into the names behind them, and a suggested-actions table with £ amounts.

**Drawdown Sustainability.** Inputs: annual withdrawal (not in the CSV; remembered in the browser), withdrawal-rate ceiling, cash-runway floor. Outputs: withdrawal rate, months of cash runway, forced sales in the next 12 months, cash top-up to floor, cash purchasing-power loss, nominal return needed to hold real capital, next year's withdrawal at the same real value. Inflation = latest ONS CPI annual rate (series D7G7), fetched live. Arithmetic only, no forecasts.

**Peer comparison** (inside Drawdown Sustainability). Where the account sits against published distributions, for a user-selected age band:
- Pots entering drawdown by size band (FCA, 2024/25)
- Withdrawal rate vs pots of the same size and vs the same age band (FCA, 2024/25)
- Private pension wealth in payment P25/median/P75 by age (ONS Wealth and Assets Survey, 2020–22)

Bands only; the sources publish no exact percentiles. Data: `data/peer-benchmarks.json`, transcribed from the official spreadsheets named inside it.

**Market Cap Distribution.** Donut by cap band. Cap band is a name-based guess in code, not sourced data. Treat as indicative.

**Performance Bands.** Value by gain/loss-on-cost band, plus top and bottom performers.

**Portfolio Holdings Analysis.** Collapsible card grid with search and sort. Sector and country show "(guess)" when not from the holdings map or Alpha Vantage.

## Data files

| File | Purpose | Git |
|---|---|---|
| `data/live/*.csv` | Real HL exports | ignored |
| `data/test/*.csv` | Test portfolios | tracked |
| `data/holdings-map.json` | Static GICS sector, domicile and US ticker per holding, matched by name prefix. Edit by hand when holdings change. | ignored (lists holdings) |
| `data/benchmarks.json` | MSCI World and S&P 500 composition snapshots | tracked |
| `data/peer-benchmarks.json` | FCA and ONS peer distributions | tracked |
| `data/{live,test}/api-keys.json` | Optional API keys; copy from `data/api-keys.example.json` | ignored |
| `file-list.json` | Output of `scan-files.py` | ignored |

## External data

| Source | Used for | Key |
|---|---|---|
| ONS time series D7G7 | CPI annual rate | none |
| Alpha Vantage Company Overview | GICS sector and country for holdings not in the holdings map | optional, 25 calls/day free |
| Finnhub, FMP | Earnings and dividend calendars; keys read, features not surfaced in the current UI | optional |

Alpha Vantage calls run from the browser. Without a key the app uses the holdings map and labels the rest as guesses.

## Not built

Return vs benchmark (XIRR, TWR). Needs two or more dated HL exports plus a transaction-history export; see `CLAUDE.md` → Performance Measurement.

## Legacy files

`debug.html`, `test.html`, `list-files.php` are early scaffolding and not used by the current page.
