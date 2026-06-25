/**
 * @fileoverview OpenClaw single-position detail.
 *
 * Route:
 *   GET /api/openclaw/position/:symbol — detailed view of one position
 *
 * Returns the position record enriched with:
 *   - Current price from `quote_cache`
 *   - Computed PnL in CNY
 *   - All associated trades from the `trades` table
 *
 * Returns 404 if no position matches the given symbol.
 */

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const MARKET_CURRENCY = { A_SHARE: 'CNY', HK: 'HKD', US: 'USD', SWISS: 'CHF' };

/** Fallback exchange rates: currency → CNY */
const FALLBACK_RATES = {
  USD: 7.2,
  HKD: 0.923,
  CHF: 8.103,
  CNY: 1,
};

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

/**
 * Load exchange rates (X → CNY) from DB, merged with fallbacks.
 * @param {D1Database} db
 * @returns {Promise<Record<string, number>>}
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

// ────────────────────────────────────────────────────────────
// GET /api/openclaw/position/:symbol
// ────────────────────────────────────────────────────────────

/**
 * Get detailed info for a specific position by stock symbol.
 * @param {EventContext} context
 */
export async function onRequestGet({ env, params }) {
  const db = env.DB;
  const symbol = (params.symbol || '').toUpperCase();

  if (!symbol) {
    return Response.json({
      success: false,
      error: 'Symbol is required',
      meta: { timestamp: new Date().toISOString(), version: 'v1' },
    }, { status: 400 });
  }

  // ── Lookup position ───────────────────────────────────────
  const pos = await db.prepare(
    'SELECT * FROM positions WHERE symbol = ?1'
  ).bind(symbol).first();

  if (!pos) {
    return Response.json({
      success: false,
      error: `Position not found: ${symbol}`,
      meta: { timestamp: new Date().toISOString(), version: 'v1' },
    }, { status: 404 });
  }

  // ── Load quote, trades, and exchange rates in parallel ────
  const [quote, tradesResult, rates] = await Promise.all([
    db.prepare('SELECT * FROM quote_cache WHERE symbol = ?1').bind(symbol).first(),
    db.prepare(
      'SELECT * FROM trades WHERE symbol = ?1 ORDER BY trade_date ASC'
    ).bind(symbol).all(),
    loadRates(db),
  ]);

  const currency = MARKET_CURRENCY[pos.market] || 'CNY';
  const rateToCNY = rates[currency] ?? 1;

  const currentPrice = quote ? Number(quote.price) : null;

  // Cost uses the rate recorded at purchase time
  const costCNY = pos.quantity * pos.open_price * (pos.open_rate_to_cny || rateToCNY);

  // Value uses current exchange rate
  const valueCNY = currentPrice !== null
    ? pos.quantity * currentPrice * rateToCNY
    : costCNY;

  const pnlCNY = valueCNY - costCNY;
  const pnlPercent = costCNY > 0
    ? Number(((pnlCNY / costCNY) * 100).toFixed(2))
    : 0;

  // ── Format trades (simplified) ────────────────────────────
  const trades = (tradesResult.results ?? []).map((t) => ({
    type: t.trade_type,
    price: t.price,
    quantity: t.quantity,
    date: t.trade_date,
    commission: t.commission,
    notes: t.notes || undefined,
  }));

  // ── Build response ────────────────────────────────────────
  return Response.json({
    success: true,
    data: {
      symbol: pos.symbol,
      name: pos.name,
      market: pos.market,
      currency,
      quantity: pos.quantity,
      openPrice: pos.open_price,
      openDate: pos.open_date,
      currentPrice,
      costCNY: Number(costCNY.toFixed(2)),
      valueCNY: Number(valueCNY.toFixed(2)),
      pnlCNY: Number(pnlCNY.toFixed(2)),
      pnlPercent,
      sector: pos.sector || null,
      beta: pos.beta != null ? Number(pos.beta) : null,
      notes: pos.notes || null,
      status: pos.status,
      trades,
    },
    meta: { timestamp: new Date().toISOString(), version: 'v1' },
  });
}
