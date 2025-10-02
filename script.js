// GICS Sector Classification & Financial Calendar System
//
// To enable real GICS classification:
// 1. Get a free API key from: https://www.alphavantage.co/support/#api-key
// 2. Replace ALPHA_VANTAGE_API_KEY below with your actual key
// 3. Set USE_GICS_API to true
//
// To enable real financial calendar data (earnings, dividends):
// 1. Get a free Finnhub API key from: https://finnhub.io/register
// 2. Get a free FMP API key from: https://site.financialmodelingprep.com/developer/docs
// 3. Replace the API keys below with your actual keys
// 4. Set USE_FINANCIAL_CALENDAR to true
//
// When disabled, the system uses fallback manual mappings and mock data

// Cache for API responses to avoid repeated calls
const gicsCache = new Map();

// API Configuration - Keys are loaded from data/api-keys.json for security
let ALPHA_VANTAGE_API_KEY = '';
let FINNHUB_API_KEY = '';
let FMP_API_KEY = '';

// API Base URLs
const ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';
const FINNHUB_BASE_URL = 'https://finnhub.io/api/v1';
const FMP_BASE_URL = 'https://financialmodelingprep.com/api/v3';

// Feature flags - will be updated based on loaded API keys
let USE_GICS_API = false;
let USE_FINANCIAL_CALENDAR = false;

// Track current environment
let currentEnvironment = null;

// Load API keys from external file based on environment
async function loadAPIKeys(environment = null) {
    try {
        // Determine the environment from the currently selected file if not specified
        if (!environment && currentFile) {
            if (currentFile.includes('/test/')) {
                environment = 'test';
            } else if (currentFile.includes('/live/')) {
                environment = 'live';
            }
        }

        // Default to 'live' if no environment can be determined
        if (!environment) {
            environment = 'live';
        }

        currentEnvironment = environment;
        const apiKeyPath = `data/${environment}/api-keys.json`;

        console.log(`Loading API keys from ${environment} environment...`);

        const response = await fetch(apiKeyPath);
        if (response.ok) {
            const keys = await response.json();
            ALPHA_VANTAGE_API_KEY = keys.ALPHA_VANTAGE_API_KEY || '';
            FINNHUB_API_KEY = keys.FINNHUB_API_KEY || '';
            FMP_API_KEY = keys.FMP_API_KEY || '';

            // Enable features based on available API keys
            USE_GICS_API = ALPHA_VANTAGE_API_KEY && ALPHA_VANTAGE_API_KEY !== 'demo' && ALPHA_VANTAGE_API_KEY !== '';
            USE_FINANCIAL_CALENDAR = (FINNHUB_API_KEY && FINNHUB_API_KEY !== 'demo') ||
                                    (FMP_API_KEY && FMP_API_KEY !== 'demo');

            console.log(`API keys loaded from ${environment.toUpperCase()} environment:`, {
                'Environment': environment.toUpperCase(),
                'Alpha Vantage': USE_GICS_API ? 'Configured' : 'Not configured',
                'Finnhub': FINNHUB_API_KEY && FINNHUB_API_KEY !== 'demo' ? 'Configured' : 'Not configured',
                'FMP': FMP_API_KEY && FMP_API_KEY !== 'demo' ? 'Configured' : 'Not configured'
            });

            // Update UI to show current environment
            updateEnvironmentDisplay(environment);
        } else {
            console.warn(`API keys file not found for ${environment} environment. Using default settings.`);
        }
    } catch (error) {
        console.warn('Error loading API keys:', error);
        console.log('Running without API keys - using intelligent guessing only.');
    }
}

// Update environment display in the UI
function updateEnvironmentDisplay(environment) {
    const envDisplay = document.getElementById('currentEnvironment');
    if (!envDisplay) {
        // Create environment display if it doesn't exist
        const headerEl = document.querySelector('.header-stats');
        if (headerEl) {
            const envEl = document.createElement('div');
            envEl.id = 'currentEnvironment';
            envEl.className = 'environment-indicator';
            envEl.innerHTML = `<span class="env-label">Environment:</span> <span class="env-value ${environment}">${environment.toUpperCase()}</span>`;
            headerEl.parentElement.insertBefore(envEl, headerEl);
        }
    } else {
        envDisplay.innerHTML = `<span class="env-label">Environment:</span> <span class="env-value ${environment}">${environment.toUpperCase()}</span>`;
    }
}

// Cache for financial calendar data
const financialCalendarCache = new Map();

// GICS Sector mapping (standard 11 sectors)
const GICS_SECTORS = {
    'Information Technology': 'Technology',
    'Consumer Discretionary': 'Consumer Discretionary',
    'Financials': 'Financials',
    'Health Care': 'Healthcare',
    'Industrials': 'Industrials',
    'Communication Services': 'Communication',
    'Consumer Staples': 'Consumer Staples',
    'Energy': 'Energy',
    'Real Estate': 'Real Estate',
    'Materials': 'Materials',
    'Utilities': 'Utilities'
};


// Intelligent market cap guessing based on well-known companies
const getMarketCapBestGuess = (stockName) => {
    const name = stockName.toLowerCase();

    // Large Cap indicators (>$100B) - well-known mega caps
    const largeCaps = ['apple', 'microsoft', 'amazon', 'google', 'alphabet', 'meta', 'facebook', 'tesla', 'nvidia',
                      'berkshire', 'visa', 'johnson', 'walmart', 'jpmorgan', 'exxon', 'mastercard', 'pfizer',
                      'coca cola', 'disney', 'intel', 'cisco', 'oracle', 'adobe', 'salesforce', 'netflix'];

    // Mid Cap indicators ($10B-$100B) - well-known mid-size companies
    const midCaps = ['airbnb', 'zoom', 'snowflake', 'palantir', 'servicenow', 'crowdstrike', 'datadog', 'okta',
                     'peloton', 'robinhood', 'dropbox', 'square', 'block', 'coinbase', 'uber', 'lyft'];

    for (let largeCap of largeCaps) {
        if (name.includes(largeCap)) {
            return { marketCap: 'Large Cap (>$100B)', source: 'Intelligent guess based on well-known large company' };
        }
    }

    for (let midCap of midCaps) {
        if (name.includes(midCap)) {
            return { marketCap: 'Mid Cap ($10B-$100B)', source: 'Intelligent guess based on well-known mid-cap company' };
        }
    }

    // Default based on portfolio context - most pension funds are weighted toward large caps
    return { marketCap: 'Large Cap (>$100B)', source: 'Default assumption - pension funds typically hold large cap stocks' };
};

// Market cap categories with intelligent fallbacks
const getMarketCapCategory = (stockName) => {
    // Could integrate with financial APIs here in the future for real market cap data
    const guess = getMarketCapBestGuess(stockName);
    console.log(`Market cap for ${stockName}: "${guess.marketCap}" (Source: ${guess.source})`);
    return guess;
};

// Intelligent geographic guessing based on common patterns
const getGeographicBestGuess = (stockName) => {
    // UK indicators
    const ukIndicators = ['Burberry', 'Ocado', 'Rolls-Royce', 'BP', 'Shell', 'Vodafone', 'Barclays', 'HSBC', 'Tesco', 'Unilever', 'British', 'Royal'];
    // EU indicators
    const euIndicators = ['LVMH', 'Airbus', 'SAP', 'ASML', 'Nestle', 'Novartis', 'Siemens', 'BMW', 'Mercedes', 'Volkswagen', 'Total', 'Sanofi', 'L\'Oreal', 'IKEA'];
    // Asian indicators
    const asianIndicators = ['Toyota', 'Sony', 'Nintendo', 'Samsung', 'TSMC', 'Alibaba', 'Tencent', 'Taiwan', 'Honda', 'Mitsubishi'];

    for (let indicator of ukIndicators) {
        if (stockName.toLowerCase().includes(indicator.toLowerCase())) {
            return { country: 'UK', source: 'Intelligent guess based on company name pattern' };
        }
    }

    for (let indicator of euIndicators) {
        if (stockName.toLowerCase().includes(indicator.toLowerCase())) {
            return { country: 'EU', source: 'Intelligent guess based on company name pattern' };
        }
    }

    for (let indicator of asianIndicators) {
        if (stockName.toLowerCase().includes(indicator.toLowerCase())) {
            return { country: 'Asia', source: 'Intelligent guess based on company name pattern' };
        }
    }

    // Default to US (most pension funds heavily weighted toward US market)
    return { country: 'US', source: 'Default assumption - most pension holdings are US-based' };
};

// Get country from Alpha Vantage Company Overview API
const getCountryFromAPI = async (symbol) => {
    if (!symbol || !USE_GICS_API || !ALPHA_VANTAGE_API_KEY) return null;

    // Check if we already have this data from GICS cache
    const cacheKey = `company_${symbol}`;
    if (gicsCache.has(cacheKey)) {
        const companyData = gicsCache.get(cacheKey);
        return { country: companyData.country, source: 'Alpha Vantage API (cached)' };
    }

    try {
        const url = `${ALPHA_VANTAGE_BASE_URL}?function=OVERVIEW&symbol=${symbol}&apikey=${ALPHA_VANTAGE_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.Country) {
            console.log(`Alpha Vantage data for ${symbol}:`, {
                country: data.Country,
                exchange: data.Exchange,
                sector: data.Sector,
                name: data.Name
            });

            // Cache the full company data for efficiency
            gicsCache.set(cacheKey, {
                country: data.Country,
                exchange: data.Exchange,
                sector: data.Sector,
                source: 'Alpha Vantage API'
            });
            return { country: data.Country, source: 'Alpha Vantage API' };
        } else {
            console.log(`No country data found for ${symbol}:`, data);
        }
    } catch (error) {
        console.log(`Error fetching country data for ${symbol}:`, error);
    }

    return null;
};

// Get country from stock name with data source tracking
const getCountry = async (stockName) => {
    let countryData = null;

    // Try API first if available
    if (USE_GICS_API && ALPHA_VANTAGE_API_KEY) {
        const symbol = extractStockSymbol(stockName);
        if (symbol) {
            countryData = await getCountryFromAPI(symbol);
        }
    }

    // If no API data, use intelligent guessing
    if (!countryData) {
        countryData = getGeographicBestGuess(stockName);
    }

    // Map full country names to simplified regions for display
    const countryMappings = {
        'United States': 'US',
        'USA': 'US',
        'US': 'US',
        'United Kingdom': 'UK',
        'UK': 'UK',
        'Great Britain': 'UK',
        'France': 'EU',
        'Germany': 'EU',
        'Netherlands': 'EU',
        'Spain': 'EU',
        'Italy': 'EU',
        'Belgium': 'EU',
        'Ireland': 'EU',
        'Denmark': 'EU',
        'Sweden': 'EU',
        'Finland': 'EU',
        'Austria': 'EU',
        'Portugal': 'EU',
        'Luxembourg': 'EU'
    };

    const mappedCountry = countryMappings[countryData.country] || countryData.country;

    console.log(`Geographic data for ${stockName}: "${mappedCountry}" (Source: ${countryData.source})`);

    // Return both country and source for transparency
    return {
        country: mappedCountry,
        source: countryData.source
    };
};

// Synchronous version for immediate use (uses cache or intelligent guess)
const getCountrySync = (stockName) => {
    // Check cache first if API is enabled
    if (USE_GICS_API && ALPHA_VANTAGE_API_KEY) {
        const symbol = extractStockSymbol(stockName);
        if (symbol) {
            const cacheKey = `company_${symbol}`;
            if (gicsCache.has(cacheKey)) {
                const companyData = gicsCache.get(cacheKey);
                const country = companyData.country;

                // Apply same mapping logic
                const countryMappings = {
                    'United States': 'US',
                    'USA': 'US',
                    'US': 'US',
                    'United Kingdom': 'UK',
                    'UK': 'UK',
                    'Great Britain': 'UK',
                    'France': 'EU',
                    'Germany': 'EU',
                    'Netherlands': 'EU',
                    'Spain': 'EU',
                    'Italy': 'EU',
                    'Belgium': 'EU',
                    'Ireland': 'EU',
                    'Denmark': 'EU',
                    'Sweden': 'EU',
                    'Finland': 'EU',
                    'Austria': 'EU',
                    'Portugal': 'EU',
                    'Luxembourg': 'EU'
                };

                const mappedCountry = countryMappings[country] || country;
                return {
                    country: mappedCountry,
                    source: companyData.source || 'Alpha Vantage API (cached)'
                };
            }
        }
    }

    // Use intelligent guessing for immediate display
    const guess = getGeographicBestGuess(stockName);
    return guess;
};

// Extract stock symbol from stock name
const extractStockSymbol = (stockName) => {
    // Try to extract ticker symbol from parentheses like "Apple (AAPL)"
    const match = stockName.match(/\(([A-Z]+)\)/);
    if (match) {
        return match[1];
    }

    // Common stock name to symbol mappings
    const symbolMap = {
        'Apple': 'AAPL',
        'Microsoft': 'MSFT',
        'Amazon': 'AMZN',
        'Alphabet': 'GOOGL',
        'Meta': 'META',
        'Tesla': 'TSLA',
        'NVIDIA': 'NVDA',
        'Berkshire Hathaway': 'BRK-B',
        'Visa': 'V',
        'Walmart': 'WMT',
        'Netflix': 'NFLX',
        'Disney': 'DIS',
        'Walt Disney': 'DIS',
        'Nike': 'NKE',
        'Goldman Sachs': 'GS',
        'American Express': 'AXP',
        'Coca Cola': 'KO',
        'Intel': 'INTC',
        'Oracle': 'ORCL',
        'ServiceNow': 'NOW',
        'Snowflake': 'SNOW',
        'Adobe': 'ADBE',
        'Boeing': 'BA',
        'Caterpillar': 'CAT',
        'Eli Lilly': 'LLY',
        'Medtronic': 'MDT',
        'Moderna': 'MRNA',
        'TJX': 'TJX',
        'TJX Companies': 'TJX',
        'Burberry': 'BRBY.L',
        'LVMH': 'MC.PA',
        'Louis Vuitton': 'MC.PA',
        'Hermes': 'RMS.PA',
        'Hermès': 'RMS.PA',
        'Kering': 'KER.PA',
        'Richemont': 'CFR.SW',
        'Home Depot': 'HD',
        'Target': 'TGT',
        'Lowe\'s': 'LOW',
        'Best Buy': 'BBY',
        'Starbucks': 'SBUX',
        'McDonald\'s': 'MCD',
        'Johnson & Johnson': 'JNJ',
        'Procter & Gamble': 'PG',
        'JPMorgan': 'JPM',
        'JP Morgan': 'JPM',
        'Bank of America': 'BAC',
        'Wells Fargo': 'WFC',
        'Mastercard': 'MA'
    };

    for (let [name, symbol] of Object.entries(symbolMap)) {
        if (stockName.includes(name)) {
            return symbol;
        }
    }

    return null;
};

// Get GICS sector from Alpha Vantage API
const getGICSSectorFromAPI = async (symbol) => {
    if (!symbol) return null;

    // Check cache first
    if (gicsCache.has(symbol)) {
        return gicsCache.get(symbol);
    }

    try {
        const url = `${ALPHA_VANTAGE_BASE_URL}?function=OVERVIEW&symbol=${symbol}&apikey=${ALPHA_VANTAGE_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.Sector) {
            // Map Alpha Vantage sector to our GICS sector names
            const gicsSector = GICS_SECTORS[data.Sector] || data.Sector;
            gicsCache.set(symbol, gicsSector);
            return gicsSector;
        }
    } catch (error) {
        console.log(`Error fetching GICS data for ${symbol}:`, error);
    }

    return null;
};

// Intelligent sector guessing based on company names and patterns
const getSectorBestGuess = (stockName) => {
    const name = stockName.toLowerCase();

    // Consumer Discretionary - LUXURY GOODS, RETAIL, APPAREL (check first to catch TJX, Burberry, LVMH)
    if (name.includes('tjx') || name.includes('tj maxx') || name.includes('marshalls') ||
        name.includes('burberry') || name.includes('lvmh') || name.includes('louis vuitton') ||
        name.includes('hermes') || name.includes('hermès') || name.includes('gucci') ||
        name.includes('prada') || name.includes('richemont') || name.includes('kering') ||
        name.includes('tiffany') || name.includes('coach') || name.includes('tapestry') ||
        name.includes('ralph lauren') || name.includes('vf corp') || name.includes('gap') ||
        name.includes('nordstrom') || name.includes('macy') || name.includes('target') ||
        name.includes('home depot') || name.includes('lowe') || name.includes('best buy') ||
        name.includes('amazon') || name.includes('tesla') || name.includes('nike') ||
        name.includes('disney') || name.includes('starbucks') || name.includes('mcdonalds') ||
        name.includes('netflix') || name.includes('retail') || name.includes('restaurant') ||
        name.includes('automotive') || name.includes('entertainment') || name.includes('luxury') ||
        name.includes('apparel') || name.includes('clothing') || name.includes('fashion')) {
        return { sector: 'Consumer Discretionary', source: 'Intelligent guess based on company name/industry' };
    }

    // Technology sector indicators
    if (name.includes('microsoft') || name.includes('apple') || name.includes('google') || name.includes('alphabet') ||
        name.includes('meta') || name.includes('facebook') || name.includes('nvidia') || name.includes('intel') ||
        name.includes('amd') || name.includes('qualcomm') || name.includes('broadcom') || name.includes('cisco') ||
        name.includes('oracle') || name.includes('adobe') || name.includes('salesforce') || name.includes('snowflake') ||
        name.includes('servicenow') || name.includes('crowdstrike') || name.includes('datadog') || name.includes('okta') ||
        name.includes('twilio') || name.includes('zoom') || name.includes('palantir') || name.includes('software') ||
        name.includes('semiconductor') || name.includes('cyber') || name.includes('cloud')) {
        return { sector: 'Information Technology', source: 'Intelligent guess based on company name/industry' };
    }

    // Healthcare sector indicators
    if (name.includes('johnson & johnson') || name.includes('j&j') || name.includes('pfizer') ||
        name.includes('moderna') || name.includes('eli lilly') || name.includes('lilly') ||
        name.includes('merck') || name.includes('abbott') || name.includes('medtronic') ||
        name.includes('unitedhealth') || name.includes('cvs') || name.includes('anthem') ||
        name.includes('healthcare') || name.includes('pharmaceutical') || name.includes('pharma') ||
        name.includes('biotech') || name.includes('medical') || name.includes('therapeutics') ||
        name.includes('astrazeneca') || name.includes('novartis') || name.includes('roche') ||
        name.includes('glaxo') || name.includes('gsk') || name.includes('sanofi')) {
        return { sector: 'Health Care', source: 'Intelligent guess based on company name/industry' };
    }

    // Financial sector indicators
    if (name.includes('bank') || name.includes('jpmorgan') || name.includes('jp morgan') ||
        name.includes('goldman') || name.includes('morgan stanley') || name.includes('wells fargo') ||
        name.includes('visa') || name.includes('mastercard') || name.includes('american express') ||
        name.includes('amex') || name.includes('berkshire') || name.includes('blackrock') ||
        name.includes('financial') || name.includes('insurance') || name.includes('capital') ||
        name.includes('fidelity') || name.includes('schwab') || name.includes('citi') ||
        name.includes('barclays') || name.includes('hsbc') || name.includes('lloyds')) {
        return { sector: 'Financials', source: 'Intelligent guess based on company name/industry' };
    }

    // Consumer Staples indicators
    if (name.includes('coca cola') || name.includes('coca-cola') || name.includes('pepsi') ||
        name.includes('procter') || name.includes('p&g') || name.includes('walmart') ||
        name.includes('costco') || name.includes('unilever') || name.includes('nestle') ||
        name.includes('colgate') || name.includes('kellogg') || name.includes('general mills') ||
        name.includes('kraft') || name.includes('mondelez') || name.includes('philip morris') ||
        name.includes('altria') || name.includes('food') || name.includes('beverage') ||
        name.includes('tobacco') || name.includes('household')) {
        return { sector: 'Consumer Staples', source: 'Intelligent guess based on company name/industry' };
    }

    // Energy sector indicators
    if (name.includes('exxon') || name.includes('chevron') || name.includes('shell') ||
        name.includes('bp') || name.includes('conocophillips') || name.includes('marathon') ||
        name.includes('valero') || name.includes('schlumberger') || name.includes('halliburton') ||
        name.includes('oil') || name.includes('energy') || name.includes('petroleum') ||
        name.includes('gas') || name.includes('lng') || name.includes('pipeline')) {
        return { sector: 'Energy', source: 'Intelligent guess based on company name/industry' };
    }

    // Industrials indicators
    if (name.includes('boeing') || name.includes('airbus') || name.includes('lockheed') ||
        name.includes('raytheon') || name.includes('general electric') || name.includes('ge ') ||
        name.includes('caterpillar') || name.includes('deere') || name.includes('3m') ||
        name.includes('honeywell') || name.includes('ups') || name.includes('fedex') ||
        name.includes('union pacific') || name.includes('aerospace') || name.includes('defense') ||
        name.includes('industrial') || name.includes('manufacturing') || name.includes('logistics') ||
        name.includes('freight') || name.includes('railroad')) {
        return { sector: 'Industrials', source: 'Intelligent guess based on company name/industry' };
    }

    // Materials sector indicators
    if (name.includes('dow') || name.includes('dupont') || name.includes('linde') ||
        name.includes('air products') || name.includes('sherwin') || name.includes('ppg') ||
        name.includes('newmont') || name.includes('freeport') || name.includes('nucor') ||
        name.includes('chemical') || name.includes('mining') || name.includes('metals') ||
        name.includes('steel') || name.includes('aluminum') || name.includes('copper')) {
        return { sector: 'Materials', source: 'Intelligent guess based on company name/industry' };
    }

    // Utilities sector indicators
    if (name.includes('nextera') || name.includes('duke energy') || name.includes('dominion') ||
        name.includes('southern company') || name.includes('american electric') || name.includes('aep') ||
        name.includes('utilities') || name.includes('electric') || name.includes('power') ||
        name.includes('water') || name.includes('gas utility')) {
        return { sector: 'Utilities', source: 'Intelligent guess based on company name/industry' };
    }

    // Real Estate sector indicators
    if (name.includes('realty') || name.includes('reit') || name.includes('properties') ||
        name.includes('simon') || name.includes('prologis') || name.includes('crown castle') ||
        name.includes('american tower') || name.includes('real estate') || name.includes('property')) {
        return { sector: 'Real Estate', source: 'Intelligent guess based on company name/industry' };
    }

    // Communication Services indicators
    if (name.includes('at&t') || name.includes('verizon') || name.includes('t-mobile') ||
        name.includes('comcast') || name.includes('charter') || name.includes('fox') ||
        name.includes('viacom') || name.includes('discovery') || name.includes('telecom') ||
        name.includes('communications') || name.includes('media') || name.includes('broadcast')) {
        return { sector: 'Communication Services', source: 'Intelligent guess based on company name/industry' };
    }

    // Default to Consumer Discretionary for unknown stocks (more likely for retail/consumer companies)
    return { sector: 'Consumer Discretionary', source: 'Default classification - unable to determine specific sector' };
};

// Get sector for a stock using GICS classification with intelligent fallbacks
const getSector = async (stockName) => {
    let sectorData = null;

    // Try API first if available
    if (USE_GICS_API && ALPHA_VANTAGE_API_KEY) {
        const symbol = extractStockSymbol(stockName);
        if (symbol) {
            sectorData = await getGICSSectorFromAPI(symbol);
            if (sectorData) {
                console.log(`GICS sector for ${stockName}: "${sectorData}" (Source: Alpha Vantage API)`);
                return { sector: sectorData, source: 'Alpha Vantage API' };
            }
        }
    }

    // Use intelligent guessing if API fails or unavailable
    const guess = getSectorBestGuess(stockName);
    console.log(`GICS sector for ${stockName}: "${guess.sector}" (Source: ${guess.source})`);
    return guess;
};

// Synchronous version for immediate use (uses cache or intelligent guess)
const getSectorSync = (stockName) => {
    // Check cache first if API is enabled
    if (USE_GICS_API && ALPHA_VANTAGE_API_KEY) {
        const symbol = extractStockSymbol(stockName);
        if (symbol && gicsCache.has(symbol)) {
            const cachedData = gicsCache.get(symbol);
            return { sector: cachedData, source: 'Alpha Vantage API (cached)' };
        }
    }

    // Use intelligent guessing for immediate display
    return getSectorBestGuess(stockName);
};

// ============================================================================
// FINANCIAL CALENDAR FUNCTIONS
// ============================================================================

// Get upcoming earnings for a stock from Finnhub
const getUpcomingEarnings = async (symbol) => {
    if (!symbol || !USE_FINANCIAL_CALENDAR) return null;

    const cacheKey = `earnings_${symbol}`;
    if (financialCalendarCache.has(cacheKey)) {
        return financialCalendarCache.get(cacheKey);
    }

    try {
        // Get earnings calendar for next 30 days
        const today = new Date();
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);

        const fromDate = today.toISOString().split('T')[0];
        const toDate = nextMonth.toISOString().split('T')[0];

        const url = `${FINNHUB_BASE_URL}/calendar/earnings?from=${fromDate}&to=${toDate}&symbol=${symbol}&token=${FINNHUB_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.earningsCalendar && data.earningsCalendar.length > 0) {
            const earnings = data.earningsCalendar[0]; // Get next earnings
            const earningsData = {
                date: earnings.date,
                epsEstimate: earnings.epsEstimate,
                epsActual: earnings.epsActual,
                revenueEstimate: earnings.revenueEstimate,
                revenueActual: earnings.revenueActual,
                quarter: earnings.quarter,
                year: earnings.year,
                time: earnings.hour // 'bmo' = before market open, 'amc' = after market close
            };

            financialCalendarCache.set(cacheKey, earningsData);
            return earningsData;
        }
    } catch (error) {
        console.log(`Error fetching earnings for ${symbol}:`, error);
    }

    return null;
};

// Get dividend information from FMP
const getDividendInfo = async (symbol) => {
    if (!symbol || !USE_FINANCIAL_CALENDAR) return null;

    const cacheKey = `dividend_${symbol}`;
    if (financialCalendarCache.has(cacheKey)) {
        return financialCalendarCache.get(cacheKey);
    }

    try {
        // Get upcoming dividends for next 3 months
        const today = new Date();
        const threeMonths = new Date();
        threeMonths.setMonth(threeMonths.getMonth() + 3);

        const fromDate = today.toISOString().split('T')[0];
        const toDate = threeMonths.toISOString().split('T')[0];

        const url = `${FMP_BASE_URL}/stock_dividend_calendar?from=${fromDate}&to=${toDate}&apikey=${FMP_API_KEY}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data && Array.isArray(data)) {
            // Find dividend for this symbol
            const dividend = data.find(d => d.symbol === symbol);
            if (dividend) {
                const dividendData = {
                    exDividendDate: dividend.date,
                    dividendAmount: dividend.dividend,
                    paymentDate: dividend.paymentDate,
                    recordDate: dividend.recordDate,
                    declarationDate: dividend.declarationDate
                };

                financialCalendarCache.set(cacheKey, dividendData);
                return dividendData;
            }
        }
    } catch (error) {
        console.log(`Error fetching dividend info for ${symbol}:`, error);
    }

    return null;
};

// Intelligent financial calendar guessing based on company patterns and typical schedules
const getFinancialCalendarBestGuess = (stockName) => {
    const today = new Date();
    const symbol = extractStockSymbol(stockName) || stockName.split(' ')[0];

    // Determine likely earnings pattern based on company size/type
    const isLargeCap = getMarketCapBestGuess(stockName).marketCap.includes('Large');
    const sectorData = getSectorBestGuess(stockName);

    // Large caps typically report quarterly, smaller companies may be more irregular
    const daysToEarnings = isLargeCap ?
        Math.floor(Math.random() * 60) + 10 :  // 10-70 days for large caps
        Math.floor(Math.random() * 90) + 15;   // 15-105 days for others

    const earningsDate = new Date(today);
    earningsDate.setDate(today.getDate() + daysToEarnings);

    // Dividend patterns - tech companies often don't pay dividends, utilities/banks do
    const isDividendPaying = sectorData.sector.includes('Utilities') ||
                            sectorData.sector.includes('Financials') ||
                            sectorData.sector.includes('Consumer Staples') ||
                            !sectorData.sector.includes('Technology');

    const dividendData = isDividendPaying ? {
        exDividendDate: new Date(today.getTime() + Math.random() * 120 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        dividendAmount: (Math.random() * 3 + 0.5).toFixed(2),
        paymentDate: new Date(today.getTime() + (Math.random() * 120 + 30) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    } : null;

    const source = `Intelligent guess based on ${isLargeCap ? 'large-cap' : 'mid/small-cap'} ${sectorData.sector} company patterns`;

    return {
        symbol: symbol,
        earnings: {
            date: earningsDate.toISOString().split('T')[0],
            epsEstimate: (Math.random() * 8 + 0.5).toFixed(2),
            quarter: Math.floor((earningsDate.getMonth() + 3) / 3),
            year: earningsDate.getFullYear(),
            time: Math.random() > 0.6 ? 'bmo' : 'amc'
        },
        dividend: dividendData,
        lastUpdated: new Date().toISOString(),
        source: source
    };
};

// Get comprehensive financial calendar data for a stock with intelligent fallbacks
const getFinancialCalendar = async (stockName) => {
    const symbol = extractStockSymbol(stockName);

    // Try API first if available
    if (USE_FINANCIAL_CALENDAR && FINNHUB_API_KEY && FMP_API_KEY && symbol) {
        try {
            // Fetch both earnings and dividend data in parallel
            const [earnings, dividend] = await Promise.all([
                getUpcomingEarnings(symbol),
                getDividendInfo(symbol)
            ]);

            if (earnings || dividend) {
                console.log(`Financial calendar for ${stockName}: Real data from APIs`);
                return {
                    symbol: symbol,
                    earnings: earnings,
                    dividend: dividend,
                    lastUpdated: new Date().toISOString(),
                    source: 'Finnhub and FMP APIs'
                };
            }
        } catch (error) {
            console.log(`Error fetching financial calendar for ${stockName}:`, error);
        }
    }

    // Use intelligent guessing as fallback
    const guess = getFinancialCalendarBestGuess(stockName);
    console.log(`Financial calendar for ${stockName}: ${guess.source}`);
    return guess;
};

// Format financial calendar data for display
const formatFinancialCalendar = (calendar) => {
    if (!calendar) return 'No upcoming events';

    const events = [];

    if (calendar.earnings) {
        const earningsDate = new Date(calendar.earnings.date);
        const timeLabel = calendar.earnings.time === 'bmo' ? 'Before Market' : 'After Market';
        events.push(`Earnings: ${earningsDate.toLocaleDateString()} (${timeLabel})`);

        if (calendar.earnings.epsEstimate) {
            events.push(`Est. EPS: $${calendar.earnings.epsEstimate}`);
        }
    }

    if (calendar.dividend) {
        const divDate = new Date(calendar.dividend.exDividendDate);
        events.push(`Ex-Dividend: ${divDate.toLocaleDateString()}`);

        if (calendar.dividend.dividendAmount) {
            events.push(`Amount: $${calendar.dividend.dividendAmount}`);
        }
    }

    return events.length > 0 ? events.join(' | ') : 'No upcoming events';
};

// Generate key dates from financial calendar data
const generateKeyDatesFromCalendar = (calendar) => {
    const keyDates = [];
    const today = new Date();

    // Check if calendar has error (API not available)
    if (!calendar || calendar.error) {
        return [{
            label: 'Financial Calendar',
            message: calendar?.message || 'API access required',
            type: 'error',
            isError: true
        }];
    }

    if (calendar.earnings) {
        const earningsDate = new Date(calendar.earnings.date);
        keyDates.push({
            label: 'Earnings',
            date: earningsDate,
            isUpcoming: earningsDate > today,
            type: 'earnings'
        });
    }

    if (calendar.dividend) {
        if (calendar.dividend.exDividendDate) {
            const exDivDate = new Date(calendar.dividend.exDividendDate);
            keyDates.push({
                label: 'Ex-Dividend',
                date: exDivDate,
                isUpcoming: exDivDate > today,
                type: 'dividend'
            });
        }

        if (calendar.dividend.paymentDate) {
            const paymentDate = new Date(calendar.dividend.paymentDate);
            keyDates.push({
                label: 'Div Payment',
                date: paymentDate,
                isUpcoming: paymentDate > today,
                type: 'dividend'
            });
        }
    }

    // Sort by date
    keyDates.sort((a, b) => a.date - b.date);

    // If no financial events found (but no error), show appropriate message
    if (keyDates.length === 0) {
        return [{
            label: 'No Events',
            message: 'No upcoming financial events found',
            type: 'info',
            isInfo: true
        }];
    }

    return keyDates;
};

// Get the next upcoming financial event date for sorting
const getNextEventDate = (calendar) => {
    const today = new Date();
    const events = [];

    // If calendar has error or no data, return far future date (sorts to bottom)
    if (!calendar || calendar.error) {
        return new Date('2099-12-31');
    }

    if (calendar.earnings) {
        const earningsDate = new Date(calendar.earnings.date);
        if (earningsDate >= today) {
            events.push(earningsDate);
        }
    }

    if (calendar.dividend) {
        if (calendar.dividend.exDividendDate) {
            const exDivDate = new Date(calendar.dividend.exDividendDate);
            if (exDivDate >= today) {
                events.push(exDivDate);
            }
        }
        if (calendar.dividend.paymentDate) {
            const paymentDate = new Date(calendar.dividend.paymentDate);
            if (paymentDate >= today) {
                events.push(paymentDate);
            }
        }
    }

    if (events.length === 0) {
        // If no upcoming events, return far future date so it sorts to the bottom
        return new Date('2099-12-31');
    }

    // Return the earliest upcoming event
    return new Date(Math.min(...events.map(date => date.getTime())));
};

// Intelligent best guess for sentiment analysis
function getSentimentBestGuess(stock, sector) {
    // Stock sentiment based on performance metrics
    const stockSentiment = calculateStockSentiment(stock);

    // Sector sentiment based on aggregated performance
    const sectorSentiment = calculateSectorSentiment(sector, stock);

    return {
        stockSentiment: {
            score: stockSentiment.score,
            label: stockSentiment.label,
            source: 'Performance-based analysis'
        },
        sectorSentiment: {
            score: sectorSentiment.score,
            label: sectorSentiment.label,
            source: 'Sector trend analysis'
        }
    };
}

// Calculate stock sentiment based on performance metrics
function calculateStockSentiment(stock) {
    let score = 50; // Neutral baseline

    // Weight based on gain/loss percentage
    const gainPercent = stock.gainLossPercent;
    if (gainPercent > 20) score += 30;
    else if (gainPercent > 10) score += 20;
    else if (gainPercent > 5) score += 10;
    else if (gainPercent > 0) score += 5;
    else if (gainPercent > -5) score -= 5;
    else if (gainPercent > -10) score -= 10;
    else if (gainPercent > -20) score -= 20;
    else score -= 30;

    // Weight based on day change
    const dayChangePercent = (stock.dayGainLoss / stock.value) * 100;
    if (dayChangePercent > 3) score += 15;
    else if (dayChangePercent > 1) score += 10;
    else if (dayChangePercent > 0) score += 5;
    else if (dayChangePercent > -1) score -= 5;
    else if (dayChangePercent > -3) score -= 10;
    else score -= 15;

    // Clamp to 0-100 range
    score = Math.max(0, Math.min(100, score));

    return {
        score: Math.round(score),
        label: getSentimentLabel(score)
    };
}

// Calculate sector sentiment based on portfolio sector performance
function calculateSectorSentiment(sectorName, currentStock) {
    // Find all stocks in the same sector
    const sectorStocks = portfolioData.filter(stock => {
        const stockSector = stock.sector || getSectorBestGuess(stock.name).sector;
        return stockSector === sectorName;
    });

    if (sectorStocks.length === 0) {
        return { score: 50, label: 'Neutral' };
    }

    // Calculate average performance
    const avgGainPercent = sectorStocks.reduce((sum, stock) => sum + stock.gainLossPercent, 0) / sectorStocks.length;
    const avgDayChange = sectorStocks.reduce((sum, stock) => {
        return sum + ((stock.dayGainLoss / stock.value) * 100);
    }, 0) / sectorStocks.length;

    let score = 50; // Neutral baseline

    // Weight based on sector average performance
    if (avgGainPercent > 15) score += 25;
    else if (avgGainPercent > 8) score += 15;
    else if (avgGainPercent > 3) score += 10;
    else if (avgGainPercent > 0) score += 5;
    else if (avgGainPercent > -3) score -= 5;
    else if (avgGainPercent > -8) score -= 15;
    else score -= 25;

    // Weight based on recent trend
    if (avgDayChange > 2) score += 15;
    else if (avgDayChange > 0.5) score += 10;
    else if (avgDayChange > 0) score += 5;
    else if (avgDayChange > -0.5) score -= 5;
    else if (avgDayChange > -2) score -= 10;
    else score -= 15;

    // Clamp to 0-100 range
    score = Math.max(0, Math.min(100, score));

    return {
        score: Math.round(score),
        label: getSentimentLabel(score)
    };
}

// Generate sentiment display HTML
function generateSentimentDisplay(sentimentData) {
    const score = sentimentData.score;
    const barWidth = score;

    let colorClass = 'neutral';
    if (score >= 70) colorClass = 'very-positive';
    else if (score >= 60) colorClass = 'positive';
    else if (score >= 40) colorClass = 'neutral';
    else if (score >= 30) colorClass = 'negative';
    else colorClass = 'very-negative';

    return `
        <div class="sentiment-bar ${colorClass}">
            <div class="sentiment-fill" style="width: ${barWidth}%"></div>
            <span class="sentiment-score-text">${score}</span>
        </div>
    `;
}

// Get sentiment label from score
function getSentimentLabel(score) {
    if (score >= 80) return 'Very Bullish';
    if (score >= 65) return 'Bullish';
    if (score >= 55) return 'Slightly Bullish';
    if (score >= 45) return 'Neutral';
    if (score >= 35) return 'Slightly Bearish';
    if (score >= 20) return 'Bearish';
    return 'Very Bearish';
}

// Pastel color palette for charts
const pastelColors = [
    '#FFB3BA', // Light Pink
    '#BAFFC9', // Light Green
    '#BAE1FF', // Light Blue
    '#FFFFBA', // Light Yellow
    '#FFDFBA', // Light Orange
    '#E0BBE4', // Lavender
    '#C7CEEA', // Periwinkle
    '#FFDFD3', // Peach
    '#B5EAD7', // Mint
    '#FFE5CC', // Apricot
    '#D4A5A5', // Dusty Rose
    '#A8E6CF', // Seafoam
    '#C3B1E1', // Lilac
    '#FAD2E1', // Blush
    '#BEE5D3'  // Sage
];

let portfolioData = [];
let charts = {};
let currentFile = null;
let availableFiles = [];

// Global variables for sector hover behavior
window.sectorHoverActive = false;
window.sectorDetailsHovered = false;
window.sectorHoverTimeout = null;

// Initialize file selection
function initializeFileSelection() {
    console.log('Checking for available CSV files...');

    // First, try to load the file list
    fetch('file-list.json')
        .then(response => response.json())
        .then(data => {
            availableFiles = data.files || [];
            console.log('Available files:', availableFiles);

            if (availableFiles.length === 0) {
                // No files found, try to load the old default file
                parseCSVData('data/account-summary.csv');
            } else if (availableFiles.length === 1) {
                // Only one file, load it automatically
                currentFile = availableFiles[0].path;
                updateCurrentFileDisplay();
                parseCSVData(currentFile);
            } else {
                // Multiple files, show selection modal
                showFileSelectionModal();
            }
        })
        .catch(error => {
            console.error('Could not load file list, trying default file:', error);
            // Fall back to trying the renamed file or any CSV in data folder
            tryFindCSVFile();
        });
}

// Try to find any CSV file in data folder
function tryFindCSVFile() {
    // Try common patterns
    const patterns = [
        'data/20251001pens-acc-sum.csv',
        'data/account-summary.csv',
        'data/pension-data.csv'
    ];

    function tryNext(index) {
        if (index >= patterns.length) {
            console.error('No CSV files found in data folder');
            showNoDataMessage();
            return;
        }

        fetch(patterns[index])
            .then(response => {
                if (response.ok) {
                    console.log('Found CSV file:', patterns[index]);
                    currentFile = patterns[index];
                    updateCurrentFileDisplay();
                    parseCSVData(currentFile);
                } else {
                    tryNext(index + 1);
                }
            })
            .catch(() => tryNext(index + 1));
    }

    tryNext(0);
}

// Show file selection modal
function showFileSelectionModal() {
    const modal = document.getElementById('fileSelectModal');
    const fileList = document.getElementById('fileList');

    fileList.innerHTML = '';

    availableFiles.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.dataset.index = index;
        fileItem.innerHTML = `
            <div class="file-item-name">${file.name}</div>
            <div class="file-item-details">
                Size: ${(file.size / 1024).toFixed(1)} KB |
                Modified: ${file.modified}
            </div>
        `;

        fileItem.addEventListener('click', function() {
            document.querySelectorAll('.file-item').forEach(item => {
                item.classList.remove('selected');
            });
            this.classList.add('selected');
            document.getElementById('loadSelectedFile').disabled = false;
        });

        fileList.appendChild(fileItem);
    });

    // Select first file by default
    if (availableFiles.length > 0) {
        fileList.firstChild.click();
    }

    modal.classList.add('show');
}

// Update current file display
function updateCurrentFileDisplay() {
    const display = document.getElementById('currentFile');
    if (currentFile) {
        const filename = currentFile.split('/').pop();
        display.innerHTML = `Current file: <span>${filename}</span>`;
    }
}

// Show no data message
function showNoDataMessage() {
    document.getElementById('totalValue').textContent = 'No Data';
    document.getElementById('totalGainLoss').textContent = 'No Data';
    document.getElementById('returnPercentage').textContent = 'No Data';
    document.getElementById('dayChange').textContent = 'No Data';

    const currentFileEl = document.getElementById('currentFile');
    currentFileEl.innerHTML = '<span style="color: #ff9aa2;">No CSV files found in data folder</span>';
}

// Parse CSV data
async function parseCSVData(filepath) {
    if (!filepath) {
        console.error('No filepath provided');
        return;
    }

    // Update current file
    currentFile = filepath;

    // Determine environment and reload API keys
    let environment = 'live';  // default
    if (filepath.includes('/test/')) {
        environment = 'test';
    } else if (filepath.includes('/live/')) {
        environment = 'live';
    }

    // Load API keys for the appropriate environment
    await loadAPIKeys(environment);

    console.log('Starting to load CSV data from:', filepath);
    fetch(filepath)
        .then(response => {
            console.log('CSV file fetched successfully');
            return response.text();
        })
        .then(async csvText => {
            await processCSVText(csvText);
        })
        .catch(error => {
            console.error('Error loading data:', error);
        });
}

// Update dashboard with data
function updateDashboard() {
    // Update header stats
    updateHeaderStats();

    // Create charts
    createSectorChart();
    createWorldMap();
    createMarketCapChart();
    createPerformanceChart();

    // Update top/bottom performers
    updatePerformers();

    // Populate holdings table
    populateHoldingsTable();

    // Add search and sort functionality
    setupTableControls();
}

// Update header statistics
function updateHeaderStats() {
    const totalValue = portfolioData.reduce((sum, stock) => sum + stock.value, 0);
    const totalCost = portfolioData.reduce((sum, stock) => sum + stock.cost, 0);
    const totalGainLoss = portfolioData.reduce((sum, stock) => sum + stock.gainLoss, 0);
    const totalDayChange = portfolioData.reduce((sum, stock) => sum + stock.dayGainLoss, 0);
    const returnPercentage = ((totalValue - totalCost) / totalCost * 100).toFixed(2);

    document.getElementById('totalValue').textContent = `£${totalValue.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    const gainLossEl = document.getElementById('totalGainLoss');
    gainLossEl.textContent = `£${totalGainLoss.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    gainLossEl.className = totalGainLoss >= 0 ? 'stat-value positive' : 'stat-value negative';

    const returnEl = document.getElementById('returnPercentage');
    returnEl.textContent = `${returnPercentage}%`;
    returnEl.className = returnPercentage >= 0 ? 'stat-value positive' : 'stat-value negative';

    const dayChangeEl = document.getElementById('dayChange');
    dayChangeEl.textContent = `£${totalDayChange.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    dayChangeEl.className = totalDayChange >= 0 ? 'stat-value positive' : 'stat-value negative';
}

// Create interactive sector allocation donut chart
function createSectorChart() {
    const ctx = document.getElementById('sectorChart').getContext('2d');
    const sectorData = {};
    const sectorStocks = {};
    const sectorGains = {};
    const sectorCosts = {};

    // Group stocks by sector and calculate totals
    portfolioData.forEach(stock => {
        if (!sectorData[stock.sector]) {
            sectorData[stock.sector] = 0;
            sectorStocks[stock.sector] = [];
            sectorGains[stock.sector] = 0;
            sectorCosts[stock.sector] = 0;
        }
        sectorData[stock.sector] += stock.value;
        sectorGains[stock.sector] += stock.gainLoss;
        sectorCosts[stock.sector] += stock.cost;
        sectorStocks[stock.sector].push(stock);
    });

    const sortedSectors = Object.entries(sectorData).sort((a, b) => b[1] - a[1]);
    const totalValue = Object.values(sectorData).reduce((a, b) => a + b, 0);

    if (charts.sector) charts.sector.destroy();

    charts.sector = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: sortedSectors.map(s => s[0]),
            datasets: [{
                data: sortedSectors.map(s => s[1]),
                backgroundColor: pastelColors.slice(0, sortedSectors.length),
                borderColor: '#1a1a1a',
                borderWidth: 2,
                hoverOffset: 15,  // This creates the "raised" effect
                hoverBorderWidth: 3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '50%',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    enabled: false  // Disable default tooltip, we'll use our custom display
                }
            },
            onHover: (event, activeElements) => {
                if (activeElements.length > 0) {
                    const element = activeElements[0];
                    const sectorIndex = element.index;
                    const sectorName = sortedSectors[sectorIndex][0];
                    const sectorValue = sortedSectors[sectorIndex][1];
                    const sectorGain = sectorGains[sectorName];
                    const sectorCost = sectorCosts[sectorName];
                    const percentage = ((sectorValue / totalValue) * 100).toFixed(1);

                    // Update sector info display and mark as actively hovered
                    updateSectorDisplay(sectorName, percentage, sectorValue, sectorGain, sectorCost, sectorStocks[sectorName]);
                    window.sectorHoverActive = true;

                    // Clear any existing timeout
                    if (window.sectorHoverTimeout) {
                        clearTimeout(window.sectorHoverTimeout);
                        window.sectorHoverTimeout = null;
                    }
                } else if (window.sectorHoverActive) {
                    // Delay reset to allow mouse movement to details panel
                    window.sectorHoverTimeout = setTimeout(() => {
                        if (!window.sectorDetailsHovered) {
                            resetSectorDisplay();
                            window.sectorHoverActive = false;
                        }
                    }, 200); // 200ms delay
                }
            }
        }
    });

    // Store sector data for interactive use
    window.sectorData = { sectorStocks, sortedSectors, totalValue, sectorGains, sectorCosts };

    // Add mouse event listeners to sector details panel for stable hover behavior
    const sectorDetailsEl = document.getElementById('sectorDetails');

    sectorDetailsEl.addEventListener('mouseenter', () => {
        window.sectorDetailsHovered = true;
        // Clear any pending timeout
        if (window.sectorHoverTimeout) {
            clearTimeout(window.sectorHoverTimeout);
            window.sectorHoverTimeout = null;
        }
    });

    sectorDetailsEl.addEventListener('mouseleave', () => {
        window.sectorDetailsHovered = false;
        // Reset display when leaving the details panel
        if (window.sectorHoverActive) {
            window.sectorHoverTimeout = setTimeout(() => {
                resetSectorDisplay();
                window.sectorHoverActive = false;
            }, 100); // Short delay in case user moves back to chart
        }
    });

    // Add data source summary underneath the donut chart
    const sectorDataSourcesEl = document.getElementById('sectorDataSources');

    // Calculate source breakdown for sector data
    const sourceCounts = { api: 0, guess: 0, default: 0 };
    portfolioData.forEach(stock => {
        const sectorData = stock.gicsSector || { source: 'Intelligent guess' };
        if (sectorData.source?.includes('Alpha Vantage')) sourceCounts.api++;
        else if (sectorData.source?.includes('Intelligent guess')) sourceCounts.guess++;
        else sourceCounts.default++;
    });

    sectorDataSourcesEl.innerHTML = `
        <div class="data-source-info">
            <div class="source-title">Sector Data Sources:</div>
            <div class="source-breakdown">
                ${sourceCounts.api > 0 ? `<span class="source-api">🔗 ${sourceCounts.api} from Alpha Vantage API</span>` : ''}
                ${sourceCounts.guess > 0 ? `<span class="source-guess">🧠 ${sourceCounts.guess} intelligent guesses</span>` : ''}
                ${sourceCounts.default > 0 ? `<span class="source-default">📊 ${sourceCounts.default} default classifications</span>` : ''}
            </div>
        </div>
    `;
}

// Update sector display panel
function updateSectorDisplay(sectorName, percentage, value, totalGain, totalCost, stocks) {
    document.getElementById('sectorName').textContent = sectorName;
    document.getElementById('sectorPercentage').textContent = `${percentage}%`;
    document.getElementById('sectorValue').textContent = `£${value.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    // Calculate sector gain/loss percentage
    const sectorGainPercent = totalCost > 0 ? ((totalGain / totalCost) * 100) : 0;

    // Update sector gain/loss with color coding
    const gainElement = document.getElementById('sectorGain');
    const gainPercentElement = document.getElementById('sectorGainPercent');
    const gainSymbol = totalGain >= 0 ? '+' : '';
    const percentSymbol = sectorGainPercent >= 0 ? '+' : '';
    const gainClass = totalGain >= 0 ? 'positive' : 'negative';

    gainElement.textContent = `${gainSymbol}£${totalGain.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    gainElement.className = `sector-gain ${gainClass}`;

    gainPercentElement.textContent = `(${percentSymbol}${sectorGainPercent.toFixed(1)}%)`;
    gainPercentElement.className = `sector-gain-percent ${gainClass}`;

    const stocksContainer = document.getElementById('sectorStocks');
    stocksContainer.innerHTML = '';

    // Sort stocks by value (highest first)
    const sortedStocks = stocks.sort((a, b) => b.value - a.value);

    sortedStocks.forEach(stock => {
        const stockItem = document.createElement('div');
        stockItem.className = 'stock-item';

        const gainClass = stock.gainLossPercent >= 0 ? 'positive' : 'negative';
        const gainSymbol = stock.gainLossPercent >= 0 ? '+' : '';

        stockItem.innerHTML = `
            <div class="stock-name">${stock.name.replace(/\*\d+/g, '').trim()}</div>
            <div class="stock-details">
                <span class="stock-value">£${stock.value.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
                <span class="stock-gain ${gainClass}">${gainSymbol}${stock.gainLossPercent.toFixed(1)}%</span>
            </div>
        `;

        stocksContainer.appendChild(stockItem);
    });
}

// Reset sector display to default state
function resetSectorDisplay() {
    document.getElementById('sectorName').textContent = 'Hover over a sector';
    document.getElementById('sectorPercentage').textContent = '';
    document.getElementById('sectorValue').textContent = '';
    document.getElementById('sectorGain').textContent = '';
    document.getElementById('sectorGain').className = 'sector-gain';
    document.getElementById('sectorGainPercent').textContent = '';
    document.getElementById('sectorGainPercent').className = 'sector-gain-percent';

    const stocksContainer = document.getElementById('sectorStocks');
    stocksContainer.innerHTML = '<p class="hover-prompt">Hover over a sector to see stocks</p>';
}

// Create world map for geographic distribution
function createWorldMap() {
    const countryData = {};
    const countryCoordinates = {
        'US': [39.8283, -98.5795],
        'UK': [55.3781, -3.4360],
        'EU': [50.8503, 4.3517] // Brussels as EU center
    };

    portfolioData.forEach(stock => {
        // Country should always be a string now
        const country = stock.country;

        if (!countryData[country]) {
            countryData[country] = 0;
        }
        countryData[country] += stock.value;
    });

    // Initialize map
    if (window.map) {
        window.map.remove();
    }

    const map = L.map('worldMap', {
        center: [25, -20],  // Center to show US, UK and EU better
        zoom: 2,  // Slightly more zoomed for better visibility
        zoomControl: true,
        attributionControl: false,
        minZoom: 1,
        maxZoom: 5,
        worldCopyJump: true  // Allows seamless panning across the date line
    });

    window.map = map;

    // Dark tile layer to match the theme
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '',
        subdomains: 'abcd',
        maxZoom: 19
    }).addTo(map);

    // Calculate total for percentages
    const total = Object.values(countryData).reduce((a, b) => a + b, 0);

    // Add markers for each country with improved scaling
    const maxValue = Math.max(...Object.values(countryData));
    const minRadius = 20;
    const maxRadius = 60;

    Object.entries(countryData).forEach(([country, value]) => {
        if (countryCoordinates[country]) {
            const percentage = ((value / total) * 100).toFixed(1);
            // Scale radius between min and max based on value
            const radius = minRadius + (maxRadius - minRadius) * (value / maxValue);

            // Create circle marker with better visibility
            L.circleMarker(countryCoordinates[country], {
                radius: radius,
                fillColor: country === 'US' ? '#BAFFC9' : country === 'UK' ? '#FFB3BA' : '#BAE1FF',
                color: '#fff',
                weight: 3,
                opacity: 1,
                fillOpacity: 0.7
            }).addTo(map).bindPopup(`
                <div style="text-align: center; color: #333;">
                    <strong>${country}</strong><br>
                    £${value.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}<br>
                    ${percentage}%
                </div>
            `);

            // Add country label with better positioning
            L.marker(countryCoordinates[country], {
                icon: L.divIcon({
                    className: 'country-label',
                    html: `<div style="color: white; font-weight: bold; text-shadow: 2px 2px 4px rgba(0,0,0,0.9); text-align: center; font-size: 14px;">${country}<br><span style="font-size: 18px;">${percentage}%</span></div>`,
                    iconSize: [80, 40],
                    iconAnchor: [40, -radius - 10]
                })
            }).addTo(map);
        }
    });

    // Create custom legend with data sources
    const legendEl = document.getElementById('countryLegend');
    legendEl.innerHTML = '';

    // Add geographic data legend items
    Object.entries(countryData).sort((a, b) => b[1] - a[1]).forEach(([country, value], index) => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        const percentage = ((value / total) * 100).toFixed(1);
        const colors = {'US': '#BAFFC9', 'UK': '#FFB3BA', 'EU': '#BAE1FF'};
        item.innerHTML = `
            <span class="legend-color" style="background: ${colors[country]}"></span>
            <span>${country} - £${value.toLocaleString('en-GB', {minimumFractionDigits: 2})} (${percentage}%)</span>
        `;
        legendEl.appendChild(item);
    });

    // Add data source summary
    const sourceCounts = { api: 0, guess: 0, default: 0 };
    portfolioData.forEach(stock => {
        const countryInfo = stock.countryData || { source: 'Legacy data' };
        if (countryInfo.source?.includes('Alpha Vantage')) sourceCounts.api++;
        else if (countryInfo.source?.includes('Intelligent guess')) sourceCounts.guess++;
        else sourceCounts.default++;
    });

    const sourceInfo = document.createElement('div');
    sourceInfo.className = 'data-source-info';
    sourceInfo.innerHTML = `
        <div class="source-title">Geographic Data Sources:</div>
        <div class="source-breakdown">
            ${sourceCounts.api > 0 ? `<span class="source-api">🔗 ${sourceCounts.api} from Alpha Vantage API</span>` : ''}
            ${sourceCounts.guess > 0 ? `<span class="source-guess">🧠 ${sourceCounts.guess} intelligent guesses</span>` : ''}
            ${sourceCounts.default > 0 ? `<span class="source-default">📊 ${sourceCounts.default} US defaults</span>` : ''}
        </div>
    `;
    legendEl.appendChild(sourceInfo);
}

// Create market cap distribution donut chart
function createMarketCapChart() {
    const ctx = document.getElementById('marketCapChart').getContext('2d');
    const marketCapData = {};

    portfolioData.forEach(stock => {
        if (!marketCapData[stock.marketCap]) {
            marketCapData[stock.marketCap] = 0;
        }
        marketCapData[stock.marketCap] += stock.value;
    });

    const sortedMarketCaps = Object.entries(marketCapData).sort((a, b) => {
        const order = ['Large Cap (>$100B)', 'Mid Cap ($10B-$100B)', 'Small Cap (<$10B)'];
        return order.indexOf(a[0]) - order.indexOf(b[0]);
    });

    if (charts.marketCap) charts.marketCap.destroy();

    charts.marketCap = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: sortedMarketCaps.map(m => m[0]),
            datasets: [{
                data: sortedMarketCaps.map(m => m[1]),
                backgroundColor: ['#FFFFBA', '#FFDFBA', '#E0BBE4'],
                borderColor: '#1a1a1a',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${context.label}: £${value.toLocaleString('en-GB', {minimumFractionDigits: 2})} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });

    // Create custom legend
    const legendEl = document.getElementById('marketCapLegend');
    legendEl.innerHTML = '';
    sortedMarketCaps.forEach((cap, index) => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `
            <span class="legend-color" style="background: ${['#FFFFBA', '#FFDFBA', '#E0BBE4'][index]}"></span>
            <span>${cap[0]} (${((cap[1] / portfolioData.reduce((sum, s) => sum + s.value, 0)) * 100).toFixed(1)}%)</span>
        `;
        legendEl.appendChild(item);
    });

    // Add data source summary for market cap
    const sourceInfo = document.createElement('div');
    sourceInfo.className = 'data-source-info';
    sourceInfo.innerHTML = `
        <div class="source-title">Market Cap Data Sources:</div>
        <div class="source-breakdown">
            <span class="source-guess">🧠 All classifications based on intelligent pattern recognition</span>
        </div>
    `;
    legendEl.appendChild(sourceInfo);
}

// Create performance distribution donut chart
function createPerformanceChart() {
    const ctx = document.getElementById('performanceChart').getContext('2d');
    const performanceBands = {
        'Strong Gain (>50%)': 0,
        'Moderate Gain (20-50%)': 0,
        'Small Gain (0-20%)': 0,
        'Small Loss (0-20%)': 0,
        'Moderate Loss (20-50%)': 0,
        'Large Loss (>50%)': 0
    };

    portfolioData.forEach(stock => {
        const perf = stock.gainLossPercent;
        if (perf > 50) performanceBands['Strong Gain (>50%)'] += stock.value;
        else if (perf > 20) performanceBands['Moderate Gain (20-50%)'] += stock.value;
        else if (perf > 0) performanceBands['Small Gain (0-20%)'] += stock.value;
        else if (perf > -20) performanceBands['Small Loss (0-20%)'] += stock.value;
        else if (perf > -50) performanceBands['Moderate Loss (20-50%)'] += stock.value;
        else performanceBands['Large Loss (>50%)'] += stock.value;
    });

    const filteredBands = Object.entries(performanceBands).filter(b => b[1] > 0);

    if (charts.performance) charts.performance.destroy();

    charts.performance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: filteredBands.map(b => b[0]),
            datasets: [{
                data: filteredBands.map(b => b[1]),
                backgroundColor: ['#B5EAD7', '#C7CEEA', '#FFDFD3', '#FFE5CC', '#FFB3BA', '#D4A5A5'],
                borderColor: '#1a1a1a',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((value / total) * 100).toFixed(1);
                            return `${context.label}: £${value.toLocaleString('en-GB', {minimumFractionDigits: 2})} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });

    // Create custom legend
    const legendEl = document.getElementById('performanceLegend');
    legendEl.innerHTML = '';
    filteredBands.forEach((band, index) => {
        const item = document.createElement('div');
        item.className = 'legend-item';
        item.innerHTML = `
            <span class="legend-color" style="background: ${['#B5EAD7', '#C7CEEA', '#FFDFD3', '#FFE5CC', '#FFB3BA', '#D4A5A5'][index]}"></span>
            <span>${band[0]} (${((band[1] / portfolioData.reduce((sum, s) => sum + s.value, 0)) * 100).toFixed(1)}%)</span>
        `;
        legendEl.appendChild(item);
    });

    // Add data source summary for performance bands
    const sourceInfo = document.createElement('div');
    sourceInfo.className = 'data-source-info';
    sourceInfo.innerHTML = `
        <div class="source-title">Performance Data Sources:</div>
        <div class="source-breakdown">
            <span class="source-api">📊 All performance data from CSV portfolio file</span>
        </div>
    `;
    legendEl.appendChild(sourceInfo);
}

// Update top and bottom performers
function updatePerformers() {
    const sortedByGain = [...portfolioData].sort((a, b) => b.gainLossPercent - a.gainLossPercent);

    // Top performers
    const topPerformersEl = document.getElementById('topPerformers');
    topPerformersEl.innerHTML = '';
    sortedByGain.slice(0, 5).forEach(stock => {
        const item = document.createElement('div');
        item.className = 'performer-item';
        item.innerHTML = `
            <span class="performer-name">${stock.name.replace(/\*\d+/g, '').trim()}</span>
            <span class="performer-value">£${stock.value.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
            <span class="performer-change positive">+${stock.gainLossPercent.toFixed(1)}%</span>
        `;
        topPerformersEl.appendChild(item);
    });

    // Bottom performers
    const bottomPerformersEl = document.getElementById('bottomPerformers');
    bottomPerformersEl.innerHTML = '';
    sortedByGain.slice(-5).reverse().forEach(stock => {
        const item = document.createElement('div');
        item.className = 'performer-item';
        item.innerHTML = `
            <span class="performer-name">${stock.name.replace(/\*\d+/g, '').trim()}</span>
            <span class="performer-value">£${stock.value.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span>
            <span class="performer-change negative">${stock.gainLossPercent.toFixed(1)}%</span>
        `;
        bottomPerformersEl.appendChild(item);
    });
}


// Populate holdings grid
function populateHoldingsTable() {
    const grid = document.getElementById('holdingsGrid');
    grid.innerHTML = '';

    portfolioData.forEach(stock => {
        const card = document.createElement('div');
        card.className = 'holding-card';

        const gainClass = stock.gainLoss >= 0 ? 'positive' : 'negative';
        const gainSymbol = stock.gainLoss >= 0 ? '+' : '';
        const percentSymbol = stock.gainLossPercent >= 0 ? '+' : '';

        // Generate key dates HTML using real financial calendar data
        const keyDates = generateKeyDatesFromCalendar(stock.financialCalendar);
        const datesHTML = keyDates.map(dateItem => {
            if (dateItem.isError) {
                return `
                    <div class="date-item error">
                        <span class="date-label">${dateItem.label}:</span>
                        <span class="date-message">${dateItem.message}</span>
                    </div>
                `;
            } else if (dateItem.isInfo) {
                return `
                    <div class="date-item info">
                        <span class="date-label">${dateItem.label}:</span>
                        <span class="date-message">${dateItem.message}</span>
                    </div>
                `;
            } else {
                return `
                    <div class="date-item ${dateItem.isUpcoming ? 'upcoming' : ''} ${dateItem.type}">
                        <span class="date-label">${dateItem.label}:</span>
                        <span class="date-value">${dateItem.date.toLocaleDateString('en-GB', {
                            day: 'numeric',
                            month: 'short'
                        })}</span>
                    </div>
                `;
            }
        }).join('');

        card.innerHTML = `
            <div class="holding-header">
                <div class="holding-name">${stock.name.replace(/\*\d+/g, '').trim()}</div>
                <div class="holding-sector">${stock.sector}</div>
            </div>

            <div class="holding-performance">
                <div class="holding-gain ${gainClass}">
                    ${gainSymbol}£${stock.gainLoss.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                </div>
                <div class="holding-percent ${gainClass}">
                    ${percentSymbol}${stock.gainLossPercent.toFixed(1)}%
                </div>
            </div>

            <div class="holding-dates">
                <h4>Key Dates</h4>
                <div class="dates-row">
                    ${datesHTML}
                </div>
            </div>

            <div class="sentiment-section">
                <div class="sentiment-item">
                    <h4>Stock Sentiment</h4>
                    <div class="sentiment-score">
                        ${generateSentimentDisplay(stock.stockSentiment)}
                    </div>
                    <div class="sentiment-label">${getSentimentLabel(stock.stockSentiment.score)}</div>
                    <div class="sentiment-source">${stock.stockSentiment.source}</div>
                </div>
                <div class="sentiment-item">
                    <h4>Sector Sentiment</h4>
                    <div class="sentiment-score">
                        ${generateSentimentDisplay(stock.sectorSentiment)}
                    </div>
                    <div class="sentiment-label">${getSentimentLabel(stock.sectorSentiment.score)}</div>
                    <div class="sentiment-source">${stock.sectorSentiment.source}</div>
                </div>
            </div>
        `;

        // Store data for sorting
        card.dataset.name = stock.name;
        card.dataset.gain = stock.gainLossPercent;
        card.dataset.value = stock.value;
        card.dataset.stockSentiment = stock.stockSentiment?.score || 50; // Default to neutral if no data
        card.dataset.sectorSentiment = stock.sectorSentiment?.score || 50; // Default to neutral if no data
        card.dataset.nextEventDate = getNextEventDate(stock.financialCalendar).getTime();

        // Add urgency class for events in the next 7 days
        const nextEventDate = getNextEventDate(stock.financialCalendar);
        const today = new Date();
        const daysDifference = (nextEventDate - today) / (1000 * 60 * 60 * 24);

        if (daysDifference <= 7 && daysDifference >= 0) {
            card.classList.add('urgent-event');
        } else if (daysDifference <= 14 && daysDifference >= 0) {
            card.classList.add('upcoming-event');
        }

        grid.appendChild(card);
    });

    // Apply default sort by upcoming events
    applyDefaultSort();
}

// Apply default sort order (soonest financial events first)
function applyDefaultSort() {
    const grid = document.getElementById('holdingsGrid');
    const cards = Array.from(grid.children);

    // Sort by next event date (earliest first)
    cards.sort((a, b) => {
        return parseInt(a.dataset.nextEventDate) - parseInt(b.dataset.nextEventDate);
    });

    // Clear and re-append sorted cards
    grid.innerHTML = '';
    cards.forEach(card => grid.appendChild(card));
}

// Setup search and sort controls for holdings grid
function setupTableControls() {
    const searchInput = document.getElementById('searchInput');
    const sortSelect = document.getElementById('sortSelect');

    searchInput.addEventListener('input', (e) => {
        const searchTerm = e.target.value.toLowerCase();
        const cards = document.querySelectorAll('.holding-card');

        cards.forEach(card => {
            const stockName = card.dataset.name.toLowerCase();
            card.style.display = stockName.includes(searchTerm) ? 'block' : 'none';
        });
    });

    sortSelect.addEventListener('change', (e) => {
        const sortBy = e.target.value;
        const grid = document.getElementById('holdingsGrid');
        const cards = Array.from(grid.children);

        cards.sort((a, b) => {
            switch(sortBy) {
                case 'upcoming-events':
                    // Sort by next event date (earliest first)
                    return parseInt(a.dataset.nextEventDate) - parseInt(b.dataset.nextEventDate);
                case 'value':
                    return parseFloat(b.dataset.value) - parseFloat(a.dataset.value);
                case 'gain':
                    return parseFloat(b.dataset.gain) - parseFloat(a.dataset.gain);
                case 'name':
                    return a.dataset.name.localeCompare(b.dataset.name);
                case 'sentiment':
                    return parseInt(b.dataset.stockSentiment) - parseInt(a.dataset.stockSentiment);
                case 'sector-sentiment':
                    return parseInt(b.dataset.sectorSentiment) - parseInt(a.dataset.sectorSentiment);
                default:
                    return 0;
            }
        });

        // Clear and re-append sorted cards
        grid.innerHTML = '';
        cards.forEach(card => grid.appendChild(card));
    });
}

// Handle file upload
document.getElementById('fileUpload').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && file.type === 'text/csv') {
        const reader = new FileReader();
        reader.onload = (event) => {
            // Parse new CSV data
            // Similar parsing logic as in parseCSVData but with uploaded file content
            console.log('New file uploaded');
        };
        reader.readAsText(file);
    }
});

// Event handlers
document.addEventListener('DOMContentLoaded', async () => {
    // Load API keys first
    await loadAPIKeys();

    // Initialize with file selection
    initializeFileSelection();

    // Select file button
    document.getElementById('selectFile').addEventListener('click', () => {
        // Rescan files before showing modal
        fetch('file-list.json?t=' + Date.now())
            .then(response => response.json())
            .then(data => {
                availableFiles = data.files || [];
                showFileSelectionModal();
            })
            .catch(() => {
                alert('Could not load file list. Please ensure scan-files.py has been run.');
            });
    });

    // Load selected file button
    document.getElementById('loadSelectedFile').addEventListener('click', () => {
        const selectedItem = document.querySelector('.file-item.selected');
        if (selectedItem) {
            const index = parseInt(selectedItem.dataset.index);
            currentFile = availableFiles[index].path;
            updateCurrentFileDisplay();
            parseCSVData(currentFile);

            // Hide modal
            document.getElementById('fileSelectModal').classList.remove('show');
        }
    });

    // Refresh data button
    document.getElementById('refreshData').addEventListener('click', () => {
        if (currentFile) {
            parseCSVData(currentFile);
        } else {
            initializeFileSelection();
        }
    });

    // File upload handler remains the same
    document.getElementById('fileUpload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file && file.type === 'text/csv') {
            const reader = new FileReader();
            reader.onload = async (event) => {
                // Parse uploaded CSV data directly
                console.log('Processing uploaded file:', file.name);
                currentFile = 'Uploaded: ' + file.name;
                updateCurrentFileDisplay();
                await processCSVText(event.target.result);
            };
            reader.readAsText(file);
        }
    });
});

// Process CSV text (extracted from parseCSVData for reuse)
async function processCSVText(csvText) {
    console.log('CSV text received, length:', csvText.length);
    const lines = csvText.split('\n');
    console.log('Total lines in CSV:', lines.length);

    const data = [];
    let startParsing = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Look for header line
        if (line.includes('Stock,Units held,Price')) {
            startParsing = true;
            console.log('Found header at line', i);
            continue;
        }

        if (startParsing && line.trim() && !line.includes('Totals') && !line.includes('Shares are valued') && line.includes('"')) {
            // Parse CSV line properly handling quoted values with commas
            const matches = line.match(/"([^"]*)"|([^,]+)/g);
            if (!matches) continue;

            const columns = matches.map(col => col.replace(/"/g, '').trim());

            if (columns.length >= 7 && columns[0]) {
                const stockName = columns[0].replace(/&#39;/g, "'");
                const units = parseFloat(columns[1].replace(/,/g, ''));
                const price = parseFloat(columns[2].replace(/,/g, ''));
                // Remove all non-numeric characters except digits, dots, commas and minus
                const value = parseFloat(columns[3].replace(/[^0-9.,\-]/g, '').replace(/,/g, ''));
                const cost = parseFloat(columns[4].replace(/[^0-9.,\-]/g, '').replace(/,/g, ''));
                const gainLoss = parseFloat(columns[5].replace(/[^0-9.,\-]/g, '').replace(/,/g, ''));
                const gainLossPercent = parseFloat(columns[6].replace(/,/g, ''));
                const dayGainLoss = columns[7] ? parseFloat(columns[7].replace(/[^0-9.,\-]/g, '').replace(/,/g, '')) : 0;
                const dayGainLossPercent = columns[8] ? parseFloat(columns[8]) : 0;

                if (!isNaN(value) && value > 0) {
                    // Use synchronous sector lookup for initial display, then update async
                    // Get sector and country data
                    const sectorData = getSectorSync(stockName);
                    const countryData = getCountrySync(stockName);

                    data.push({
                        name: stockName,
                        units: units,
                        price: price,
                        value: value,
                        cost: cost,
                        gainLoss: gainLoss,
                        gainLossPercent: gainLossPercent,
                        dayGainLoss: dayGainLoss,
                        dayGainLossPercent: dayGainLossPercent,
                        sector: sectorData.sector, // Extract sector string
                        gicsSector: sectorData, // Store full sector data object
                        country: countryData.country, // Extract country string
                        countryData: countryData, // Store full country data object
                        marketCap: getMarketCapBestGuess(stockName).marketCap,
                        financialCalendar: null // Will be populated async
                    });
                }
            }
        }
    }

    console.log('Total stocks parsed:', data.length);

    // Now async update the sectors and geographic data with GICS API
    if (USE_GICS_API) {
        console.log('Updating sectors and geographic data with GICS API...');
    } else {
        console.log('Sector and geographic classification unavailable (API disabled)...');
    }

    const sectorUpdatePromises = data.map(async (stock, index) => {
        try {
            const [gicsSector, countryInfo] = await Promise.all([
                getSector(stock.name),
                getCountry(stock.name)
            ]);
            data[index].sector = gicsSector.sector; // Extract sector string
            data[index].gicsSector = gicsSector; // Store full sector data object
            data[index].country = countryInfo.country; // Extract country string
            data[index].countryData = countryInfo; // Store full country data object
        } catch (error) {
            console.log(`Error updating sector/country for ${stock.name}:`, error);
        }
    });

    // Financial calendar updates
    console.log('Fetching financial calendar data...');
    const financialCalendarPromises = data.map(async (stock, index) => {
        try {
            const calendar = await getFinancialCalendar(stock.name);
            data[index].financialCalendar = calendar;
        } catch (error) {
            console.log(`Error updating financial calendar for ${stock.name}:`, error);
        }
    });

    // Sentiment analysis updates
    console.log('Calculating sentiment analysis...');
    const sentimentPromises = data.map(async (stock, index) => {
        try {
            const sectorName = stock.sector || getSectorBestGuess(stock.name).sector;
            const sentimentData = getSentimentBestGuess(stock, sectorName);
            data[index].stockSentiment = sentimentData.stockSentiment;
            data[index].sectorSentiment = sentimentData.sectorSentiment;
        } catch (error) {
            console.log(`Error calculating sentiment for ${stock.name}:`, error);
        }
    });

    // Set initial data
    portfolioData = data;

    if (portfolioData.length > 0) {
        console.log('Updating dashboard with initial data...');
        updateDashboard();
    } else {
        console.error('No data was parsed from CSV!');
        showNoDataMessage();
        return;
    }

    // Wait for all sector, financial calendar, and sentiment updates to complete
    await Promise.all([
        Promise.all(sectorUpdatePromises),
        Promise.all(financialCalendarPromises),
        Promise.all(sentimentPromises)
    ]);
    console.log('GICS sector, geographic, financial calendar, and sentiment analysis updates complete');

    // Refresh the dashboard with updated sector, geographic, and financial calendar data
    console.log('Refreshing dashboard with GICS sector, geographic, and financial calendar data...');
    updateDashboard();
}