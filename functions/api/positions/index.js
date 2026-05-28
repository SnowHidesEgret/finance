/**
 * @fileoverview
 * GET  /api/positions          — list positions (optional filters: market, status)
 * POST /api/positions          — create a new position
 */

/**
 * Generate a URL-safe unique ID (nano-id style, no dependencies).
 * @returns {string} 21-char random ID
 */
function generateId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(21));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

// ────────────────────────────────────────────────────────────
// GET  /api/positions
// ────────────────────────────────────────────────────────────

/**
 * List positions with optional query-string filters.
 * @param {EventContext} context
 */
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);

  const market = url.searchParams.get('market');   // e.g. A_SHARE
  const status = url.searchParams.get('status');   // OPEN | CLOSED

  let sql = 'SELECT * FROM positions WHERE 1=1';
  /** @type {any[]} */
  const binds = [];
  let paramIdx = 1;

  if (market) {
    sql += ` AND market = ?${paramIdx++}`;
    binds.push(market.toUpperCase());
  }
  if (status) {
    sql += ` AND status = ?${paramIdx++}`;
    binds.push(status.toUpperCase());
  }

  sql += ' ORDER BY open_date DESC';

  const stmt = env.DB.prepare(sql);
  const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();

  const MARKET_CURRENCY = { A_SHARE: 'CNY', HK: 'HKD', US: 'USD', SWISS: 'CHF' };
  const rows = (results ?? []).map(r => ({
    ...r,
    currency: MARKET_CURRENCY[r.market] || 'CNY',
  }));

  return Response.json({
    success: true,
    data: rows,
    count: rows.length,
  });
}

// ────────────────────────────────────────────────────────────
// POST /api/positions
// ────────────────────────────────────────────────────────────

/** Required fields for a new position */
const REQUIRED_FIELDS = ['symbol', 'name', 'market', 'open_date', 'open_price', 'quantity'];

/** Allowed market values */
const VALID_MARKETS = new Set(['A_SHARE', 'HK', 'US', 'SWISS']);

/**
 * Create a new position.
 * @param {EventContext} context
 */
export async function onRequestPost(context) {
  const { env, request } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  // Validate required fields
  const missing = REQUIRED_FIELDS.filter((f) => body[f] == null || body[f] === '');
  if (missing.length) {
    return Response.json(
      { success: false, error: `Missing required fields: ${missing.join(', ')}` },
      { status: 400 },
    );
  }

  const market = String(body.market).toUpperCase();
  if (!VALID_MARKETS.has(market)) {
    return Response.json(
      { success: false, error: `Invalid market. Allowed: ${[...VALID_MARKETS].join(', ')}` },
      { status: 400 },
    );
  }

  if (Number(body.open_price) <= 0) {
    return Response.json(
      { success: false, error: 'open_price must be a positive number' },
      { status: 400 },
    );
  }

  if (Number(body.quantity) <= 0) {
    return Response.json(
      { success: false, error: 'quantity must be a positive number' },
      { status: 400 },
    );
  }

  const id = generateId();
  const tradeId = generateId();
  const now = new Date().toISOString();
  const symbolUpper = String(body.symbol).toUpperCase();

  // Check if there is an existing OPEN position for this symbol
  const existing = await env.DB.prepare('SELECT * FROM positions WHERE symbol = ?1 AND status = \'OPEN\'')
    .bind(symbolUpper)
    .first();

  let posStmt;
  let targetPositionId;

  if (existing) {
    targetPositionId = existing.id;
    const oldQty = existing.quantity;
    const oldPrice = existing.open_price;
    const oldRate = existing.open_rate_to_cny || 1;
    const newQty = Number(body.quantity);
    const newPrice = Number(body.open_price);
    const newRate = Number(body.open_rate_to_cny ?? 1);
    
    const totalQty = oldQty + newQty;
    const oldCostNative = oldQty * oldPrice;
    const newCostNative = newQty * newPrice;
    const totalCostNative = oldCostNative + newCostNative;
    const avgPrice = totalCostNative / totalQty;
    
    const oldCostCNY = oldCostNative * oldRate;
    const newCostCNY = newCostNative * newRate;
    const avgRateToCNY = (oldCostCNY + newCostCNY) / totalCostNative;
    
    const totalCommission = (existing.commission || 0) + Number(body.commission ?? 0);

    posStmt = env.DB.prepare(
      `UPDATE positions 
       SET quantity = ?1, open_price = ?2, open_rate_to_cny = ?3, commission = ?4, updated_at = ?5
       WHERE id = ?6`
    ).bind(
      totalQty,
      avgPrice,
      avgRateToCNY,
      totalCommission,
      now,
      targetPositionId
    );
  } else {
    targetPositionId = id;
    posStmt = env.DB.prepare(
      `INSERT INTO positions
         (id, symbol, name, market, currency, open_date, open_price, open_rate_to_cny,
          quantity, commission, status, sector, beta, notes, tags, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'OPEN', ?11, ?12, ?13, ?14, ?15, ?16)`
    ).bind(
      targetPositionId,
      symbolUpper,
      body.name,
      market,
      body.currency ?? 'CNY',
      body.open_date,
      Number(body.open_price),
      Number(body.open_rate_to_cny ?? 1),
      Number(body.quantity),
      Number(body.commission ?? 0),
      body.sector ?? null,
      body.beta != null ? Number(body.beta) : null,
      body.notes ?? null,
      body.tags ?? null,
      now,
      now
    );
  }

  const tradeStmt = env.DB.prepare(
    `INSERT INTO trades
       (id, position_id, symbol, name, market, trade_type, price, quantity,
        commission, currency, rate_to_cny, trade_date, notes, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 'BUY', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`
  ).bind(
    tradeId,
    targetPositionId,
    symbolUpper,
    body.name,
    market,
    Number(body.open_price),
    Number(body.quantity),
    Number(body.commission ?? 0),
    body.currency ?? 'CNY',
    Number(body.open_rate_to_cny ?? 1),
    body.open_date,
    body.notes ?? null,
    now
  );

  await env.DB.batch([posStmt, tradeStmt]);

  // Return the newly created/updated position
  const resultingPosition = await env.DB.prepare('SELECT * FROM positions WHERE id = ?1')
    .bind(targetPositionId)
    .first();

  return Response.json(
    { success: true, data: resultingPosition },
    { status: existing ? 200 : 201 }
  );
}
