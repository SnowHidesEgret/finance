/**
 * @fileoverview GET /api/summary
 *
 * Returns a global portfolio summary across all markets.
 * - Fetches live exchange rates from Frankfurter
 * - Directly fetches live prices from Yahoo Finance for all open positions
 * - Stores fetched prices into quote_cache for reuse by other endpoints
 * - Computes PnL in CNY using live rates
 */

/** Translate legacy Alpha Vantage symbol suffixes → Yahoo Finance format */
function toYahooSymbol(sym) {
  const s = (sym || '').toUpperCase();
  if (s.endsWith('.HKG')) return s.replace('.HKG', '.HK');
  if (s.endsWith('.SHH')) return s.replace('.SHH', '.SS');
  if (s.endsWith('.SHZ')) return s.replace('.SHZ', '.SZ');
  if (s.endsWith('.SWX')) return s.replace('.SWX', '.SW');
  return s;
}

/** Get the currency for a given market */
function marketCurrency(market) {
  switch (market) {
    case 'US':      return 'USD';
    case 'HK':      return 'HKD';
    case 'SWISS':   return 'CHF';
    case 'A_SHARE': return 'CNY';
    default:        return 'CNY';
  }
}

/** Round to 2 decimal places. */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Fetch a single quote from Yahoo Finance chart API.
 * Returns { price, prevClose, currency } or null on failure.
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
    return {
      price:      meta.regularMarketPrice,
      prevClose:  meta.chartPreviousClose || meta.regularMarketPrice,
      currency:   meta.currency || '',
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

  // ── 2. Load all open positions from DB ──────────────────────────────
  const { results: positions } = await env.DB.prepare(
    `SELECT * FROM positions WHERE status = 'OPEN' ORDER BY market, open_date DESC`,
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

  // ── 3. Fetch live quotes for all symbols in parallel ─────────────────
  // Deduplicate symbols
  const uniqueSymbols = [...new Set(positions.map(p => p.symbol))];
  const quoteResults = await Promise.all(
    uniqueSymbols.map(async (sym) => {
      const yfSym = toYahooSymbol(sym);
      const quote = await fetchYahooQuote(yfSym);
      return { sym, yfSym, quote };
    })
  );

  // Build quote map: original_symbol → quote data
  const quoteMap = new Map();
  for (const { sym, yfSym, quote } of quoteResults) {
    if (quote) {
      quoteMap.set(sym.toUpperCase(), quote);
      // Also save to quote_cache for other endpoints (fire and forget)
      try {
        await env.DB.prepare(
          `INSERT INTO quote_cache (symbol, price, change_amount, change_percent, high, low, volume, prev_close, currency, updated_at)
           VALUES (?1, ?2, ?3, ?4, 0, 0, 0, ?5, ?6, datetime('now'))
           ON CONFLICT(symbol) DO UPDATE SET
             price = excluded.price,
             change_amount = excluded.change_amount,
             change_percent = excluded.change_percent,
             prev_close = excluded.prev_close,
             currency = excluded.currency,
             updated_at = datetime('now')`,
        ).bind(
          sym.toUpperCase(),
          quote.price,
          round2(quote.price - quote.prevClose),
          quote.prevClose ? round2(((quote.price - quote.prevClose) / quote.prevClose) * 100) : 0,
          quote.prevClose,
          quote.currency,
        ).run();
      } catch (e) {
        console.warn('[summary] Failed to update quote_cache for', sym, e.message);
      }
    }
  }

  // ── 4. Compute portfolio summary ────────────────────────────────────
  let totalValueCNY = 0;
  let totalCostCNY  = 0;
  let totalDayPnL   = 0;

  const marketBreakdown = {};
  const positionDetails = [];

  for (const p of positions) {
    const currency = p.currency || marketCurrency(p.market);
    const rateToCNY = currency === 'CNY' ? 1 : (rates[currency] ? 1 / rates[currency] : 1);

    const liveQuote   = quoteMap.get(p.symbol?.toUpperCase());
    const currentPrice = liveQuote?.price ?? p.open_price;
    const prevClose    = liveQuote?.prevClose ?? p.open_price;
    const hasLivePrice = !!liveQuote;

    // Cost in original currency (open_price is in the position's own currency)
    const costOriginal   = p.open_price * p.quantity + (p.commission ?? 0);
    const costCNY        = round2(costOriginal * rateToCNY);

    // Market value in CNY using live price + live exchange rate
    const valueOriginal  = currentPrice * p.quantity;
    const valueCNY       = round2(valueOriginal * rateToCNY);

    const pnlCNY         = round2(valueCNY - costCNY);
    const pnlPercent     = costCNY !== 0 ? round2((pnlCNY / costCNY) * 100) : 0;

    // Day PnL
    const dayChangeCNY   = round2((currentPrice - prevClose) * p.quantity * rateToCNY);

    totalValueCNY += valueCNY;
    totalCostCNY  += costCNY;
    totalDayPnL   += dayChangeCNY;

    const mkt = p.market;
    if (!marketBreakdown[mkt]) {
      marketBreakdown[mkt] = { value: 0, cost: 0, count: 0, pnl: 0, dayPnl: 0 };
    }
    marketBreakdown[mkt].value  += valueCNY;
    marketBreakdown[mkt].cost   += costCNY;
    marketBreakdown[mkt].count  += 1;
    marketBreakdown[mkt].pnl    += pnlCNY;
    marketBreakdown[mkt].dayPnl += dayChangeCNY;

    positionDetails.push({
      ...p,
      currency,
      currentPrice,
      prevClose,
      rateToCNY,
      costCNY,
      marketValueCNY: valueCNY,
      pnlCNY,
      pnlPercent,
      dayPnLCNY: dayChangeCNY,
      hasLivePrice,
      weight: 0, // calculated below
    });
  }

  // Compute weights
  for (const pd of positionDetails) {
    pd.weight = totalValueCNY > 0 ? round2((pd.marketValueCNY / totalValueCNY) * 100) : 0;
  }

  const totalPnlCNY     = round2(totalValueCNY - totalCostCNY);
  const totalPnlPercent = totalCostCNY !== 0 ? round2((totalPnlCNY / totalCostCNY) * 100) : 0;

  // Build per-market stats
  const markets = {};
  for (const [mkt, data] of Object.entries(marketBreakdown)) {
    markets[mkt] = {
      totalValue:    round2(data.value),
      totalCost:     round2(data.cost),
      totalPnL:      round2(data.pnl),
      totalValueCNY: round2(data.value),
      totalCostCNY:  round2(data.cost),
      totalPnlCNY:   round2(data.pnl),
      pnlPercent:    data.cost !== 0 ? round2((data.pnl / data.cost) * 100) : 0,
      positionCount: data.count,
      dayPnL:        round2(data.dayPnl),
    };
  }

  return Response.json(
    {
      success: true,
      data: {
        totalValueCNY:  round2(totalValueCNY),
        totalCostCNY:   round2(totalCostCNY),
        totalPnlCNY,
        totalPnlPercent,
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
