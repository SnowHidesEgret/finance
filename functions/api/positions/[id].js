/**
 * @fileoverview
 * GET    /api/positions/:id   — fetch a single position
 * PUT    /api/positions/:id   — update a position (edit or close)
 * DELETE /api/positions/:id   — delete a position
 */

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

    await env.DB.prepare(
      `UPDATE positions
       SET status = 'CLOSED',
           close_date         = ?1,
           close_price        = ?2,
           close_rate_to_cny  = ?3,
           close_commission   = ?4,
           updated_at         = datetime('now')
       WHERE id = ?5`,
    )
      .bind(
        body.close_date,
        Number(body.close_price),
        Number(body.close_rate_to_cny ?? 1),
        Number(body.close_commission ?? 0),
        id,
      )
      .run();

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
