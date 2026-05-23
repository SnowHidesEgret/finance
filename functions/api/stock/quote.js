/**
 * @fileoverview GET /api/stock/quote?symbol=AAPL
 *
 * Returns a normalised stock quote. Tries the D1 quote_cache first (5-minute
 * TTL), then falls back to Alpha Vantage GLOBAL_QUOTE if the cache is stale
 * or missing.
 */

/** Cache TTL in seconds */
const CACHE_TTL_SECONDS = 60;

/**
 * Parse the messy Alpha Vantage key names into clean camelCase.
 * @param {object} raw – the "Global Quote" object from Alpha Vantage
 * @returns {object}   – normalised quote
 */
function normaliseQuote(meta) {
  const price = meta.regularMarketPrice || 0;
  const prevClose = meta.chartPreviousClose || 0;
  const changeAmount = price - prevClose;
  const changePercent = prevClose ? (changeAmount / prevClose) * 100 : 0;

  return {
    symbol: meta.symbol ?? '',
    price: price,
    changeAmount: changeAmount,
    changePercent: changePercent,
    high: meta.regularMarketDayHigh || 0,
    low: meta.regularMarketDayLow || 0,
    volume: meta.regularMarketVolume || 0,
    prevClose: prevClose,
    open: prevClose,
    latestTradingDay: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString().split('T')[0] : '',
    currency: meta.currency ?? ''
  };
}

/**
 * GET handler — fetch a stock quote.
 * @param {EventContext} context
 */
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase();

  if (!symbol) {
    return Response.json(
      { success: false, error: 'Missing required query parameter: symbol' },
      { status: 400 },
    );
  }

  const db = env.DB;

  // ── 1. Check cache ──────────────────────────────────────────────────
  const cached = await db
    .prepare(
      `SELECT *, (strftime('%s','now') - strftime('%s', updated_at)) AS age_seconds
       FROM quote_cache WHERE symbol = ?1`,
    )
    .bind(symbol)
    .first();

  if (cached && cached.age_seconds < CACHE_TTL_SECONDS) {
    return Response.json(
      {
        success: true,
        data: {
          symbol: cached.symbol,
          price: cached.price,
          changeAmount: cached.change_amount,
          changePercent: cached.change_percent,
          high: cached.high,
          low: cached.low,
          volume: cached.volume,
          prevClose: cached.prev_close,
          currency: cached.currency,
          cached: true,
          updatedAt: cached.updated_at,
        },
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=60',
        },
      },
    );
  }

  // Translate legacy Alpha Vantage symbols to Yahoo Finance symbols
  function translateSymbol(sym) {
    let s = sym.toUpperCase();
    if (s.endsWith('.HKG')) return s.replace('.HKG', '.HK');
    if (s.endsWith('.SHH')) return s.replace('.SHH', '.SS');
    if (s.endsWith('.SHZ')) return s.replace('.SHZ', '.SZ');
    if (s.endsWith('.SWX')) return s.replace('.SWX', '.SW');
    return s;
  }

  const yfSymbol = translateSymbol(symbol);

  // ── 2. Fetch from Yahoo Finance ─────────────────────────────────────
  const apiUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?region=US&lang=en-US&includePrePost=false&interval=1d&useYfid=true&range=1d`;
  
  try {
    const yfResponse = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    if (!yfResponse.ok) {
      return Response.json(
        { success: false, error: `Yahoo Finance returned HTTP ${yfResponse.status}` },
        { status: 502 },
      );
    }

    const yfData = await yfResponse.json();
    const result = yfData.chart?.result?.[0];
    
    if (!result || !result.meta) {
      return Response.json(
        { success: false, error: `No quote data found for symbol: ${symbol}` },
        { status: 404 },
      );
    }

    const quote = normaliseQuote(result.meta);

  // ── 3. Upsert cache ────────────────────────────────────────────────
  await db
    .prepare(
      `INSERT INTO quote_cache (symbol, price, change_amount, change_percent, high, low, volume, prev_close, currency, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, datetime('now'))
       ON CONFLICT(symbol) DO UPDATE SET
         price          = excluded.price,
         change_amount  = excluded.change_amount,
         change_percent = excluded.change_percent,
         high           = excluded.high,
         low            = excluded.low,
         volume         = excluded.volume,
         prev_close     = excluded.prev_close,
         currency       = excluded.currency,
         updated_at     = datetime('now')`,
    )
    .bind(
      symbol, // Use original symbol for cache key
      quote.price,
      quote.changeAmount,
      quote.changePercent,
      quote.high,
      quote.low,
      quote.volume,
      quote.prevClose,
      null, // currency
    )
    .run();

  return Response.json(
    {
      success: true,
      data: { ...quote, symbol: symbol, cached: false },
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    },
  );
  } catch (error) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
