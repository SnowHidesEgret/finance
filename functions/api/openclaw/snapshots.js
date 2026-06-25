/**
 * OpenClaw API — Snapshots Endpoint
 * GET /api/openclaw/snapshots
 *
 * Returns portfolio snapshot history for charting / trend analysis.
 *
 * Query params (all optional):
 *   from   — start date, ISO format (default: 90 days ago)
 *   to     — end date, ISO format   (default: today)
 *   market — market filter           (default: ALL)
 *
 * Response includes Cache-Control: public, max-age=300
 */

const DEFAULT_RANGE_DAYS = 90;
const VALID_MARKETS = new Set(['A_SHARE', 'HK', 'US', 'SWISS', 'ALL']);

export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);

  try {
    // ── Parse params ─────────────────────────────────────────────
    const now = new Date();

    const defaultFrom = new Date(now);
    defaultFrom.setDate(defaultFrom.getDate() - DEFAULT_RANGE_DAYS);

    const from = url.searchParams.get('from') || defaultFrom.toISOString().slice(0, 10);
    const to = url.searchParams.get('to') || now.toISOString().slice(0, 10);
    const market = (url.searchParams.get('market') || 'ALL').toUpperCase();

    if (!VALID_MARKETS.has(market)) {
      return Response.json(
        { success: false, error: `Invalid market. Must be one of: ${[...VALID_MARKETS].join(', ')}`, meta: { timestamp: new Date().toISOString(), version: 'v1' } },
        { status: 400 }
      );
    }

    // ── Build query ──────────────────────────────────────────────
    const conditions = ['snapshot_date >= ?', 'snapshot_date <= ?'];
    const params = [from, to];

    conditions.push('market = ?');
    params.push(market);

    const sql = `
      SELECT snapshot_date, total_value_cny, total_cost_cny,
             total_pnl_cny, ytd_pnl_cny, position_count
      FROM portfolio_snapshots
      WHERE ${conditions.join(' AND ')}
      ORDER BY snapshot_date ASC
    `;

    const result = await env.DB.prepare(sql).bind(...params).all();

    const snapshots = (result.results || []).map((row) => ({
      date: row.snapshot_date,
      totalValueCNY: row.total_value_cny,
      totalCostCNY: row.total_cost_cny,
      totalPnlCNY: row.total_pnl_cny,
      ytdPnlCNY: row.ytd_pnl_cny,
      positionCount: row.position_count,
    }));

    return Response.json(
      {
        success: true,
        data: snapshots,
        count: snapshots.length,
        meta: { timestamp: new Date().toISOString(), version: 'v1' },
      },
      {
        headers: { 'Cache-Control': 'public, max-age=300' },
      }
    );
  } catch (err) {
    console.error('OpenClaw snapshots error:', err);
    return Response.json(
      { success: false, error: 'Internal server error', meta: { timestamp: new Date().toISOString(), version: 'v1' } },
      { status: 500 }
    );
  }
}
