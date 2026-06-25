/**
 * @fileoverview OpenClaw portfolio overview.
 *
 * Route:
 *   GET /api/openclaw/portfolio — simplified portfolio summary
 *
 * This endpoint is READ-ONLY and intended for external consumption
 * (MCP clients, dashboards, etc.). It uses only cached data — no live
 * price fetches or external API calls are made.
 *
 * Calculation approach:
 *   1. Load all OPEN positions
 *   2. Match with cached quotes from `quote_cache`
 *   3. Convert to CNY using cached `exchange_rates` (with hardcoded fallbacks)
 *   4. Attach YTD data from the latest `portfolio_snapshots` row
 */

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

/** Market → native currency mapping */
const MARKET_CURRENCY = { A_SHARE: 'CNY', HK: 'HKD', US: 'USD', SWISS: 'CHF' };

/**
 * Fallback exchange rates (foreign-currency → CNY).
 * Used when `exchange_rates` table has no cached value.
 */
const FALLBACK_RATES = {
  USD: 7.2,    // 1 USD = 7.2 CNY (1/0.1389 ≈ 7.2)
  HKD: 0.923,  // 1 HKD ≈ 0.923 CNY (1/1.0833 ≈ 0.923)
  CHF: 8.103,  // 1 CHF ≈ 8.103 CNY (1/0.1234 ≈ 8.103)
  CNY: 1,
};

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Load exchange rates from DB, merging with fallbacks.
 * The DB stores rates as "base → target", but we need "X → CNY".
 * We look for rows where target_currency = 'CNY'.
 * @param {D1Database} db
 * @returns {Promise<Record<string, number>>} currency → CNY rate
 */
async function loadRates(db) {
  const rates = { ...FALLBACK_RATES };

  const { results } = await db.prepare(
    "SELECT base_currency, rate FROM exchange_rates WHERE target_currency = 'CNY'"
  ).all();

  for (const row of results ?? []) {
    rates[row.base_currency] = Number(row.rate);
  }

  return rates;
}

/**
 * Build a keyed map of cached quotes: symbol → quote row.
 * @param {D1Database} db
 * @returns {Promise<Map<string, object>>}
 */
async function loadQuoteMap(db) {
  const { results } = await db.prepare('SELECT * FROM quote_cache').all();
  const map = new Map();
  for (const row of results ?? []) {
    map.set(row.symbol, row);
  }
  return map;
}

// ────────────────────────────────────────────────────────────
// GET /api/openclaw/portfolio
// ────────────────────────────────────────────────────────────

/**
 * Return a simplified portfolio overview.
 * @param {EventContext} context
 */
export async function onRequestGet({ env }) {
  const db = env.DB;

  // 1. All OPEN positions
  const { results: positions } = await db.prepare(
    "SELECT * FROM positions WHERE status = 'OPEN'"
  ).all();

  // 2. Cached quotes & exchange rates (parallel)
  const [quoteMap, rates] = await Promise.all([
    loadQuoteMap(db),
    loadRates(db),
  ]);

  // 3. Aggregate per-position values
  let totalValueCNY = 0;
  let totalCostCNY = 0;

  /** @type {Record<string, { count: number, valueCNY: number, pnlCNY: number }>} */
  const markets = {};

  let latestQuoteTime = null;

  for (const pos of positions ?? []) {
    const currency = MARKET_CURRENCY[pos.market] || 'CNY';
    const rateToCNY = rates[currency] ?? 1;

    // Cost in CNY: quantity × openPrice × open_rate_to_cny
    // If open_rate_to_cny is stored, prefer it (it's the rate at time of purchase).
    // For current value, we use the live rate.
    const costCNY = pos.quantity * pos.open_price * (pos.open_rate_to_cny || rateToCNY);

    // Current value: use cached quote price, fall back to open price
    const quote = quoteMap.get(pos.symbol);
    const currentPrice = quote ? Number(quote.price) : pos.open_price;
    const valueCNY = pos.quantity * currentPrice * rateToCNY;

    totalCostCNY += costCNY;
    totalValueCNY += valueCNY;

    // Track per-market stats
    const mkt = pos.market || 'OTHER';
    if (!markets[mkt]) {
      markets[mkt] = { count: 0, valueCNY: 0, pnlCNY: 0 };
    }
    markets[mkt].count += 1;
    markets[mkt].valueCNY += valueCNY;
    markets[mkt].pnlCNY += valueCNY - costCNY;

    // Track most recent quote update
    if (quote && quote.updated_at) {
      if (!latestQuoteTime || quote.updated_at > latestQuoteTime) {
        latestQuoteTime = quote.updated_at;
      }
    }
  }

  const totalPnlCNY = totalValueCNY - totalCostCNY;
  const totalPnlPercent = totalCostCNY > 0
    ? Number(((totalPnlCNY / totalCostCNY) * 100).toFixed(2))
    : 0;

  // Round market-level values
  for (const key of Object.keys(markets)) {
    markets[key].valueCNY = Number(markets[key].valueCNY.toFixed(2));
    markets[key].pnlCNY = Number(markets[key].pnlCNY.toFixed(2));
  }

  // 4. YTD data from latest snapshot
  const snapshot = await db.prepare(
    "SELECT * FROM portfolio_snapshots WHERE market = 'ALL' ORDER BY snapshot_date DESC LIMIT 1"
  ).first();

  return Response.json({
    success: true,
    data: {
      totalValueCNY: Number(totalValueCNY.toFixed(2)),
      totalCostCNY: Number(totalCostCNY.toFixed(2)),
      totalPnlCNY: Number(totalPnlCNY.toFixed(2)),
      totalPnlPercent,
      ytdPnlCNY: snapshot ? Number(snapshot.ytd_pnl_cny) : null,
      positionCount: (positions ?? []).length,
      markets,
      lastUpdated: latestQuoteTime || new Date().toISOString(),
    },
    meta: { timestamp: new Date().toISOString(), version: 'v1' },
  });
}
