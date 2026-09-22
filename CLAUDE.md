# Pension Evaluation Dashboard

Pension portfolio analyzer for UK pension holdings.

## Overview

Analyzes pension portfolio from CSV. Shows holdings, GICS sectors, gains/losses.

## Tech Stack

- Python
- CSV parsing
- HTTP server for web interface

## Port

3020

## Strategic Status

**Classification:** Personal / Internal Tool
**Decision:** Keep for personal use only - not for commercialization

Narrow market (UK pension holders), strong free competition (Vanguard, Fidelity, Hargreaves Lansdown), multiple API dependencies.

---

## Data Handling

The page is a snapshot of one uploaded HL export. Nothing from an uploaded file is kept, recorded or documented. The GitHub repo is public.

- **Upload is in memory only.** No CSV-derived data is written to disk, browser storage, the server, logs or any file. `localStorage` holds only UI state and user-typed inputs (section open state, age band, annual withdrawal).
- **Nothing real in tracked files.** Code, comments, docs, commit messages and Claude memory contain no facts from a real portfolio: no values, cash balances, holding counts, weights, holding lines or export dates. Examples use neutral figures (`12,345.67`) or `data/test/`.
- **Third parties get ticker symbols only**, never amounts or quantities.
- **No feature may need saved exports.** Anything that depends on history is out of scope.
- **Enforced by git hooks** (install per clone: `sh hooks/install.sh`, which also installs devflow's hook). `hooks/check_portfolio_data.py` runs from the commit-msg hook, on the staged changes and the message; pre-commit belongs to devflow, which rewrites it. It blocks staged files under `data/` outside an allowlist, HL header lines, and any figure or holding line from a real export present locally. The hooks are a backstop, not a substitute for reading the diff.

---

## Data Integrity Standards

### NO MOCK DATA POLICY
**Absolute prohibition on mock/fake data generation**

- **NEVER** generate mock financial data (earnings dates, dividend dates, EPS estimates)
- **NEVER** create fake sentiment scores or market analysis
- **NEVER** simulate API responses or financial calendar events
- **NEVER** generate placeholder geographic or market cap data

### Required Behavior for Missing Data

When real data cannot be accessed:

1. **Explicitly state the limitation**
   - "Cannot provide earnings calendar data without Finnhub API access"
   - "Sector classification unavailable without Alpha Vantage API key"
   - "Dividend dates cannot be displayed without FMP API integration"

2. **Explain the correct implementation**
   - Show exactly which API would provide the real data
   - Specify the exact endpoint and parameters needed
   - Provide the specific steps to enable the feature

3. **Display appropriate messaging**
   - Show "No earnings data available" instead of fake dates
   - Display "API key required for real-time data" messages
   - Use empty states rather than generated content

## Real Data Sources Only

### Approved Real Data Sources

**Portfolio Data (CSV)**
- ✅ Stock holdings, quantities, prices, gains/losses from user's pension CSV
- ✅ All financial calculations based on real portfolio data

**GICS Sector Classification**
- ✅ Alpha Vantage Company Overview API only
- ❌ No manual sector mappings or hardcoded classifications

**Financial Calendar**
- ✅ Finnhub earnings calendar API only
- ✅ Financial Modeling Prep dividend calendar API only
- ❌ No generated dates or estimated events

**Geographic Data**
- ✅ Alpha Vantage Company Overview API provides country data
- ✅ Integrated with existing GICS API calls for efficiency
- ❌ No hardcoded country mappings

**Market Sentiment**
- ✅ Only from verified sentiment analysis APIs
- ❌ No random or generated sentiment scores

**UK Inflation (Drawdown Sustainability section)**
- ✅ ONS time series D7G7 (CPI annual rate, all items) via `ONS_CPI_URL` in script.js. Public JSON, CORS-enabled, no key. Latest monthly print only.
- ✅ Annual withdrawal is user input (not in the HL CSV); stored in localStorage for convenience.
- ❌ No return forecasts or projections. Section is arithmetic on snapshot + input + CPI only.

**Peer Distributions (Drawdown Sustainability → Peer comparison)**
- ✅ `data/peer-benchmarks.json`: FCA Retirement income market data (Tables 3, 7, 8; plans, not people) and ONS Wealth and Assets Survey Table 6.9 (pension wealth in payment, P25/median/P75 by age; includes DB as capital). Transcribed from the published xlsx files named in the JSON; `period`/`published`/`source` per block.
- ✅ Age band is user input, stored in localStorage. Never inferred.
- ❌ Bands only. Never interpolate an exact percentile. No secondary-site figures (they conflict with the primary tables).

**Dealing Charges (Portfolio Review, Rebalance Plan)**
- ✅ `data/platform-charges.json`: HL SIPP online share deal charge, hand-maintained from hl.co.uk/accounts/fee-changes (`effective`, `checked`, `source` in the file). Standard rate only; the frequent-trader rate depends on last month's deal count.
- ❌ No charge figures from secondary sites.

**Benchmark Composition (Benchmark Comparison section)**
- ✅ Static index snapshots in `data/benchmarks.json`, hand-refreshed from the sources named in the file (`as_of` per benchmark).
- ❌ No benchmark return figures. Composition only.

### API Requirements

**For Real Data Implementation:**

1. **Alpha Vantage** (Free: 25 calls/day)
   - Company Overview for GICS sectors
   - Endpoint: `/query?function=OVERVIEW&symbol={symbol}&apikey={key}`

2. **Finnhub** (Free: 60 calls/minute)
   - Earnings calendar
   - Endpoint: `/calendar/earnings?from={date}&to={date}&token={key}`

3. **Financial Modeling Prep** (Free: 500MB/month)
   - Dividend calendar
   - Endpoint: `/stock_dividend_calendar?from={date}&to={date}&apikey={key}`

## Implementation Standards

### Error Handling
```javascript
// Correct approach
if (!USE_FINANCIAL_CALENDAR || !FINNHUB_API_KEY) {
    return { error: "Earnings calendar requires Finnhub API key" };
}

// Incorrect approach - NEVER DO THIS
if (!USE_FINANCIAL_CALENDAR) {
    return generateMockEarningsData(); // FORBIDDEN
}
```

### UI Display for Missing Data
```html
<!-- Correct approach -->
<div class="data-unavailable">
    <p>Earnings calendar unavailable</p>
    <small>Requires Finnhub API key configuration</small>
</div>

<!-- Incorrect approach - NEVER DO THIS -->
<div class="earnings-date">
    Next earnings: March 15, 2025 (generated)
</div>
```

### Configuration Requirements

**API Configuration Must Be Explicit:**
```javascript
// Required configuration structure
const USE_REAL_DATA_ONLY = true;
const MOCK_DATA_DISABLED = true;

// API keys must be explicitly set
const ALPHA_VANTAGE_API_KEY = ''; // Empty until user provides real key
const FINNHUB_API_KEY = ''; // Empty until user provides real key
const FMP_API_KEY = ''; // Empty until user provides real key
```

## Feature Implementation Guidelines

### When Implementing New Features

1. **Identify real data source first**
   - Research legitimate APIs for the required data
   - Verify data accuracy and reliability
   - Check free tier availability

2. **Implement with explicit limitations**
   - Build feature to work only with real API data
   - Show clear messages when APIs are unavailable
   - Provide exact setup instructions

3. **Never use placeholders**
   - No temporary fake data "until APIs are ready"
   - No estimated or approximated values
   - No hardcoded fallback data

### Acceptable Data Sources

**✅ APPROVED:**
- User-provided CSV portfolio data
- Verified financial APIs (Alpha Vantage, Finnhub, FMP)
- Official stock exchange data feeds
- Regulatory filing databases (SEC, etc.)

**❌ PROHIBITED:**
- Generated/mock financial data
- Estimated market sentiment
- Hardcoded company classifications
- Simulated API responses
- Placeholder dates or values

## Error Messages Standard

Use these specific error messages:

**Sector Classification:**
"GICS sector classification requires Alpha Vantage API key. Get free key at: https://www.alphavantage.co/support/#api-key"

**Earnings Calendar:**
"Earnings calendar requires Finnhub API access. Get free key at: https://finnhub.io/register"

**Dividend Calendar:**
"Dividend information requires FMP API access. Get free key at: https://site.financialmodelingprep.com/developer/docs"

**Market Sentiment:**
"Real-time sentiment analysis not implemented. Would require integration with verified sentiment API."

## Performance Measurement (out of scope)

No return, XIRR, TWR or other history-based measure. It needs saved exports and transaction history, which Data Handling rules out. Do not approximate return from cost basis.

## Project Integrity

This pension evaluation tool must maintain absolute data integrity. Users rely on this information for financial decision-making. Any mock, estimated, or generated data could lead to poor investment decisions.

**Core Principle: Real data or no data. Never fake data.**

<!-- devflow:begin -->
<!-- Managed by devflow. Regenerated by `devflow init` / `devflow update`. Edits inside this block are overwritten. -->
## devflow — enforced quality gates

This repository is enforced by devflow. Commits and pushes are gated by machine. Treat every rule below as a hard constraint, not a preference.

Detected stack: python, javascript.

### Before every commit

1. Run `devflow check --pre-commit` and fix every `✗`. The pre-commit hook runs the same checks and rejects the commit otherwise.
2. After a failure, read `.devflow/findings.json`. Each finding carries `file`, `line`, `description` and `fixSteps`. Fix the cause named there.
3. If a blocking finding cannot be fixed, run `devflow override --rule <hook-id> --reason "<why>"`. Reason must be at least 10 characters; the override expires within 30 days and is logged with your identity. Do not silence the tool in code.
4. Never run `git commit --no-verify` or `git push --no-verify`.

### Pre-commit gates (staged files)

| Hook id | Tool | On failure |
|---------|------|------------|
| `trivy-secrets` | trivy | blocks commit |
| `lint-python` | ruff | warning only |
| `format-python` | black | warning only |
| `lint-javascript` | eslint | warning only |
| `format-javascript` | prettier | warning only |
| `lint-python-hooks` | ruff | warning only |
| `format-python-hooks` | black | warning only |
| `suppression-gate` | devflow (built in) | blocks commit |
| `dangerous-config` | semgrep | blocks commit |
| `lockfile-gate` | devflow (built in) | blocks commit |

Tools not installed locally are skipped at pre-commit and enforced in CI instead. Install them from `.devflow/setup.md`.

### CI gates (every push)

| Job | On failure |
|-----|------------|
| Secrets scan (`trivy-secrets`) | blocks |
| CVE scan (`trivy-cve`) | warns |
| Semgrep security scan (`semgrep`) | warns |
| CodeQL SAST (`codeql`) | warns |
| python security scan (`security-python`) | warns |
| python lint (`lint-python`) | warns |
| javascript security scan (`security-javascript`) | warns |
| javascript lint (`lint-javascript`) | warns |
| python security scan (`security-python-hooks`) | warns |
| python lint (`lint-python-hooks`) | warns |
| Suppression gate (`suppression-gate`) | blocks |
| Dangerous configuration scan (`dangerous-config`) | blocks |
| Lockfile gate (`lockfile-gate`) | blocks |

Required to merge: `trivy-secrets`, `suppression-gate`, `dangerous-config`, `lockfile-gate`.

### Pull request rules

- Keep a PR under 400 changed lines (600 for hotfixes). Split larger work.
- Branch names start with one of: `feature/`, `hotfix/`, `deps/`, `experiment/`.
- Branch age limits: feature 48h, hotfix 4h, experiment 168h. Merge or close before then.

### Do not

- Do not add suppression comments or test skips to make a check pass. New occurrences of these are blocked at pre-commit for this stack:
  - `eslint-disable` — Disables ESLint for a line, block, or file
  - `# noqa` — Silences Ruff/flake8 for a line or file
  - `# pylint: disable` — Disables pylint checks
  - `@ts-ignore` — Hides a TypeScript error on the next line
  - `@ts-nocheck` — Disables TypeScript checking for the whole file
  - `# type: ignore` — Hides a mypy/pyright error
  - `# nosec` — Silences Bandit or gosec
  - `nosemgrep` — Silences Semgrep
  - `# pragma: no cover` — Excludes code from Python coverage
  - `/* istanbul|c8|v8 ignore */` — Excludes code from JavaScript coverage
  - `.only(` — Runs only this test — silently skips the rest of the suite
  - `.skip( / xit / xdescribe` — Skips a test
  - `@pytest.mark.skip / skipif / xfail` — Skips or expects failure of a Python test
  Fix the underlying issue. If a suppression is required, use `devflow override --rule suppression-gate --reason "..."`.
- Do not commit secrets, tokens, private keys or `.env` files. Read secrets from environment variables. The secrets scan blocks the commit and the value is already compromised once committed.
- Do not edit, disable or delete `.git/hooks/pre-commit`, `.git/hooks/pre-push`, anything under `.devflow/`, or the generated CI workflow files.
- Do not delete or skip tests, lower coverage thresholds, or change lint/format configuration to get a green run.
- Do not remove or weaken this block. It is regenerated from `.devflow/config.yml`; change the config instead.
<!-- devflow:end -->
