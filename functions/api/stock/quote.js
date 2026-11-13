/**
 * @fileoverview GET /api/stock/quote?symbol=AAPL or GET /api/stock/quote?symbols=^GSPC,^IXIC
 *
 * Returns normalised stock quote(s).
 * - Tries D1 quote_cache first (60-second TTL unless force=1)
 * - Supports multi-source fallback: Yahoo Finance (query1 / query2) <-> Sina Finance <-> Finnhub
 * - Falls back to stale quote_cache data when upstream providers are unreachable or rate-limited
 */

/** Cache TTL in seconds */
const CACHE_TTL_SECONDS = 60;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Parse Yahoo Finance chart meta details into clean camelCase.
 * @param {object} meta – the chart meta object from Yahoo Finance
 * @returns {object}    – normalised quote
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
    latestTradingDay: meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString().split('T')[0]
      : '',
    currency: meta.currency ?? '',
  };
}

/**
 * Translate internal symbol to Yahoo Finance symbol.
 * @param {string} sym
 * @returns {string}
 */
function translateSymbolForYahoo(sym) {
  const s = sym.toUpperCase();
  if (s.endsWith('.HKG')) return s.replace('.HKG', '.HK');
  if (s.endsWith('.SHH')) return s.replace('.SHH', '.SS');
  if (s.endsWith('.SHZ')) return s.replace('.SHZ', '.SZ');
  if (s.endsWith('.SWX')) return s.replace('.SWX', '.SW');

  // Handle Finnhub-style symbols for Yahoo Finance
  if (s === 'OANDA:XAU_USD') return 'GC=F';
  if (s === 'BINANCE:BTCUSDT') return 'BTC-USD';
  if (s.startsWith('BINANCE:') && s.endsWith('USDT')) {
    return s.replace('BINANCE:', '').replace('USDT', '-USD');
  }
  if (s.startsWith('BINANCE:') && s.endsWith('BTC')) {
    return s.replace('BINANCE:', '').replace('BTC', '-BTC');
  }
  if (s.startsWith('CRYPTO:')) {
    return s.replace('CRYPTO:', '') + '-USD';
  }
  return s;
}

/**
 * Format a cached DB row into the standard quote response object.
 */
function formatCachedRow(cached, stale = false) {
  return {
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
    ...(stale ? { stale: true } : {}),
    updatedAt: cached.updated_at,
  };
}

/**
 * Try fetching quote from Yahoo Finance (tries query1 then query2, plus alternate ticker for DXY).
 */
async function tryFetchYahoo(symbol) {
  const primaryYfSymbol = translateSymbolForYahoo(symbol);
  const candidates = primaryYfSymbol === 'DX-Y.NYB' ? ['DX-Y.NYB', 'DX=F'] : [primaryYfSymbol];
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];

  for (const yfSymbol of candidates) {
    for (const host of hosts) {
      const apiUrl = `https://${host}/v8/finance/chart/${encodeURIComponent(yfSymbol)}?region=US&lang=en-US&includePrePost=false&interval=1d&useYfid=true&range=1d`;
      try {
        const yfResponse = await fetch(apiUrl, {
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'application/json',
          },
        });

        if (yfResponse.ok) {
          const yfData = await yfResponse.json();
          const result = yfData.chart?.result?.[0];
          if (result && result.meta && result.meta.regularMarketPrice != null) {
            const quote = normaliseQuote(result.meta);
            quote.symbol = symbol;
            return quote;
          }
        }
      } catch (e) {
        console.warn(`[StockAPI] Yahoo (${host}) fetch failed for ${symbol}:`, e.message);
      }
    }
  }
  return null;
}

/**
 * Try fetching quote from Sina Finance.
 */
async function tryFetchSina(symbol) {
  let sinaSymbol = '';
  let format = ''; // 'A' for domestic, 'B' for US gb_, 'C' for HK rt_

  if (symbol.endsWith('.SS') || symbol.endsWith('.SHH')) {
    sinaSymbol = 'sh' + symbol.replace(/\.S(S|HH)$/, '');
    format = 'A';
  } else if (symbol.endsWith('.SZ') || symbol.endsWith('.SHZ')) {
    sinaSymbol = 'sz' + symbol.replace(/\.S(Z|HZ)$/, '');
    format = 'A';
  } else if (symbol === '^IXIC') {
    sinaSymbol = 'gb_ixic';
    format = 'B';
  } else if (symbol === '^GSPC') {
    sinaSymbol = 'gb_inx';
    format = 'B';
  } else if (symbol === '^HSI') {
    sinaSymbol = 'rt_hkHSI';
    format = 'C';
  } else if (symbol.startsWith('^') && symbol !== '^VIX' && symbol !== '^TNX') {
    sinaSymbol = 'gb_' + symbol.replace('^', '').toLowerCase();
    format = 'B';
  } else {
    return null;
  }

  try {
    const sinaUrl = `https://hq.sinajs.cn/list=${sinaSymbol}`;
    const sinaResponse = await fetch(sinaUrl, {
      headers: { Referer: 'https://finance.sina.com.cn' },
    });

    if (!sinaResponse.ok) return null;

    const text = await sinaResponse.text();
    const match = text.match(/="(.*)"/);
    if (!match || !match[1] || match[1].length < 10) return null;

    const parts = match[1].split(',');
    let price = 0,
      prevClose = 0,
      changeAmount = 0,
      changePercent = 0;
    let high = 0,
      low = 0,
      open = 0,
      volume = 0;

    if (format === 'A') {
      price = parseFloat(parts[3]);
      prevClose = parseFloat(parts[2]);
      open = parseFloat(parts[1]);
      high = parseFloat(parts[4]);
      low = parseFloat(parts[5]);
      volume = parseFloat(parts[8]);
      changeAmount = price - prevClose;
    } else if (format === 'B') {
      price = parseFloat(parts[1]);
      changePercent = parseFloat(parts[2]);
      changeAmount = parseFloat(parts[4]);
      prevClose = price - changeAmount;
      open = parseFloat(parts[5]);
      high = parseFloat(parts[6]);
      low = parseFloat(parts[7]);
    } else if (format === 'C') {
      price = parseFloat(parts[6]);
      prevClose = parseFloat(parts[3]);
      open = parseFloat(parts[2]);
      high = parseFloat(parts[4]);
      low = parseFloat(parts[5]);
      changeAmount = price - prevClose;
    }

    if (!Number.isFinite(price) || price <= 0) return null;

    if (format !== 'B') {
      changePercent = prevClose ? (changeAmount / prevClose) * 100 : 0;
    }

    let currency = 'USD';
    if (format === 'A') currency = 'CNY';
    else if (format === 'C') currency = 'HKD';

    return {
      symbol,
      price,
      changeAmount,
      changePercent,
      high: high || 0,
      low: low || 0,
      volume: volume || 0,
      prevClose,
      open: open || 0,
      latestTradingDay: new Date().toISOString().split('T')[0],
      currency,
    };
  } catch (e) {
    console.warn(`[StockAPI] Sina fetch failed for ${symbol}:`, e.message);
    return null;
  }
}

/**
 * Try fetching quote from Finnhub (fallback for OANDA / BINANCE / CRYPTO or US tickers).
 */
async function tryFetchFinnhub(db, symbol) {
  if (!symbol.startsWith('OANDA:') && !symbol.startsWith('BINANCE:') && !symbol.startsWith('CRYPTO:')) {
    return null;
  }
  try {
    const stmt = await db.prepare("SELECT value FROM user_settings WHERE key = 'finnhub_api_key'").first();
    const finnhubKey = stmt ? stmt.value : '';
    if (!finnhubKey) return null;

    const finnhubUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`;
    const finnhubResp = await fetch(finnhubUrl);
    if (!finnhubResp.ok) return null;

    const finnhubData = await finnhubResp.json();
    if (finnhubData && (finnhubData.c !== 0 || finnhubData.pc !== 0)) {
      return {
        symbol,
        price: finnhubData.c,
        changeAmount: finnhubData.d || finnhubData.c - finnhubData.pc,
        changePercent:
          finnhubData.dp ||
          (finnhubData.pc ? ((finnhubData.c - finnhubData.pc) / finnhubData.pc) * 100 : 0),
        high: finnhubData.h || 0,
        low: finnhubData.l || 0,
        volume: 0,
        prevClose: finnhubData.pc,
        open: finnhubData.o || finnhubData.pc,
        latestTradingDay: new Date().toISOString().split('T')[0],
        currency: 'USD',
      };
    }
  } catch (e) {
    console.warn(`[StockAPI] Finnhub fallback failed for ${symbol}:`, e.message);
  }
  return null;
}

/**
 * Fetch quote for a single symbol with multi-source fallback and stale-cache resilience.
 * @param {D1Database} db
 * @param {string} symbol
 * @param {object|null} cachedRow
 * @param {boolean} force
 */
async function resolveQuote(db, symbol, cachedRow, force = false) {
  if (!force && cachedRow && cachedRow.age_seconds < CACHE_TTL_SECONDS) {
    return formatCachedRow(cachedRow, false);
  }

  const isSinaPreferred =
    symbol.endsWith('.SS') ||
    symbol.endsWith('.SZ') ||
    symbol.endsWith('.SHH') ||
    symbol.endsWith('.SHZ') ||
    (symbol.startsWith('^') && symbol !== '^VIX' && symbol !== '^TNX');

  let quote = null;

  if (isSinaPreferred) {
    // 1. Try Sina first, then fallback to Yahoo Finance
    quote = await tryFetchSina(symbol);
    if (!quote) {
      quote = await tryFetchYahoo(symbol);
    }
  } else {
    // 1. Try Yahoo first, then Sina (if supported), then Finnhub
    quote = await tryFetchYahoo(symbol);
    if (!quote) {
      quote = await tryFetchSina(symbol);
    }
    if (!quote) {
      quote = await tryFetchFinnhub(db, symbol);
    }
  }

  if (quote) {
    try {
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
             updated_at     = datetime('now')`
        )
        .bind(
          quote.symbol,
          quote.price,
          quote.changeAmount,
          quote.changePercent,
          quote.high,
          quote.low,
          quote.volume,
          quote.prevClose,
          quote.currency || null
        )
        .run();
    } catch (e) {
      console.warn(`[StockAPI] Failed to write quote_cache for ${symbol}:`, e.message);
    }
    return { ...quote, cached: false };
  }

  // Fallback to stale cache if available instead of failing with 500
  if (cachedRow && cachedRow.price != null) {
    console.warn(`[StockAPI] Returning stale cached quote for ${symbol}`);
    return formatCachedRow(cachedRow, true);
  }

  return null;
}

/**
 * GET handler — fetch one or multiple stock quotes.
 * @param {EventContext} context
 */
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const db = env.DB;
  const force = url.searchParams.get('force') === '1' || url.searchParams.get('force') === 'true';

  // ── Batch mode: ?symbols=^GSPC,^IXIC,... ────────────────────────────
  const symbolsParam = (url.searchParams.get('symbols') ?? '').trim();
  if (symbolsParam) {
    const symbolList = [
      ...new Set(
        symbolsParam
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      ),
    ].slice(0, 50);

    if (symbolList.length === 0) {
      return Response.json({ success: false, error: 'Empty symbols parameter' }, { status: 400 });
    }

    // Batch read from quote_cache using parameterized placeholders
    const placeholders = symbolList.map((_, idx) => `?${idx + 1}`).join(', ');
    const cachedMap = new Map();
    try {
      const { results } = await db
        .prepare(
          `SELECT *, (strftime('%s','now') - strftime('%s', updated_at)) AS age_seconds
           FROM quote_cache WHERE symbol IN (${placeholders})`
        )
        .bind(...symbolList)
        .all();
      for (const row of results || []) {
        cachedMap.set(row.symbol.toUpperCase(), row);
      }
    } catch (e) {
      console.warn('[StockAPI] Batch cache read failed:', e.message);
    }

    const entries = await Promise.all(
      symbolList.map(async (sym) => {
        const q = await resolveQuote(db, sym, cachedMap.get(sym) || null, force);
        return [sym, q];
      })
    );

    const data = {};
    for (const [sym, q] of entries) {
      if (q) data[sym] = q;
    }

    return Response.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'public, max-age=30' } }
    );
  }

  // ── Single mode: ?symbol=AAPL ───────────────────────────────────────
  const symbol = (url.searchParams.get('symbol') ?? '').trim().toUpperCase();

  if (!symbol) {
    return Response.json(
      { success: false, error: 'Missing required query parameter: symbol' },
      { status: 400 }
    );
  }

  try {
    const cached = await db
      .prepare(
        `SELECT *, (strftime('%s','now') - strftime('%s', updated_at)) AS age_seconds
         FROM quote_cache WHERE symbol = ?1`
      )
      .bind(symbol)
      .first();

    const quote = await resolveQuote(db, symbol, cached, force);
    if (!quote) {
      return Response.json(
        { success: false, error: `No quote data found for symbol: ${symbol}` },
        { status: 500 }
      );
    }

    return Response.json(
      {
        success: true,
        data: quote,
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=60',
        },
      }
    );
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}
