/**
 * OpenClaw API — Quote Endpoint
 * GET /api/openclaw/quote/:symbol
 *
 * Returns a stock quote for the given symbol. Serves from quote_cache if
 * the cached entry is less than 5 minutes old; otherwise fetches a fresh
 * quote from Yahoo Finance, updates the cache, and returns it.
 */

// ── Yahoo symbol translation ──────────────────────────────────────────
// Maps internal suffixes to Yahoo Finance suffixes.
const SUFFIX_MAP = {
  '.HKG': '.HK',
  '.SHH': '.SS',
  '.SHZ': '.SZ',
  '.SWX': '.SW',
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Translate an internal symbol to its Yahoo Finance equivalent.
 */
function toYahooSymbol(symbol) {
  for (const [from, to] of Object.entries(SUFFIX_MAP)) {
    if (symbol.endsWith(from)) {
      return symbol.replace(from, to);
    }
  }
  return symbol;
}

/**
 * Translate a Yahoo Finance symbol back to the internal representation.
 */
function fromYahooSymbol(yahooSymbol) {
  for (const [internal, yahoo] of Object.entries(SUFFIX_MAP)) {
    if (yahooSymbol.endsWith(yahoo)) {
      return yahooSymbol.replace(yahoo, internal);
    }
  }
  return yahooSymbol;
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const symbol = (params.symbol || '').toUpperCase();

  if (!symbol) {
    return Response.json(
      { success: false, error: 'Symbol parameter is required', meta: { timestamp: new Date().toISOString(), version: 'v1' } },
      { status: 400 }
    );
  }

  try {
    // ── 1. Check quote_cache ─────────────────────────────────────
    const cached = await env.DB.prepare(
      'SELECT * FROM quote_cache WHERE symbol = ?'
    ).bind(symbol).first();

    if (cached && cached.updated_at) {
      const cacheAge = Date.now() - new Date(cached.updated_at).getTime();
      if (cacheAge < CACHE_TTL_MS) {
        const change = cached.price - (cached.prev_close || 0);
        const changePercent = cached.prev_close
          ? parseFloat(((change / cached.prev_close) * 100).toFixed(2))
          : 0;

        return Response.json({
          success: true,
          data: {
            symbol,
            price: cached.price,
            previousClose: cached.prev_close,
            change: parseFloat(change.toFixed(2)),
            changePercent,
            currency: cached.currency,
            cached: true,
            updatedAt: cached.updated_at,
          },
          meta: { timestamp: new Date().toISOString(), version: 'v1' },
        });
      }
    }

    // ── 2. Fetch fresh quote from Yahoo Finance ──────────────────
    const yahooSymbol = toYahooSymbol(symbol);
    const yahooURL = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?region=US&lang=en-US&includePrePost=false&interval=1d&range=1d`;

    const response = await fetch(yahooURL, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      // Distinguish "not found" from upstream failures
      if (response.status === 404 || response.status === 422) {
        return Response.json(
          { success: false, error: `Symbol not found: ${symbol}`, meta: { timestamp: new Date().toISOString(), version: 'v1' } },
          { status: 404 }
        );
      }
      throw new Error(`Yahoo Finance responded with HTTP ${response.status}`);
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];

    if (!result || !result.meta) {
      return Response.json(
        { success: false, error: `Symbol not found: ${symbol}`, meta: { timestamp: new Date().toISOString(), version: 'v1' } },
        { status: 404 }
      );
    }

    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const previousClose = meta.chartPreviousClose ?? meta.previousClose ?? 0;
    const currency = meta.currency || 'USD';
    const change = parseFloat((price - previousClose).toFixed(2));
    const changePercent = previousClose
      ? parseFloat(((change / previousClose) * 100).toFixed(2))
      : 0;

    const now = new Date().toISOString();

    // ── 3. Upsert quote_cache ────────────────────────────────────
    await env.DB.prepare(`
      INSERT INTO quote_cache (symbol, price, change_amount, change_percent,
                               prev_close, currency, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(symbol) DO UPDATE SET
        price          = excluded.price,
        change_amount  = excluded.change_amount,
        change_percent = excluded.change_percent,
        prev_close     = excluded.prev_close,
        currency       = excluded.currency,
        updated_at     = excluded.updated_at
    `).bind(symbol, price, change, changePercent, previousClose, currency, now).run();

    return Response.json({
      success: true,
      data: {
        symbol,
        price,
        previousClose,
        change,
        changePercent,
        currency,
        cached: false,
        updatedAt: now,
      },
      meta: { timestamp: new Date().toISOString(), version: 'v1' },
    });
  } catch (err) {
    console.error(`OpenClaw quote error [${symbol}]:`, err);
    return Response.json(
      { success: false, error: 'Failed to fetch quote from external API', meta: { timestamp: new Date().toISOString(), version: 'v1' } },
      { status: 502 }
    );
  }
}
