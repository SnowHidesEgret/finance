/**
 * @fileoverview GET /api/stock/finnhub?type=<type>&symbol=<symbol>
 *
 * Unified Finnhub API proxy with D1 caching layer.
 * Supported types: news, recommendation, price-target, basic-financials, earnings
 */

/** Cache TTL per data type (seconds) */
const CACHE_TTL = {
  'basic-financials': 24 * 3600, // 24 hours
  'earnings': 12 * 3600,         // 12 hours
};

const FINNHUB_BASE = 'https://finnhub.io/api/v1';

/**
 * Build the Finnhub API URL for a given type and symbol.
 */
function buildFinnhubUrl(type, symbol, apiKey) {
  const today = new Date();
  const fmt = (d) => d.toISOString().split('T')[0];

  switch (type) {
    case 'basic-financials':
      return `${FINNHUB_BASE}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${apiKey}`;
    case 'earnings': {
      const from = new Date(today);
      from.setDate(from.getDate() - 7);
      const to = new Date(today);
      to.setDate(to.getDate() + 14);
      return `${FINNHUB_BASE}/calendar/earnings?from=${fmt(from)}&to=${fmt(to)}&symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
    }
    default:
      return null;
  }
}

/**
 * Translate internal symbol suffix to Yahoo Finance suffix format.
 */
function translateSymbolForYahoo(sym) {
  let s = sym.toUpperCase();
  if (s.endsWith('.HKG')) return s.replace('.HKG', '.HK');
  if (s.endsWith('.SHH')) return s.replace('.SHH', '.SS');
  if (s.endsWith('.SHZ')) return s.replace('.SHZ', '.SZ');
  if (s.endsWith('.SWX')) return s.replace('.SWX', '.SW');
  return s;
}

let _cachedYahooSession = null;

async function getYahooSession(db) {
  if (_cachedYahooSession) {
    return _cachedYahooSession;
  }

  // Check D1 cache first
  try {
    const cookieRow = await db.prepare("SELECT value, updated_at FROM user_settings WHERE key = 'yahoo_session_cookie'").first();
    const crumbRow = await db.prepare("SELECT value FROM user_settings WHERE key = 'yahoo_session_crumb'").first();
    
    if (cookieRow && crumbRow) {
      const updatedAt = new Date(cookieRow.updated_at).getTime();
      const ageMs = Date.now() - updatedAt;
      // If session is less than 1 hour old, reuse it
      if (ageMs < 3600 * 1000) {
        _cachedYahooSession = { cookie: cookieRow.value, crumb: crumbRow.value };
        return _cachedYahooSession;
      }
    }
  } catch (e) {
    console.warn('[YahooSession] Failed to read session from D1:', e.message);
  }

  // Fetch new session
  const fcUrl = 'https://fc.yahoo.com/';
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  const fcResp = await fetch(fcUrl, {
    headers: { 'User-Agent': userAgent }
  });

  const cookie = fcResp.headers.get('set-cookie');
  if (!cookie) {
    throw new Error('Failed to get cookie from fc.yahoo.com');
  }

  const cookiePart = cookie.split(';')[0];

  const crumbUrl = 'https://query2.finance.yahoo.com/v1/test/getcrumb';
  const crumbResp = await fetch(crumbUrl, {
    headers: {
      'User-Agent': userAgent,
      'Cookie': cookiePart
    }
  });

  if (!crumbResp.ok) {
    throw new Error(`Failed to get crumb: ${crumbResp.status}`);
  }

  const crumb = await crumbResp.text();
  const session = { cookie: cookiePart, crumb };

  // Write back to D1
  try {
    await db.prepare("INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES ('yahoo_session_cookie', ?, datetime('now'))").bind(cookiePart).run();
    await db.prepare("INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES ('yahoo_session_crumb', ?, datetime('now'))").bind(crumb).run();
  } catch (e) {
    console.warn('[YahooSession] Failed to write session to D1:', e.message);
  }

  _cachedYahooSession = session;
  return session;
}

/**
 * Fetch from Yahoo Finance quoteSummary API.
 */
async function fetchYahooQuoteSummary(db, symbol, modules, isRetry = false) {
  const yfSymbol = translateSymbolForYahoo(symbol);
  
  let session;
  try {
    session = await getYahooSession(db);
  } catch (err) {
    throw new Error(`Failed to get Yahoo session: ${err.message}`);
  }

  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(yfSymbol)}?modules=${modules.join(',')}&crumb=${session.crumb}`;
  
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Cookie': session.cookie
    }
  });

  if (resp.status === 401 && !isRetry) {
    console.warn(`[Yahoo] Session unauthorized, clearing session and retrying...`);
    _cachedYahooSession = null;
    try {
      await db.prepare("DELETE FROM user_settings WHERE key IN ('yahoo_session_cookie', 'yahoo_session_crumb')").run();
    } catch (_) {}
    return await fetchYahooQuoteSummary(db, symbol, modules, true);
  }

  if (!resp.ok) {
    throw new Error(`Yahoo Finance returned HTTP ${resp.status}`);
  }

  const json = await resp.json();
  const result = json.quoteSummary?.result?.[0];
  if (!result) {
    throw new Error(`No quoteSummary result found for ${symbol}`);
  }
  return result;
}

/**
 * Map Yahoo Finance quoteSummary data to Finnhub-like structure.
 */
function mapYahooData(type, yahooData, symbol) {
  if (type === 'basic-financials') {
    const defaultKeyStats = yahooData.defaultKeyStatistics || {};
    const financialData = yahooData.financialData || {};
    const summaryDetail = yahooData.summaryDetail || {};

    const high52 = summaryDetail.fiftyTwoWeekHigh?.raw || defaultKeyStats.fiftyTwoWeekHigh?.raw || null;
    const low52 = summaryDetail.fiftyTwoWeekLow?.raw || defaultKeyStats.fiftyTwoWeekLow?.raw || null;
    const pe = summaryDetail.trailingPE?.raw || defaultKeyStats.forwardPE?.raw || null;
    const pb = defaultKeyStats.priceToBook?.raw || null;
    const eps = defaultKeyStats.trailingEps?.raw || null;
    // Yahoo marketCap is absolute, Finnhub is in millions
    const marketCap = (summaryDetail.marketCap?.raw || defaultKeyStats.enterpriseValue?.raw || 0) / 1000000;
    const beta = defaultKeyStats.beta?.raw || null;
    const divYield = summaryDetail.dividendYield?.raw ? (summaryDetail.dividendYield.raw * 100) : null;
    const grossMargin = financialData.grossMargins?.raw ? (financialData.grossMargins.raw * 100) : null;
    const netMargin = defaultKeyStats.profitMargins?.raw ? (defaultKeyStats.profitMargins.raw * 100) : null;
    const roe = financialData.returnOnEquity?.raw ? (financialData.returnOnEquity.raw * 100) : null;

    return {
      metric: {
        '52WeekHigh': high52,
        '52WeekLow': low52,
        'peNormalizedAnnual': pe,
        'peTTM': pe,
        'pbAnnual': pb,
        'pbQuarterly': pb,
        'epsNormalizedAnnual': eps,
        'epsTTM': eps,
        'marketCapitalization': marketCap,
        'beta': beta,
        'dividendYieldIndicatedAnnual': divYield,
        'grossMarginTTM': grossMargin,
        'netProfitMarginTTM': netMargin,
        'roeTTM': roe
      }
    };
  } else if (type === 'earnings') {
    const calendarEvents = yahooData.calendarEvents || {};
    const earnings = calendarEvents.earnings || {};
    const earningsDateArray = earnings.earningsDate || [];

    const mappedEarnings = [];
    if (earningsDateArray.length > 0) {
      earningsDateArray.forEach(d => {
        if (d && d.raw) {
          const dateStr = new Date(d.raw * 1000).toISOString().split('T')[0];
          mappedEarnings.push({
            date: dateStr,
            symbol: symbol,
            epsEstimate: earnings.earningsAverage?.raw || null,
            hour: ''
          });
        }
      });
    }
    return mappedEarnings;
  }
  return null;
}

/**
 * GET handler — proxy Finnhub API with D1 caching.
 */
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const type = (url.searchParams.get('type') ?? '').trim().toLowerCase();
  const symbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase();

  if (!type || !symbol) {
    return Response.json(
      { success: false, error: 'Missing required parameters: type, symbol' },
      { status: 400 },
    );
  }

  if (!CACHE_TTL[type]) {
    return Response.json(
      { success: false, error: `Unsupported type: ${type}. Supported: ${Object.keys(CACHE_TTL).join(', ')}` },
      { status: 400 },
    );
  }

  const db = env.DB;

  // ── 1. Read Finnhub API key from user_settings ─────────────
  const keyRow = await db
    .prepare("SELECT value FROM user_settings WHERE key = 'finnhub_api_key'")
    .first();
  const apiKey = keyRow ? keyRow.value : '';

  const cacheKey = `${type}:${symbol}`;
  const ttlSeconds = CACHE_TTL[type];

  // ── 2. Check D1 cache ──────────────────────────────────────
  try {
    const cached = await db
      .prepare(
        `SELECT data, (strftime('%s','now') - strftime('%s', updated_at)) AS age_seconds
         FROM finnhub_cache WHERE cache_key = ?1`,
      )
      .bind(cacheKey)
      .first();

    if (cached && cached.age_seconds < ttlSeconds) {
      return Response.json({
        success: true,
        data: JSON.parse(cached.data),
        cached: true,
        cacheAge: cached.age_seconds,
      });
    }
  } catch (e) {
    console.warn(`[Finnhub] Cache read error for ${cacheKey}:`, e.message);
  }

  // ── 3. Decide source: Yahoo Finance or Finnhub ──────────────
  const isNonUS = symbol.endsWith('.HKG') || symbol.endsWith('.SHH') || symbol.endsWith('.SHZ') || symbol.endsWith('.SWX');
  const useYahooFinance = isNonUS || !apiKey;

  let finnhubData = null;

  if (useYahooFinance) {
    try {
      const modules = type === 'basic-financials' 
        ? ['defaultKeyStatistics', 'financialData', 'summaryDetail']
        : ['calendarEvents'];
      
      const yahooData = await fetchYahooQuoteSummary(db, symbol, modules);
      finnhubData = mapYahooData(type, yahooData, symbol);
    } catch (e) {
      console.error(`[YahooFinance Fallback] Fetch error for ${cacheKey}:`, e.message);
      return await returnStaleOrError(db, cacheKey, `数据获取失败: ${e.message}`);
    }
  } else {
    // ── 3b. Fetch from Finnhub API ──────────────────────────────
    const finnhubUrl = buildFinnhubUrl(type, symbol, apiKey);
    if (!finnhubUrl) {
      return Response.json(
        { success: false, error: `Failed to build URL for type: ${type}` },
        { status: 400 },
      );
    }

    try {
      const resp = await fetch(finnhubUrl, {
        headers: { 'X-Finnhub-Token': apiKey },
      });

      if (resp.status === 429) {
        console.warn(`[Finnhub] Rate limited for ${cacheKey}, trying Yahoo Finance fallback...`);
        try {
          const modules = type === 'basic-financials' 
            ? ['defaultKeyStatistics', 'financialData', 'summaryDetail']
            : ['calendarEvents'];
          const yahooData = await fetchYahooQuoteSummary(db, symbol, modules);
          finnhubData = mapYahooData(type, yahooData, symbol);
        } catch (yfErr) {
          console.error(`[YahooFinance Fallback after Finnhub 429] Fetch error for ${cacheKey}:`, yfErr.message);
          return await returnStaleOrError(db, cacheKey, 'Finnhub API 频率限制，且备用数据源获取失败。');
        }
      } else if (!resp.ok) {
        console.warn(`[Finnhub] HTTP ${resp.status} for ${cacheKey}, trying Yahoo Finance fallback...`);
        try {
          const modules = type === 'basic-financials' 
            ? ['defaultKeyStatistics', 'financialData', 'summaryDetail']
            : ['calendarEvents'];
          const yahooData = await fetchYahooQuoteSummary(db, symbol, modules);
          finnhubData = mapYahooData(type, yahooData, symbol);
        } catch (yfErr) {
          console.error(`[YahooFinance Fallback after Finnhub Error] Fetch error for ${cacheKey}:`, yfErr.message);
          return await returnStaleOrError(db, cacheKey, `Finnhub API 返回 HTTP ${resp.status}，且备用数据源获取失败。`);
        }
      } else {
        finnhubData = await resp.json();

        // Normalize earnings calendar response
        if (type === 'earnings' && finnhubData?.earningsCalendar) {
          finnhubData = finnhubData.earningsCalendar;
        }
      }
    } catch (e) {
      console.error(`[Finnhub] Fetch error for ${cacheKey}, trying Yahoo Finance fallback...`, e.message);
      try {
        const modules = type === 'basic-financials' 
          ? ['defaultKeyStatistics', 'financialData', 'summaryDetail']
          : ['calendarEvents'];
        const yahooData = await fetchYahooQuoteSummary(db, symbol, modules);
        finnhubData = mapYahooData(type, yahooData, symbol);
      } catch (yfErr) {
        console.error(`[YahooFinance Fallback after Finnhub Exception] Fetch error for ${cacheKey}:`, yfErr.message);
        return await returnStaleOrError(db, cacheKey, `Finnhub 请求失败: ${e.message}，且备用数据源获取失败。`);
      }
    }
  }

  // ── 4. Write to D1 cache ───────────────────────────────────
  try {
    const jsonStr = JSON.stringify(finnhubData);
    await db
      .prepare(
        `INSERT INTO finnhub_cache (cache_key, data, updated_at)
         VALUES (?1, ?2, datetime('now'))
         ON CONFLICT(cache_key) DO UPDATE SET
           data = excluded.data,
           updated_at = datetime('now')`,
      )
      .bind(cacheKey, jsonStr)
      .run();
  } catch (e) {
    console.warn(`[Finnhub] Cache write error for ${cacheKey}:`, e.message);
    // Non-fatal — still return data
  }

  return Response.json({
    success: true,
    data: finnhubData,
    cached: false,
  });
}

/**
 * Helper: return stale cache or error response.
 */
async function returnStaleOrError(db, cacheKey, errorMessage) {
  try {
    const stale = await db
      .prepare('SELECT data FROM finnhub_cache WHERE cache_key = ?1')
      .bind(cacheKey)
      .first();

    if (stale) {
      return Response.json({
        success: true,
        data: JSON.parse(stale.data),
        cached: true,
        stale: true,
      });
    }
  } catch (_) { /* ignore */ }

  return Response.json(
    { success: false, error: errorMessage },
    { status: 200 },
  );
}
