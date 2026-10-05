/**
 * @fileoverview GET /api/agent/markets — Per-market portfolio summaries.
 *
 * Route:
 *   GET /api/agent/markets
 *
 * READ-ONLY: uses cached quotes & rates. Does not fetch external prices or write snapshots.
 *
 * Fixes addressed:
 *   - B7: Currency derived from market via marketCurrency; uses shared loadRates; unified fallback rates
 *   - Missing snapshot returns ytdPnlCNY: null (consistent with portfolio, not 0)
 *   - Q2: Cost converted using live exchange rate (consistent with Dashboard)
 *   - Q3: Currency derived from market
 */

import {
  round2,
  marketCurrency,
  getRateToCNY,
  loadRates,
  loadQuoteMap,
  successResponse,
  errorResponse,
} from '../../../lib/agent-common.js';

export async function onRequestGet({ env }) {
  const db = env?.DB;
  if (!db) {
    return errorResponse('DB_UNAVAILABLE', '数据库连接不可用', 500);
  }

  try {
    // 1. OPEN positions, cached quotes, exchange rates, and per-market snapshots
    const [posResult, quoteMap, rates, snapResult] = await Promise.all([
      db.prepare(
        "SELECT id, symbol, market, open_price, quantity, commission FROM positions WHERE status = 'OPEN'"
      ).all(),
      loadQuoteMap(db),
      loadRates(db),
      db.prepare(
        `SELECT market, ytd_pnl_cny
         FROM portfolio_snapshots
         WHERE (market, snapshot_date) IN (
           SELECT market, MAX(snapshot_date)
           FROM portfolio_snapshots
           GROUP BY market
         )`
      ).all(),
    ]);

    // Build YTD lookup from latest snapshots
    const ytdByMarket = {};
    for (const row of snapResult.results || []) {
      ytdByMarket[row.market] = row.ytd_pnl_cny != null ? round2(Number(row.ytd_pnl_cny)) : null;
    }

    // Aggregate by market
    const marketData = {};

    for (const pos of posResult.results || []) {
      const market = pos.market;
      if (!marketData[market]) {
        marketData[market] = {
          positionCount: 0,
          totalValueCNY: 0,
          totalCostCNY: 0,
          totalPnlCNY: 0,
          pnlPercent: 0,
          ytdPnlCNY: null,
        };
      }

      const entry = marketData[market];
      const currency = marketCurrency(market);
      const rate = getRateToCNY(currency, rates);

      // Q2: Cost in CNY using live exchange rate
      const costOriginal = (pos.open_price * pos.quantity) + (pos.commission || 0);
      const costCNY = round2(costOriginal * rate);

      // Current value in CNY (quote_cache price, fallback to open_price)
      const quote = quoteMap.get(pos.symbol?.toUpperCase());
      const currentPrice = (quote && quote.price != null) ? Number(quote.price) : pos.open_price;
      const valueCNY = round2(pos.quantity * currentPrice * rate);

      entry.positionCount += 1;
      entry.totalCostCNY += costCNY;
      entry.totalValueCNY += valueCNY;
    }

    // Finalize rounded values, percentages, and YTD
    for (const [market, entry] of Object.entries(marketData)) {
      entry.totalValueCNY = round2(entry.totalValueCNY);
      entry.totalCostCNY = round2(entry.totalCostCNY);
      entry.totalPnlCNY = round2(entry.totalValueCNY - entry.totalCostCNY);
      entry.pnlPercent = entry.totalCostCNY !== 0
        ? round2((entry.totalPnlCNY / entry.totalCostCNY) * 100)
        : 0;
      // Missing snapshot returns null (not 0)
      entry.ytdPnlCNY = ytdByMarket[market] !== undefined ? ytdByMarket[market] : null;
    }

    return successResponse({
      markets: marketData,
    });
  } catch (err) {
    console.error('[agent:markets]', err);
    return errorResponse('SERVER_ERROR', '系统内部错误，无法获取分市场汇总', 500);
  }
}
