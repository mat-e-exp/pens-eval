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

// Static holdings classification (data/holdings-map.json): authoritative GICS
// sector + domicile per known holding. Name-pattern guessing is the fallback only.
let holdingsMap = [];

async function loadHoldingsMap() {
    try {
        const response = await fetch('data/holdings-map.json?t=' + Date.now());
        if (!response.ok) {
            console.warn('holdings-map.json not found; sector/country will be guessed from names');
            return;
        }
        const data = await response.json();
        holdingsMap = (data.holdings || []).map(h => ({ ...h, match: h.match.toLowerCase() }));
        console.log(`Holdings map loaded: ${holdingsMap.length} entries`);
    } catch (error) {
        console.warn('Error loading holdings map:', error);
    }
}

const lookupHolding = (stockName) => {
    const name = stockName.replace(/&#39;/g, "'").trim().toLowerCase();
    return holdingsMap.find(h => name.startsWith(h.match)) || null;
};

const HOLDINGS_MAP_SOURCE = 'Holdings map (data/holdings-map.json)';

// Static benchmark composition (data/benchmarks.json)
let benchmarks = null;

// Platform dealing charges (data/platform-charges.json): HL SIPP online share
// deal charge, hand-maintained from HL's published tariff.
let charges = null;

// UK CPI annual rate, ONS time series D7G7 (CPI ANNUAL RATE 00: ALL ITEMS 2015=100).
// Public JSON endpoint, CORS-enabled, no key. Latest monthly print only.
const ONS_CPI_URL = 'https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23/data';
let cpi = null;   // { rate, period, releaseDate, nextRelease, title }
let cpiError = null;

// Peer distributions (data/peer-benchmarks.json): FCA retirement income market
// data and ONS Wealth and Assets Survey, transcribed from the published files.
let peers = null;

// Numbers the summary strip and section summary lines are drawn from.
// Each renderer stashes its results here; renderSummaryStrip() reads them.
const summaryState = { drawdown: null, review: null, bench: null, peers: null, plan: null };

async function loadPeerBenchmarks() {
    try {
        const response = await fetch('data/peer-benchmarks.json?t=' + Date.now());
        if (!response.ok) { console.warn('peer-benchmarks.json not found; peer comparison disabled'); return; }
        peers = await response.json();
    } catch (error) {
        console.warn('Error loading peer benchmarks:', error);
    }
}

async function loadCPI() {
    try {
        const response = await fetch(ONS_CPI_URL);
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        const months = (data.months || []).filter(m => m.value !== '' && !isNaN(parseFloat(m.value)));
        if (!months.length) throw new Error('no monthly values in response');
        const last = months[months.length - 1];
        const desc = data.description || {};
        cpi = {
            rate: parseFloat(last.value),
            period: last.date,
            releaseDate: desc.releaseDate ? desc.releaseDate.slice(0, 10) : null,
            nextRelease: desc.nextRelease || null,
            title: desc.title || 'CPI annual rate'
        };
    } catch (error) {
        cpi = null;
        cpiError = error.message;
        console.warn('ONS CPI fetch failed:', error);
    }
}

async function loadCharges() {
    try {
        const response = await fetch('data/platform-charges.json?t=' + Date.now());
        if (!response.ok) { console.warn('platform-charges.json not found; dealing costs not shown'); return; }
        charges = (await response.json()).hl_sipp || null;
    } catch (error) {
        console.warn('Error loading platform charges:', error);
    }
}

async function loadBenchmarks() {
    try {
        const response = await fetch('data/benchmarks.json?t=' + Date.now());
        if (!response.ok) {
            console.warn('benchmarks.json not found; benchmark comparison disabled');
            return;
        }
        benchmarks = await response.json();
    } catch (error) {
        console.warn('Error loading benchmarks:', error);
    }
}

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
        const headerEl = document.querySelector('.summary-strip');
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
    const mapped = lookupHolding(stockName);
    if (mapped) return { country: mapped.country, source: HOLDINGS_MAP_SOURCE };

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
    const mapped = lookupHolding(stockName);
    if (mapped) return { country: mapped.country, source: HOLDINGS_MAP_SOURCE };

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
    if (match && match[1] !== 'CDI') {  // "(CDI)" is HL's depository-interest suffix, not a ticker
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
    const mapped = lookupHolding(stockName);
    if (mapped) return { sector: mapped.sector, source: HOLDINGS_MAP_SOURCE };

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
    const mapped = lookupHolding(stockName);
    if (mapped) return { sector: mapped.sector, source: HOLDINGS_MAP_SOURCE };

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

    // No fabricated fallback: without API data the calendar is simply unavailable
    return null;
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
let accountSummary = { stockValue: null, totalCash: null, availableToInvest: null, totalValue: null, createdAt: null };
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
    createBenchmarkComparison();
    createPortfolioReview();
    createDrawdownReview();
    createWorldMap();

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

    const money = n => `£${n.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    // Account value = holdings + cash from the CSV header. Falls back to holdings only if the header is absent.
    const cash = accountSummary.totalCash;
    const accountValue = accountSummary.totalValue !== null ? accountSummary.totalValue : totalValue + (cash || 0);
    document.getElementById('totalValue').textContent = money(accountValue);
    document.getElementById('stockValue').textContent = `holdings ${money(totalValue)}`;
    document.getElementById('cashValue').textContent = cash === null ? 'not in file' : money(cash);
    document.getElementById('cashPct').textContent = cash === null ? '' : `${(cash / accountValue * 100).toFixed(1)}% of account`;

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
// Sector tile colours: 8 categorical slots validated for the dark surface
// (dataviz palette). Sectors ranked 9+ by weight get a neutral accent; the tile
// carries the sector name so identity never relies on colour alone.
const sectorPalette = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
const sectorNeutral = '#6b6b6b';

function createSectorChart() {
    const grid = document.getElementById('sectorGrid');
    grid.innerHTML = '';

    const fmtGBP = n => n.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2});

    // Group holdings by sector
    const groups = {};
    portfolioData.forEach(stock => {
        const sector = stock.sector || 'Unclassified';
        if (!groups[sector]) groups[sector] = { sector, stocks: [], value: 0, cost: 0, gainLoss: 0 };
        groups[sector].stocks.push(stock);
        groups[sector].value += stock.value;
        groups[sector].cost += stock.cost;
        groups[sector].gainLoss += stock.gainLoss;
    });

    const sorted = Object.values(groups).sort((a, b) => b.value - a.value);
    const totalValue = sorted.reduce((sum, g) => sum + g.value, 0);

    sorted.forEach((g, index) => {
        const colour = index < sectorPalette.length ? sectorPalette[index] : sectorNeutral;
        const weight = totalValue ? (g.value / totalValue) * 100 : 0;
        const glPct = g.cost ? (g.gainLoss / g.cost) * 100 : 0;
        const glClass = g.gainLoss >= 0 ? 'positive' : 'negative';
        const glSign = g.gainLoss >= 0 ? '+' : '';

        const holdingsHTML = g.stocks
            .slice()
            .sort((a, b) => b.value - a.value)
            .map(stock => {
                const cls = stock.gainLossPercent >= 0 ? 'positive' : 'negative';
                const sign = stock.gainLossPercent >= 0 ? '+' : '';
                const share = totalValue ? (stock.value / totalValue) * 100 : 0;
                return `
                <div class="stock-item">
                    <div class="stock-name">${stock.name.replace(/\*\d+/g, '').trim()}</div>
                    <div class="stock-details">
                        <span class="stock-share">${share.toFixed(2)}%</span>
                        <span class="stock-value">£${fmtGBP(stock.value)}</span>
                        <span class="stock-gain ${cls}">${sign}${stock.gainLossPercent.toFixed(1)}%</span>
                    </div>
                </div>`;
            }).join('');

        const tile = document.createElement('div');
        tile.className = 'sector-tile open';
        tile.style.setProperty('--sector-colour', colour);
        tile.innerHTML = `
            <div class="tile-head">
                <span class="tile-swatch"></span>
                <span class="tile-name">${g.sector}</span>
                <span class="tile-count">${g.stocks.length} holding${g.stocks.length === 1 ? '' : 's'}</span>
            </div>
            <div class="tile-weight">${weight.toFixed(1)}%<span class="tile-weight-label">of portfolio</span></div>
            <div class="tile-bar"><div class="tile-bar-fill" style="width:${Math.min(weight, 100)}%"></div></div>
            <div class="tile-figures">
                <div class="tile-figure">
                    <span class="tile-label">Value</span>
                    <span class="tile-value">£${fmtGBP(g.value)}</span>
                </div>
                <div class="tile-figure">
                    <span class="tile-label">Profit/Loss</span>
                    <span class="tile-value ${glClass}">${glSign}£${fmtGBP(g.gainLoss)}</span>
                    <span class="tile-sub ${glClass}">${glSign}${glPct.toFixed(1)}%</span>
                </div>
            </div>
            <div class="tile-holdings">${holdingsHTML}</div>
        `;

        tile.querySelector('.tile-head').addEventListener('click', () => tile.classList.toggle('open'));
        grid.appendChild(tile);
    });

    // Data source summary
    const sectorDataSourcesEl = document.getElementById('sectorDataSources');
    const sourceCounts = { map: 0, api: 0, guess: 0, default: 0 };
    portfolioData.forEach(stock => {
        const src = stock.gicsSector?.source || 'Intelligent guess';
        if (src.includes('Holdings map')) sourceCounts.map++;
        else if (src.includes('Alpha Vantage')) sourceCounts.api++;
        else if (src.includes('Intelligent guess')) sourceCounts.guess++;
        else sourceCounts.default++;
    });
    sectorDataSourcesEl.innerHTML = `
        <div class="data-source-info">
            <div class="source-title">Sector Data Sources:</div>
            <div class="source-breakdown">
                ${sourceCounts.map > 0 ? `<span class="source-api">✅ ${sourceCounts.map} from holdings map</span>` : ''}
                ${sourceCounts.api > 0 ? `<span class="source-api">🔗 ${sourceCounts.api} from Alpha Vantage API</span>` : ''}
                ${sourceCounts.guess > 0 ? `<span class="source-guess">🧠 ${sourceCounts.guess} name-pattern guesses</span>` : ''}
                ${sourceCounts.default > 0 ? `<span class="source-default">📊 ${sourceCounts.default} default classifications</span>` : ''}
            </div>
        </div>
    `;
}

// ---------------------------------------------------------------------------
// Benchmark comparison: composition, concentration and active share against a
// static index snapshot (data/benchmarks.json). Snapshot data only; no returns.
// ---------------------------------------------------------------------------
function portfolioComposition() {
    const total = portfolioData.reduce((sum, s) => sum + s.value, 0);
    const sectors = {}, regions = {};
    const weights = portfolioData.map(s => {
        const w = total ? (s.value / total) * 100 : 0;
        const sector = s.sector || 'Unclassified';
        const region = s.country || 'Unknown';
        sectors[sector] = (sectors[sector] || 0) + w;
        regions[region] = (regions[region] || 0) + w;
        return { name: s.name, weight: w, ticker: lookupHolding(s.name)?.ticker || null };
    }).sort((a, b) => b.weight - a.weight);
    const hhi = weights.reduce((sum, h) => sum + Math.pow(h.weight / 100, 2), 0);
    return {
        total, sectors, regions, weights,
        count: weights.length,
        largest: weights[0]?.weight || 0,
        top10: weights.slice(0, 10).reduce((sum, h) => sum + h.weight, 0),
        effectiveN: hhi ? 1 / hhi : 0
    };
}

function benchmarkStats(bench) {
    if (bench.holdings) {
        const sorted = bench.holdings.slice().sort((a, b) => b.weight - a.weight);
        const hhi = sorted.reduce((sum, h) => sum + Math.pow(h.weight / 100, 2), 0);
        return {
            largest: sorted[0].weight,
            top10: sorted.slice(0, 10).reduce((sum, h) => sum + h.weight, 0),
            effectiveN: hhi ? 1 / hhi : null,
            top10List: sorted.slice(0, 10)
        };
    }
    return { largest: bench.largest, top10: bench.top10_total, effectiveN: null, top10List: bench.top10 };
}

// Active share = 0.5 * sum |w_portfolio - w_index| over the union of names.
// Requires full index weights; only available for benchmarks with a holdings list.
function activeShare(port, bench) {
    if (!bench.holdings) return null;
    const idx = {};
    bench.holdings.forEach(h => { idx[h.ticker] = h.weight; });
    let sum = 0, indexWeightHeld = 0;
    port.weights.forEach(h => {
        const bw = h.ticker && idx[h.ticker] !== undefined ? idx[h.ticker] : 0;
        sum += Math.abs(h.weight - bw);
        indexWeightHeld += bw;
    });
    sum += (100 - indexWeightHeld);  // index names not held at all
    return sum / 2;
}

function createBenchmarkComparison() {
    const statsEl = document.getElementById('benchStats');
    const metaEl = document.getElementById('benchmarkMeta');
    if (!benchmarks) {
        statsEl.innerHTML = '<p class="section-note">Benchmark data unavailable (data/benchmarks.json).</p>';
        return;
    }
    const key = document.getElementById('benchmarkSelect').value;
    const bench = benchmarks[key];
    const port = portfolioComposition();
    const bstats = benchmarkStats(bench);
    const fmtPct = n => (n === null || n === undefined) ? 'n/a' : n.toFixed(1) + '%';
    const fmtN = n => (n === null || n === undefined) ? 'n/a' : n.toFixed(0);
    const diffCell = d => {
        const cls = d > 0 ? 'over' : d < 0 ? 'under' : 'flat';
        const sign = d > 0 ? '+' : '';
        const width = Math.min(Math.abs(d), 30) / 30 * 50;  // half-width bar, capped at 30pt
        return `<td class="num diff ${cls}">
                    <div class="diff-bar"><div class="diff-fill ${cls}" style="width:${width}%"></div></div>
                    <span>${sign}${d.toFixed(1)}</span>
                </td>`;
    };

    metaEl.textContent = `${bench.name} composition as of ${bench.as_of}. Source: ${bench.source}. Snapshot comparison only; no return data.`;

    // Stat tiles
    const share = activeShare(port, bench);
    const top10Tickers = new Set(bstats.top10List.map(h => h.ticker));
    const overlap = port.weights.filter(h => h.ticker && top10Tickers.has(h.ticker)).reduce((sum, h) => sum + h.weight, 0);
    summaryState.bench = { name: bench.name, asOf: bench.as_of, activeShare: share, overlap };
    const tiles = [
        ['Holdings', fmtN(port.count), fmtN(bench.constituents)],
        ['Largest position', fmtPct(port.largest), fmtPct(bstats.largest)],
        ['Top 10 weight', fmtPct(port.top10), fmtPct(bstats.top10)],
        ['Effective holdings (1/HHI)', fmtN(port.effectiveN), fmtN(bstats.effectiveN)],
        ['Weight in index top 10', fmtPct(overlap), fmtPct(bstats.top10)],
        ['Active share', share === null ? 'n/a (needs full index weights)' : fmtPct(share), '0%']
    ];
    statsEl.innerHTML = tiles.map(([label, p, b]) => `
        <div class="bench-stat">
            <span class="tile-label">${label}</span>
            <span class="bench-stat-values"><span class="bench-p">${p}</span><span class="bench-vs">vs</span><span class="bench-b">${b}</span></span>
            <span class="bench-stat-legend">portfolio vs index</span>
        </div>`).join('');

    // Sector table: union of sectors, ordered by index weight
    const sectorNames = Array.from(new Set([...Object.keys(bench.sectors), ...Object.keys(port.sectors)]))
        .sort((a, b) => (bench.sectors[b] || 0) - (bench.sectors[a] || 0));
    document.getElementById('benchSectorTable').innerHTML = `
        <thead><tr><th>Sector</th><th class="num">Portfolio</th><th class="num">Index</th><th class="num">Diff (pts)</th></tr></thead>
        <tbody>${sectorNames.map(name => {
            const p = port.sectors[name] || 0, b = bench.sectors[name] || 0;
            return `<tr><td>${name}</td><td class="num">${fmtPct(p)}</td><td class="num">${fmtPct(b)}</td>${diffCell(p - b)}</tr>`;
        }).join('')}</tbody>`;

    // Region table. Portfolio regions are US/UK/EU/CH; MSCI publishes US, Japan, UK,
    // Canada, France and Other, so Europe ex-UK is compared against France+Other.
    let regionRows;
    if (key === 'sp500') {
        regionRows = [['US', port.regions['US'] || 0, 100],
                      ['Non-US (UK, EU, CH)', 100 - (port.regions['US'] || 0), 0]];
    } else {
        const c = bench.countries;
        const euCh = (port.regions['EU'] || 0) + (port.regions['CH'] || 0);
        regionRows = [['US', port.regions['US'] || 0, c['US']],
                      ['UK', port.regions['UK'] || 0, c['UK']],
                      ['Japan', 0, c['Japan']],
                      ['Canada', 0, c['Canada']],
                      ['Europe ex-UK and other (index: France + Other)', euCh, c['France'] + c['Other']]];
    }
    document.getElementById('benchRegionTable').innerHTML = `
        <thead><tr><th>Region</th><th class="num">Portfolio</th><th class="num">Index</th><th class="num">Diff (pts)</th></tr></thead>
        <tbody>${regionRows.map(([name, p, b]) =>
            `<tr><td>${name}</td><td class="num">${fmtPct(p)}</td><td class="num">${fmtPct(b)}</td>${diffCell(p - b)}</tr>`).join('')}</tbody>`;

    // Index top 10 vs portfolio weight in each
    const portByTicker = {};
    port.weights.forEach(h => { if (h.ticker) portByTicker[h.ticker] = (portByTicker[h.ticker] || 0) + h.weight; });
    document.getElementById('benchTop10Table').innerHTML = `
        <thead><tr><th>Index constituent</th><th class="num">Index</th><th class="num">Portfolio</th><th class="num">Diff (pts)</th></tr></thead>
        <tbody>${bstats.top10List.map(h => {
            const p = portByTicker[h.ticker] || 0;
            return `<tr><td>${h.name}${p === 0 ? ' <span class="not-held">not held</span>' : ''}</td><td class="num">${fmtPct(h.weight)}</td><td class="num">${fmtPct(p)}</td>${diffCell(p - h.weight)}</tr>`;
        }).join('')}</tbody>`;
}

// ---------------------------------------------------------------------------
// Portfolio review: decision-oriented checks computed from the holdings snapshot
// only. No prices, no history. Rules are user-editable inputs on the page.
// ---------------------------------------------------------------------------
function readRules() {
    const num = (id, fallback) => {
        const v = parseFloat(document.getElementById(id).value);
        return isNaN(v) ? fallback : v;
    };
    return {
        maxPosition: num('ruleMaxPosition', 5),   // % of invested value
        minPosition: num('ruleMinPosition', 1.5), // % of invested value
        sectorBand: num('ruleSectorBand', 5),     // +/- points vs benchmark
        cashTarget: num('ruleCashTarget', 2)      // % of total account
    };
}

// Small positions classified by their sector's gap to the benchmark (portfolio
// minus index, points of invested value). Uses only the snapshot and benchmarks.json.
//   Top up: sector more than the band under the index; topping up closes the gap.
//   Exit:   sector at or over the index; proceeds can fund gaps elsewhere.
//   Either: sector under the index but within the band.
function smallPositionStances(holdings, rules, bench) {
    const sectorWeight = {};
    holdings.forEach(h => { sectorWeight[h.sector] = (sectorWeight[h.sector] || 0) + h.weight; });
    return holdings.filter(h => h.weight < rules.minPosition).map(h => {
        if (!bench) return { ...h, gap: null, stance: '—' };
        const gap = sectorWeight[h.sector] - (bench.sectors[h.sector] || 0);
        const stance = gap < -rules.sectorBand ? 'Top up' : gap >= 0 ? 'Exit' : 'Either';
        return { ...h, gap, stance };
    });
}

function createPortfolioReview() {
    const rules = readRules();
    const gbp = n => '£' + Math.round(n).toLocaleString('en-GB');
    const pct = n => n.toFixed(1) + '%';
    const clean = n => n.replace(/\*\d+|\*R|\(CDI\)|\(Crest Depository Interest\)/g, '').replace(/\s+/g, ' ').trim();
    const port = portfolioComposition();
    const invested = port.total;
    const totalCash = accountSummary.totalCash;
    const accountTotal = accountSummary.totalValue || (invested + (totalCash || 0));

    const holdings = portfolioData.map(s => ({
        name: clean(s.name), value: s.value, cost: s.cost, gainLoss: s.gainLoss,
        gainLossPercent: s.gainLossPercent, sector: s.sector || 'Unclassified',
        country: s.country || 'Unknown', weight: invested ? s.value / invested * 100 : 0
    }));
    const benchKey = document.getElementById('benchmarkSelect').value;
    const bench = benchmarks ? benchmarks[benchKey] : null;

    // ---- Flags ----
    const flags = [];
    const usWeight = port.regions['US'] || 0;
    flags.push({
        level: usWeight > 75 ? 'warn' : 'ok',
        title: 'Currency',
        text: `${pct(usWeight)} of holdings are US-listed and USD-denominated, unhedged. A 10% move in GBP/USD moves the portfolio about ${pct(usWeight / 10)} regardless of the companies.`
    });
    const over = holdings.filter(h => h.weight > rules.maxPosition);
    flags.push({
        level: over.length ? 'warn' : 'ok',
        title: 'Concentration',
        text: `Largest position ${pct(port.largest)}, top 10 ${pct(port.top10)}, ${port.count} holdings but ${port.effectiveN.toFixed(0)} effective (1/HHI). ` +
              (over.length ? `${over.length} above the ${pct(rules.maxPosition)} cap: ${over.map(h => h.name).join(', ')}.` : `None above the ${pct(rules.maxPosition)} cap.`)
    });
    const small = smallPositionStances(holdings, rules, bench).sort((a, b) => a.weight - b.weight);
    const smallWeight = small.reduce((sum, h) => sum + h.weight, 0);
    const count = stance => small.filter(h => h.stance === stance).length;
    flags.push({
        level: small.length ? 'warn' : 'ok',
        title: 'Small positions',
        text: small.length
            ? `${small.length} holdings under ${pct(rules.minPosition)} each, ${pct(smallWeight)} of invested value combined. ` +
              `Each is too small to move the result alone; together they are not. ` +
              (bench ? `Against ${bench.name}: ${count('Top up')} in sectors more than ${rules.sectorBand} pts under the index (top-up candidates; the plan fills these first when there is cash to deploy), ` +
                       `${count('Exit')} in sectors at or over the index (exit candidates), ${count('Either')} in between. ` : '') +
              (charges ? `Exiting all costs ${gbp(small.length * charges.share_deal_online)} in dealing (${small.length} × £${charges.share_deal_online.toFixed(2)}).` : '')
            : `No holdings under ${pct(rules.minPosition)}.`
    });
    document.getElementById('reviewFlags').innerHTML = flags.map(f => `
        <div class="review-flag ${f.level}">
            <span class="review-flag-title">${f.title}</span>
            <span class="review-flag-text">${f.text}</span>
        </div>`).join('');

    // ---- Small positions table ----
    document.getElementById('reviewSmallTable').innerHTML = small.length ? `
        <thead><tr><th>Holding</th><th class="num">Weight</th><th class="num">Value</th><th class="num">P/L</th><th class="num">P/L %</th><th>Sector vs index</th><th>Suggests</th></tr></thead>
        <tbody>${small.map(h => `<tr><td>${h.name}</td><td class="num">${pct(h.weight)}</td><td class="num">${gbp(h.value)}</td>
            <td class="num ${h.gainLoss >= 0 ? 'positive' : 'negative'}">${gbp(h.gainLoss)}</td>
            <td class="num ${h.gainLoss >= 0 ? 'positive' : 'negative'}">${pct(h.gainLossPercent)}</td>
            <td>${h.gap === null ? '—' : `${h.sector} ${h.gap > 0 ? '+' : ''}${h.gap.toFixed(1)} pts`}</td><td>${h.stance}</td></tr>`).join('')}</tbody>`
        : '<tbody><tr><td class="section-note">None.</td></tr></tbody>';

    // ---- Losers with recovery required ----
    const losers = holdings.filter(h => h.gainLoss < 0).sort((a, b) => a.gainLoss - b.gainLoss);
    const totalLoss = losers.reduce((sum, h) => sum + h.gainLoss, 0);
    document.getElementById('reviewLosersTable').innerHTML = losers.length ? `
        <thead><tr><th>Holding</th><th class="num">Weight</th><th class="num">Loss</th><th class="num">Loss %</th><th class="num">Rise needed to break even</th></tr></thead>
        <tbody>${losers.map(h => {
            const recover = h.value > 0 ? (h.cost / h.value - 1) * 100 : 0;
            return `<tr><td>${h.name}</td><td class="num">${pct(h.weight)}</td><td class="num negative">${gbp(h.gainLoss)}</td>
                <td class="num negative">${pct(h.gainLossPercent)}</td><td class="num">${pct(recover)}</td></tr>`;
        }).join('')}</tbody>
        <tfoot><tr><td>Total unrealised loss</td><td></td><td class="num negative">${gbp(totalLoss)}</td><td></td><td></td></tr></tfoot>`
        : '<tbody><tr><td class="section-note">No holdings below cost.</td></tr></tbody>';

    // ---- Sector bets vs selected benchmark, decomposed into the names driving them ----
    const betsEl = document.getElementById('reviewBets');
    if (bench) {
        const bySector = {};
        holdings.forEach(h => { (bySector[h.sector] = bySector[h.sector] || []).push(h); });
        const rows = Array.from(new Set([...Object.keys(bench.sectors), ...Object.keys(bySector)]))
            .map(name => {
                const p = (bySector[name] || []).reduce((sum, h) => sum + h.weight, 0);
                const b = bench.sectors[name] || 0;
                return { name, p, b, diff: p - b, names: (bySector[name] || []).sort((x, y) => y.weight - x.weight) };
            })
            .filter(r => Math.abs(r.diff) > rules.sectorBand)
            .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
        document.getElementById('reviewBetsNote').textContent =
            `Sectors more than ${rules.sectorBand} points from ${bench.name} (${bench.as_of}). Each shows the holdings that make up the bet.`;
        betsEl.innerHTML = rows.length ? rows.map(r => `
            <div class="review-bet ${r.diff > 0 ? 'over' : 'under'}">
                <div class="review-bet-head">
                    <span class="review-bet-name">${r.name}</span>
                    <span class="review-bet-diff">${r.diff > 0 ? '+' : ''}${r.diff.toFixed(1)} pts</span>
                    <span class="review-bet-sub">portfolio ${pct(r.p)} vs index ${pct(r.b)}</span>
                </div>
                <div class="review-bet-names">${r.names.length
                    ? r.names.map(h => `<span>${h.name} <em>${pct(h.weight)}</em></span>`).join('')
                    : '<span class="section-note">Nothing held in this sector.</span>'}</div>
            </div>`).join('')
            : `<p class="section-note">No sector deviates by more than ${rules.sectorBand} points.</p>`;
    } else {
        betsEl.innerHTML = '<p class="section-note">Benchmark data unavailable.</p>';
    }

    // ---- Rebalance plan: reserve, trims, allocation, before/after ----
    // Cash reserve comes from the drawdown runway when an annual withdrawal is
    // entered (months of withdrawals held as cash); otherwise the cash target rule.
    const dd = readDrawdownRules();
    const plan = buildRebalancePlan({ holdings, invested, totalCash, accountTotal, rules, bench, withdrawal: dd.withdrawal, runwayFloor: dd.runwayFloor });

    document.getElementById('reviewPlanNote').textContent = plan.reserveNote + ' ' + (plan.dealing
        ? `Dealing: ${plan.dealing.deals} Trim/Buy deals × £${plan.dealing.rate.toFixed(2)} = ${gbp(plan.dealing.cost)} (HL SIPP online share deal from ${charges.effective}; £${charges.share_deal_frequent.toFixed(2)} after ${charges.frequent_condition}).`
        : 'Dealing charges unavailable: data/platform-charges.json not found.');

    document.getElementById('reviewActionsTable').innerHTML = plan.actions.length ? `
        <thead><tr><th>Action</th><th>Holding / sector</th><th class="num">Amount</th><th>Reason</th></tr></thead>
        <tbody>${plan.actions.map(a => `<tr><td><span class="action-kind">${a.kind}</span></td><td>${a.name}</td><td class="num">${gbp(a.amount)}</td><td class="reason">${a.why}</td></tr>`).join('')}</tbody>`
        : '<tbody><tr><td class="section-note">Portfolio is within all rules.</td></tr></tbody>';

    const row = (label, before, after, ok) => `<tr><td>${label}</td><td class="num">${before}</td><td class="num">${after}</td><td><span class="dd-status ${ok === null ? '' : ok ? 'ok' : 'warn'}">${ok === null ? '—' : ok ? 'OK' : 'Check'}</span></td></tr>`;
    const B = plan.before, A = plan.after;
    document.getElementById('reviewPlanTable').innerHTML = `
        <thead><tr><th>Measure</th><th class="num">Now</th><th class="num">After plan</th><th>Rule after</th></tr></thead>
        <tbody>
            ${row('Cash', `${gbp(B.cash)} (${pct(B.cashPct)})`, `${gbp(A.cash)} (${pct(A.cashPct)})`, A.cash >= plan.reserve - 1)}
            ${row('Invested', gbp(B.invested), gbp(A.invested), null)}
            ${row('Largest position', pct(B.largest), pct(A.largest), A.largest <= rules.maxPosition + 1e-9)}
            ${row('Top 10 weight', pct(B.top10), pct(A.top10), null)}
            ${row('Effective holdings (1/HHI)', B.effectiveN.toFixed(1), A.effectiveN.toFixed(1), null)}
            ${row('Positions above cap', B.overCap, A.overCap, A.overCap === 0)}
            ${bench ? row(`Sectors outside ±${rules.sectorBand} pts vs ${bench.name}`, B.sectorsOut, A.sectorsOut, A.sectorsOut === 0) : ''}
            ${bench ? row('Largest sector gap (pts)', B.maxGap.toFixed(1), A.maxGap.toFixed(1), null) : ''}
        </tbody>`;

    summaryState.review = { largest: port.largest, effectiveN: port.effectiveN, count: port.count, overCap: over.length,
                            small: small.length, sectorsOut: B.sectorsOut, band: rules.sectorBand, benchName: bench ? bench.name : null, usWeight };
    summaryState.plan = { actions: plan.actions, reserve: plan.reserve, after: plan.after, before: plan.before };
    renderSummaryStrip();
}

// ---------------------------------------------------------------------------
// Summary strip (level 1) and section summary lines (level 2). Reads
// summaryState only; every number here is owned by one renderer above.
// ---------------------------------------------------------------------------
function renderSummaryStrip() {
    const gbp = n => '£' + Math.round(n).toLocaleString('en-GB');
    const gbpK = n => n >= 1e6 ? '£' + (n / 1e6).toFixed(2) + 'm' : '£' + Math.round(n / 1000).toLocaleString('en-GB') + 'k';
    const pct = n => n.toFixed(1) + '%';
    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const pill = (id, level, text) => { const el = document.getElementById(id); if (!el) return; el.className = 'pill' + (level ? ' ' + level : ''); el.textContent = text || ''; };
    const D = summaryState.drawdown, R = summaryState.review, B = summaryState.bench, P = summaryState.peers, L = summaryState.plan;

    // Account: cash vs reserve
    if (D && L) {
        if (D.cash === null) pill('tileAccountPill', 'info', 'no cash line');
        else {
            const diff = D.cash - L.reserve;
            pill('tileAccountPill', Math.abs(diff) < 1 ? 'ok' : 'warn', diff > 0 ? `${gbpK(diff)} above reserve` : diff < 0 ? `${gbpK(-diff)} below reserve` : 'at reserve');
        }
    }

    // Drawdown
    if (D) {
        if (D.W === null) { set('tileDrawdownValue', '—'); set('tileDrawdownSub', 'enter annual withdrawal'); pill('tileDrawdownPill', 'info', 'input needed'); }
        else {
            set('tileDrawdownValue', pct(D.rate) + ' a year');
            set('tileDrawdownSub', D.months === null ? `${gbp(D.W)} withdrawal` : `${D.months.toFixed(0)} months cash runway`);
            const bad = D.overCeiling || D.short;
            pill('tileDrawdownPill', bad ? 'warn' : 'ok', D.overCeiling && D.short ? 'rate and runway' : D.overCeiling ? `rate above ${pct(D.ceiling)}` : D.short ? `runway under ${D.floor}m` : 'within rules');
        }
        set('sumDrawdown', D.W === null ? 'Enter your annual withdrawal to measure rate, runway and the inflation hurdle.'
            : `${pct(D.rate)} withdrawal rate` + (D.months !== null ? `, ${D.months.toFixed(0)} months of cash` : '') + (D.cpiRate !== null ? `, CPI ${pct(D.cpiRate)}` : '') + '.');
    }

    // Concentration
    if (R) {
        set('tileConcValue', `${pct(R.largest)} largest`);
        set('tileConcSub', `${R.effectiveN.toFixed(0)} effective of ${R.count} holdings`);
        pill('tileConcPill', R.overCap ? 'warn' : 'ok', R.overCap ? `${R.overCap} above cap` : 'none above cap');
        set('sumReview', `${R.overCap} above the position cap, ${R.small} under the minimum, ${pct(R.usWeight)} USD exposure.`);
    }

    // Vs index
    if (R && B) {
        set('tileIndexValue', `${R.sectorsOut} sector${R.sectorsOut === 1 ? '' : 's'} out`);
        set('tileIndexSub', B.activeShare === null ? `vs ${B.name}` : `active share ${pct(B.activeShare)} vs ${B.name}`);
        pill('tileIndexPill', R.sectorsOut ? 'warn' : 'ok', R.sectorsOut ? `beyond ±${R.band} pts` : `within ±${R.band} pts`);
        set('sumBenchmark', `${B.name} (${B.asOf}): ${R.sectorsOut} sectors outside ±${R.band} pts, ${pct(B.overlap)} of the portfolio in the index top 10.`);
    }

    // Peers
    if (P) {
        set('tilePeerValue', P.potLabel + ' pot');
        set('tilePeerSub', `larger than ${pct(P.below)} of pots entering drawdown${P.ageBand ? ', age ' + P.fcaAge : ''}`);
        if (P.rate) pill('tilePeerPill', P.rate.below > 50 ? 'warn' : 'ok', `${pct(P.rate.below)} draw less than you`);
        else pill('tilePeerPill', 'info', P.ageBand ? 'enter withdrawal' : 'select age band');
    } else if (summaryState.drawdown) {
        set('tilePeerValue', '—'); set('tilePeerSub', 'peer data unavailable'); pill('tilePeerPill', '', '');
    }

    // Plan
    if (L) {
        const buys = L.actions.filter(a => a.kind === 'Buy'), trims = L.actions.filter(a => a.kind === 'Trim');
        const deploy = buys.reduce((s, a) => s + a.amount, 0);
        const raise = L.actions.filter(a => a.kind === 'Raise cash').reduce((s, a) => s + a.amount, 0);
        const firm = L.actions.filter(a => a.kind !== 'Decide' && a.kind !== 'Keep as cash').length;
        set('tilePlanValue', firm ? `${firm} action${firm === 1 ? '' : 's'}` : 'no action');
        set('tilePlanSub', raise > 0 ? `raise ${gbpK(raise)} for the reserve` : deploy > 0 ? `deploy ${gbpK(deploy)} into ${buys.length} buys` : 'within all rules');
        pill('tilePlanPill', firm ? 'info' : 'ok', firm ? `${trims.length} trims, ${buys.length} buys` : 'nothing to do');
        set('sumPlan', firm
            ? `${trims.length} trim${trims.length === 1 ? '' : 's'}, ${buys.length} buy${buys.length === 1 ? '' : 's'} totalling ${gbp(deploy)}; cash after ${gbp(L.after.cash)} against a ${gbp(L.reserve)} reserve.`
            : 'Portfolio is within all rules. Nothing to do.');
    }

    // Composition and holdings
    if (portfolioData.length) {
        const port = portfolioComposition();
        const sectors = Object.keys(port.sectors).length;
        const top = Object.entries(port.sectors).sort((a, b) => b[1] - a[1])[0];
        set('sumComposition', `${port.count} holdings across ${sectors} sectors; largest sector ${top[0]} ${pct(top[1])}; US ${pct(port.regions['US'] || 0)}.`);
        set('sumHoldings', `${port.count} holdings, ${gbp(port.total)} invested.`);
    }
}

// Section behaviour: remembered open state, tile-to-section jumps, and
// map resize when a hidden container becomes visible.
const OPEN_STATE_PREFIX = 'pensEval.open.';
function initSections() {
    const refreshVisuals = () => setTimeout(() => {
        if (window.map && window.map.invalidateSize) window.map.invalidateSize();
    }, 60);
    document.querySelectorAll('details.section').forEach(d => {
        try { if (localStorage.getItem(OPEN_STATE_PREFIX + d.id) === '1') d.open = true; } catch (e) { /* ignore */ }
        d.addEventListener('toggle', () => {
            try { localStorage.setItem(OPEN_STATE_PREFIX + d.id, d.open ? '1' : '0'); } catch (e) { /* ignore */ }
            if (d.open) refreshVisuals();
        });
    });
    document.querySelectorAll('details.sub').forEach(d => d.addEventListener('toggle', () => { if (d.open) refreshVisuals(); }));
    document.querySelectorAll('.sum-tile[data-target]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = document.getElementById(btn.dataset.target);
            if (!target) return;
            target.open = true;
            const sub = btn.dataset.sub ? document.getElementById(btn.dataset.sub) : null;
            if (sub) sub.open = true;
            (sub || target).scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });
}

// ---------------------------------------------------------------------------
// Rebalance plan. Pure function of the snapshot and the rules.
//   1. Reserve: cash to keep = runwayFloor months of withdrawals (if entered),
//      else cashTarget % of the account. Deployable = cash - reserve.
//   2. Trims: holdings above the max position are cut to the cap; proceeds join
//      the deployable pool.
//   3. Allocation: the pool is spread across sectors more than sectorBand points
//      under the benchmark, in proportion to each gap and capped at the gap, so
//      no sector overshoots the index. Within a sector: holdings under the
//      minimum position are topped up to it first, then larger holdings largest
//      first up to the max position, then new positions. Anything left stays as cash.
//   4. Dealing: one HL online share deal per Trim/Buy (data/platform-charges.json).
//   5. Before/after: the same concentration and sector measures on the
//      hypothetical portfolio if every action is taken.
// Small positions the plan does not top up are listed as one decision, not
// netted: exit or top-up is a judgement the rules cannot make.
// ---------------------------------------------------------------------------
function concentrationStats(values, bench, band) {
    const total = values.reduce((s, v) => s + v.value, 0);
    const w = values.map(v => ({ ...v, weight: total ? v.value / total * 100 : 0 })).sort((a, b) => b.weight - a.weight);
    const hhi = w.reduce((s, h) => s + Math.pow(h.weight / 100, 2), 0);
    const sectors = {};
    w.forEach(h => { sectors[h.sector] = (sectors[h.sector] || 0) + h.weight; });
    let sectorsOut = 0, maxGap = 0;
    if (bench) {
        new Set([...Object.keys(bench.sectors), ...Object.keys(sectors)]).forEach(name => {
            const gap = (sectors[name] || 0) - (bench.sectors[name] || 0);
            if (Math.abs(gap) > band) sectorsOut++;
            if (Math.abs(gap) > Math.abs(maxGap)) maxGap = gap;
        });
    }
    return { invested: total, largest: w[0]?.weight || 0, top10: w.slice(0, 10).reduce((s, h) => s + h.weight, 0),
             effectiveN: hhi ? 1 / hhi : 0, sectors, sectorsOut, maxGap, weights: w };
}

function buildRebalancePlan({ holdings, invested, totalCash, accountTotal, rules, bench, withdrawal, runwayFloor }) {
    const gbp = n => '£' + Math.round(n).toLocaleString('en-GB');
    const pct = n => n.toFixed(1) + '%';
    const actions = [];
    const cash = totalCash === null ? 0 : totalCash;

    // 1. Reserve
    let reserve, reserveNote;
    if (withdrawal !== null) {
        reserve = withdrawal / 12 * runwayFloor;
        reserveNote = `Cash reserve ${gbp(reserve)} = ${runwayFloor} months of the ${gbp(withdrawal)} annual withdrawal (Drawdown Sustainability inputs). ` +
                      `The cash target rule above is not used while a withdrawal is entered.`;
    } else {
        reserve = accountTotal * rules.cashTarget / 100;
        reserveNote = `Cash reserve ${gbp(reserve)} = ${pct(rules.cashTarget)} of the account (cash target rule). ` +
                      `Enter an annual withdrawal in Drawdown Sustainability to size the reserve from the cash runway instead.`;
    }
    if (totalCash === null) reserveNote += ' No "Total cash" line in this file; cash treated as £0.';

    // Working copy of the portfolio
    const work = holdings.map(h => ({ name: h.name, sector: h.sector, value: h.value }));
    let pool = Math.max(0, cash - reserve);
    const shortfall = Math.max(0, reserve - cash);

    // 2. Trims
    const capValue = invested * rules.maxPosition / 100;
    work.forEach(h => {
        if (h.value > capValue) {
            const amount = h.value - capValue;
            actions.push({ kind: 'Trim', name: h.name, amount,
                why: `${pct(h.value / invested * 100)} exceeds the ${pct(rules.maxPosition)} single-position cap. Proceeds join the cash to deploy. No capital gains tax in a SIPP.` });
            h.value = capValue; pool += amount;
        }
    });

    // Reserve shortfall: cash below the reserve must come from the pool first
    let poolAfterReserve = pool;
    if (shortfall > 0) {
        const cover = Math.min(pool, shortfall);
        if (cover > 0) actions.push({ kind: 'Hold as cash', name: 'Reserve top-up', amount: cover,
            why: `Cash ${gbp(cash)} is ${gbp(shortfall)} below the ${gbp(reserve)} reserve. Trim proceeds are kept as cash before anything is bought.` });
        poolAfterReserve = pool - cover;
        if (shortfall - cover > 0) actions.push({ kind: 'Raise cash', name: 'Sell to reach reserve', amount: shortfall - cover,
            why: `Still ${gbp(shortfall - cover)} short of the reserve after trims. Sell from holdings below cost that are also under the minimum position, or from the largest positions.` });
    }

    // 3. Allocation across sector underweights. Fill order within a sector: existing
    // holdings by headroom under the cap, then new positions sized at the cap.
    // Position caps are tested against the invested total as it grows, so no
    // holding ends above maxPosition after the plan.
    let unallocated = poolAfterReserve;
    const toppedUp = new Set();   // sub-minimum holdings the plan buys into; excluded from the Decide row
    if (bench && poolAfterReserve > 0) {
        const cap = rules.maxPosition / 100;
        const investedNow = () => work.reduce((s, h) => s + h.value, 0);
        // Max amount that can be added to a holding of value v so that (v + x) <= cap * (inv + x)
        const headroom = v => Math.max(0, (cap * investedNow() - v) / (1 - cap));
        const investedTarget = investedNow() + poolAfterReserve;
        const bySector = {};
        work.forEach(h => { bySector[h.sector] = (bySector[h.sector] || 0) + h.value; });
        const gaps = Object.entries(bench.sectors).map(([name, b]) => {
            const cur = bySector[name] || 0;
            const curPts = cur / investedTarget * 100;
            return { name, b, curPts, need: Math.max(0, investedTarget * b / 100 - cur) };
        }).filter(g => g.b - g.curPts > rules.sectorBand && g.need > 0);
        const totalNeed = gaps.reduce((s, g) => s + g.need, 0);
        if (totalNeed > 0) {
            const scale = Math.min(1, poolAfterReserve / totalNeed);
            gaps.sort((a, b) => b.need - a.need).forEach(g => {
                let remaining = g.need * scale;
                const gapPts = (g.b - g.curPts).toFixed(1);
                const minValue = investedTarget * rules.minPosition / 100;
                // Sub-minimum holdings in an under-index sector are filled first, to the
                // minimum: this closes the gap and removes a too-small position at once.
                const smallHere = work.filter(h => h.sector === g.name && !h.name.startsWith('New: ') && h.value < minValue)
                    .sort((a, b) => b.value - a.value);
                for (const h of smallHere) {
                    if (remaining < 1) break;
                    const amount = Math.min(remaining, minValue - h.value, headroom(h.value));
                    if (amount < 1) continue;
                    actions.push({ kind: 'Buy', name: `${g.name} → ${h.name}`, amount,
                        why: `Sector ${gapPts} pts under ${bench.name}. Under the ${pct(rules.minPosition)} minimum, so topped up to it before larger holdings or a new position.` });
                    h.value += amount; remaining -= amount; unallocated -= amount; toppedUp.add(h.name);
                }
                // Then existing holdings at or above the minimum, largest first, up to the cap.
                const existing = work.filter(h => h.sector === g.name && !h.name.startsWith('New: ') && h.value >= minValue)
                    .sort((a, b) => b.value - a.value);
                for (const h of existing) {
                    if (remaining < 1) break;
                    const amount = Math.min(remaining, headroom(h.value));
                    if (amount < 1) continue;
                    // A holding already topped up to the minimum above: one deal, one row.
                    const prior = toppedUp.has(h.name) && actions.find(a => a.kind === 'Buy' && a.name === `${g.name} → ${h.name}`);
                    if (prior) {
                        prior.amount += amount;
                        prior.why = `Sector ${gapPts} pts under ${bench.name}. Under the ${pct(rules.minPosition)} minimum, so topped up first, then with the other holdings up to the ${pct(rules.maxPosition)} position cap.`;
                    } else {
                        actions.push({ kind: 'Buy', name: `${g.name} → ${h.name}`, amount,
                            why: `Sector ${gapPts} pts under ${bench.name}. Top up existing holdings largest first; stops at the ${pct(rules.maxPosition)} position cap.` });
                    }
                    h.value += amount; remaining -= amount; unallocated -= amount;
                }
                let n = 1;
                while (remaining >= minValue) {   // a new position below the minimum is not opened; remainder stays as cash
                    const amount = Math.min(remaining, headroom(0));
                    if (amount < minValue) break;
                    const label = `New: ${g.name}${n > 1 ? ' #' + n : ''}`;
                    actions.push({ kind: 'Buy', name: `${g.name} → new position${n > 1 ? ' #' + n : ''}`, amount,
                        why: existing.length
                            ? `Sector still ${gapPts} pts under ${bench.name} after topping up existing holdings to the cap. A sector ETF or one large-cap name, sized at or below the ${pct(rules.maxPosition)} cap.`
                            : `Sector ${gapPts} pts under ${bench.name}, nothing held. A sector ETF or one large-cap name, sized at or below the ${pct(rules.maxPosition)} cap.` });
                    work.push({ name: label, sector: g.name, value: amount });
                    remaining -= amount; unallocated -= amount; n++;
                }
            });
        }
    }
    if (unallocated > 1) actions.push({ kind: 'Keep as cash', name: 'Unallocated', amount: unallocated,
        why: bench ? `Left after closing every sector gap more than ${rules.sectorBand} pts under the index. Above the reserve; deploy at your discretion or raise the reserve.`
                   : 'Benchmark data unavailable, so no sector allocation was made.' });

    // Dealing: one online share deal per Trim or Buy row, at the standard rate
    // (the frequent-trader rate depends on the previous month's deal count).
    const deals = actions.filter(a => a.kind === 'Trim' || a.kind === 'Buy').length;
    const dealing = charges ? { deals, cost: deals * charges.share_deal_online, rate: charges.share_deal_online } : null;

    // Small positions the plan did not top up: one summary row. Exit or top-up
    // is a judgement the rules cannot make; the stance split informs it.
    const small = smallPositionStances(holdings, rules, bench).filter(h => !toppedUp.has(h.name));
    if (small.length) {
        const topUp = small.reduce((s, h) => s + (invested * rules.minPosition / 100 - h.value), 0);
        const release = small.reduce((s, h) => s + h.value, 0);
        const exits = small.filter(h => h.stance === 'Exit');
        const exitRelease = exits.reduce((s, h) => s + h.value, 0);
        const deal = n => charges ? `, dealing ${gbp(n * charges.share_deal_online)}` : '';
        actions.push({ kind: 'Decide', name: `${small.length} holdings under ${pct(rules.minPosition)}${toppedUp.size ? ' not topped up above' : ''}`, amount: topUp,
            why: `Top up all to the minimum for ${gbp(topUp)}, or exit all and release ${gbp(release)}${deal(small.length)}. ` +
                 (bench ? `${exits.length} are in sectors at or over ${bench.name} (exit candidates, ${gbp(exitRelease)}${deal(exits.length)}). ` : '') +
                 `Per-holding figures in the Small positions table. Not included in the after-plan figures.` });
    }

    // 4. Before / after
    const beforeStats = concentrationStats(holdings.map(h => ({ name: h.name, sector: h.sector, value: h.value })), bench, rules.sectorBand);
    const afterStats = concentrationStats(work, bench, rules.sectorBand);
    const cashAfterClean = Math.min(cash, reserve) + (pool - poolAfterReserve) + Math.max(0, unallocated);
    const accountAfter = afterStats.invested + cashAfterClean;
    const overCap = stats => stats.weights.filter(h => h.weight > rules.maxPosition + 1e-9).length;
    return {
        reserve, reserveNote, actions, dealing,
        before: { cash, cashPct: accountTotal ? cash / accountTotal * 100 : 0, invested: beforeStats.invested, largest: beforeStats.largest, top10: beforeStats.top10,
                  effectiveN: beforeStats.effectiveN, overCap: overCap(beforeStats), sectorsOut: beforeStats.sectorsOut, maxGap: beforeStats.maxGap },
        after:  { cash: cashAfterClean, cashPct: accountAfter ? cashAfterClean / accountAfter * 100 : 0, invested: afterStats.invested, largest: afterStats.largest, top10: afterStats.top10,
                  effectiveN: afterStats.effectiveN, overCap: overCap(afterStats), sectorsOut: afterStats.sectorsOut, maxGap: afterStats.maxGap }
    };
}

// ---------------------------------------------------------------------------
// Drawdown sustainability: withdrawal rate, cash runway and inflation hurdle
// from the account snapshot, the user's annual withdrawal and the latest ONS
// CPI print. Arithmetic on real inputs only; no return assumptions.
// ---------------------------------------------------------------------------
const WITHDRAWAL_STORAGE_KEY = 'pensEval.annualWithdrawal';
const AGE_BAND_STORAGE_KEY = 'pensEval.ageBand';

function readDrawdownRules() {
    const num = (id, fallback) => {
        const v = parseFloat(document.getElementById(id).value);
        return isNaN(v) ? fallback : v;
    };
    const w = num('ddAnnualWithdrawal', 0);
    return {
        withdrawal: w > 0 ? w : null,       // £ per year; null = not entered
        rateCeiling: num('ddRateCeiling', 4), // % of account per year
        runwayFloor: num('ddRunwayFloor', 24) // months of withdrawals held as cash
    };
}

function createDrawdownReview() {
    const rules = readDrawdownRules();
    const gbp = n => '£' + Math.round(n).toLocaleString('en-GB');
    const pct = n => n.toFixed(1) + '%';
    const flagsEl = document.getElementById('ddFlags');
    const tableEl = document.getElementById('ddTable');
    const srcEl = document.getElementById('ddSources');

    const port = portfolioComposition();
    const totalCash = accountSummary.totalCash;
    const accountTotal = accountSummary.totalValue || (port.total + (totalCash || 0));
    const snapshotDate = accountSummary.createdAt
        ? accountSummary.createdAt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
        : 'date not found in file';

    const flags = [];
    const rows = [];   // { measure, value, rule, status: 'ok'|'warn'|'info', note }
    const W = rules.withdrawal;
    const dd = { W, accountTotal, cash: totalCash, rate: null, overCeiling: null, months: null, short: null,
                 ceiling: rules.rateCeiling, floor: rules.runwayFloor, cpiRate: cpi ? cpi.rate : null };
    summaryState.drawdown = dd;

    if (W === null) {
        flags.push({ level: 'info', title: 'Withdrawal',
            text: 'Enter the annual amount you draw from this SIPP. The CSV does not contain it. Withdrawal rate, cash runway and the inflation hurdle need it.' });
    } else {
        // Withdrawal rate
        const rate = accountTotal ? W / accountTotal * 100 : 0;
        const overCeiling = rate > rules.rateCeiling;
        dd.rate = rate; dd.overCeiling = overCeiling;
        flags.push({ level: overCeiling ? 'warn' : 'ok', title: 'Withdrawal rate',
            text: `${gbp(W)} a year is ${pct(rate)} of the ${gbp(accountTotal)} account. Ceiling ${pct(rules.rateCeiling)}. ` +
                  (overCeiling ? `${gbp(W - accountTotal * rules.rateCeiling / 100)} a year above the ceiling.` : 'Within the ceiling.') });
        rows.push({ measure: 'Withdrawal rate', value: pct(rate), rule: '≤ ' + pct(rules.rateCeiling), status: overCeiling ? 'warn' : 'ok',
            note: 'Annual withdrawal ÷ total account value at the snapshot.' });

        // Cash runway
        if (totalCash !== null) {
            const months = W > 0 ? totalCash / (W / 12) : Infinity;
            const short = months < rules.runwayFloor;
            dd.months = months; dd.short = short;
            const shortfall12 = Math.max(0, W - totalCash);
            flags.push({ level: short ? 'warn' : 'ok', title: 'Cash runway',
                text: `${gbp(totalCash)} cash covers ${months.toFixed(1)} months of withdrawals. Floor ${rules.runwayFloor} months. ` +
                      (shortfall12 > 0 ? `${gbp(shortfall12)} of the next 12 months must come from selling holdings.` : 'No forced sales in the next 12 months.') });
            rows.push({ measure: 'Cash runway', value: months.toFixed(1) + ' months', rule: '≥ ' + rules.runwayFloor + ' months', status: short ? 'warn' : 'ok',
                note: 'Total cash ÷ monthly withdrawal. Months of income before holdings must be sold.' });
            rows.push({ measure: 'Cash top-up to reach floor', value: gbp(Math.max(0, W / 12 * rules.runwayFloor - totalCash)), rule: '', status: 'info',
                note: 'Sales needed now to hold the runway floor in cash.' });
        } else {
            flags.push({ level: 'info', title: 'Cash runway', text: 'No "Total cash" line found in this file.' });
        }
    }

    // Inflation
    if (cpi) {
        const r = cpi.rate / 100;
        if (totalCash !== null) {
            rows.push({ measure: 'Cash purchasing-power loss', value: gbp(totalCash * r) + ' / year', rule: '', status: totalCash * r > 0 ? 'warn' : 'ok',
                note: `Total cash × CPI ${pct(cpi.rate)}. Uninvested cash loses this much real value each year at the current rate.` });
        }
        if (W !== null) {
            const rate = accountTotal ? W / accountTotal * 100 : 0;
            const hurdle = rate + cpi.rate;
            flags.push({ level: 'info', title: 'Inflation hurdle',
                text: `To keep the account's real value flat while drawing ${gbp(W)}, the portfolio must return ${pct(hurdle)} a year: ` +
                      `${pct(rate)} withdrawal rate + ${pct(cpi.rate)} CPI (${cpi.period}). Next year's withdrawal at the same real value: ${gbp(W * (1 + r))}.` });
            rows.push({ measure: 'Nominal return to preserve real capital', value: pct(hurdle), rule: '', status: 'info',
                note: 'Withdrawal rate + CPI. V(1+R) − W = V(1+CPI) ⇒ R = CPI + W/V.' });
            rows.push({ measure: 'Withdrawal next year at same real value', value: gbp(W * (1 + r)), rule: '', status: 'info',
                note: `Current withdrawal × (1 + CPI ${pct(cpi.rate)}).` });
        }
    } else {
        flags.push({ level: 'info', title: 'Inflation',
            text: 'UK CPI unavailable. Fetch of ONS series D7G7 failed' + (cpiError ? ` (${cpiError})` : '') + '. Inflation measures not shown.' });
    }

    flagsEl.innerHTML = flags.map(f => `
        <div class="review-flag ${f.level}">
            <span class="review-flag-title">${f.title}</span>
            <span class="review-flag-text">${f.text}</span>
        </div>`).join('');

    tableEl.innerHTML = rows.length ? `
        <thead><tr><th>Measure</th><th class="num">Value</th><th class="num">Rule</th><th>Status</th><th>Basis</th></tr></thead>
        <tbody>${rows.map(r => `<tr><td>${r.measure}</td><td class="num">${r.value}</td><td class="num">${r.rule}</td>
            <td><span class="dd-status ${r.status}">${r.status === 'ok' ? 'OK' : r.status === 'warn' ? 'Check' : '—'}</span></td>
            <td class="reason">${r.note}</td></tr>`).join('')}</tbody>`
        : '';

    const hdr = accountSummary;
    const hdrBits = [['stock', hdr.stockValue], ['cash', hdr.totalCash], ['total', hdr.totalValue]]
        .map(([k, v]) => `${k} ${v === null ? 'not found' : gbp(v)}`).join(', ');
    srcEl.textContent =
        `Account: HL export dated ${snapshotDate}; header lines read: ${hdrBits}. ` +
        (cpi ? `Inflation: ONS ${cpi.title}, ${cpi.period} = ${pct(cpi.rate)}, released ${cpi.releaseDate || 'n/a'}, next release ${cpi.nextRelease || 'n/a'}. ` : '') +
        (W !== null ? `Withdrawal: ${gbp(W)} a year, your input (stored in this browser only).` : '');

    createPeerComparison(accountTotal, W);
    renderSummaryStrip();
}

// ---------------------------------------------------------------------------
// Peer comparison: where this account sits against published distributions.
// FCA: pots entering drawdown by size (Table 3) and regular withdrawal rate by
// pot size (Table 8) and by age (Table 7), 2024/25. ONS WAS: private pension
// wealth in payment P25/median/P75 by age, 2020-22. Bands only; the sources do
// not publish exact percentiles.
// ---------------------------------------------------------------------------
const FCA_AGE_FOR_ONS_BAND = { '50-54': 'Under 55', '55-59': '55-64', '60-64': '55-64', '65-69': '65-74', '70-74': '65-74', '75+': '75+' };
const FCA_TABLE7_AGE_FOR_ONS_BAND = { '50-54': 'Under 55', '55-59': '55-64', '60-64': '55-64', '65-69': '65-74', '70-74': '65-74', '75+': '75-84' };

function bandKeyFor(value, bands) {
    for (const [key, [lo, hi]] of Object.entries(bands)) {
        if (value >= lo && (hi === null || value < hi)) return key;
    }
    return null;
}

function createPeerComparison(accountTotal, W) {
    const gbp = n => '£' + Math.round(n).toLocaleString('en-GB');
    const pct = n => n.toFixed(1) + '%';
    const noteEl = document.getElementById('ddPeerNote');
    const flagsEl = document.getElementById('ddPeerFlags');
    const potEl = document.getElementById('ddPeerPotTable');
    const rateEl = document.getElementById('ddPeerRateTable');
    const ageRateEl = document.getElementById('ddPeerAgeRateTable');
    const onsEl = document.getElementById('ddPeerOnsTable');
    const srcEl = document.getElementById('ddPeerSources');
    summaryState.peers = null;
    if (!peers) {
        noteEl.textContent = 'Peer data unavailable (data/peer-benchmarks.json).';
        [flagsEl, potEl, rateEl, ageRateEl, onsEl].forEach(el => el.innerHTML = '');
        srcEl.textContent = '';
        return;
    }
    const fca = peers.fca, ons = peers.ons;
    const ageBand = document.getElementById('ddAgeBand').value || null;
    const fcaAge = ageBand ? FCA_AGE_FOR_ONS_BAND[ageBand] : 'All ages';
    const fcaAge7 = ageBand ? FCA_TABLE7_AGE_FOR_ONS_BAND[ageBand] : null;
    const potKeys = Object.keys(fca.pot_bands);
    const rateKeys = Object.keys(fca.rate_bands);
    const potKey = bandKeyFor(accountTotal, fca.pot_bands);
    const potLabel = fca.pot_band_labels[potKey];
    const rate = W !== null && accountTotal ? W / accountTotal * 100 : null;
    const rateKey = rate !== null ? bandKeyFor(rate, fca.rate_bands) : null;

    noteEl.textContent = `Comparator for pot size is the total account value ${gbp(accountTotal)} (FCA pot sizes exclude tax-free cash already taken). ` +
        (ageBand ? `Age band ${ageBand}; FCA tables use ${fcaAge}.` : 'Select an age band to narrow the FCA figures and show the ONS row for your age.');

    // Helper: position of a band within a distribution {key: count}
    const position = (dist, keys, key) => {
        const total = keys.reduce((s, k) => s + (dist[k] || 0), 0);
        const idx = keys.indexOf(key);
        const below = keys.slice(0, idx).reduce((s, k) => s + (dist[k] || 0), 0);
        const inBand = dist[key] || 0;
        return { total, below: below / total * 100, inBand: inBand / total * 100, above: (total - below - inBand) / total * 100 };
    };

    const flags = [];

    // ---- Pot size vs pots entering drawdown ----
    const entering = fca.entering_drawdown.by_pot_band;
    const potDist = {}; potKeys.forEach(k => potDist[k] = entering[k][fcaAge]);
    const potPos = position(potDist, potKeys, potKey);
    summaryState.peers = { potLabel, below: potPos.below, above: potPos.above, fcaAge, ageBand,
                           rate: rateKey !== null ? position(fca.regular_withdrawal_rate_by_pot.by_pot_band[potKey], rateKeys, rateKey) : null };
    flags.push({ level: 'info', title: 'Pot size vs peers',
        text: `${gbp(accountTotal)} is in the ${potLabel} band. Of ${potPos.total.toLocaleString('en-GB')} pots entering drawdown in ${fca.period}${ageBand ? `, age ${fcaAge}` : ''}: ` +
              `${pct(potPos.below)} were smaller than this band, ${pct(potPos.inBand)} in it, ${pct(potPos.above)} larger.` });
    potEl.innerHTML = `
        <thead><tr><th>Pot band</th><th class="num">Pots</th><th class="num">Share</th><th class="num">Cumulative</th></tr></thead>
        <tbody>${(() => { let cum = 0; return potKeys.map(k => { const n = potDist[k]; const sh = n / potPos.total * 100; cum += sh;
            return `<tr class="${k === potKey ? 'peer-you' : ''}"><td>${fca.pot_band_labels[k]}${k === potKey ? ' ◀ you' : ''}</td><td class="num">${n.toLocaleString('en-GB')}</td><td class="num">${pct(sh)}</td><td class="num">${pct(cum)}</td></tr>`; }).join(''); })()}</tbody>`;

    // ---- Withdrawal rate vs pots of the same size ----
    const rateByPot = fca.regular_withdrawal_rate_by_pot.by_pot_band[potKey];
    if (rateKey !== null) {
        const rp = position(rateByPot, rateKeys, rateKey);
        flags.push({ level: rp.below > 50 ? 'warn' : 'ok', title: 'Withdrawal rate vs pots your size',
            text: `${pct(rate)} a year is in the ${fca.rate_band_labels[rateKey]} band. Of ${rp.total.toLocaleString('en-GB')} ${potLabel} pots in regular drawdown: ` +
                  `${pct(rp.below)} draw less than this band, ${pct(rp.inBand)} the same, ${pct(rp.above)} more.` +
                  (rp.below > 50 ? ' You draw faster than most pots of this size.' : '') });
    } else {
        flags.push({ level: 'info', title: 'Withdrawal rate vs pots your size', text: 'Enter an annual withdrawal above to place it in the distribution.' });
    }
    const rateTable = (dist, youKey) => {
        const total = rateKeys.reduce((s, k) => s + (dist[k] || 0), 0); let cum = 0;
        return `<thead><tr><th>Annual rate</th><th class="num">Plans</th><th class="num">Share</th><th class="num">Cumulative</th></tr></thead>
        <tbody>${rateKeys.map(k => { const n = dist[k] || 0; const sh = n / total * 100; cum += sh;
            return `<tr class="${k === youKey ? 'peer-you' : ''}"><td>${fca.rate_band_labels[k]}${k === youKey ? ' ◀ you' : ''}</td><td class="num">${n.toLocaleString('en-GB')}</td><td class="num">${pct(sh)}</td><td class="num">${pct(cum)}</td></tr>`; }).join('')}</tbody>`;
    };
    rateEl.innerHTML = rateTable(rateByPot, rateKey);

    // ---- Withdrawal rate vs same age band (Table 7) ----
    if (fcaAge7) {
        const rateByAge = fca.regular_withdrawal_rate_by_age.by_age_band[fcaAge7];
        ageRateEl.innerHTML = `<caption class="section-note">Age ${fcaAge7}, all pot sizes</caption>` + rateTable(rateByAge, rateKey);
        if (rateKey !== null) {
            const ra = position(rateByAge, rateKeys, rateKey);
            flags.push({ level: 'info', title: 'Withdrawal rate vs your age band',
                text: `Of ${ra.total.toLocaleString('en-GB')} plans in regular drawdown aged ${fcaAge7}: ${pct(ra.below)} draw less than your band, ${pct(ra.inBand)} the same, ${pct(ra.above)} more.` });
        }
    } else {
        ageRateEl.innerHTML = '<tbody><tr><td class="section-note">Select an age band.</td></tr></tbody>';
    }

    // ---- ONS pension wealth in payment by age ----
    const onsRows = Object.entries(ons.in_payment_by_age).filter(([age, v]) => age !== 'Under 50' && v.p50 !== null);
    const quartile = v => accountTotal < v.p25 ? 'below P25' : accountTotal < v.p50 ? 'P25–median' : accountTotal < v.p75 ? 'median–P75' : 'above P75';
    onsEl.innerHTML = `
        <thead><tr><th>Age</th><th class="num">P25</th><th class="num">Median</th><th class="num">P75</th><th>You</th></tr></thead>
        <tbody>${onsRows.map(([age, v]) => `<tr class="${age === ageBand ? 'peer-you' : ''}"><td>${age}${age === ageBand ? ' ◀ you' : ''}</td>
            <td class="num">${gbp(v.p25)}</td><td class="num">${gbp(v.p50)}</td><td class="num">${gbp(v.p75)}</td><td>${quartile(v)}</td></tr>`).join('')}</tbody>`;
    if (ageBand && ons.in_payment_by_age[ageBand] && ons.in_payment_by_age[ageBand].p50 !== null) {
        const v = ons.in_payment_by_age[ageBand];
        flags.push({ level: 'info', title: 'Pension wealth vs your age band (ONS)',
            text: `${gbp(accountTotal)} is ${quartile(v)} for people aged ${ageBand} with a private pension in payment (P25 ${gbp(v.p25)}, median ${gbp(v.p50)}, P75 ${gbp(v.p75)}, ${ons.period}). ` +
                  `Includes defined benefit pensions valued as capital, so the bar is higher than a pure pot comparison.` });
    }

    flagsEl.innerHTML = flags.map(f => `
        <div class="review-flag ${f.level}">
            <span class="review-flag-title">${f.title}</span>
            <span class="review-flag-text">${f.text}</span>
        </div>`).join('');

    srcEl.textContent = `FCA: ${fca.name}, ${fca.period}, published ${fca.published}. Counts are plans, not people; one person can hold several. ` +
        `ONS: ${ons.name}, ${ons.period}, published ${ons.published}. ${ons.measure}`;
}

// Create world map for geographic distribution
function createWorldMap() {
    const countryData = {};
    const countryCoordinates = {
        'US': [39.8283, -98.5795],
        'UK': [55.3781, -3.4360],
        'EU': [50.8503, 4.3517], // Brussels as EU center
        'CH': [46.8182, 8.2275]
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

    const worldBounds = L.latLngBounds([[-60, -180], [85, 180]]);

    const map = L.map('worldMap', {
        zoomControl: true,
        attributionControl: false,
        maxZoom: 5,
        zoomSnap: 0.25,  // Allow fractional zoom so one world copy fits the container width
        worldCopyJump: false,
        maxBounds: worldBounds,
        maxBoundsViscosity: 1.0
    });

    // Base view: one world copy filling the container WIDTH (top/bottom polar
    // regions are cropped rather than leaving grey margins at the sides).
    // Fitted zoom becomes the minimum so the user cannot zoom out into repeats/blank space.
    const fillZoom = map.getBoundsZoom(worldBounds, true);
    map.setView([30, 0], fillZoom);
    map.setMinZoom(fillZoom);

    window.map = map;

    // OpenStreetMap tiles (no API key). CARTO basemaps now watermark keyless
    // requests with "API KEY REQUIRED". Darkened via CSS filter in styles.css.
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
        noWrap: true,
        bounds: [[-85, -180], [85, 180]]
    }).addTo(map);
    L.control.attribution({ prefix: false }).addTo(map);

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
                fillColor: {'US': '#BAFFC9', 'UK': '#FFB3BA', 'EU': '#BAE1FF', 'CH': '#FFFFBA'}[country] || '#DDDDDD',
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
        const colors = {'US': '#BAFFC9', 'UK': '#FFB3BA', 'EU': '#BAE1FF', 'CH': '#FFFFBA'};
        item.innerHTML = `
            <span class="legend-color" style="background: ${colors[country]}"></span>
            <span>${country} - £${value.toLocaleString('en-GB', {minimumFractionDigits: 2})} (${percentage}%)</span>
        `;
        legendEl.appendChild(item);
    });

    // Add data source summary
    const sourceCounts = { map: 0, api: 0, guess: 0, default: 0 };
    portfolioData.forEach(stock => {
        const countryInfo = stock.countryData || { source: 'Legacy data' };
        if (countryInfo.source?.includes('Holdings map')) sourceCounts.map++;
        else if (countryInfo.source?.includes('Alpha Vantage')) sourceCounts.api++;
        else if (countryInfo.source?.includes('Intelligent guess')) sourceCounts.guess++;
        else sourceCounts.default++;
    });

    const sourceInfo = document.createElement('div');
    sourceInfo.className = 'data-source-info';
    sourceInfo.innerHTML = `
        <div class="source-title">Geographic Data Sources:</div>
        <div class="source-breakdown">
            ${sourceCounts.map > 0 ? `<span class="source-api">✅ ${sourceCounts.map} from holdings map</span>` : ''}
            ${sourceCounts.api > 0 ? `<span class="source-api">🔗 ${sourceCounts.api} from Alpha Vantage API</span>` : ''}
            ${sourceCounts.guess > 0 ? `<span class="source-guess">🧠 ${sourceCounts.guess} name-pattern guesses</span>` : ''}
            ${sourceCounts.default > 0 ? `<span class="source-default">📊 ${sourceCounts.default} US defaults</span>` : ''}
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

    const totalValue = portfolioData.reduce((sum, stock) => sum + stock.value, 0);
    const fmtGBP = n => n.toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2});

    portfolioData.forEach(stock => {
        const card = document.createElement('div');
        card.className = 'holding-card';

        const gainClass = stock.gainLoss >= 0 ? 'positive' : 'negative';
        const gainSymbol = stock.gainLoss >= 0 ? '+' : '';
        const percentSymbol = stock.gainLossPercent >= 0 ? '+' : '';
        const weight = totalValue ? (stock.value / totalValue) * 100 : 0;
        const sectorSource = stock.gicsSector?.source || '';
        const countrySource = stock.countryData?.source || '';
        const isApi = src => src.includes('Alpha Vantage') || src.includes('Holdings map');

        card.innerHTML = `
            <div class="holding-header">
                <div class="holding-name">${stock.name.replace(/\*\d+/g, '').trim()}</div>
                <div class="holding-meta">
                    <span class="holding-sector" title="${sectorSource}">${stock.sector}${isApi(sectorSource) ? '' : ' (guess)'}</span>
                    <span class="holding-country" title="${countrySource}">${stock.country}${isApi(countrySource) ? '' : ' (guess)'}</span>
                </div>
            </div>

            <div class="holding-figures">
                <div class="figure">
                    <span class="figure-label">Value</span>
                    <span class="figure-value">£${fmtGBP(stock.value)}</span>
                </div>
                <div class="figure">
                    <span class="figure-label">% of Portfolio</span>
                    <span class="figure-value">${weight.toFixed(2)}%</span>
                </div>
                <div class="figure">
                    <span class="figure-label">Cost</span>
                    <span class="figure-value">£${fmtGBP(stock.cost)}</span>
                </div>
            </div>

            <div class="holding-performance">
                <div class="holding-gain ${gainClass}">${gainSymbol}£${fmtGBP(stock.gainLoss)}</div>
                <div class="holding-percent ${gainClass}">${percentSymbol}${stock.gainLossPercent.toFixed(1)}%</div>
            </div>
        `;

        // Store data for sorting/filtering
        card.dataset.name = stock.name;
        card.dataset.gain = stock.gainLossPercent;
        card.dataset.value = stock.value;
        card.dataset.weight = weight;
        card.dataset.sector = stock.sector || '';
        card.dataset.country = stock.country || '';

        grid.appendChild(card);
    });

    applyDefaultSort();
}

function applyDefaultSort() {
    const grid = document.getElementById('holdingsGrid');
    const cards = Array.from(grid.children);

    // Sort by value (largest first)
    cards.sort((a, b) => parseFloat(b.dataset.value) - parseFloat(a.dataset.value));

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
            const haystack = `${card.dataset.name} ${card.dataset.sector} ${card.dataset.country}`.toLowerCase();
            card.style.display = haystack.includes(searchTerm) ? 'flex' : 'none';
        });
    });

    sortSelect.addEventListener('change', (e) => {
        const sortBy = e.target.value;
        const grid = document.getElementById('holdingsGrid');
        const cards = Array.from(grid.children);

        cards.sort((a, b) => {
            switch(sortBy) {
                case 'value':
                    return parseFloat(b.dataset.value) - parseFloat(a.dataset.value);
                case 'gain':
                    return parseFloat(b.dataset.gain) - parseFloat(a.dataset.gain);
                case 'name':
                    return a.dataset.name.localeCompare(b.dataset.name);
                case 'sector':
                    return a.dataset.sector.localeCompare(b.dataset.sector) ||
                           parseFloat(b.dataset.value) - parseFloat(a.dataset.value);
                case 'country':
                    return a.dataset.country.localeCompare(b.dataset.country) ||
                           parseFloat(b.dataset.value) - parseFloat(a.dataset.value);
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
    // Load static holdings classification and benchmark data, then API keys
    await Promise.all([loadHoldingsMap(), loadBenchmarks(), loadCPI(), loadPeerBenchmarks(), loadCharges()]);
    await loadAPIKeys();

    document.getElementById('benchmarkSelect').addEventListener('change', () => {
        if (portfolioData.length > 0) {
            createBenchmarkComparison();
            createPortfolioReview();
        }
    });
    ['ruleMaxPosition', 'ruleMinPosition', 'ruleSectorBand', 'ruleCashTarget'].forEach(id => {
        document.getElementById(id).addEventListener('input', () => {
            if (portfolioData.length > 0) createPortfolioReview();
        });
    });
    // Drawdown inputs. Annual withdrawal is remembered in this browser only.
    try {
        const saved = localStorage.getItem(WITHDRAWAL_STORAGE_KEY);
        if (saved) document.getElementById('ddAnnualWithdrawal').value = saved;
    } catch (e) { /* storage unavailable; input starts empty */ }
    try {
        const savedAge = localStorage.getItem(AGE_BAND_STORAGE_KEY);
        if (savedAge) document.getElementById('ddAgeBand').value = savedAge;
    } catch (e) { /* ignore */ }
    document.getElementById('ddAgeBand').addEventListener('change', () => {
        try { localStorage.setItem(AGE_BAND_STORAGE_KEY, document.getElementById('ddAgeBand').value); } catch (e) { /* ignore */ }
        if (portfolioData.length > 0) { createDrawdownReview(); createPortfolioReview(); }
    });
    ['ddAnnualWithdrawal', 'ddRateCeiling', 'ddRunwayFloor'].forEach(id => {
        document.getElementById(id).addEventListener('input', () => {
            if (id === 'ddAnnualWithdrawal') {
                try { localStorage.setItem(WITHDRAWAL_STORAGE_KEY, document.getElementById(id).value); } catch (e) { /* ignore */ }
            }
            if (portfolioData.length > 0) { createDrawdownReview(); createPortfolioReview(); }
        });
    });

    initSections();

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

    // Upload button inside the file-selection modal reuses the hidden file input
    document.getElementById('uploadFromModal').addEventListener('click', () => {
        document.getElementById('fileUpload').click();
    });

    // File upload handler remains the same
    document.getElementById('fileUpload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!/\.csv$/i.test(file.name)) {
            alert(`"${file.name}" is not a .csv file. Export the HL account summary as CSV and try again.`);
            return;
        }
        {
            const reader = new FileReader();
            reader.onload = async (event) => {
                // Parse uploaded CSV data directly
                console.log('Processing uploaded file:', file.name);
                currentFile = 'Uploaded: ' + file.name;
                updateCurrentFileDisplay();
                document.getElementById('fileSelectModal').classList.remove('show');
                await processCSVText(event.target.result);
            };
            reader.readAsText(file);
        }
        e.target.value = '';  // allow the same file to be chosen again
    });
});

// Process CSV text (extracted from parseCSVData for reuse)
async function processCSVText(csvText) {
    console.log('CSV text received, length:', csvText.length);
    const lines = csvText.split('\n');
    console.log('Total lines in CSV:', lines.length);

    const data = [];
    let startParsing = false;

    // Account-level lines above the holdings table (HL account summary header)
    accountSummary = { stockValue: null, totalCash: null, availableToInvest: null, totalValue: null, createdAt: null };
    // Accepts `Total cash:,"12,345.67"`, `Total cash:,12345.67`, `Total cash:, £12,345.67`,
    // trailing \r, and label variants without the colon.
    const headerNumber = (label) => {
        const key = label.replace(/:$/, '').toLowerCase();
        const line = lines.find(l => l.replace(/^\uFEFF/, '').trim().toLowerCase().startsWith(key));
        if (!line) return null;
        const rest = line.slice(line.toLowerCase().indexOf(key) + key.length).replace(/^[:\s]*,?/, '');
        const m = rest.match(/-?[£]?\s*[\d,]+(?:\.\d+)?/);
        const n = m ? parseFloat(m[0].replace(/[^0-9.\-]/g, '')) : NaN;
        return isNaN(n) ? null : n;
    };
    accountSummary.stockValue = headerNumber('Stock value:');
    accountSummary.totalCash = headerNumber('Total cash:');
    accountSummary.availableToInvest = headerNumber('Amount available to invest:');
    accountSummary.totalValue = headerNumber('Total value:');
    // "Spreadsheet created at,01-10-2025 10:27" (DD-MM-YYYY HH:MM, HL export)
    const createdLine = lines.find(l => l.startsWith('Spreadsheet created at'));
    const cm = createdLine && createdLine.match(/(\d{2})-(\d{2})-(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
    accountSummary.createdAt = cm ? new Date(+cm[3], +cm[2] - 1, +cm[1], +(cm[4] || 0), +(cm[5] || 0)) : null;

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