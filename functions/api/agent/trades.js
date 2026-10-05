/**
 * @fileoverview GET /api/agent/trades — Paginated trade history.
 *
 * Route:
 *   GET /api/agent/trades
 *   GET /api/agent/trades?symbol=AAPL&market=US&type=BUY&from=2026-01-01&to=2026-10-01&limit=50&offset=0
 *
 * Fixes addressed:
 *   - B4: Sorting is ORDER BY trade_date DESC, created_at DESC, id DESC for stable pagination;
 *         response includes id, positionId, realizedPnl, rateToCny
 *   - B8: Validate from/to date formats (return 400 if invalid); validate limit (1–500, return 400 if invalid);
 *         validate offset (>=0, return 400 if invalid); validate market & type
 */

import { successResponse, errorResponse } from '../../../lib/agent-common.js';

const VALID_MARKETS = new Set(['A_SHARE', 'HK', 'US', 'SWISS']);
const VALID_TYPES = new Set(['BUY', 'SELL']);
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Validate YYYY-MM-DD date strictly.
 * @param {string} dateStr
 * @returns {boolean}
 */
function isValidDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const d = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(d.getTime())) return false;
  return d.toISOString().slice(0, 10) === dateStr;
}

export async function onRequestGet({ env, request }) {
  const db = env?.DB;
  if (!db) {
    return errorResponse('DB_UNAVAILABLE', '数据库连接不可用', 500);
  }

  const url = new URL(request.url);

  // ── Parse & validate query params (B8) ──────────────────────────────
  const rawSymbol = url.searchParams.get('symbol');
  const symbol = rawSymbol ? rawSymbol.trim().toUpperCase() : null;

  const rawMarket = url.searchParams.get('market');
  const market = rawMarket ? rawMarket.trim().toUpperCase() : null;
  if (market && !VALID_MARKETS.has(market)) {
    return errorResponse(
      'INVALID_MARKET',
      `无效的市场参数: "${rawMarket}"，合法值为: ${[...VALID_MARKETS].join(', ')}`,
      400,
      { hint: '支持的市场: A_SHARE, HK, US, SWISS' }
    );
  }

  const rawType = url.searchParams.get('type');
  const type = rawType ? rawType.trim().toUpperCase() : null;
  if (type && !VALID_TYPES.has(type)) {
    return errorResponse(
      'INVALID_TRADE_TYPE',
      `无效的交易类型: "${rawType}"，合法值为: ${[...VALID_TYPES].join(', ')}`,
      400,
      { hint: '支持的交易类型: BUY, SELL' }
    );
  }

  const rawFrom = url.searchParams.get('from');
  const from = rawFrom ? rawFrom.trim() : null;
  if (from && !isValidDate(from)) {
    return errorResponse('INVALID_DATE', `起始日期格式非法: "${rawFrom}"，必须为 YYYY-MM-DD 且为有效日期`, 400);
  }

  const rawTo = url.searchParams.get('to');
  const to = rawTo ? rawTo.trim() : null;
  if (to && !isValidDate(to)) {
    return errorResponse('INVALID_DATE', `结束日期格式非法: "${rawTo}"，必须为 YYYY-MM-DD 且为有效日期`, 400);
  }

  if (from && to && from > to) {
    return errorResponse('INVALID_DATE_RANGE', `起始日期 (${from}) 不能晚于结束日期 (${to})`, 400);
  }

  let limit = DEFAULT_LIMIT;
  if (url.searchParams.has('limit')) {
    const rawLimit = url.searchParams.get('limit');
    const parsedLimit = Number(rawLimit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIMIT) {
      return errorResponse(
        'INVALID_LIMIT',
        `limit 必须为 1 到 ${MAX_LIMIT} 之间的整数，实际传入: "${rawLimit}"`,
        400
      );
    }
    limit = parsedLimit;
  }

  let offset = 0;
  if (url.searchParams.has('offset')) {
    const rawOffset = url.searchParams.get('offset');
    const parsedOffset = Number(rawOffset);
    if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
      return errorResponse('INVALID_OFFSET', `offset 必须为大于等于 0 的整数，实际传入: "${rawOffset}"`, 400);
    }
    offset = parsedOffset;
  }

  try {
    // ── Build dynamic WHERE clause ─────────────────────────────────
    const conditions = [];
    const binds = [];

    if (symbol) {
      conditions.push('symbol = ? COLLATE NOCASE');
      binds.push(symbol);
    }
    if (market) {
      conditions.push('market = ?');
      binds.push(market);
    }
    if (type) {
      conditions.push('trade_type = ?');
      binds.push(type);
    }
    if (from) {
      conditions.push('trade_date >= ?');
      binds.push(from);
    }
    if (to) {
      conditions.push('trade_date <= ?');
      binds.push(to);
    }

    const whereClause = conditions.length > 0
      ? 'WHERE ' + conditions.join(' AND ')
      : '';

    // ── Run data + count queries in parallel (B4: stable pagination sort) ──
    const dataSQL = `
      SELECT id, position_id, symbol, name, market, trade_type, price, quantity,
             commission, currency, rate_to_cny, trade_date, notes, realized_pnl
      FROM trades
      ${whereClause}
      ORDER BY trade_date DESC, created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `;
    const countSQL = `SELECT COUNT(*) AS total FROM trades ${whereClause}`;

    const [dataResult, countResult] = await Promise.all([
      db.prepare(dataSQL).bind(...binds, limit, offset).all(),
      db.prepare(countSQL).bind(...binds).first(),
    ]);

    const items = (dataResult.results || []).map((row) => ({
      id: row.id,
      positionId: row.position_id,
      symbol: row.symbol,
      name: row.name,
      market: row.market,
      type: row.trade_type,
      price: row.price,
      quantity: row.quantity,
      commission: row.commission,
      currency: row.currency,
      date: row.trade_date,
      tradeDate: row.trade_date,
      notes: row.notes || null,
      realizedPnl: row.realized_pnl != null ? row.realized_pnl : null,
      rateToCny: row.rate_to_cny != null ? row.rate_to_cny : null,
    }));

    return successResponse({
      items,
      count: items.length,
      total: countResult?.total ?? 0,
    });
  } catch (err) {
    console.error('[agent:trades]', err);
    return errorResponse('SERVER_ERROR', '系统内部错误，无法获取交易流水', 500);
  }
}
