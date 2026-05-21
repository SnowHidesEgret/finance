/**
 * @fileoverview GET /api/summary
 *
 * Returns a global portfolio summary across all markets.
 * Joins OPEN positions with quote_cache to compute current values,
 * then aggregates totals in CNY.
 */

/**
 * Compute summary metrics from an array of open positions.
 * @param {object[]} positions – rows from D1 join
 * @returns {object} summary object
 */
function computeSummary(positions) {
  let totalValueCNY = 0;
  let totalCostCNY = 0;
  /** @type {Record<string, {value: number, cost: number, count: number}>} */
  const marketBreakdown = {};

  for (const p of positions) {
    const currentPrice = p.quote_price ?? p.open_price;
    const rateToCNY = p.open_rate_to_cny ?? 1;

    const costCNY = p.open_price * p.quantity * rateToCNY + (p.commission ?? 0) * rateToCNY;
    const valueCNY = currentPrice * p.quantity * rateToCNY;

    totalCostCNY += costCNY;
    totalValueCNY += valueCNY;

    const mkt = p.market;
    if (!marketBreakdown[mkt]) {
      marketBreakdown[mkt] = { value: 0, cost: 0, count: 0 };
    }
    marketBreakdown[mkt].value += valueCNY;
    marketBreakdown[mkt].cost += costCNY;
    marketBreakdown[mkt].count += 1;
  }

  const totalPnlCNY = totalValueCNY - totalCostCNY;
  const totalPnlPercent = totalCostCNY !== 0
    ? ((totalPnlCNY / totalCostCNY) * 100)
    : 0;

  // Per-market stats
  /** @type {Record<string, object>} */
  const markets = {};
  for (const [mkt, data] of Object.entries(marketBreakdown)) {
    const pnl = data.value - data.cost;
    markets[mkt] = {
      totalValueCNY: round2(data.value),
      totalCostCNY: round2(data.cost),
      totalPnlCNY: round2(pnl),
      totalPnlPercent: data.cost !== 0 ? round2((pnl / data.cost) * 100) : 0,
      positionCount: data.count,
    };
  }

  return {
    totalValueCNY: round2(totalValueCNY),
    totalCostCNY: round2(totalCostCNY),
    totalPnlCNY: round2(totalPnlCNY),
    totalPnlPercent: round2(totalPnlPercent),
    positionCount: positions.length,
    marketCounts: Object.fromEntries(
      Object.entries(marketBreakdown).map(([m, d]) => [m, d.count]),
    ),
    markets,
  };
}

/**
 * Round to 2 decimal places.
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * GET handler — global portfolio summary.
 * @param {EventContext} context
 */
export async function onRequestGet(context) {
  const { env } = context;

  const { results } = await env.DB.prepare(
    `SELECT
       p.*,
       q.price   AS quote_price,
       q.change_amount  AS quote_change_amount,
       q.change_percent AS quote_change_percent,
       q.updated_at     AS quote_updated_at
     FROM positions p
     LEFT JOIN quote_cache q ON UPPER(p.symbol) = UPPER(q.symbol)
     WHERE p.status = 'OPEN'
     ORDER BY p.market, p.open_date DESC`,
  ).all();

  const positions = results ?? [];

  if (positions.length === 0) {
    return Response.json({
      success: true,
      data: {
        totalValueCNY: 0,
        totalCostCNY: 0,
        totalPnlCNY: 0,
        totalPnlPercent: 0,
        positionCount: 0,
        marketCounts: {},
        markets: {},
      },
    });
  }

  const summary = computeSummary(positions);

  return Response.json(
    { success: true, data: summary },
    {
      headers: {
        'Cache-Control': 'public, max-age=30',
      },
    },
  );
}
