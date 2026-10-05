/**
 * @fileoverview GET /api/agent/ping — Lightweight health & state check.
 *
 * Performs 4 lightweight DB queries to verify database connectivity and state:
 *   1. API Key creation timestamp
 *   2. Most recent quote cache timestamp
 *   3. Most recent portfolio snapshot date
 *   4. Current open position count
 *
 * No external API or network calls are made.
 */

import { formatIsoUtc, successResponse, errorResponse } from '../../../lib/agent-common.js';

export async function onRequestGet({ env }) {
  const db = env?.DB;
  if (!db) {
    return errorResponse('DB_UNAVAILABLE', '数据库连接不可用', 500);
  }

  try {
    const [keyRow, quoteRow, snapshotRow, posRow] = await Promise.all([
      db.prepare("SELECT value FROM user_settings WHERE key = 'openclaw_api_key_created_at'").first(),
      db.prepare("SELECT MAX(updated_at) AS latest FROM quote_cache").first(),
      db.prepare("SELECT MAX(snapshot_date) AS latest FROM portfolio_snapshots").first(),
      db.prepare("SELECT COUNT(*) AS count FROM positions WHERE status = 'OPEN'").first(),
    ]);

    return successResponse({
      apiVersion: 'v1',
      keyCreatedAt: keyRow?.value ? formatIsoUtc(keyRow.value) : null,
      latestQuoteAt: quoteRow?.latest ? formatIsoUtc(quoteRow.latest) : null,
      latestSnapshotDate: snapshotRow?.latest || null,
      openPositionCount: posRow?.count ?? 0,
    });
  } catch (err) {
    console.error('[agent:ping]', err);
    return errorResponse('SERVER_ERROR', '系统内部错误，无法获取状态', 500);
  }
}
