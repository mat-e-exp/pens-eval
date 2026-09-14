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

## Project Integrity

This pension evaluation tool must maintain absolute data integrity. Users rely on this information for financial decision-making. Any mock, estimated, or generated data could lead to poor investment decisions.

**Core Principle: Real data or no data. Never fake data.**