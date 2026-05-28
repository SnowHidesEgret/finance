/**
 * @fileoverview
 * GET    /api/positions/:id   — fetch a single position
 * PUT    /api/positions/:id   — update a position (edit or close)
 * DELETE /api/positions/:id   — delete a position
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
// GET /api/positions/:id
// ────────────────────────────────────────────────────────────

/**
 * Return a single position by its ID.
 * @param {EventContext} context
 */
export async function onRequestGet(context) {
  const { env, params } = context;
  const id = params.id;

  if (!id) {
    return Response.json(
      { success: false, error: 'Missing position ID' },
      { status: 400 },
    );
  }

  const row = await env.DB.prepare('SELECT * FROM positions WHERE id = ?1')
    .bind(id)
    .first();

  if (!row) {
    return Response.json(
      { success: false, error: `Position not found: ${id}` },
      { status: 404 },
    );
  }

  return Response.json({ success: true, data: row });
}

// ────────────────────────────────────────────────────────────
// PUT /api/positions/:id
// ────────────────────────────────────────────────────────────

/** Fields that may be updated on an OPEN position */
const EDITABLE_FIELDS = [
  'symbol', 'name', 'market', 'currency', 'open_date', 'open_price',
  'open_rate_to_cny', 'quantity', 'commission', 'sector', 'beta',
  'notes', 'tags',
];

/** Fields required when closing a position */
const CLOSE_FIELDS = ['close_date', 'close_price'];

/** Allowed market values */
const VALID_MARKETS = new Set(['A_SHARE', 'HK', 'US', 'SWISS']);

/**
 * Update (edit) or close a position.
 *
 * To **close** a position, send `{ status: 'CLOSED', close_date, close_price, … }`.
 * To **edit**, send any of the editable fields.
 *
 * @param {EventContext} context
 */
export async function onRequestPut(context) {
  const { env, params } = context;
  const id = params.id;

  if (!id) {
    return Response.json(
      { success: false, error: 'Missing position ID' },
      { status: 400 },
    );
  }

  let body;
  try {
    body = await context.request.json();
  } catch {
    return Response.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  // Make sure the position exists
  const existing = await env.DB.prepare('SELECT * FROM positions WHERE id = ?1')
    .bind(id)
    .first();

  if (!existing) {
    return Response.json(
      { success: false, error: `Position not found: ${id}` },
      { status: 404 },
    );
  }

  // ── Closing flow ────────────────────────────────────────────────────
  if (body.status === 'CLOSED') {
    if (existing.status === 'CLOSED') {
      return Response.json(
        { success: false, error: 'Position is already closed' },
        { status: 409 },
      );
    }

    const missingClose = CLOSE_FIELDS.filter((f) => body[f] == null || body[f] === '');
    if (missingClose.length) {
      return Response.json(
        {
          success: false,
          error: `Closing requires: ${missingClose.join(', ')}`,
        },
        { status: 400 },
      );
    }
    
    const closeQty = Number(body.close_quantity || existing.quantity);
    if (closeQty <= 0 || closeQty > existing.quantity) {
      return Response.json({ success: false, error: 'Invalid close quantity' }, { status: 400 });
    }
    
    const isFullClose = closeQty === existing.quantity;

    const tradeId = generateId();
    const now = new Date().toISOString();

    // -- FIFO Cost Basis Calculation --
    // Fetch all existing trades for this position
    const { results: existingTrades } = await env.DB.prepare(
      'SELECT trade_type, quantity, price, rate_to_cny FROM trades WHERE position_id = ?1 ORDER BY trade_date ASC, created_at ASC'
    ).bind(id).all();

    let priorSold = 0;
    const buyTrades = [];
    
    for (const t of (existingTrades || [])) {
      if (t.trade_type === 'SELL') {
        priorSold += t.quantity;
      } else if (t.trade_type === 'BUY') {
        buyTrades.push(t);
      }
    }

    let remainingCostNative = 0;
    let remainingCostCNY = 0;
    let remainingQty = 0;
    
    let costOfCurrentSellNative = 0;
    let currentSellUnfulfilled = closeQty;
    let priorSoldTracker = priorSold;

    for (const b of buyTrades) {
      let bQty = b.quantity;
      
      // Step 1: consume priorSold
      if (priorSoldTracker > 0) {
        if (priorSoldTracker >= bQty) {
          priorSoldTracker -= bQty;
          continue; // this buy lot is completely gone
        } else {
          bQty -= priorSoldTracker;
          priorSoldTracker = 0;
        }
      }
      
      // Step 2: consume current sell
      if (currentSellUnfulfilled > 0) {
        if (bQty <= currentSellUnfulfilled) {
          costOfCurrentSellNative += bQty * b.price;
          currentSellUnfulfilled -= bQty;
          continue; // this buy lot is completely consumed by current sell
        } else {
          costOfCurrentSellNative += currentSellUnfulfilled * b.price;
          bQty -= currentSellUnfulfilled;
          currentSellUnfulfilled = 0;
        }
      }
      
      // Step 3: whatever is left belongs to remainingQty
      remainingQty += bQty;
      remainingCostNative += bQty * b.price;
      remainingCostCNY += bQty * b.price * (b.rate_to_cny || 1);
    }

    const newOpenPrice = remainingQty > 0 ? remainingCostNative / remainingQty : existing.open_price;
    const newRateToCNY = remainingCostNative > 0 ? remainingCostCNY / remainingCostNative : existing.open_rate_to_cny;
    const newCommission = remainingQty > 0 ? (existing.commission || 0) * (remainingQty / existing.quantity) : 0;
    
    const realizedPnlNative = (closeQty * Number(body.close_price)) - costOfCurrentSellNative - Number(body.close_commission ?? 0);

    let updatePosStmt;
    if (isFullClose) {
      updatePosStmt = env.DB.prepare(
        `UPDATE positions
         SET status = 'CLOSED',
             close_date         = ?1,
             close_price        = ?2,
             close_rate_to_cny  = ?3,
             close_commission   = ?4,
             updated_at         = datetime('now')
         WHERE id = ?5`
      ).bind(
        body.close_date,
        Number(body.close_price),
        Number(body.close_rate_to_cny ?? 1),
        Number(body.close_commission ?? 0),
        id,
      );
    } else {
      updatePosStmt = env.DB.prepare(
        `UPDATE positions
         SET quantity = ?1,
             open_price = ?2,
             open_rate_to_cny = ?3,
             commission = ?4,
             updated_at = datetime('now')
         WHERE id = ?5`
      ).bind(remainingQty, newOpenPrice, newRateToCNY, newCommission, id);
    }

    const insertTradeStmt = env.DB.prepare(
      `INSERT INTO trades
         (id, position_id, symbol, name, market, trade_type, price, quantity,
          commission, currency, rate_to_cny, trade_date, notes, realized_pnl, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'SELL', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`
    ).bind(
      tradeId,
      id,
      existing.symbol,
      existing.name,
      existing.market,
      Number(body.close_price),
      closeQty,
      Number(body.close_commission ?? 0),
      existing.currency,
      Number(body.close_rate_to_cny ?? 1),
      body.close_date,
      isFullClose ? 'Closed position' : 'Partial close',
      realizedPnlNative,
      now,
    );

    await env.DB.batch([updatePosStmt, insertTradeStmt]);

    const updated = await env.DB.prepare('SELECT * FROM positions WHERE id = ?1')
      .bind(id)
      .first();

    return Response.json({ success: true, data: updated });
  }

  // ── General edit flow ───────────────────────────────────────────────
  /** @type {string[]} */
  const setClauses = [];
  /** @type {any[]} */
  const values = [];
  let idx = 1;

  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) {
      // Extra validation for market
      if (field === 'market') {
        const mv = String(body[field]).toUpperCase();
        if (!VALID_MARKETS.has(mv)) {
          return Response.json(
            { success: false, error: `Invalid market. Allowed: ${[...VALID_MARKETS].join(', ')}` },
            { status: 400 },
          );
        }
        setClauses.push(`${field} = ?${idx++}`);
        values.push(mv);
      } else {
        setClauses.push(`${field} = ?${idx++}`);
        values.push(body[field]);
      }
    }
  }

  if (setClauses.length === 0) {
    return Response.json(
      { success: false, error: 'No valid fields provided for update' },
      { status: 400 },
    );
  }

  setClauses.push(`updated_at = datetime('now')`);

  const sql = `UPDATE positions SET ${setClauses.join(', ')} WHERE id = ?${idx}`;
  values.push(id);

  await env.DB.prepare(sql).bind(...values).run();

  const updated = await env.DB.prepare('SELECT * FROM positions WHERE id = ?1')
    .bind(id)
    .first();

  return Response.json({ success: true, data: updated });
}

// ────────────────────────────────────────────────────────────
// DELETE /api/positions/:id
// ────────────────────────────────────────────────────────────

/**
 * Delete a position by ID.
 * @param {EventContext} context
 */
export async function onRequestDelete(context) {
  const { env, params } = context;
  const id = params.id;

  if (!id) {
    return Response.json(
      { success: false, error: 'Missing position ID' },
      { status: 400 },
    );
  }

  const existing = await env.DB.prepare('SELECT id FROM positions WHERE id = ?1')
    .bind(id)
    .first();

  if (!existing) {
    return Response.json(
      { success: false, error: `Position not found: ${id}` },
      { status: 404 },
    );
  }

  await env.DB.prepare('DELETE FROM positions WHERE id = ?1').bind(id).run();

  return Response.json({ success: true, data: { deleted: id } });
}
