/**
 * @fileoverview GET /api/summary
 *
 * Returns a global portfolio summary across all markets.
 * - Fetches live exchange rates from Frankfurter
 * - Directly fetches live prices from Yahoo Finance for all open positions
 * - Stores fetched prices into quote_cache for reuse by other endpoints
 * - Computes PnL in CNY using live rates
 */

import {
  computePortfolioPerformance,
  marketCurrency,
  round2,
  getYYYYMMDD,
  getMarketTodayYMD,
} from '../../../lib/agent-common.js';

/** Translate legacy Alpha Vantage symbol suffixes → Yahoo Finance format */
function toYahooSymbol(sym) {
  const s = (sym || '').toUpperCase();
  if (s.endsWith('.HKG')) return s.replace('.HKG', '.HK');
  if (s.endsWith('.SHH')) return s.replace('.SHH', '.SS');
  if (s.endsWith('.SHZ')) return s.replace('.SHZ', '.SZ');
  if (s.endsWith('.SWX')) return s.replace('.SWX', '.SW');
  return s;
}

/**
 * Fetch a single quote from Yahoo Finance chart API.
 * Returns { price, prevClose, currency, marketDate } or null on failure.
 */
async function fetchYahooQuote(yfSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?region=US&lang=en-US&includePrePost=false&interval=1d&range=1d`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || !meta.regularMarketPrice) return null;

    let marketDate = null;
    if (meta.regularMarketTime) {
      const tz = meta.exchangeTimezoneName || 'Asia/Shanghai';
      try {
        const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
        marketDate = fmt.format(new Date(meta.regularMarketTime * 1000));
      } catch {
        marketDate = new Date(meta.regularMarketTime * 1000).toISOString().slice(0, 10);
      }
    }

    return {
      price:      meta.regularMarketPrice,
      prevClose:  meta.chartPreviousClose || meta.regularMarketPrice,
      currency:   meta.currency || '',
      marketDate: marketDate,
    };
  } catch {
    return null;
  }
}


/**
 * GET handler — global portfolio summary.
 * @param {EventContext} context
 */
export async function onRequestGet(context) {
  const { env } = context;

  // ── 1. Fetch live exchange rates (CNY base) ─────────────────────────
  // rates = { USD: 0.1389, HKD: 1.0833, CHF: 0.1234 }  (1 CNY = X foreign)
  let rates = { USD: 0.1389, HKD: 1.0833, CHF: 0.1234 };
  try {
    const rateRes = await fetch('https://api.frankfurter.dev/v1/latest?base=CNY&symbols=USD,HKD,CHF');
    if (rateRes.ok) {
      const rateData = await rateRes.json();
      if (rateData.rates) rates = { ...rates, ...rateData.rates };
    }
  } catch (e) {
    console.warn('[summary] Exchange rate fetch failed, using fallback:', e.message);
  }

  // Helper: convert any amount in `currency` to CNY
  function toCNY(amount, currency) {
    if (!currency || currency === 'CNY') return amount;
    const r = rates[currency];
    return r ? amount / r : amount;
  }

  // ── 2. Load all open & this year's closed positions from DB ─────────
  const currentYearStr = new Date().getFullYear().toString();
  const { results: positions } = await env.DB.prepare(
    `SELECT * FROM positions 
     WHERE status = 'OPEN' 
        OR (status = 'CLOSED' AND close_date >= '${currentYearStr}-01-01')
     ORDER BY market, open_date DESC`,
  ).all();

  if (!positions || positions.length === 0) {
    return Response.json({
      success: true,
      data: {
        totalValueCNY: 0, totalCostCNY: 0, totalPnlCNY: 0,
        totalPnlPercent: 0, positionCount: 0,
        marketCounts: {}, markets: {}, marketSummaries: {},
        positions: [], exchangeRates: rates,
      },
    });
  }

  // Load all trades for active positions to compute lot-level returns
  const posIds = positions.map(p => `'${p.id}'`).join(',');
  let allTrades = [];
  if (posIds) {
    const { results } = await env.DB.prepare(
      `SELECT * FROM trades WHERE position_id IN (${posIds}) ORDER BY trade_date ASC, created_at ASC`
    ).all();
    allTrades = results || [];
  }
  
  const tradesByPosition = {};
  for (const t of allTrades) {
    if (!tradesByPosition[t.position_id]) tradesByPosition[t.position_id] = [];
    tradesByPosition[t.position_id].push(t);
  }

/**
 * Fetch YTD price from Yahoo Finance chart API.
 */
async function fetchYtdPrice(yfSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?region=US&lang=en-US&includePrePost=false&interval=1d&range=ytd`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta || meta.chartPreviousClose == null) return null;
    return meta.chartPreviousClose;
  } catch {
    return null;
  }
}

/**
 * Fetch MTD (Month-To-Date) baseline price (closing price of the previous natural month)
 * for a given symbol from Yahoo Finance, accurately respecting the exchange's local timezone.
 */
async function fetchMtdPrice(yfSymbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yfSymbol)}?region=US&lang=en-US&includePrePost=false&interval=1d&range=2mo`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]?.close) return null;

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;
    const timeZone = result.meta?.exchangeTimezoneName || 'Asia/Shanghai';

    const now = new Date();
    const currentFmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' });
    const currentParts = currentFmt.formatToParts(now);
    let curYear = now.getFullYear();
    let curMonth = now.getMonth();
    for (const p of currentParts) {
      if (p.type === 'year') curYear = parseInt(p.value, 10);
      if (p.type === 'month') curMonth = parseInt(p.value, 10) - 1;
    }

    const candleFmt = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' });

    let prevMonthClose = null;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (closes[i] == null) continue;
      const cDate = new Date(timestamps[i] * 1000);
      const cParts = candleFmt.formatToParts(cDate);
      let cYear = cDate.getFullYear();
      let cMonth = cDate.getMonth();
      for (const p of cParts) {
        if (p.type === 'year') cYear = parseInt(p.value, 10);
        if (p.type === 'month') cMonth = parseInt(p.value, 10) - 1;
      }

      if (cYear < curYear || (cYear === curYear && cMonth < curMonth)) {
        prevMonthClose = closes[i];
        break;
      }
    }
    return prevMonthClose;
  } catch {
    return null;
  }
}

  // Current natural month & year keys for cache validation
  const nowForKeys = new Date();
  const currentMonthKey = `${nowForKeys.getFullYear()}-${String(nowForKeys.getMonth() + 1).padStart(2, '0')}`;
  const currentYearNum = nowForKeys.getFullYear();
  const currentMonthStartStr = `${currentMonthKey}-01`;

  // ── 3. Fetch live quotes, YTD & MTD prices in parallel ────────────
  // Deduplicate symbols
  const uniqueSymbols = [...new Set(positions.map(p => p.symbol))];
  
  // Pre-load ytd_price & mtd_price from cache (validating against current year/month)
  let cachedYtdMap = new Map();
  let cachedMtdMap = new Map();
  if (uniqueSymbols.length > 0) {
    const symbolsList = uniqueSymbols.map(s => `'${s}'`).join(',');
    try {
      const { results: cachedQuotes } = await env.DB.prepare(
        `SELECT symbol, ytd_price, mtd_price, mtd_month, ytd_year FROM quote_cache WHERE symbol IN (${symbolsList})`
      ).all();
      for (const row of cachedQuotes || []) {
        if (row.ytd_price != null && row.ytd_year === currentYearNum) {
          cachedYtdMap.set(row.symbol, row.ytd_price);
        }
        if (row.mtd_price != null && row.mtd_month === currentMonthKey) {
          cachedMtdMap.set(row.symbol, row.mtd_price);
        }
      }
    } catch (e) {
      console.warn('[summary] Failed to read quote_cache:', e.message);
      // Auto-migrate missing columns if D1 table schema is outdated
      if (e.message && (e.message.includes('mtd_month') || e.message.includes('ytd_year') || e.message.includes('mtd_price') || e.message.includes('ytd_price'))) {
        try {
          await env.DB.prepare("ALTER TABLE quote_cache ADD COLUMN mtd_month TEXT").run().catch(() => {});
          await env.DB.prepare("ALTER TABLE quote_cache ADD COLUMN ytd_year INTEGER").run().catch(() => {});
          await env.DB.prepare("ALTER TABLE quote_cache ADD COLUMN mtd_price REAL").run().catch(() => {});
          await env.DB.prepare("ALTER TABLE quote_cache ADD COLUMN ytd_price REAL").run().catch(() => {});
          console.log('[summary] Auto-added missing mtd_month/ytd_year columns to quote_cache');
        } catch (alterErr) {
          console.warn('[summary] Failed to auto-migrate quote_cache schema:', alterErr.message);
        }
      }
    }
  }

  const quoteResults = await Promise.all(
    uniqueSymbols.map(async (sym) => {
      const yfSym = toYahooSymbol(sym);
      const quotePromise = fetchYahooQuote(yfSym);
      let ytdPricePromise = Promise.resolve(cachedYtdMap.get(sym.toUpperCase()));
      let mtdPricePromise = Promise.resolve(cachedMtdMap.get(sym.toUpperCase()));
      
      if (!cachedYtdMap.has(sym.toUpperCase())) {
        ytdPricePromise = fetchYtdPrice(yfSym);
      }
      if (!cachedMtdMap.has(sym.toUpperCase())) {
        mtdPricePromise = fetchMtdPrice(yfSym);
      }
      
      const [quote, ytdPrice, mtdPrice] = await Promise.all([quotePromise, ytdPricePromise, mtdPricePromise]);
      return { sym, yfSym, quote, ytdPrice, mtdPrice };
    })
  );

  // Build quote map: original_symbol → quote data
  const quoteMap = new Map();
  for (const { sym, yfSym, quote, ytdPrice, mtdPrice } of quoteResults) {
    if (quote) {
      quote.ytdPrice = ytdPrice;
      quote.mtdPrice = mtdPrice;
      quoteMap.set(sym.toUpperCase(), quote);
      // Also save to quote_cache for other endpoints (fire and forget)
      try {
        await env.DB.prepare(
          `INSERT INTO quote_cache (symbol, price, change_amount, change_percent, high, low, volume, prev_close, ytd_price, mtd_price, mtd_month, ytd_year, currency, updated_at)
           VALUES (?1, ?2, ?3, ?4, 0, 0, 0, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now'))
           ON CONFLICT(symbol) DO UPDATE SET
             price = excluded.price,
             change_amount = excluded.change_amount,
             change_percent = excluded.change_percent,
             prev_close = excluded.prev_close,
             ytd_price = excluded.ytd_price,
             mtd_price = excluded.mtd_price,
             mtd_month = excluded.mtd_month,
             ytd_year = excluded.ytd_year,
             currency = excluded.currency,
             updated_at = datetime('now')`,
        ).bind(
          sym.toUpperCase(),
          quote.price,
          round2(quote.price - quote.prevClose),
          quote.prevClose ? round2(((quote.price - quote.prevClose) / quote.prevClose) * 100) : 0,
          quote.prevClose,
          ytdPrice,
          mtdPrice,
          currentMonthKey,
          currentYearNum,
          quote.currency,
        ).run();
      } catch (e) {
        if (e.message && (e.message.includes('no such column: mtd_price') || e.message.includes('no such column: ytd_price') || e.message.includes('no such column: mtd_month') || e.message.includes('no such column: ytd_year'))) {
          try {
            await env.DB.prepare("ALTER TABLE quote_cache ADD COLUMN mtd_month TEXT").run().catch(() => {});
            await env.DB.prepare("ALTER TABLE quote_cache ADD COLUMN ytd_year INTEGER").run().catch(() => {});
            await env.DB.prepare("ALTER TABLE quote_cache ADD COLUMN mtd_price REAL").run().catch(() => {});
            await env.DB.prepare("ALTER TABLE quote_cache ADD COLUMN ytd_price REAL").run().catch(() => {});
            // Retry insert once
            await env.DB.prepare(
              `INSERT INTO quote_cache (symbol, price, change_amount, change_percent, high, low, volume, prev_close, ytd_price, mtd_price, mtd_month, ytd_year, currency, updated_at)
               VALUES (?1, ?2, ?3, ?4, 0, 0, 0, ?5, ?6, ?7, ?8, ?9, ?10, datetime('now'))
               ON CONFLICT(symbol) DO UPDATE SET
                 price = excluded.price,
                 change_amount = excluded.change_amount,
                 change_percent = excluded.change_percent,
                 prev_close = excluded.prev_close,
                 ytd_price = excluded.ytd_price,
                 mtd_price = excluded.mtd_price,
                 mtd_month = excluded.mtd_month,
                 ytd_year = excluded.ytd_year,
                 currency = excluded.currency,
                 updated_at = datetime('now')`,
            ).bind(
              sym.toUpperCase(),
              quote.price,
              round2(quote.price - quote.prevClose),
              quote.prevClose ? round2(((quote.price - quote.prevClose) / quote.prevClose) * 100) : 0,
              quote.prevClose,
              ytdPrice,
              mtdPrice,
              currentMonthKey,
              currentYearNum,
              quote.currency,
            ).run();
          } catch (retryErr) {
            console.warn('[summary] Failed to update quote_cache after column auto-migration for', sym, retryErr.message);
          }
        } else {
          console.warn('[summary] Failed to update quote_cache for', sym, e.message);
        }
      }
    }
  }

  // ── 4. Compute portfolio summary (using shared pure function) ───────
  const {
    totalValueCNY,
    totalCostCNY,
    totalPnlCNY,
    totalPnlPercent,
    totalDayPnL,
    portfolioYtdPnlCNY,
    portfolioYtdPercent,
    portfolioMtdPnlCNY,
    totalMonthlyReturn,
    totalAvgHoldingDays,
    totalAnnualizedReturn,
    marketBreakdown,
    markets,
    positionDetails,
  } = computePortfolioPerformance({
    positions,
    tradesByPosition,
    quoteMap,
    rates,
    now: nowForKeys,
  });

  // ── 6. Write daily snapshot (fire and forget) ───────────────────────
  const today = new Date().toISOString().split('T')[0];
  try {
    const snapshotStmts = [];
    // Per-market snapshots
    for (const [mkt, data] of Object.entries(marketBreakdown)) {
      snapshotStmts.push(
        env.DB.prepare(
          `INSERT INTO portfolio_snapshots (snapshot_date, market, total_value_cny, total_cost_cny, total_pnl_cny, ytd_pnl_cny, position_count)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
           ON CONFLICT(snapshot_date, market) DO UPDATE SET
             total_value_cny = excluded.total_value_cny,
             total_cost_cny  = excluded.total_cost_cny,
             total_pnl_cny   = excluded.total_pnl_cny,
             ytd_pnl_cny     = excluded.ytd_pnl_cny,
             position_count  = excluded.position_count`
        ).bind(today, mkt, round2(data.value), round2(data.cost), round2(data.pnl), round2(data.ytdPnl), data.count)
      );
    }
    // ALL summary snapshot
    snapshotStmts.push(
      env.DB.prepare(
        `INSERT INTO portfolio_snapshots (snapshot_date, market, total_value_cny, total_cost_cny, total_pnl_cny, ytd_pnl_cny, position_count)
         VALUES (?1, 'ALL', ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(snapshot_date, market) DO UPDATE SET
           total_value_cny = excluded.total_value_cny,
           total_cost_cny  = excluded.total_cost_cny,
           total_pnl_cny   = excluded.total_pnl_cny,
           ytd_pnl_cny     = excluded.ytd_pnl_cny,
           position_count  = excluded.position_count`
      ).bind(today, round2(totalValueCNY), round2(totalCostCNY), totalPnlCNY, portfolioYtdPnlCNY, positionDetails.length)
    );
    await env.DB.batch(snapshotStmts);
  } catch (e) {
    console.warn('[summary] Failed to write snapshots:', e.message);
  }

  return Response.json(
    {
      success: true,
      data: {
        totalValueCNY:  round2(totalValueCNY),
        totalCostCNY:   round2(totalCostCNY),
        totalPnlCNY,
        totalPnlPercent,
        totalAvgHoldingDays,
        totalAnnualizedReturn,
        totalMonthlyReturn,
        portfolioYtdPnlCNY,
        portfolioYtdPercent,
        portfolioMtdPnlCNY,
        dayPnl:         round2(totalDayPnL),
        positionCount:  positionDetails.length,
        marketCounts:   Object.fromEntries(Object.entries(marketBreakdown).map(([m, d]) => [m, d.count])),
        markets,
        marketSummaries: markets,
        positions:       positionDetails,
        exchangeRates:   rates,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
