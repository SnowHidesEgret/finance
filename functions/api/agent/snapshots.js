/**
 * @fileoverview GET /api/agent/snapshots?from=&to=&market= — Historical portfolio snapshots.
 *
 * Route:
 *   GET /api/agent/snapshots
 *   GET /api/agent/snapshots?from=2026-01-01&to=2026-10-01&market=ALL
 *
 * Fixes addressed:
 *   - B5: Cache-Control set to 'private, max-age=300' (strictly private, NOT public)
 *   - B8: Validate from/to formats (return 400 if invalid)
 *   - Q6: UTC date calculations for defaults
 */

import { round2, successResponse, errorResponse } from '../../../lib/agent-common.js';

const VALID_MARKETS = new Set(['ALL', 'A_SHARE', 'HK', 'US', 'SWISS']);

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

  // ── Parse & validate market ──────────────────────────────────
  const rawMarket = url.searchParams.get('market');
  const market = rawMarket ? rawMarket.trim().toUpperCase() : 'ALL';

  if (!VALID_MARKETS.has(market)) {
    return errorResponse(
      'INVALID_MARKET',
      `无效的市场参数: "${rawMarket}"，合法值为: ${[...VALID_MARKETS].join(', ')}`,
      400,
      { hint: '支持的市场: ALL, A_SHARE, HK, US, SWISS' }
    );
  }

  // ── Parse & validate date range (UTC, B8, Q6) ────────────────
  const now = new Date();
  const defaultTo = now.toISOString().slice(0, 10);
  const d90Ago = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const defaultFrom = d90Ago.toISOString().slice(0, 10);

  const rawFrom = url.searchParams.get('from');
  const rawTo = url.searchParams.get('to');

  const from = rawFrom ? rawFrom.trim() : defaultFrom;
  const to = rawTo ? rawTo.trim() : defaultTo;

  if (!isValidDate(from)) {
    return errorResponse('INVALID_DATE', `起始日期格式非法: "${from}"，必须为 YYYY-MM-DD 且为有效日期`, 400);
  }

  if (!isValidDate(to)) {
    return errorResponse('INVALID_DATE', `结束日期格式非法: "${to}"，必须为 YYYY-MM-DD 且为有效日期`, 400);
  }

  if (from > to) {
    return errorResponse('INVALID_DATE_RANGE', `起始日期 (${from}) 不能晚于结束日期 (${to})`, 400);
  }

  try {
    const sql = `
      SELECT snapshot_date, total_value_cny, total_cost_cny,
             total_pnl_cny, ytd_pnl_cny, position_count, market
      FROM portfolio_snapshots
      WHERE snapshot_date >= ?1 AND snapshot_date <= ?2 AND market = ?3
      ORDER BY snapshot_date ASC
    `;

    const result = await db.prepare(sql).bind(from, to, market).all();

    const items = (result.results || []).map((row) => ({
      date: row.snapshot_date,
      totalValueCNY: row.total_value_cny != null ? round2(Number(row.total_value_cny)) : 0,
      totalCostCNY: row.total_cost_cny != null ? round2(Number(row.total_cost_cny)) : 0,
      totalPnlCNY: row.total_pnl_cny != null ? round2(Number(row.total_pnl_cny)) : 0,
      ytdPnlCNY: row.ytd_pnl_cny != null ? round2(Number(row.ytd_pnl_cny)) : null,
      positionCount: row.position_count ?? 0,
      market: row.market,
    }));

    return successResponse(
      {
        items,
        count: items.length,
        filter: { market, from, to },
      },
      {},
      {
        // B5: Cache-Control strictly private
        headers: { 'Cache-Control': 'private, max-age=300' },
      }
    );
  } catch (err) {
    console.error('[agent:snapshots]', err);
    return errorResponse('SERVER_ERROR', '系统内部错误，无法获取资产快照', 500);
  }
}
