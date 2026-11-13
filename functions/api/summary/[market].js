/**
 * @fileoverview GET /api/summary/:market
 *
 * Returns a portfolio summary for a specific market (A_SHARE, HK, US, SWISS).
 * Joins OPEN positions in that market with quote_cache and computes totals in CNY
 * using live exchange rates from lib/agent-common.js.
 */

import {
  loadRatesDetailed,
  marketCurrency,
  round2,
} from '../../../lib/agent-common.js';

const VALID_MARKETS = new Set(['A_SHARE', 'HK', 'US', 'SWISS']);

/**
 * GET handler — per-market portfolio summary.
 * @param {EventContext} context
 */
export async function onRequestGet(context) {
  const { env, params } = context;
  const market = (params.market ?? '').toUpperCase();

  if (!VALID_MARKETS.has(market)) {
    return Response.json(
      {
        success: false,
        error: `Invalid market: ${params.market}. Allowed: ${[...VALID_MARKETS].join(', ')}`,
      },
      { status: 400 },
    );
  }

  const [{ results }, ratesInfo] = await Promise.all([
    env.DB.prepare(
      `SELECT
         p.*,
         q.price           AS quote_price,
         q.change_amount   AS quote_change_amount,
         q.change_percent  AS quote_change_percent,
         q.updated_at      AS quote_updated_at
       FROM positions p
       LEFT JOIN quote_cache q ON UPPER(p.symbol) = UPPER(q.symbol)
       WHERE p.status = 'OPEN' AND p.market = ?1
       ORDER BY p.open_date DESC`,
    )
      .bind(market)
      .all(),
    loadRatesDetailed(env.DB),
  ]);

  const positions = results ?? [];

  if (positions.length === 0) {
    return Response.json({
      success: true,
      data: {
        market,
        totalValueCNY: 0,
        totalCostCNY: 0,
        totalPnlCNY: 0,
        totalPnlPercent: 0,
        positionCount: 0,
        positions: [],
      },
    });
  }

  let totalValueCNY = 0;
  let totalCostCNY = 0;

  /** @type {object[]} */
  const positionDetails = positions.map((p) => {
    const currency = marketCurrency(p.market);
    const liveRateToCNY = ratesInfo.rates?.[currency]?.rateToCNY ?? p.open_rate_to_cny ?? 1;
    const currentPrice = p.quote_price ?? p.open_price;

    const costCNY = (p.open_price * p.quantity + (p.commission ?? 0)) * liveRateToCNY;
    const valueCNY = currentPrice * p.quantity * liveRateToCNY;
    const pnlCNY = valueCNY - costCNY;
    const pnlPercent = costCNY !== 0 ? (pnlCNY / costCNY) * 100 : 0;

    totalCostCNY += costCNY;
    totalValueCNY += valueCNY;

    return {
      id: p.id,
      symbol: p.symbol,
      name: p.name,
      currency,
      quantity: p.quantity,
      openPrice: p.open_price,
      currentPrice,
      rateToCNY: round2(liveRateToCNY),
      costCNY: round2(costCNY),
      valueCNY: round2(valueCNY),
      pnlCNY: round2(pnlCNY),
      pnlPercent: round2(pnlPercent),
      sector: p.sector,
      beta: p.beta,
      quoteUpdatedAt: p.quote_updated_at ?? null,
    };
  });

  const totalPnlCNY = totalValueCNY - totalCostCNY;
  const totalPnlPercent = totalCostCNY !== 0
    ? (totalPnlCNY / totalCostCNY) * 100
    : 0;

  return Response.json(
    {
      success: true,
      data: {
        market,
        totalValueCNY: round2(totalValueCNY),
        totalCostCNY: round2(totalCostCNY),
        totalPnlCNY: round2(totalPnlCNY),
        totalPnlPercent: round2(totalPnlPercent),
        positionCount: positions.length,
        positions: positionDetails,
      },
    },
    {
      headers: {
        'Cache-Control': 'public, max-age=30',
      },
    },
  );
}
