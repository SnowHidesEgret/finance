/**
 * @fileoverview GET /api/stock/quote?symbol=AAPL
 *
 * Returns a normalised stock quote. Tries the D1 quote_cache first (5-minute
 * TTL), then falls back to Alpha Vantage GLOBAL_QUOTE if the cache is stale
 * or missing.
 */

/** Cache TTL in seconds */
const CACHE_TTL_SECONDS = 300;

/**
 * Parse the messy Alpha Vantage key names into clean camelCase.
 * @param {object} raw – the "Global Quote" object from Alpha Vantage
 * @returns {object}   – normalised quote
 */
function normaliseQuote(raw) {
  return {
    symbol: raw['01. symbol'] ?? '',
    price: parseFloat(raw['05. price']) || 0,
    changeAmount: parseFloat(raw['09. change']) || 0,
    changePercent: parseFloat((raw['10. change percent'] ?? '').replace('%', '')) || 0,
    high: parseFloat(raw['03. high']) || 0,
    low: parseFloat(raw['04. low']) || 0,
    volume: parseInt(raw['06. volume'], 10) || 0,
    prevClose: parseFloat(raw['08. previous close']) || 0,
    open: parseFloat(raw['02. open']) || 0,
    latestTradingDay: raw['07. latest trading day'] ?? '',
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

  // ── 2. Fetch from Alpha Vantage ─────────────────────────────────────
  const apiKey = env.ALPHA_VANTAGE_KEY;
  if (!apiKey) {
    return Response.json(
      { success: false, error: 'Alpha Vantage API key is not configured' },
      { status: 503 },
    );
  }

  const apiUrl = `${env.ALPHA_VANTAGE_BASE}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
  const avResponse = await fetch(apiUrl);

  if (!avResponse.ok) {
    return Response.json(
      { success: false, error: `Alpha Vantage returned HTTP ${avResponse.status}` },
      { status: 502 },
    );
  }

  const avData = await avResponse.json();

  // Alpha Vantage may return a rate-limit note instead of data
  if (avData['Note'] || avData['Information']) {
    return Response.json(
      { success: false, error: avData['Note'] || avData['Information'] },
      { status: 429 },
    );
  }

  const raw = avData['Global Quote'];
  if (!raw || Object.keys(raw).length === 0) {
    return Response.json(
      { success: false, error: `No quote data found for symbol: ${symbol}` },
      { status: 404 },
    );
  }

  const quote = normaliseQuote(raw);

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
      quote.symbol || symbol,
      quote.price,
      quote.changeAmount,
      quote.changePercent,
      quote.high,
      quote.low,
      quote.volume,
      quote.prevClose,
      null, // currency — Alpha Vantage GLOBAL_QUOTE doesn't include it
    )
    .run();

  return Response.json(
    {
      success: true,
      data: { ...quote, cached: false },
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=60',
      },
    },
  );
}
