/**
 * @fileoverview POST /api/trades/import
 *
 * Bulk-import trades from a JSON array. Each trade object is validated
 * individually and inserted via a D1 batch. Returns a summary of
 * successful vs failed imports.
 */

/**
 * Generate a URL-safe unique ID.
 * @returns {string}
 */
function generateId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(21));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

const REQUIRED_FIELDS = ['symbol', 'name', 'market', 'trade_type', 'price', 'quantity', 'trade_date'];
const VALID_MARKETS = new Set(['A_SHARE', 'HK', 'US', 'SWISS']);
const VALID_TRADE_TYPES = new Set(['BUY', 'SELL']);

/**
 * Validate a single trade object.
 * @param {object} t  – trade record
 * @param {number} idx – index in the input array (for error messages)
 * @returns {string|null} error message, or null if valid
 */
function validateTrade(t, idx) {
  const missing = REQUIRED_FIELDS.filter((f) => t[f] == null || t[f] === '');
  if (missing.length) return `[${idx}] Missing fields: ${missing.join(', ')}`;

  if (!VALID_MARKETS.has(String(t.market).toUpperCase()))
    return `[${idx}] Invalid market: ${t.market}`;

  if (!VALID_TRADE_TYPES.has(String(t.trade_type).toUpperCase()))
    return `[${idx}] Invalid trade_type: ${t.trade_type}`;

  if (Number(t.price) <= 0)  return `[${idx}] price must be positive`;
  if (Number(t.quantity) <= 0) return `[${idx}] quantity must be positive`;

  return null;
}

/**
 * POST handler — bulk import trades.
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

  if (!Array.isArray(body)) {
    return Response.json(
      { success: false, error: 'Request body must be a JSON array of trade objects' },
      { status: 400 },
    );
  }

  if (body.length === 0) {
    return Response.json(
      { success: false, error: 'Empty array — nothing to import' },
      { status: 400 },
    );
  }

  // D1 batch has a 100-statement limit per call
  const BATCH_SIZE = 100;

  /** @type {string[]} */
  const errors = [];
  /** @type {import('@cloudflare/workers-types').D1PreparedStatement[]} */
  const statements = [];
  /** @type {string[]} */
  const importedIds = [];

  for (let i = 0; i < body.length; i++) {
    const t = body[i];
    const err = validateTrade(t, i);
    if (err) {
      errors.push(err);
      continue;
    }

    const id = generateId();
    importedIds.push(id);

    statements.push(
      env.DB.prepare(
        `INSERT INTO trades
           (id, position_id, symbol, name, market, trade_type, price, quantity,
            commission, currency, rate_to_cny, trade_date, notes, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, datetime('now'))`,
      ).bind(
        id,
        t.position_id ?? null,
        String(t.symbol).toUpperCase(),
        t.name,
        String(t.market).toUpperCase(),
        String(t.trade_type).toUpperCase(),
        Number(t.price),
        Number(t.quantity),
        Number(t.commission ?? 0),
        t.currency ?? 'CNY',
        Number(t.rate_to_cny ?? 1),
        t.trade_date,
        t.notes ?? null,
      ),
    );
  }

  // Execute in batches
  let insertedCount = 0;
  for (let start = 0; start < statements.length; start += BATCH_SIZE) {
    const batch = statements.slice(start, start + BATCH_SIZE);
    try {
      await env.DB.batch(batch);
      insertedCount += batch.length;
    } catch (batchErr) {
      console.error('[import batch error]', batchErr);
      errors.push(`Batch starting at index ${start} failed: ${batchErr.message}`);
    }
  }

  const statusCode = errors.length > 0 ? (insertedCount > 0 ? 207 : 400) : 201;

  return Response.json(
    {
      success: insertedCount > 0,
      data: {
        total: body.length,
        imported: insertedCount,
        failed: body.length - insertedCount,
        errors: errors.length > 0 ? errors : undefined,
        importedIds: importedIds.slice(0, insertedCount),
      },
    },
    { status: statusCode },
  );
}
