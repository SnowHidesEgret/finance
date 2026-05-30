/**
 * @fileoverview
 * PUT /api/trades/:id — update an existing trade record
 */

export async function onRequestPut(context) {
  const { env, request, params } = context;
  const id = params.id;

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }

  const updates = [];
  const binds = [];
  let idx = 1;

  if (body.price !== undefined) {
    if (Number(body.price) <= 0) {
      return Response.json({ success: false, error: 'price must be positive' }, { status: 400 });
    }
    updates.push(`price = ?${idx++}`);
    binds.push(Number(body.price));
  }
  
  if (body.quantity !== undefined) {
    if (Number(body.quantity) <= 0) {
      return Response.json({ success: false, error: 'quantity must be positive' }, { status: 400 });
    }
    updates.push(`quantity = ?${idx++}`);
    binds.push(Number(body.quantity));
  }

  if (body.commission !== undefined) {
    updates.push(`commission = ?${idx++}`);
    binds.push(Number(body.commission));
  }
  
  if (body.trade_date !== undefined) {
    updates.push(`trade_date = ?${idx++}`);
    binds.push(body.trade_date);
  }

  if (body.notes !== undefined) {
    updates.push(`notes = ?${idx++}`);
    binds.push(body.notes);
  }

  if (updates.length === 0) {
    return Response.json(
      { success: false, error: 'No fields to update' },
      { status: 400 },
    );
  }

  binds.push(id);
  const sql = `UPDATE trades SET ${updates.join(', ')} WHERE id = ?${idx}`;

  try {
    await env.DB.prepare(sql).bind(...binds).run();
  } catch (error) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 },
    );
  }

  const updated = await env.DB.prepare('SELECT * FROM trades WHERE id = ?1')
    .bind(id)
    .first();

  if (!updated) {
    return Response.json(
      { success: false, error: 'Trade not found' },
      { status: 404 },
    );
  }

  return Response.json(
    { success: true, data: updated },
    { status: 200 },
  );
}
