/**
 * @fileoverview
 * GET  /api/trades          — list trades with optional filters
 * POST /api/trades          — create a single trade record
 */

/**
 * Generate a URL-safe unique ID.
 * @returns {string} 21-char random ID
 */
function generateId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(21));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

// ────────────────────────────────────────────────────────────
// GET /api/trades
// ────────────────────────────────────────────────────────────

/**
 * List trades with optional filters: symbol, market, from, to (date range).
 * @param {EventContext} context
 */
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);

  const symbol = url.searchParams.get('symbol');
  const market = url.searchParams.get('market');
  const from = url.searchParams.get('from');   // ISO date, inclusive
  const to = url.searchParams.get('to');       // ISO date, inclusive
  const positionId = url.searchParams.get('position_id');

  let sql = 'SELECT * FROM trades WHERE 1=1';
  /** @type {any[]} */
  const binds = [];
  let idx = 1;

  if (symbol) {
    sql += ` AND symbol = ?${idx++}`;
    binds.push(symbol.toUpperCase());
  }
  if (market) {
    sql += ` AND market = ?${idx++}`;
    binds.push(market.toUpperCase());
  }
  if (positionId) {
    sql += ` AND position_id = ?${idx++}`;
    binds.push(positionId);
  }
  if (from) {
    sql += ` AND trade_date >= ?${idx++}`;
    binds.push(from);
  }
  if (to) {
    sql += ` AND trade_date <= ?${idx++}`;
    binds.push(to);
  }

  sql += ' ORDER BY trade_date DESC, created_at DESC';

  const stmt = env.DB.prepare(sql);
  const { results } = await (binds.length ? stmt.bind(...binds) : stmt).all();

  return Response.json({
    success: true,
    data: results ?? [],
    count: (results ?? []).length,
  });
}

// ────────────────────────────────────────────────────────────
// POST /api/trades
// ────────────────────────────────────────────────────────────

const REQUIRED_FIELDS = ['symbol', 'name', 'market', 'trade_type', 'price', 'quantity', 'trade_date'];
const VALID_MARKETS = new Set(['A_SHARE', 'HK', 'US', 'SWISS']);
const VALID_TRADE_TYPES = new Set(['BUY', 'SELL']);

/**
 * Create a single trade record.
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

  const tradeType = String(body.trade_type).toUpperCase();
  if (!VALID_TRADE_TYPES.has(tradeType)) {
    return Response.json(
      { success: false, error: `Invalid trade_type. Allowed: BUY, SELL` },
      { status: 400 },
    );
  }

  if (Number(body.price) <= 0) {
    return Response.json(
      { success: false, error: 'price must be a positive number' },
      { status: 400 },
    );
  }

  if (Number(body.quantity) <= 0) {
    return Response.json(
      { success: false, error: 'quantity must be a positive number' },
      { status: 400 },
    );
  }

  // If position_id is given, verify it exists
  if (body.position_id) {
    const pos = await env.DB.prepare('SELECT id FROM positions WHERE id = ?1')
      .bind(body.position_id)
      .first();

    if (!pos) {
      return Response.json(
        { success: false, error: `Position not found: ${body.position_id}` },
        { status: 404 },
      );
    }
  }

  const id = generateId();

  await env.DB.prepare(
    `INSERT INTO trades
       (id, position_id, symbol, name, market, trade_type, price, quantity,
        commission, currency, rate_to_cny, trade_date, notes, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, datetime('now'))`,
  )
    .bind(
      id,
      body.position_id ?? null,
      String(body.symbol).toUpperCase(),
      body.name,
      market,
      tradeType,
      Number(body.price),
      Number(body.quantity),
      Number(body.commission ?? 0),
      body.currency ?? 'CNY',
      Number(body.rate_to_cny ?? 1),
      body.trade_date,
      body.notes ?? null,
    )
    .run();

  const created = await env.DB.prepare('SELECT * FROM trades WHERE id = ?1')
    .bind(id)
    .first();

  return Response.json(
    { success: true, data: created },
    { status: 201 },
  );
}
