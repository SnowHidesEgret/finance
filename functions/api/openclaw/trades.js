/**
 * OpenClaw API — Trades Endpoint
 * GET /api/openclaw/trades
 *
 * Returns paginated trade records with optional filters:
 *   symbol, market, type, from, to, limit, offset
 *
 * Ordered by trade_date DESC.
 */

const VALID_MARKETS = new Set(['A_SHARE', 'HK', 'US', 'SWISS']);
const VALID_TYPES = new Set(['BUY', 'SELL']);
const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);

  try {
    // ── Parse & validate query params ──────────────────────────────
    const symbol = url.searchParams.get('symbol')?.toUpperCase() || null;
    const market = url.searchParams.get('market')?.toUpperCase() || null;
    const type = url.searchParams.get('type')?.toUpperCase() || null;
    const from = url.searchParams.get('from') || null;
    const to = url.searchParams.get('to') || null;

    let limit = parseInt(url.searchParams.get('limit') || DEFAULT_LIMIT, 10);
    let offset = parseInt(url.searchParams.get('offset') || 0, 10);

    if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    if (isNaN(offset) || offset < 0) offset = 0;

    if (market && !VALID_MARKETS.has(market)) {
      return Response.json(
        { success: false, error: `Invalid market. Must be one of: ${[...VALID_MARKETS].join(', ')}`, meta: { timestamp: new Date().toISOString(), version: 'v1' } },
        { status: 400 }
      );
    }
    if (type && !VALID_TYPES.has(type)) {
      return Response.json(
        { success: false, error: `Invalid type. Must be one of: ${[...VALID_TYPES].join(', ')}`, meta: { timestamp: new Date().toISOString(), version: 'v1' } },
        { status: 400 }
      );
    }

    // ── Build dynamic WHERE clause ─────────────────────────────────
    const conditions = [];
    const params = [];

    if (symbol) {
      conditions.push('symbol = ?');
      params.push(symbol);
    }
    if (market) {
      conditions.push('market = ?');
      params.push(market);
    }
    if (type) {
      conditions.push('trade_type = ?');
      params.push(type);
    }
    if (from) {
      conditions.push('trade_date >= ?');
      params.push(from);
    }
    if (to) {
      conditions.push('trade_date <= ?');
      params.push(to);
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    // ── Run data + count queries in parallel ───────────────────────
    const dataSQL = `
      SELECT symbol, name, market, trade_type, price, quantity,
             commission, currency, trade_date, notes
      FROM trades
      ${whereClause}
      ORDER BY trade_date DESC
      LIMIT ? OFFSET ?
    `;
    const countSQL = `SELECT COUNT(*) AS total FROM trades ${whereClause}`;

    const [dataResult, countResult] = await Promise.all([
      env.DB.prepare(dataSQL).bind(...params, limit, offset).all(),
      env.DB.prepare(countSQL).bind(...params).first(),
    ]);

    // ── Shape response ─────────────────────────────────────────────
    const trades = (dataResult.results || []).map((row) => ({
      symbol: row.symbol,
      name: row.name,
      market: row.market,
      type: row.trade_type,
      price: row.price,
      quantity: row.quantity,
      commission: row.commission,
      currency: row.currency,
      date: row.trade_date,
      notes: row.notes || null,
    }));

    return Response.json({
      success: true,
      data: trades,
      count: trades.length,
      total: countResult?.total ?? 0,
      meta: { timestamp: new Date().toISOString(), version: 'v1' },
    });
  } catch (err) {
    console.error('OpenClaw trades error:', err);
    return Response.json(
      { success: false, error: 'Internal server error', meta: { timestamp: new Date().toISOString(), version: 'v1' } },
      { status: 500 }
    );
  }
}
