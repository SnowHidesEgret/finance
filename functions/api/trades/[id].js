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

  // Recalculate position if position_id is set
  if (updated.position_id) {
    const positionId = updated.position_id;
    
    const { results: allTrades } = await env.DB.prepare(
      'SELECT trade_type, quantity, price, rate_to_cny, commission FROM trades WHERE position_id = ?1 ORDER BY trade_date ASC, created_at ASC'
    ).bind(positionId).all();

    let totalSold = 0;
    const buyTrades = [];
    let totalBuyCommission = 0;
    
    for (const t of (allTrades || [])) {
      if (t.trade_type === 'SELL') {
        totalSold += t.quantity;
      } else if (t.trade_type === 'BUY') {
        buyTrades.push(t);
        totalBuyCommission += (t.commission || 0);
      }
    }

    let remainingCostNative = 0;
    let remainingCostCNY = 0;
    let remainingQty = 0;
    let originalBuyQty = 0;
    
    let soldTracker = totalSold;

    for (const b of buyTrades) {
      let bQty = b.quantity;
      originalBuyQty += bQty;
      
      if (soldTracker > 0) {
        if (soldTracker >= bQty) {
          soldTracker -= bQty;
          continue;
        } else {
          bQty -= soldTracker;
          soldTracker = 0;
        }
      }
      
      remainingQty += bQty;
      remainingCostNative += bQty * b.price;
      remainingCostCNY += bQty * b.price * (b.rate_to_cny || 1);
    }

    if (remainingQty > 0) {
      const newOpenPrice = remainingCostNative / remainingQty;
      const newRateToCNY = remainingCostNative > 0 ? remainingCostCNY / remainingCostNative : 1;
      const newCommission = totalBuyCommission * (remainingQty / originalBuyQty);
      
      await env.DB.prepare(
        `UPDATE positions 
         SET quantity = ?1, open_price = ?2, open_rate_to_cny = ?3, commission = ?4, status = 'OPEN', updated_at = datetime('now')
         WHERE id = ?5`
      ).bind(remainingQty, newOpenPrice, newRateToCNY, newCommission, positionId).run();
    } else {
      await env.DB.prepare(
        `UPDATE positions 
         SET quantity = ?1, status = 'CLOSED', updated_at = datetime('now')
         WHERE id = ?2`
      ).bind(0, positionId).run();
    }
  }

  return Response.json(
    { success: true, data: updated },
    { status: 200 },
  );
}
