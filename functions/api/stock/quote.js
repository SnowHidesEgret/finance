/**
 * @fileoverview GET /api/stock/quote?symbol=AAPL
 *
 * Returns a normalised stock quote. Tries the D1 quote_cache first (60-second
 * TTL), then falls back to Yahoo Finance Chart API if the cache is stale
 * or missing.
 */

/** Cache TTL in seconds */
const CACHE_TTL_SECONDS = 60;

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

  // ── 2. Fetch from appropriate API based on symbol ────────────────────
  let quote = null;

  try {
    const isSinaSymbol = symbol.endsWith('.SS') || symbol.endsWith('.SZ') || symbol.endsWith('.SHH') || symbol.endsWith('.SHZ') || (symbol.startsWith('^') && symbol !== '^VIX' && symbol !== '^TNX');

    // A) Yahoo Finance (Prioritized for ordinary stocks, crypto, forex, commodities, VIX, and TNX)
    if (!isSinaSymbol) {
      try {
        function translateSymbol(sym) {
          let s = sym.toUpperCase();
          if (s.endsWith('.HKG')) return s.replace('.HKG', '.HK');
          if (s.endsWith('.SHH')) return s.replace('.SHH', '.SS');
          if (s.endsWith('.SHZ')) return s.replace('.SHZ', '.SZ');
          if (s.endsWith('.SWX')) return s.replace('.SWX', '.SW');
          
          // Handle Finnhub-style symbols for Yahoo Finance
          if (s === 'OANDA:XAU_USD') return 'GC=F'; // Map Gold to Gold Futures
          if (s === 'BINANCE:BTCUSDT') return 'BTC-USD'; // Map BTC to BTC-USD
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
        const yfSymbol = translateSymbol(symbol);
        const apiUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?region=US&lang=en-US&includePrePost=false&interval=1d&useYfid=true&range=1d`;
        
        const yfResponse = await fetch(apiUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json'
          }
        });

        if (yfResponse.ok) {
          const yfData = await yfResponse.json();
          const result = yfData.chart?.result?.[0];
          
          if (result && result.meta) {
            quote = normaliseQuote(result.meta);
            quote.symbol = symbol; // Keep the original symbol
          }
        } else {
          console.warn(`[StockAPI] Yahoo Finance returned HTTP ${yfResponse.status} for ${symbol}`);
        }
      } catch (e) {
        console.warn(`[StockAPI] Yahoo Finance fetch failed for ${symbol}:`, e.message);
      }
    }

    // B) All Indices (Domestic & International) -> Sina Finance
    // (Tencent blocks Cloudflare IPs, and Finnhub blocks CFD indices on free tier)
    if (!quote && isSinaSymbol) {
      let sinaSymbol = '';
      let format = ''; // 'A' for domestic, 'B' for US gb_, 'C' for HK rt_
      
      // Domestic mapping
      if (symbol.endsWith('.SS') || symbol.endsWith('.SHH')) {
        sinaSymbol = 'sh' + symbol.replace(/\.S(S|HH)$/, '');
        format = 'A';
      } else if (symbol.endsWith('.SZ') || symbol.endsWith('.SHZ')) {
        sinaSymbol = 'sz' + symbol.replace(/\.S(Z|HZ)$/, '');
        format = 'A';
      }
      // International mapping
      else if (symbol === '^IXIC') { sinaSymbol = 'gb_ixic'; format = 'B'; }
      else if (symbol === '^GSPC') { sinaSymbol = 'gb_inx'; format = 'B'; }
      else if (symbol === '^HSI') { sinaSymbol = 'rt_hkHSI'; format = 'C'; }
      else { sinaSymbol = 'gb_' + symbol.replace('^', '').toLowerCase(); format = 'B'; } // generic fallback

      const sinaUrl = `https://hq.sinajs.cn/list=${sinaSymbol}`;
      const sinaResponse = await fetch(sinaUrl, {
        headers: { 'Referer': 'https://finance.sina.com.cn' }
      });
      
      if (!sinaResponse.ok) {
        throw new Error(`Sina Finance returned HTTP ${sinaResponse.status}`);
      }
      
      const text = await sinaResponse.text();
      const match = text.match(/="(.*)"/);
      if (!match || !match[1] || match[1].length < 10) {
        throw new Error(`No data from Sina Finance for ${symbol}`);
      }
      
      const parts = match[1].split(',');
      let price = 0, prevClose = 0, changeAmount = 0, changePercent = 0;
      let high = 0, low = 0, open = 0, volume = 0;
      
      if (format === 'A') { // sh/sz
        price = parseFloat(parts[3]);
        prevClose = parseFloat(parts[2]);
        open = parseFloat(parts[1]);
        high = parseFloat(parts[4]);
        low = parseFloat(parts[5]);
        volume = parseFloat(parts[8]);
        changeAmount = price - prevClose;
      } else if (format === 'B') { // gb_
        price = parseFloat(parts[1]);
        changePercent = parseFloat(parts[2]);
        changeAmount = parseFloat(parts[4]);
        prevClose = price - changeAmount;
        open = parseFloat(parts[5]);
        high = parseFloat(parts[6]);
        low = parseFloat(parts[7]);
      } else if (format === 'C') { // rt_hk
        price = parseFloat(parts[6]);
        prevClose = parseFloat(parts[3]);
        open = parseFloat(parts[2]);
        high = parseFloat(parts[4]);
        low = parseFloat(parts[5]);
        changeAmount = price - prevClose;
      }

      if (format !== 'B') {
        changePercent = prevClose ? (changeAmount / prevClose) * 100 : 0;
      }
      
      let currency = 'USD';
      if (format === 'A') currency = 'CNY';
      else if (format === 'C') currency = 'HKD';

      quote = {
        symbol: symbol,
        price,
        changeAmount,
        changePercent,
        high: high || 0,
        low: low || 0,
        volume: volume || 0,
        prevClose,
        open: open || 0,
        latestTradingDay: new Date().toISOString().split('T')[0],
        currency: currency
      };
    }  

    // C) Finnhub API (Forex & Crypto fallback)
    if (!quote && (symbol.startsWith('OANDA:') || symbol.startsWith('BINANCE:') || symbol.startsWith('CRYPTO:'))) {
      const stmt = await db.prepare("SELECT value FROM user_settings WHERE key = 'finnhub_api_key'").first();
      const finnhubKey = stmt ? stmt.value : '';
      
      if (finnhubKey) {
        try {
          const finnhubUrl = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${finnhubKey}`;
          const finnhubResp = await fetch(finnhubUrl);
          if (finnhubResp.ok) {
            const finnhubData = await finnhubResp.json();
            if (finnhubData && (finnhubData.c !== 0 || finnhubData.pc !== 0)) {
              quote = {
                symbol: symbol,
                price: finnhubData.c,
                changeAmount: finnhubData.d || (finnhubData.c - finnhubData.pc),
                changePercent: finnhubData.dp || (finnhubData.pc ? ((finnhubData.c - finnhubData.pc) / finnhubData.pc * 100) : 0),
                high: finnhubData.h || 0,
                low: finnhubData.l || 0,
                volume: 0,
                prevClose: finnhubData.pc,
                open: finnhubData.o || finnhubData.pc,
                latestTradingDay: new Date().toISOString().split('T')[0],
                currency: 'USD'
              };
            }
          }
        } catch (e) {
          console.warn(`[StockAPI] Finnhub fallback failed for ${symbol}:`, e.message);
        }
      }
    }

    if (!quote) {
      throw new Error(`No quote data found for symbol: ${symbol}`);
    }

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
        quote.symbol,
        quote.price,
        quote.changeAmount,
        quote.changePercent,
        quote.high,
        quote.low,
        quote.volume,
        quote.prevClose,
        quote.currency || null,
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
  } catch (error) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
