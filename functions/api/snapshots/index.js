/**
 * @fileoverview GET /api/snapshots?days=90&market=ALL
 *
 * Returns historical portfolio snapshot data for trend charts.
 */
export async function onRequestGet(context) {
  const { env, request } = context;
  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get('days') || '90', 10), 365);
  const market = (url.searchParams.get('market') || 'ALL').toUpperCase();

  try {
    const { results } = await env.DB.prepare(
      `SELECT snapshot_date, market, total_value_cny, total_cost_cny, total_pnl_cny, ytd_pnl_cny, position_count
       FROM portfolio_snapshots
       WHERE market = ?1 AND snapshot_date >= date('now', '-' || ?2 || ' days')
       ORDER BY snapshot_date ASC`
    ).bind(market, days).all();

    return Response.json({
      success: true,
      data: (results || []).map(r => ({
        date: r.snapshot_date,
        totalValueCNY: r.total_value_cny,
        totalCostCNY: r.total_cost_cny,
        totalPnlCNY: r.total_pnl_cny,
        ytdPnlCNY: r.ytd_pnl_cny || 0,
        positionCount: r.position_count
      }))
    }, { headers: { 'Cache-Control': 'public, max-age=300' } });
  } catch (error) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
