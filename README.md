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

## Layout

Three levels. **Summary strip** at the top: six tiles (Account, Drawdown, Concentration, Vs index, Peers, Plan), each a headline number, a one-line sub and a status pill; clicking a tile opens its section. **Sections** are collapsible `<details>` blocks, closed by default, each with a one-sentence summary line so the closed page reads as a report; open state is remembered in the browser. **Detail toggles** inside sections hide the tables behind "+ …" links. Order: Drawdown → Rebalance Plan → Portfolio Review → Benchmark → Composition → Holdings. Each fact has one owner: cash lives in the Account tile and Drawdown, sector deviation in Benchmark Comparison, concentration stats in Benchmark and the Concentration tile.

## Sections

**Header.** Holdings value, gain/loss vs cost, return on cost, day change, then the summary strip. Account tile = total account value from the CSV header, cash and its share, pill = cash against the plan's reserve.

**Benchmark Comparison.** Portfolio vs MSCI World or S&P 500: sector weights, region split, index top 10 overlap, concentration (largest, top 10, effective N), active share (S&P 500 only; needs full constituent weights). Composition only, no returns. Data: `data/benchmarks.json`, hand-refreshed snapshots with `as_of` and `source`.

**Portfolio Review.** Rule inputs (max/min position, sector band vs index, min trade, cash target) drive flags, a small-positions table, holdings below cost with rise-to-break-even (with a note that SIPP cost basis has no tax effect), and sector bets decomposed into the names behind them. Each small position is labelled by its sector's gap to the benchmark: **Top up** (sector more than the band under the index), **Exit** (sector at or over the index), **Either** (under, within the band). The flag gives the count per label, the combined weight and the dealing cost of exiting all. The **Rebalance Plan** section (its own section, rules taken from Portfolio Review) reconciles cash with drawdown: the cash reserve is the runway floor × monthly withdrawal when a withdrawal is entered (else the cash target), trims above the position cap join the deployable pool, and the pool is allocated across sectors more than the band under the benchmark: sub-minimum holdings in that sector are topped up to the minimum first, then existing holdings largest first up to the cap, then new positions, never overshooting the index. A holding bought in both steps is one row. Sub-minimum holdings the plan does not top up appear as one Decide row, with the exit candidates and their dealing cost split out. The plan note gives the dealing cost of the Trim/Buy rows at the HL online share deal rate (`data/platform-charges.json`). Trades under the min trade rule (default 1% of the account) are never proposed: below that the £6.95 dealing charge is too large a share. A **before/after** table shows cash, concentration and sector measures if every action is taken.

**Drawdown Sustainability.** Inputs: annual withdrawal (not in the CSV; remembered in the browser), withdrawal-rate ceiling, cash-runway floor. Outputs: withdrawal rate, months of cash runway, forced sales in the next 12 months, cash top-up to floor, cash purchasing-power loss, nominal return needed to hold real capital, next year's withdrawal at the same real value. Inflation = latest ONS CPI annual rate (series D7G7), fetched live. Arithmetic only, no forecasts.

**Peer comparison** (toggle inside Drawdown Sustainability). Where the account sits against published distributions, for a user-selected age band:
- Pots entering drawdown by size band (FCA, 2024/25)
- Withdrawal rate vs pots of the same size and vs the same age band (FCA, 2024/25)
- Private pension wealth in payment P25/median/P75 by age (ONS Wealth and Assets Survey, 2020–22)

Bands only; the sources publish no exact percentiles. Data: `data/peer-benchmarks.json`, transcribed from the official spreadsheets named inside it.

**Composition.** Sector tiles with per-holding drill-down and source badges (holdings map, Alpha Vantage, guess). Behind toggles: Leaflet map of value by domicile (US, UK, EU, CH); top and bottom performers.

**Portfolio Holdings.** Card grid with search and sort. Sector and country show "(guess)" when not from the holdings map or Alpha Vantage.

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

Alpha Vantage calls run from the browser. Without a key the app uses the holdings map and labels the rest as guesses.

Endpoint: Alpha Vantage `/query?function=OVERVIEW&symbol={symbol}&apikey={key}` (25 calls/day free). Earnings and dividend calendars (Finnhub, FMP) were removed as unused; they are in git history if a calendar feature is built.

Standard messages when a source is unavailable:

- Sector: "GICS sector classification requires Alpha Vantage API key. Get free key at: https://www.alphavantage.co/support/#api-key"

## Data handling

The page is a snapshot of one uploaded export; nothing from it is kept. Rules in `CLAUDE.md` → Data Handling. `hooks/check_portfolio_data.py` blocks real-portfolio data from commits, alongside devflow's checks (`.devflow/`). Install both once per clone with `sh hooks/install.sh`.

## Out of scope

Performance measurement (return vs benchmark, XIRR, TWR): it needs saved exports. Ideas and researched dead ends are in [ROADMAP.md](ROADMAP.md).
