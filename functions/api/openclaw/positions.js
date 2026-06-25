/**
 * @fileoverview OpenClaw positions listing.
 *
 * Route:
 *   GET /api/openclaw/positions — list positions with optional filters
 *
 * Query parameters:
 *   market  (optional) — A_SHARE | HK | US | SWISS
 *   status  (optional) — OPEN | CLOSED (default: OPEN)
 *
 * Returns simplified position objects with per-position PnL computed
 * using cached quotes and exchange rates. Internal fields (created_at,
 * updated_at, tags, etc.) are stripped from the response.
 */

// ────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────

const MARKET_CURRENCY = { A_SHARE: 'CNY', HK: 'HKD', US: 'USD', SWISS: 'CHF' };

const VALID_MARKETS = new Set(['A_SHARE', 'HK', 'US', 'SWISS']);
const VALID_STATUSES = new Set(['OPEN', 'CLOSED']);

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

/**
 * Load cached quotes into a Map keyed by symbol.
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
// GET /api/openclaw/positions
// ────────────────────────────────────────────────────────────

/**
 * List positions with optional filters, enriched with cached quote data.
 * @param {EventContext} context
 */
export async function onRequestGet({ env, request }) {
  const db = env.DB;
  const url = new URL(request.url);

  // ── Parse & validate query params ─────────────────────────
  const marketParam = url.searchParams.get('market');
  const statusParam = url.searchParams.get('status');

  const market = marketParam ? marketParam.toUpperCase() : null;
  const status = statusParam ? statusParam.toUpperCase() : 'OPEN';

  if (market && !VALID_MARKETS.has(market)) {
    return Response.json({
      success: false,
      error: `Invalid market. Allowed: ${[...VALID_MARKETS].join(', ')}`,
      meta: { timestamp: new Date().toISOString(), version: 'v1' },
    }, { status: 400 });
  }

  if (!VALID_STATUSES.has(status)) {
    return Response.json({
      success: false,
      error: `Invalid status. Allowed: ${[...VALID_STATUSES].join(', ')}`,
      meta: { timestamp: new Date().toISOString(), version: 'v1' },
    }, { status: 400 });
  }

  // ── Build query ───────────────────────────────────────────
  let sql = 'SELECT * FROM positions WHERE status = ?1';
  const binds = [status];
  let paramIdx = 2;

  if (market) {
    sql += ` AND market = ?${paramIdx++}`;
    binds.push(market);
  }

  sql += ' ORDER BY open_date DESC';

  const { results: positions } = await (
    db.prepare(sql).bind(...binds)
  ).all();

  // ── Load cached quotes & rates in parallel ────────────────
  const [quoteMap, rates] = await Promise.all([
    loadQuoteMap(db),
    loadRates(db),
  ]);

  // ── Transform positions ───────────────────────────────────
  const data = (positions ?? []).map((pos) => {
    const currency = MARKET_CURRENCY[pos.market] || 'CNY';
    const rateToCNY = rates[currency] ?? 1;

    const quote = quoteMap.get(pos.symbol);
    const currentPrice = quote ? Number(quote.price) : null;

    // Cost uses the rate recorded at purchase time
    const costCNY = pos.quantity * pos.open_price * (pos.open_rate_to_cny || rateToCNY);

    // Value uses current exchange rate; falls back to cost if no quote
    const valueCNY = currentPrice !== null
      ? pos.quantity * currentPrice * rateToCNY
      : costCNY;

    const pnlCNY = valueCNY - costCNY;
    const pnlPercent = costCNY > 0
      ? Number(((pnlCNY / costCNY) * 100).toFixed(2))
      : 0;

    return {
      symbol: pos.symbol,
      name: pos.name,
      market: pos.market,
      currency,
      quantity: pos.quantity,
      openPrice: pos.open_price,
      currentPrice,
      costCNY: Number(costCNY.toFixed(2)),
      valueCNY: Number(valueCNY.toFixed(2)),
      pnlCNY: Number(pnlCNY.toFixed(2)),
      pnlPercent,
      openDate: pos.open_date,
      status: pos.status,
    };
  });

  return Response.json({
    success: true,
    data,
    count: data.length,
    meta: { timestamp: new Date().toISOString(), version: 'v1' },
  });
}
