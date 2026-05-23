/**
 * @fileoverview GET /api/summary
 *
 * Returns a global portfolio summary across all markets.
 * - Fetches live exchange rates (CNY base) from Frankfurter
 * - Translates legacy AV symbol suffixes to Yahoo Finance format for quote lookup
 * - Computes current values and PnL in CNY using live rates
 */

/** Translate legacy Alpha Vantage symbol suffixes to Yahoo Finance format */
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
 * GET handler — global portfolio summary.
 * @param {EventContext} context
 */
export async function onRequestGet(context) {
  const { env } = context;

  // ── 1. Fetch live exchange rates (CNY base) ─────────────────────────
  // rates = { USD: 0.1389, HKD: 1.0833, CHF: 0.1234 }  (how many foreign per 1 CNY)
  let rates = { USD: 0.1389, HKD: 1.0833, CHF: 0.1234 };
  try {
    const rateRes = await fetch('https://api.frankfurter.dev/v1/latest?base=CNY&symbols=USD,HKD,CHF');
    if (rateRes.ok) {
      const rateData = await rateRes.json();
      rates = { ...rates, ...rateData.rates };
    }
  } catch (e) {
    console.warn('[summary] Exchange rate fetch failed, using fallback:', e.message);
  }

  // 1 USD → CNY = 1 / rates.USD, etc.
  function toCNY(amount, currency) {
    if (currency === 'CNY' || !currency) return amount;
    const r = rates[currency];
    return r ? amount / r : amount;
  }

  // ── 2. Load positions with quote cache (using Yahoo-format join) ─────
  // We need to join on both the original symbol AND the translated symbol
  const { results } = await env.DB.prepare(
    `SELECT
       p.*,
       COALESCE(
         (SELECT price FROM quote_cache WHERE UPPER(symbol) = UPPER(p.symbol) LIMIT 1),
         (SELECT price FROM quote_cache WHERE UPPER(symbol) = UPPER(
           CASE
             WHEN UPPER(p.symbol) LIKE '%.HKG' THEN REPLACE(UPPER(p.symbol), '.HKG', '.HK')
             WHEN UPPER(p.symbol) LIKE '%.SHH' THEN REPLACE(UPPER(p.symbol), '.SHH', '.SS')
             WHEN UPPER(p.symbol) LIKE '%.SHZ' THEN REPLACE(UPPER(p.symbol), '.SHZ', '.SZ')
             WHEN UPPER(p.symbol) LIKE '%.SWX' THEN REPLACE(UPPER(p.symbol), '.SWX', '.SW')
             ELSE UPPER(p.symbol)
           END
         ) LIMIT 1)
       ) AS quote_price,
       COALESCE(
         (SELECT updated_at FROM quote_cache WHERE UPPER(symbol) = UPPER(p.symbol) LIMIT 1),
         (SELECT updated_at FROM quote_cache WHERE UPPER(symbol) = UPPER(
           CASE
             WHEN UPPER(p.symbol) LIKE '%.HKG' THEN REPLACE(UPPER(p.symbol), '.HKG', '.HK')
             WHEN UPPER(p.symbol) LIKE '%.SHH' THEN REPLACE(UPPER(p.symbol), '.SHH', '.SS')
             WHEN UPPER(p.symbol) LIKE '%.SHZ' THEN REPLACE(UPPER(p.symbol), '.SHZ', '.SZ')
             WHEN UPPER(p.symbol) LIKE '%.SWX' THEN REPLACE(UPPER(p.symbol), '.SWX', '.SW')
             ELSE UPPER(p.symbol)
           END
         ) LIMIT 1)
       ) AS quote_updated_at
     FROM positions p
     WHERE p.status = 'OPEN'
     ORDER BY p.market, p.open_date DESC`,
  ).all();

  const positions = results ?? [];

  if (positions.length === 0) {
    return Response.json({
      success: true,
      data: {
        totalValueCNY: 0,
        totalCostCNY: 0,
        totalPnlCNY: 0,
        totalPnlPercent: 0,
        positionCount: 0,
        marketCounts: {},
        markets: {},
        positions: [],
        exchangeRates: rates,
      },
    });
  }

  // ── 3. Compute summary ──────────────────────────────────────────────
  let totalValueCNY = 0;
  let totalCostCNY  = 0;
  let totalDayPnL   = 0;

  const marketBreakdown = {};
  const positionDetails = [];

  for (const p of positions) {
    // Determine currency from market if not stored
    const currency = p.currency || marketCurrency(p.market);

    // Use live quote price if available, else fall back to open price
    const currentPrice = p.quote_price ?? p.open_price;

    // Live rate: 1 unit of currency → CNY
    const rateToCNY = currency === 'CNY' ? 1 : (rates[currency] ? 1 / rates[currency] : 1);

    // Cost in original currency (open_price stored in the position's own currency)
    const costOriginal  = p.open_price * p.quantity + (p.commission ?? 0);
    const costCNY       = round2(costOriginal * rateToCNY);

    // Market value in CNY using live price and live exchange rate
    const valueOriginal = currentPrice * p.quantity;
    const valueCNY      = round2(valueOriginal * rateToCNY);

    const pnlCNY        = round2(valueCNY - costCNY);
    const pnlPercent    = costCNY !== 0 ? round2((pnlCNY / costCNY) * 100) : 0;

    // Approximate day PnL (requires prev_close from quote_cache - not in join yet, skip)
    const dayPnl = 0;

    totalValueCNY += valueCNY;
    totalCostCNY  += costCNY;
    totalDayPnL   += dayPnl;

    const mkt = p.market;
    if (!marketBreakdown[mkt]) {
      marketBreakdown[mkt] = { value: 0, cost: 0, count: 0, pnl: 0 };
    }
    marketBreakdown[mkt].value += valueCNY;
    marketBreakdown[mkt].cost  += costCNY;
    marketBreakdown[mkt].count += 1;
    marketBreakdown[mkt].pnl   += pnlCNY;

    positionDetails.push({
      ...p,
      currency,
      currentPrice,
      rateToCNY,
      costCNY,
      marketValueCNY: valueCNY,
      pnlCNY,
      pnlPercent,
      quoteUpdatedAt: p.quote_updated_at,
      hasLivePrice: p.quote_price != null,
    });
  }

  // Compute weights
  for (const pd of positionDetails) {
    pd.weight = totalValueCNY > 0 ? round2((pd.marketValueCNY / totalValueCNY) * 100) : 0;
  }

  const totalPnlCNY     = round2(totalValueCNY - totalCostCNY);
  const totalPnlPercent = totalCostCNY !== 0 ? round2((totalPnlCNY / totalCostCNY) * 100) : 0;

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
    };
  }

  return Response.json(
    {
      success: true,
      data: {
        totalValueCNY: round2(totalValueCNY),
        totalCostCNY:  round2(totalCostCNY),
        totalPnlCNY,
        totalPnlPercent,
        dayPnl: round2(totalDayPnL),
        positionCount: positionDetails.length,
        marketCounts: Object.fromEntries(
          Object.entries(marketBreakdown).map(([m, d]) => [m, d.count]),
        ),
        markets,
        marketSummaries: markets,
        positions: positionDetails,
        exchangeRates: rates,
      },
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
